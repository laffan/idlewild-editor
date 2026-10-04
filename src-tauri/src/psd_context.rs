//! The canvas around a PSD, written into it on its way out to another app.
//!
//! A PSD's canvas is usually bigger than its artwork — the margin, the grid
//! footprint — and on the editor's canvas that box overlaps whatever stands
//! beside it: the wall the door goes in, the ground under the tree. Opened in
//! Photoshop the file has none of that, and the artist is drawing a door with
//! no wall. **Include context** fixes that: each time the file goes out
//! through Open PSD or Share PSD, the editor renders what is visible on the
//! canvas inside the PSD's box — everything but the PSD itself — and this
//! writes it in as a layer called `context`, at the bottom of the stack, at
//! half opacity, so the artwork is drawn over a faint picture of where it
//! stands.
//!
//! Like the palette strip (`psd_palette.rs`) it **syncs** rather than
//! appends: every send replaces the layer when the box is ticked and takes it
//! out when it is not. And like the strip it is named outside the pipe
//! convention, so psd-to-json ignores it — a picture of the neighbours must
//! never arrive in the game as a sprite — and nothing is re-parsed after.
//!
//! **Which `context` is ours.** The user asked for the plain name, and a plain
//! name is one an artist might use. So a layer is the editor's only if it is
//! at the root, called `context`, *and* at the half opacity this writes; an
//! artist's own `context` at any other opacity is never taken out.

use crate::psd_layers::{self, unwritable_because, Item, LayerEdit};
use crate::psd_pipeline;
use crate::psd_rebuild::rebuild;
use image::{imageops::FilterType, RgbaImage};
use psd::Psd;
use serde::Serialize;

/// What the layer is called — as asked, without a pipe.
pub const LAYER_NAME: &str = "context";

/// Half opacity, as the fork stores it.
pub const HALF: u8 = 128;

/// How far from half an opacity may be and still be ours — Photoshop rounds
/// 50% to 127 or 128 depending on how it was typed.
const SLACK: u8 = 3;

/// The picture the editor rendered: any size, scaled onto the canvas here.
pub struct ContextImage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// What a sync did, for the editor's log line.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextSync {
    pub changed: bool,
    /// Why nothing was written, when something was asked for.
    pub skipped: Option<String>,
}

/// Whether a root layer is the one this writes.
fn is_ours(name: &str, opacity: u8) -> bool {
    name.trim().eq_ignore_ascii_case(LAYER_NAME) && opacity.abs_diff(HALF) <= SLACK
}

/// Bring `<key>.psd`'s context layer into line: replaced with `image`, or
/// taken out when it is `None`.
pub fn sync(project_id: &str, key: &str, image: Option<ContextImage>) -> Result<ContextSync, String> {
    let _job = psd_pipeline::exclusive();
    let path = psd_pipeline::psd_path(project_id, key)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read {key}.psd: {e}"))?;
    let doc = Psd::from_bytes(&bytes).map_err(|e| format!("Cannot parse {key}.psd: {e}"))?;

    let rows = psd_layers::rows(&doc);
    let held: Vec<usize> = rows
        .iter()
        .enumerate()
        .filter(|(_, row)| match row.item {
            Item::Layer(at) if row.depth == 0 => {
                let layer = doc.layer_by_idx(at);
                is_ours(layer.name(), layer.opacity())
            }
            _ => false,
        })
        .map(|(index, _)| index)
        .collect();

    // Nothing wanted and nothing there: every file that has never had the box
    // ticked goes out without being touched.
    if image.is_none() && held.is_empty() {
        return Ok(ContextSync::default());
    }
    if let Some(reason) = unwritable_because(&doc) {
        return Ok(ContextSync {
            changed: false,
            skipped: Some(reason),
        });
    }

    let mut edits: Vec<LayerEdit> = rows
        .iter()
        .enumerate()
        .filter(|(index, _)| !held.contains(index))
        .map(|(index, row)| LayerEdit::keep(index, psd_layers::name_of(&doc, row), row.depth))
        .collect();
    if edits.is_empty() {
        return Ok(ContextSync {
            changed: false,
            skipped: Some(format!("{key}.psd has no layers besides the context")),
        });
    }
    if let Some(image) = image {
        let rgba = fitted(image, doc.width(), doc.height())?;
        // Last in the list is the bottom of the stack: under everything.
        edits.push(LayerEdit {
            index: None,
            name: LAYER_NAME.to_string(),
            depth: 0,
            visible: Some(true),
            paint: Some(crate::psd_paint::Paint {
                x: 0,
                y: 0,
                width: doc.width(),
                height: doc.height(),
                rgba,
                erase: None,
            }),
            opacity: Some(HALF),
        });
    }

    std::fs::write(&path, rebuild(&doc, &edits)?)
        .map_err(|e| format!("Cannot save {key}.psd: {e}"))?;
    Ok(ContextSync {
        changed: true,
        skipped: None,
    })
}

/// The rendered picture at exactly the canvas's size. The editor renders at
/// the file's density where it can, so this is usually a copy; a print file
/// bigger than a texture the device can hold arrives smaller and is scaled up.
fn fitted(image: ContextImage, width: u32, height: u32) -> Result<Vec<u8>, String> {
    let expected = (image.width as usize) * (image.height as usize) * 4;
    if image.width == 0 || image.height == 0 || image.rgba.len() != expected {
        return Err("The context picture is not the size it says".to_string());
    }
    if image.width == width && image.height == height {
        return Ok(image.rgba);
    }
    let picture = RgbaImage::from_raw(image.width, image.height, image.rgba)
        .ok_or("The context picture could not be read")?;
    Ok(image::imageops::resize(&picture, width, height, FilterType::Triangle).into_raw())
}

/// Include context, from the Open PSD / Share PSD control. The picture arrives
/// as raw bytes beside the arguments — see `ipc_bytes.rs` — or not at all,
/// which is the request to take the layer out.
#[tauri::command]
pub fn sync_psd_context(request: tauri::ipc::Request<'_>) -> Result<ContextSync, String> {
    let mut packed = crate::ipc_bytes::unpack::<ContextArgs>(&request)?;
    let image = match packed.args.image.take() {
        Some(wire) => Some(ContextImage {
            width: wire.width,
            height: wire.height,
            rgba: packed.take(wire.rgba)?,
        }),
        None => None,
    };
    sync(&packed.args.id, &packed.args.key, image)
}

#[derive(serde::Deserialize)]
struct ContextArgs {
    id: String,
    key: String,
    #[serde(default)]
    image: Option<ContextWire>,
}

#[derive(serde::Deserialize)]
struct ContextWire {
    width: u32,
    height: u32,
    rgba: crate::ipc_bytes::Bytes,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_half_opacity_context_at_the_root_is_ours() {
        assert!(is_ours("context", 128));
        assert!(is_ours(" Context ", 127));
        assert!(!is_ours("context", 255));
        assert!(!is_ours("context copy", 128));
    }

    #[test]
    fn a_smaller_render_is_scaled_onto_the_canvas() {
        let image = ContextImage { width: 2, height: 1, rgba: vec![255; 8] };
        assert_eq!(fitted(image, 4, 2).unwrap().len(), 4 * 2 * 4);
        let wrong = ContextImage { width: 2, height: 2, rgba: vec![0; 4] };
        assert!(fitted(wrong, 4, 2).is_err());
    }
}
