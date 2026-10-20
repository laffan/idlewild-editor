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

use crate::psd_layers::{crop, items, rows, Item};
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
    let canvas = composite(project_id, key)?;
    let (width, height) = canvas.dimensions();

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

/// The file as it looks, at its own size: every visible layer, without the
/// two orienting marks — what the merged palette is and what a thumbnail
/// shows.
fn composite(project_id: &str, key: &str) -> Result<RgbaImage, String> {
    let doc = parse(project_id, key)?;
    let (width, height) = (doc.width(), doc.height());
    if width == 0 || height == 0 {
        return Err(format!("{key}.psd has no canvas to merge"));
    }
    let mut canvas = RgbaImage::new(width, height);
    paint(&doc, None, 255, &mut canvas);
    Ok(canvas)
}

fn parse(project_id: &str, key: &str) -> Result<Psd, String> {
    let path = psd_pipeline::psd_path(project_id, key)?;
    let bytes = std::fs::read(&path)
        .map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    Psd::from_bytes(&bytes).map_err(|e| format!("Cannot read {key}.psd: {e:?}"))
}

/// A small picture of a placed file, for its row in the layer list.
///
/// The same composite as the merged palette, so the row shows what the canvas
/// does — hidden layers and the orienting marks left out — then **cropped to
/// the artwork** before it is shrunk: an import's canvas is padded out to
/// whole grid spaces, and a thumbnail of the padding would be a speck in a
/// box. Nothing is written; the answer is a PNG data URL, or an empty string
/// for a file with nothing visible in it, which the row draws as its icon.
#[tauri::command(async)]
pub fn psd_art_thumbnail(id: String, key: String, max_size: u32) -> Result<String, String> {
    thumbnail(&composite(&id, &key)?, max_size)
}

/// One row of a PSD's layer list as a picture, beside what names it.
///
/// The name and depth come with the picture so the editor can work out the
/// row's place in the manifest — `S | roof` inside `G | tower` is
/// `tower/roof` there — without reading the stack a second time.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerThumb {
    pub name: String,
    pub depth: usize,
    /// A PNG data URL, or empty for a layer with nothing in it.
    pub url: String,
}

/// A small picture of every row in a PSD's layer list, in the order
/// `psd_layers::read` lists them — the same walk, so index for index.
///
/// The same treatment as the file's own thumbnail: cropped to what is drawn
/// before it is shrunk. A layer is its own pixels, hidden or not — the row is
/// there to say what the layer *is*, and its eye says whether it shows. A
/// group is its contents composited the way the file's thumbnail is, so a
/// folder of a roof and walls looks like the building. One parse for the
/// whole list, which is why this is one command rather than one per row.
#[tauri::command(async)]
pub fn psd_layer_thumbnails(
    id: String,
    key: String,
    max_size: u32,
) -> Result<Vec<LayerThumb>, String> {
    let doc = parse(&id, &key)?;
    let (width, height) = (doc.width(), doc.height());
    rows(&doc)
        .iter()
        .map(|row| {
            let (name, picture) = match row.item {
                Item::Layer(at) => {
                    let layer = doc.layer_by_idx(at);
                    let (_, _, w, h, pixels) = crop(layer, width, height);
                    (layer.name().to_string(), RgbaImage::from_raw(w, h, pixels))
                }
                Item::Group(group) => {
                    let mut canvas = RgbaImage::new(width.max(1), height.max(1));
                    paint(&doc, Some(group), 255, &mut canvas);
                    let name = doc.groups().get(&group).map(|g| g.name().to_string());
                    (name.unwrap_or_default(), Some(canvas))
                }
            };
            let url = match picture {
                Some(picture) if picture.width() > 0 && picture.height() > 0 => {
                    thumbnail(&picture, max_size)?
                }
                _ => String::new(),
            };
            Ok(LayerThumb { name, depth: row.depth, url })
        })
        .collect()
}

/// Crop a picture to what is drawn in it and shrink it to fit `max_size`, as
/// a PNG data URL — or an empty string when nothing in it is drawn.
fn thumbnail(picture: &RgbaImage, max_size: u32) -> Result<String, String> {
    let Some((left, top, width, height)) = opaque_bounds(picture) else {
        return Ok(String::new());
    };
    let art = image::imageops::crop_imm(picture, left, top, width, height).to_image();
    let side = max_size.max(1);
    crate::psd_write::png_data_url(&image::DynamicImage::ImageRgba8(art).thumbnail(side, side))
}

/// The smallest rectangle holding every pixel with any alpha, or None.
fn opaque_bounds(canvas: &RgbaImage) -> Option<(u32, u32, u32, u32)> {
    let (mut left, mut top, mut right, mut bottom) = (u32::MAX, u32::MAX, 0, 0);
    for (x, y, pixel) in canvas.enumerate_pixels() {
        if pixel.0[3] == 0 {
            continue;
        }
        left = left.min(x);
        top = top.min(y);
        right = right.max(x);
        bottom = bottom.max(y);
    }
    (left <= right).then(|| (left, top, right - left + 1, bottom - top + 1))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounds_hold_every_visible_pixel_and_nothing_else() {
        let mut canvas = RgbaImage::new(10, 8);
        canvas.put_pixel(2, 3, image::Rgba([255, 0, 0, 255]));
        canvas.put_pixel(6, 5, image::Rgba([0, 0, 255, 1]));
        assert_eq!(opaque_bounds(&canvas), Some((2, 3, 5, 3)));
    }

    #[test]
    fn an_empty_canvas_has_no_bounds() {
        assert_eq!(opaque_bounds(&RgbaImage::new(4, 4)), None);
    }
}
