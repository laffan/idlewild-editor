//! Reading and rewriting a PSD's layer stack.
//!
//! The inspector lists a selected PSD's real layers so they can be reordered
//! and renamed without leaving the editor. Both matter to the game: order is
//! draw order, and the name carries psd-to-json's pipe convention, so
//! renaming `S | tower` to `T | tower` is what turns a sprite into a tileset.
//!
//! ## Why rewriting is guarded
//!
//! The `psd` fork writes a file by rebuilding it from RGBA. There is no way
//! to edit a layer record in place, so a rename is a full rebuild — and a
//! rebuild only preserves what `LayerBuilder` can express: pixels, position,
//! name, opacity, visibility and blend mode.
//!
//! Groups, layer masks and clipping masks are none of those. A file using
//! them would come back flattened, having quietly lost work someone did in
//! Photoshop, so `read` reports the file unwritable instead and the inspector
//! shows the list read-only. Every PSD this editor generates is flat, which
//! is the case the feature is mostly for.

use crate::psd_pipeline;
use psd::{LayerBuilder, Psd, PsdBuilder};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PsdLayerInfo {
    /// Position in the list as shown — topmost first, as Photoshop shows it.
    pub index: usize,
    pub name: String,
    pub visible: bool,
    pub opacity: u8,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    /// What psd-to-json will make of it, from the pipe prefix.
    pub category: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PsdLayerList {
    pub key: String,
    pub width: u32,
    pub height: u32,
    pub layers: Vec<PsdLayerInfo>,
    /// False when rewriting would lose something — see the module note.
    pub writable: bool,
    /// Why not, in a sentence the inspector can show.
    pub blocked_by: Option<String>,
}

/// One layer in the order and under the name it should end up with.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerEdit {
    /// Where this layer is in the *current* file, as `read` numbered them.
    pub index: usize,
    pub name: String,
}

pub fn read(project_id: &str, key: &str) -> Result<PsdLayerList, String> {
    let path = psd_pipeline::psd_path(project_id, key)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read {key}.psd: {e}"))?;
    let doc = Psd::from_bytes(&bytes).map_err(|e| format!("Cannot parse {key}.psd: {e}"))?;

    let blocked_by = unwritable_because(&doc);
    let layers = doc
        .layers()
        .iter()
        .enumerate()
        .map(|(index, layer)| PsdLayerInfo {
            index,
            name: layer.name().to_string(),
            visible: layer.visible(),
            opacity: layer.opacity(),
            width: layer.width() as u32,
            height: layer.height() as u32,
            x: layer.layer_left(),
            y: layer.layer_top(),
            category: category_of(layer.name()),
        })
        .collect();

    Ok(PsdLayerList {
        key: key.to_string(),
        width: doc.width(),
        height: doc.height(),
        layers,
        writable: blocked_by.is_none(),
        blocked_by,
    })
}

/// Rewrite the file with the given layers, in the given order and under the
/// given names, then run it back through psd-to-json.
///
/// `edits` is the whole stack — a layer left out of it is left out of the
/// file, which is how a deletion would work if the inspector ever offered
/// one. Names are trimmed but otherwise taken as typed: the pipe convention
/// is the user's to get right, and refusing an unrecognised prefix would
/// stop them parking a layer out of the game deliberately.
pub fn write(
    project_id: &str,
    key: &str,
    edits: &[LayerEdit],
    emit_log: impl Fn(&str),
) -> Result<String, String> {
    let path = psd_pipeline::psd_path(project_id, key)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read {key}.psd: {e}"))?;
    let doc = Psd::from_bytes(&bytes).map_err(|e| format!("Cannot parse {key}.psd: {e}"))?;

    if let Some(reason) = unwritable_because(&doc) {
        return Err(reason);
    }
    if edits.is_empty() {
        return Err("A PSD needs at least one layer".to_string());
    }

    let (canvas_w, canvas_h) = (doc.width(), doc.height());
    let mut builder = PsdBuilder::new(canvas_w, canvas_h);

    // `layers()` reads top-first and `add_layer` stacks bottom-up, so the
    // edited order goes back in reversed. The round trip is pinned by a test.
    for edit in edits.iter().rev() {
        let layer = doc
            .layers()
            .get(edit.index)
            .ok_or_else(|| format!("No layer {} in {key}.psd", edit.index))?;

        let name = edit.name.trim();
        if name.is_empty() {
            return Err("A layer needs a name".to_string());
        }

        let (left, top, width, height, pixels) = crop(layer, canvas_w, canvas_h);
        if width == 0 || height == 0 {
            // Nothing of it is on the canvas, so there is nothing to write.
            continue;
        }
        builder.add_layer(
            LayerBuilder::new(name)
                .rgba(width, height, pixels)
                .at(left, top)
                .opacity(layer.opacity())
                .visible(layer.visible())
                .blend_mode(layer.blend_mode()),
        );
    }

    let rebuilt = builder
        .to_bytes()
        .map_err(|e| format!("Failed to write {key}.psd: {e:?}"))?;
    std::fs::write(&path, rebuilt).map_err(|e| format!("Cannot save {key}.psd: {e}"))?;

    emit_log(&format!("Rewrote psd/{key}.psd with {} layers", edits.len()));
    psd_pipeline::process(
        project_id,
        key,
        &psd_pipeline::ProcessOptions::default(),
        emit_log,
    )
}

