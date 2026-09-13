//! An empty tiled backdrop, and the command that writes one.
//!
//! What New Background writes for an image backdrop. It is its own module
//! rather than another arm of `psd_write` for two reasons: the file it writes
//! is unlike every other one this editor makes — no artwork crosses the
//! bridge at all, because the raster is tens of megapixels and base64 is not
//! a way to move one — and the line rule at the top of README-TECHNICAL.
//!
//! The shape of the file is the spec's: the anchor mark, so the editor knows
//! which grid space the backdrop's top-left sits on, and `T | Background`
//! holding one transparent sprite layer to paint into. `T |` is psd-to-json's
//! tileset prefix, which is what makes the runtime load a thirty-tile backdrop
//! as the camera reaches each piece of it rather than as one enormous texture.

use crate::psd_marks;
use crate::psd_pipeline::{self, ProcessOptions};
use crate::psd_write::{self, AnchorMarks};
use crate::store;
use crate::{logger, ImportResult};
use psd::{GroupBuilder, LayerBuilder, PsdBuilder};

/// The name of the tile group in a generated background, and of the sprite
/// inside it.
///
/// Fixed rather than derived from the file's key, because the point of a
/// background PSD is that the artist opens it and paints into a row whose
/// name says what it is for. `T |` is psd-to-json's tileset prefix: the group
/// is sliced into tiles the runtime loads as the camera reaches them, which
/// is the only way a backdrop thirty tiles wide is a backdrop rather than one
/// enormous texture.
pub const BACKGROUND_GROUP: &str = "T | Background";
pub const BACKGROUND_SPRITE: &str = "S | background";

/// The biggest backdrop this will write, in pixels.
///
/// A tiled background is a raster the size of the whole backdrop, and the
/// buffer for it exists in memory before the file does — thirty tiles by ten
/// at a 512px slice is already 78 megapixels. The ceiling is what turns
/// "sixty by forty" from an allocation nobody can recover from into a
/// sentence naming the limit. It is well clear of the default.
const MAX_BACKGROUND_PIXELS: u64 = 160_000_000;

/// An empty tiled backdrop: a canvas of whole tiles, ready to be painted.
///
/// What New Background writes for an image backdrop. The file is the size the
/// backdrop is going to be — that is the whole of what "how many tiles"
/// asks — and it holds two things: the anchor mark, so the editor knows
/// which grid space the top-left corner sits on, and `T | Background`
/// holding one transparent sprite layer to paint into.
///
/// It is written here rather than rasterised in the editor and sent across
/// for the reason the size makes obvious: a base64 of a 78-megapixel RGBA
/// buffer is four hundred megabytes of string through an IPC bridge. The
/// pixels are all zero, so the allocation is a zero page until something
/// touches it and the compressed file is a few kilobytes.
pub fn psd_from_empty_tiles_marked(
    width: u32,
    height: u32,
    marks: &AnchorMarks,
) -> Result<Vec<u8>, String> {
    let pixels = (width as u64) * (height as u64);
    if pixels == 0 {
        return Err("A background needs at least one tile".to_string());
    }
    if pixels > MAX_BACKGROUND_PIXELS {
        return Err(format!(
            "That background is {width}x{height} pixels, past the {} megapixel \
             limit. Ask for fewer tiles.",
            MAX_BACKGROUND_PIXELS / 1_000_000
        ));
    }

    let layout = psd_marks::layout(width, height, marks);
    let mut builder = PsdBuilder::new(layout.canvas_width, layout.canvas_height);
    // Clear, so what the artist paints is the whole of what the backdrop is.
    let rgba = vec![0u8; (pixels as usize) * 4];
    builder.add_group(
        GroupBuilder::new(BACKGROUND_GROUP).add_layer(
            LayerBuilder::new(BACKGROUND_SPRITE)
                .rgba(width, height, rgba)
                .at(layout.art_left, layout.art_top),
        ),
    );
    // The anchor over the artwork, as every import has it: the mark stays
    // visible while somebody paints underneath it.
    for layer in psd_marks::layers(&layout, marks) {
        builder.add_layer(layer);
    }
    builder
        .to_bytes()
        .map_err(|e| format!("Failed to write PSD: {e:?}"))
}

/// An empty tiled backdrop, the size of the backdrop it is going to be.
///
/// What New Background writes for an image backdrop: a PSD `cols` x `rows`
/// tiles across, holding the anchor mark and `T | Background` with one
/// transparent sprite layer inside it. Written here rather than rasterised in
/// the editor because the buffer is tens of megapixels and base64 over the
/// bridge is not a way to move one — see `psd_write::psd_from_empty_tiles_marked`.
#[tauri::command(async)]
pub fn create_background_psd(
    app: tauri::AppHandle,
    id: String,
    name: String,
    cols: u32,
    rows: u32,
    tile_size: u32,
    marks: AnchorMarks,
) -> Result<ImportResult, String> {
    let tile = tile_size.max(1);
    let width = cols.max(1).saturating_mul(tile);
    let height = rows.max(1).saturating_mul(tile);

    let key = psd_write::sanitise_stem(&name);
    let psd_bytes = psd_from_empty_tiles_marked(width, height, &marks)?;
    let dest = store::psd_dir(&id)?.join(format!("{key}.psd"));
    std::fs::write(&dest, psd_bytes).map_err(|e| e.to_string())?;

    // The file's own size rather than the one asked for: the marks grow the
    // canvas around the artwork, as they do on every other import path.
    let (width, height) = psd_pipeline::psd_dimensions(&dest)?;
    let manifest = psd_pipeline::process(&id, &key, &ProcessOptions::default(), logger(&app))?;
    Ok(ImportResult {
        key,
        width,
        height,
        manifest,
    })
}
