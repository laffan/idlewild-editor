//! A PSD as one picture — what a **merged** tile palette is cut from.
//!
//! A PSD dropped on a tile layer becomes a palette, and until now it became
//! one palette *per layer*: a building drawn as walls, roof and shadow came
//! into the sidebar as three pictures, each of them a sparse tileset with the
//! other two's tiles missing. That is genuinely useful when the layers are
//! separate sets of tiles, and it is the wrong answer for a sheet somebody
//! drew in layers and thinks of as one. So the panel offers both and this is
//! what the default one needs: a single picture of the file as it looks.
//!
//! **It is a real file under `assets/`, not a canvas in the sidebar.** A
//! tileset names the image its tiles are cut out of, and that name reaches
//! `game.config.json` — the first rule of tile layers is that what leaves is
//! indistinguishable from what Tiled would have written, and a tileset
//! pointing at a picture that exists only in the editor's memory would break
//! it. So the merge is written beside the layer sprites psd-to-json exported,
//! ships with a publish like the rest of `assets/`, and is loaded over the
//! asset server like the rest of them.
//!
//! **A re-parse rebuilds it**, because a re-parse clears `assets/<key>/` to
//! stop stale sprites outliving an import — see `psd_pipeline::process`,
//! which calls `refresh` on the way out. Only for a file that has a merged
//! palette in the document: a project that never made one should not carry a
//! second copy of every picture in it.
//!
//! **Composited here rather than read from psd-to-json's output**, because
//! psd-to-json writes one PNG per layer and no composite of its own. The
//! stack is walked bottom-first with alpha and per-layer opacity, which is
//! exactly what the canvas shows when it draws the same layers as separate
//! placements — so the palette and the artwork beside it agree.

use crate::psd_layers::{crop, items, Item};
use crate::{psd_pipeline, store};
use image::RgbaImage;
use psd::Psd;
use serde::Serialize;

/// What the merged picture is called inside a PSD's own assets directory.
pub const MERGED_FILE: &str = "merged.png";

/// The merged picture, as the editor needs to describe it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergedArt {
    /// Relative to the PSD's own `assets/<key>/`, as a manifest layer's is.
    pub file_path: String,
    pub width: u32,
    pub height: u32,
}

/// Write the merged picture for a PSD, and say what it is.
#[tauri::command(async)]
pub fn merge_psd_art(id: String, key: String) -> Result<MergedArt, String> {
    write(&id, &key)
}

/// Composite the file and write it beside its layer sprites.
pub fn write(project_id: &str, key: &str) -> Result<MergedArt, String> {
    let path = psd_pipeline::psd_path(project_id, key)?;
    let bytes = std::fs::read(&path)
        .map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    let doc = Psd::from_bytes(&bytes).map_err(|e| format!("Cannot read {key}.psd: {e:?}"))?;

    let (width, height) = (doc.width(), doc.height());
    if width == 0 || height == 0 {
        return Err(format!("{key}.psd has no canvas to merge"));
    }
    let mut canvas = RgbaImage::new(width, height);
    paint(&doc, None, 255, &mut canvas);

    let out = psd_pipeline::output_dir(project_id, key)?;
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let file = out.join(MERGED_FILE);
    canvas
        .save(&file)
        .map_err(|e| format!("Cannot write {}: {e}", file.display()))?;

    Ok(MergedArt {
        file_path: MERGED_FILE.to_string(),
        width,
        height,
    })
}

/// Rebuild it, but only for a file the document actually has one for.
///
/// Called at the end of every processing run, which has just cleared the
/// directory this writes into. Silent on every failure, deliberately: this is
/// a picture the palette needs and a re-import must not fail over one, and
/// the palette says so for itself by showing nothing if the file is missing.
pub fn refresh(project_id: &str, key: &str) {
    if !has_merged_palette(project_id, key) {
        return;
    }
    let _ = write(project_id, key);
}

/// Whether the document holds a merged palette cut from this file.
///
/// Read off the tileset's own properties rather than off a per-project
/// setting, because the tileset is the thing that names the picture: if
/// nothing points at `merged.png`, nothing wants it written. The key is
/// `idlewild:layer`, which a merged palette sets to `MERGED_LAYER` in place
/// of a layer path — see `src/lib/tile-layers.ts`.
fn has_merged_palette(project_id: &str, key: &str) -> bool {
    let Ok(raw) = store::read_doc(project_id) else {
        return false;
    };
    let Ok(doc) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return false;
    };
    let Some(tilesets) = doc.get("tilesets").and_then(|v| v.as_array()) else {
        return false;
    };
    tilesets.iter().any(|tileset| {
        property(tileset, PSD_PROPERTY) == Some(key)
            && property(tileset, PSD_LAYER_PROPERTY) == Some(MERGED_LAYER)
    })
}