/// Take a layer's own rectangle out of the canvas-sized buffer `rgba()`
/// hands back, clamped to the canvas.
///
/// Two traps here, both silent. `rgba()` returns the layer composited onto
/// the *whole canvas*, not its own rect, so the crop is a windowed read
/// rather than a copy — and anything hanging off the canvas edge was never
/// in that buffer to begin with. And `layer_right()` / `layer_bottom()` are
/// **inclusive** in this crate (`width() == right - left + 1`), so the size
/// is taken from `width()` and `height()` and every edge below is exclusive.
pub(crate) fn crop(
    layer: &psd::PsdLayer,
    canvas_w: u32,
    canvas_h: u32,
) -> (i32, i32, u32, u32, Vec<u8>) {
    let x0 = layer.layer_left().max(0);
    let y0 = layer.layer_top().max(0);
    let x1 = (layer.layer_left() + layer.width() as i32).min(canvas_w as i32);
    let y1 = (layer.layer_top() + layer.height() as i32).min(canvas_h as i32);
    if x1 <= x0 || y1 <= y0 {
        return (x0, y0, 0, 0, Vec::new());
    }

    let width = (x1 - x0) as u32;
    let height = (y1 - y0) as u32;
    let canvas = layer.rgba();
    let mut out = Vec::with_capacity((width * height * 4) as usize);
    for y in 0..height {
        let row = ((y0 as u32 + y) * canvas_w + x0 as u32) as usize * 4;
        out.extend_from_slice(&canvas[row..row + (width as usize) * 4]);
    }
    (x0, y0, width, height, out)
}

/// The reason the *inspector* cannot rewrite a file, or None when it can.
///
/// Stricter than `unrebuildable_because` by one case, and the difference is
/// what the two are for. The inspector edits a **flat list** of layers: it has
/// no way to say that a layer is inside a group, so a file with groups would
/// come back with all of them gone. A rewrite that builds the tree itself has
/// no such problem, which is why an extrusion — a group by construction — can
/// still be carried on in a file this reports read-only.
pub(crate) fn unwritable_because(doc: &Psd) -> Option<String> {
    if !doc.group_ids_in_order().is_empty() {
        return Some(
            "This PSD uses layer groups, so its names and order cannot be edited here."
                .to_string(),
        );
    }
    unrebuildable_because(doc)
}

/// The reason a file cannot be rebuilt at all, or None when it can.
///
/// Masks and clipping are none of what `LayerBuilder` can express, so a file
/// using them would come back having quietly lost work. Groups are not on the
/// list: `GroupBuilder` expresses those, and `psd_write::rewrite_parts_marked`
/// walks the tree and puts it back.
pub(crate) fn unrebuildable_because(doc: &Psd) -> Option<String> {
    for layer in doc.layers() {
        if layer.mask().is_some() || layer.has_vector_mask() {
            return Some(format!(
                "\"{}\" carries a mask, which a rewrite would lose.",
                layer.name()
            ));
        }
        // Read the sense of this carefully. The accessor is named for the
        // wrong half: its backing field is `clipping_base`, and the parser
        // sets it from `byte == 0` — which the PSD spec defines as *base*,
        // meaning not clipped. The fork's own `clipped_to_layer_below` notes
        // the same inversion. So a layer clipped to the one below reports
        // `false` here, and that is the case a rewrite would flatten.
        if !layer.is_clipping_mask() {
            return Some(format!(
                "\"{}\" is clipped to the layer below, which a rewrite would lose.",
                layer.name()
            ));
        }
    }
    None
}

/// What psd-to-json will make of a layer, read from its pipe prefix. Kept in
/// step with `parser.rs` there; anything else is ignored by the pipeline and
/// says so.
/// Rename the layers a file named after itself, when the file is renamed.
///
/// A converted image or a generated PSD has exactly one sprite layer, and it
/// is named after the key by construction — `S | sketch-mtw0b4rf`. Rename the
/// *file* and that layer keeps the old name, which is what the layers panel
/// then shows in its grey detail column: the correct name on the left and a
/// stale one on the right, for no reason a user could work out.
///
/// So the layer follows the file — but only a layer that was named after it.
/// A stack someone built in Photoshop has names of their own choosing and
/// nothing here has any business touching them, and a file this cannot
/// rewrite at all (groups, masks, clipping) is left exactly as it is: the
/// grey column showing a real layer path is the honest answer there.
///
/// Returns whether anything was rewritten, so a caller can skip re-parsing a
/// file it did not change.
pub fn rename_layers_named_after(
    project_id: &str,
    key: &str,
    from: &str,
    to: &str,
    emit_log: impl Fn(&str),
) -> Result<bool, String> {
    let list = read(project_id, key)?;
    if !list.writable {
        return Ok(false);
    }

    let mut edits = Vec::with_capacity(list.layers.len());
    let mut changed = false;
    for layer in &list.layers {
        let renamed = rename_segment(&layer.name, from, to);
        changed |= renamed != layer.name;
        edits.push(LayerEdit {
            index: layer.index,
            name: renamed,
        });
    }
    if !changed {
        return Ok(false);
    }

    write(project_id, key, &edits, emit_log)?;
    Ok(true)
}

/// The name psd-to-json exports a layer under: the second pipe segment.
pub(crate) fn exported_name(layer_name: &str) -> Option<&str> {
    let parts: Vec<&str> = layer_name.split('|').map(str::trim).collect();
    if parts.len() < 2 || parts.len() > 4 || parts[1].is_empty() {
        return None;
    }
    layer_name.split('|').nth(1).map(str::trim)
}

/// Swap the name out of `S | name`, leaving every other segment alone.
///
/// The second segment is what psd-to-json takes as the layer's name and what
/// a placement's `layerPath` points at; the prefix says what kind of thing it
/// is and is none of a rename's business.
fn rename_segment(layer_name: &str, from: &str, to: &str) -> String {
    let parts: Vec<&str> = layer_name.split('|').collect();
    if parts.len() < 2 || parts[1].trim() != from {
        return layer_name.to_string();
    }
    // Rebuilt from the original segments, so the prefix and any third or
    // fourth segment survive a rename of the second.
    parts
        .iter()
        .enumerate()
        .map(|(i, part)| {
            if i == 1 {
                format!(" {to} ")
            } else {
                part.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("|")
        .trim()
        .to_string()
}

pub(crate) fn category_of(name: &str) -> String {
    // The shape as well as the prefix: psd-to-json takes the name from the
    // second segment, so a layer called plain "S" is ignored rather than a
    // sprite, and so is one with five segments.
    let parts: Vec<&str> = name.split('|').map(str::trim).collect();
    if parts.len() < 2 || parts.len() > 4 || parts[1].is_empty() {
        return "ignored".to_string();
    }
    match parts[0].to_uppercase().as_str() {
        "S" => "sprite",
        "T" => "tileset",
        "G" => "group",
        "P" => "point",
        "Z" => "zone",
        _ => "ignored",
    }
    .to_string()
}