/// The two custom properties a palette carries, as `lib/tiled/types.ts` names
/// them, and the layer path a merged one records in place of a real one.
///
/// Written out rather than shared, because the other end of them is
/// TypeScript. They are Tiled custom properties on a record this project
/// treats as Tiled's own, so they are as stable as the file format is — and
/// `tiles.rs` asserts that a merged palette written by the editor is one this
/// finds.
const PSD_PROPERTY: &str = "idlewild:psd";
const PSD_LAYER_PROPERTY: &str = "idlewild:layer";
const MERGED_LAYER: &str = "*merged*";

fn property<'a>(tileset: &'a serde_json::Value, name: &str) -> Option<&'a str> {
    tileset
        .get("properties")?
        .as_array()?
        .iter()
        .find(|p| p.get("name").and_then(|v| v.as_str()) == Some(name))?
        .get("value")?
        .as_str()
}

/// Paint one level of the stack onto the canvas, bottom-first.
///
/// `items` reads top-first, as Photoshop's own panel does, so it is walked in
/// reverse: the back of the stack goes down first and everything in front of
/// it is composited over.
///
/// `opacity` carries a group's down to its children, which is what Photoshop
/// does and what psd-to-json's export does not — a group at half opacity
/// exports its layers at full and the runtime dims the group. Here there is
/// no group left to dim, so it is folded in.
fn paint(doc: &Psd, parent: Option<u32>, opacity: u8, canvas: &mut RgbaImage) {
    for item in items(doc, parent).into_iter().rev() {
        match item {
            Item::Group(id) => {
                let Some(group) = doc.groups().get(&id) else {
                    continue;
                };
                if !group.visible() || is_mark(group.name()) {
                    continue;
                }
                paint(doc, Some(id), scale(opacity, group.opacity()), canvas);
            }
            Item::Layer(index) => {
                let layer = doc.layer_by_idx(index);
                // A hidden layer is not drawn on the canvas either, and the
                // two marks an import writes — `P | anchor` and `Z | grid` —
                // are the editor's own drawing rather than the artist's. Both
                // are skipped for the same reason: the merge has to look like
                // the artwork, because it is going to be cut into tiles.
                if !layer.visible() || is_mark(layer.name()) {
                    continue;
                }
                over(canvas, doc, layer, scale(opacity, layer.opacity()));
            }
        }
    }
}

/// One layer, composited over what is already down.
fn over(canvas: &mut RgbaImage, doc: &Psd, layer: &psd::PsdLayer, opacity: u8) {
    let (left, top, width, height, pixels) = crop(layer, doc.width(), doc.height());
    if width == 0 || height == 0 || opacity == 0 {
        return;
    }
    let (canvas_w, canvas_h) = (canvas.width() as i32, canvas.height() as i32);

    for y in 0..height as i32 {
        let cy = top + y;
        if cy < 0 || cy >= canvas_h {
            continue;
        }
        for x in 0..width as i32 {
            let cx = left + x;
            if cx < 0 || cx >= canvas_w {
                continue;
            }
            let at = ((y as usize) * (width as usize) + x as usize) * 4;
            let source = &pixels[at..at + 4];
            let alpha = (source[3] as u32 * opacity as u32) / 255;
            if alpha == 0 {
                continue;
            }
            let under = canvas.get_pixel_mut(cx as u32, cy as u32);
            *under = blend(under.0, [source[0], source[1], source[2]], alpha as u8);
        }
    }
}

/// Source-over, in straight (un-premultiplied) alpha.
fn blend(under: [u8; 4], rgb: [u8; 3], alpha: u8) -> image::Rgba<u8> {
    let sa = alpha as u32;
    let da = under[3] as u32;
    // The standard composite: the result's alpha is what the two cover
    // between them, and each channel is weighted by how much of it each
    // contributes. A fully transparent destination leaves the source's own
    // colour rather than mixing it with whatever happened to be in the
    // buffer, which the `out` guard below takes care of.
    let out = sa + da * (255 - sa) / 255;
    if out == 0 {
        return image::Rgba([0, 0, 0, 0]);
    }
    let mix = |s: u8, d: u8| -> u8 {
        let top = s as u32 * sa + d as u32 * da * (255 - sa) / 255;
        (top / out) as u8
    };
    image::Rgba([
        mix(rgb[0], under[0]),
        mix(rgb[1], under[1]),
        mix(rgb[2], under[2]),
        out as u8,
    ])
}

fn scale(a: u8, b: u8) -> u8 {
    ((a as u32 * b as u32) / 255) as u8
}

/// Whether a layer name is one of the editor's own orienting marks.
///
/// `P | anchor` and `Z | grid` are written by every import — see
/// `psd_marks.rs` — and they arrive with their eye off, so the visibility
/// check above already skips them. This is for the file somebody turned one
/// on in to line their artwork up and then brought home: a red dot baked into
/// a palette is a red dot in every tile it lands on.
fn is_mark(name: &str) -> bool {
    let parts: Vec<&str> = name.split('|').map(str::trim).collect();
    if parts.len() < 2 {
        return false;
    }
    matches!(parts[0].to_uppercase().as_str(), "P" | "Z")
}
