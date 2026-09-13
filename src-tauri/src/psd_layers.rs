//! Reading and rewriting a PSD's layer stack.
//!
//! The inspector lists a selected PSD's real layers so they can be reordered
//! and renamed without leaving the editor. Both matter to the game: order is
//! draw order, and the name carries psd-to-json's pipe convention, so
//! renaming `S | tower` to `T | tower` is what turns a sprite into a tileset.
//!
//! ## The list is a tree
//!
//! `Psd::layers()` is a flat run of the layers *inside* things; the groups
//! holding them live in `Psd::groups()` and appear in neither. So the list
//! the inspector shows is assembled here, in the order Photoshop's panel
//! reads: a group where its topmost child is, then its contents indented
//! under it. `rows` is that walk, and both halves go through it — `read` to
//! describe the file, `write` to resolve which row an edit names — so the
//! two cannot disagree about what row 3 is.
//!
//! ## Why rewriting is guarded
//!
//! The `psd` fork writes a file by rebuilding it from RGBA. There is no way
//! to edit a layer record in place, so a rename is a full rebuild — and a
//! rebuild only preserves what `LayerBuilder` can express: pixels, position,
//! name, opacity, visibility and blend mode, plus the grouping `GroupBuilder`
//! puts back.
//!
//! Layer masks and clipping masks are none of those. A file using them would
//! come back having quietly lost work someone did in Photoshop, so `read`
//! reports it unwritable and the inspector shows the list read-only.

use crate::psd_paint::Paint;
use crate::psd_rebuild::rebuild;
use crate::psd_pipeline;
use psd::Psd;
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
    /// Whether this row is a group holding the rows indented under it.
    pub is_group: bool,
    /// How deep it sits: zero at the top level, one inside a group.
    pub depth: usize,
}

/// One thing at a level of the stack: a layer, or a group and its contents.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Item {
    Layer(usize),
    Group(u32),
}

/// What sits directly at one level of a file, top-first as the panel reads.
///
/// There is no single ordered list of *items* to read: layers come top-first
/// by index, groups come bottom-first by id. Both can be placed in the layer
/// index space, though — a group sits where its topmost child does — so
/// sorting on that interleaves them the way Photoshop shows them.
pub(crate) fn items(doc: &Psd, parent: Option<u32>) -> Vec<Item> {
    let mut out: Vec<(usize, Item)> = Vec::new();
    for (index, layer) in doc.layers().iter().enumerate() {
        if layer.parent_id() == parent {
            out.push((index, Item::Layer(index)));
        }
    }
    for (id, group) in doc.groups() {
        if group.parent_id() == parent {
            out.push((group.contained_layers().start, Item::Group(*id)));
        }
    }
    out.sort_by_key(|(at, _)| *at);
    out.into_iter().map(|(_, item)| item).collect()
}

/// One row of the list the inspector shows: what it is, and how deep.
pub(crate) struct Row {
    pub item: Item,
    pub depth: usize,
}

/// The whole file as a list of rows, top-first and depth-first.
///
/// The one walk both `read` and `write` use, so a row index means the same
/// thing to each of them.
pub(crate) fn rows(doc: &Psd) -> Vec<Row> {
    let mut out = Vec::new();
    walk(doc, None, 0, &mut out);
    out
}

fn walk(doc: &Psd, parent: Option<u32>, depth: usize, out: &mut Vec<Row>) {
    for item in items(doc, parent) {
        out.push(Row { item, depth });
        if let Item::Group(id) = item {
            walk(doc, Some(id), depth + 1, out);
        }
    }
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

/// One row in the order, at the depth, and under the name it should end up
/// with.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerEdit {
    /// Which row of the list `read` returned this is.
    ///
    /// None for a row that is not in the file yet — the empty layer the
    /// inspector's New layer button asks for, which is written as a single
    /// transparent pixel because a layer of no pixels is not a layer the
    /// fork will write. See `add`.
    #[serde(default)]
    pub index: Option<usize>,
    pub name: String,
    /// Where it sits in the rebuilt tree. Zero is the top level.
    #[serde(default)]
    pub depth: usize,
    /// Whether the layer's eye is on, or None to leave it as the file has it.
    ///
    /// A rewrite has always carried visibility across untouched, which is
    /// what an edit list that says nothing about it still means. Saying
    /// something is how the inspector's eye column reaches the file — and it
    /// goes into the file rather than into the document because it is a fact
    /// about the *artwork*: Photoshop shows it, psd-to-json reports it, and
    /// every scene that places this PSD agrees about it for free.
    #[serde(default)]
    pub visible: Option<bool>,
    /// Ink to lay over whatever this row already holds. See `psd_paint`.
    #[serde(default)]
    pub paint: Option<Paint>,
}

impl LayerEdit {
    /// A row carried across unchanged, named by where it is now.
    pub(crate) fn keep(index: usize, name: String, depth: usize) -> Self {
        LayerEdit {
            index: Some(index),
            name,
            depth,
            visible: None,
            paint: None,
        }
    }
}

pub fn read(project_id: &str, key: &str) -> Result<PsdLayerList, String> {
    let path = psd_pipeline::psd_path(project_id, key)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read {key}.psd: {e}"))?;
    let doc = Psd::from_bytes(&bytes).map_err(|e| format!("Cannot parse {key}.psd: {e}"))?;

    let blocked_by = unwritable_because(&doc);
    let layers = rows(&doc)
        .iter()
        .enumerate()
        .map(|(index, row)| match row.item {
            Item::Layer(at) => {
                let layer = doc.layer_by_idx(at);
                PsdLayerInfo {
                    index,
                    name: layer.name().to_string(),
                    visible: layer.visible(),
                    opacity: layer.opacity(),
                    width: layer.width() as u32,
                    height: layer.height() as u32,
                    x: layer.layer_left(),
                    y: layer.layer_top(),
                    category: category_of(layer.name()),
                    is_group: false,
                    depth: row.depth,
                }
            }
            Item::Group(id) => {
                let group = &doc.groups()[&id];
                // A group divider carries zeroed bounds, so its size is the
                // box its contents actually cover.
                let (top, left, bottom, right) =
                    doc.group_bounds(id).unwrap_or((0, 0, 0, 0));
                PsdLayerInfo {
                    index,
                    name: group.name().to_string(),
                    visible: group.visible(),
                    opacity: group.opacity(),
                    width: (right - left + 1).max(0) as u32,
                    height: (bottom - top + 1).max(0) as u32,
                    x: left,
                    y: top,
                    category: category_of(group.name()),
                    is_group: true,
                    depth: row.depth,
                }
            }
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

/// Rewrite the file with the given rows, in the given order, at the given
/// depths and under the given names, then run it back through psd-to-json.
///
/// `edits` is the whole tree, flattened the way the inspector shows it: top
/// first, a group followed by what is inside it. A row left out of it is left
/// out of the file, which is how a deletion would work if the inspector ever
/// offered one. Names are trimmed but otherwise taken as typed: the pipe
/// convention is the user's to get right, and refusing an unrecognised prefix
/// would stop them parking a layer out of the game deliberately.
pub fn write(
    project_id: &str,
    key: &str,
    edits: &[LayerEdit],
    emit_log: impl Fn(&str),
) -> Result<String, String> {
    let _job = psd_pipeline::exclusive();
    write_held(project_id, key, edits, emit_log)
}

/// The same, for a caller already holding the pipeline lock.
///
/// `rename_and_process` is that caller: renaming a file and renaming the
/// layer inside it that was named after it are one job, so the lock is taken
/// once around the pair. Taking it here as well is a thread waiting for a
/// lock it is already holding, which is a hang rather than an error.
pub(crate) fn write_held(
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
    for edit in edits {
        if edit.name.trim().is_empty() {
            return Err("A layer needs a name".to_string());
        }
    }

    std::fs::write(&path, rebuild(&doc, edits)?)
        .map_err(|e| format!("Cannot save {key}.psd: {e}"))?;

    emit_log(&format!("Rewrote psd/{key}.psd with {} rows", edits.len()));
    psd_pipeline::process_held(
        project_id,
        key,
        &psd_pipeline::ProcessOptions::default(),
        emit_log,
    )
}

/// The file's own stack, as an edit list that changes nothing.
///
/// What `add` and `paint` start from: both are one change against a file
/// nobody has retyped, and expressing them as edits means they go through the
/// same rebuild a rewrite does rather than through a second one.
fn identity_edits(doc: &Psd) -> Vec<LayerEdit> {
    rows(doc)
        .iter()
        .enumerate()
        .map(|(index, row)| LayerEdit::keep(index, name_of(doc, row), row.depth))
        .collect()
}

pub(crate) fn name_of(doc: &Psd, row: &Row) -> String {
    match row.item {
        Item::Layer(at) => doc.layer_by_idx(at).name().to_string(),
        Item::Group(id) => doc.groups()[&id].name().to_string(),
    }
}

/// Put an empty sprite layer on the top of the stack, and say what is there
/// now.
///
/// The layer is a single transparent pixel. A layer of *no* pixels is not
/// something the fork will write, and a layer the size of the canvas would
/// arrive on the grid as a placement covering the whole file — invisible, and
/// swallowing every click over the artwork under it. One pixel is the
/// smallest honest placeholder, and the editor does not place a layer that
/// small (see `adoptNewLayers` in `game/reconcile.ts`); the first thing
/// painted into it replaces the rectangle outright, because a blank patch has
/// no bounds worth keeping — see `psd_paint`.
///
/// Sprite because that is what almost every layer in a game document is, and
/// because the prefix is one character to retype in the row that has just
/// appeared. The name is the first `layer-N` the file is not already using,
/// so a second press does not collide with the first.
pub fn add(project_id: &str, key: &str, emit_log: impl Fn(&str)) -> Result<String, String> {
    let _job = psd_pipeline::exclusive();
    let path = psd_pipeline::psd_path(project_id, key)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read {key}.psd: {e}"))?;
    let doc = Psd::from_bytes(&bytes).map_err(|e| format!("Cannot parse {key}.psd: {e}"))?;
    if let Some(reason) = unwritable_because(&doc) {
        return Err(reason);
    }

    let mut edits = vec![LayerEdit {
        index: None,
        name: format!("S | {}", spare_name(&doc)),
        depth: 0,
        // A row you asked for is a row you can see.
        visible: Some(true),
        paint: None,
    }];
    edits.extend(identity_edits(&doc));

    std::fs::write(&path, rebuild(&doc, &edits)?)
        .map_err(|e| format!("Cannot save {key}.psd: {e}"))?;
    emit_log(&format!("Added a layer to psd/{key}.psd"));
    psd_pipeline::process_held(
        project_id,
        key,
        &psd_pipeline::ProcessOptions::default(),
        emit_log,
    )
}

/// The first `layer-N` this file does not already export something under.
fn spare_name(doc: &Psd) -> String {
    let taken: Vec<String> = rows(doc)
        .iter()
        .filter_map(|row| exported_name(&name_of(doc, row)).map(str::to_lowercase))
        .collect();
    for n in 1.. {
        let candidate = format!("layer-{n}");
        if !taken.contains(&candidate) {
            return candidate;
        }
    }
    unreachable!("the search above only ends by returning")
}

/// Lay ink into one layer of the file, and run the pipeline over the result.
///
/// `index` is a row of the list `read` returned and `name` is what that row
/// was called when the editor read it. Both are checked, because the two are
/// only in step for as long as nobody else has rewritten the file: a paint
/// against a stale index would put somebody's drawing into the wrong layer,
/// which is the one failure here that would be silent.
pub fn paint(
    project_id: &str,
    key: &str,
    index: usize,
    name: &str,
    ink: Paint,
    emit_log: impl Fn(&str),
) -> Result<String, String> {
    let _job = psd_pipeline::exclusive();
    let path = psd_pipeline::psd_path(project_id, key)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read {key}.psd: {e}"))?;
    let doc = Psd::from_bytes(&bytes).map_err(|e| format!("Cannot parse {key}.psd: {e}"))?;
    if let Some(reason) = unwritable_because(&doc) {
        return Err(reason);
    }

    let mut edits = identity_edits(&doc);
    let edit = edits
        .get_mut(index)
        .ok_or_else(|| format!("No layer {index} in {key}.psd"))?;
    if edit.name != name {
        return Err(format!(
            "{key}.psd has changed under this drawing — \"{name}\" is now \"{}\"",
            edit.name
        ));
    }
    if matches!(rows(&doc)[index].item, Item::Group(_)) {
        return Err(format!("\"{name}\" is a group, not a layer to draw in"));
    }
    edit.paint = Some(ink);

    std::fs::write(&path, rebuild(&doc, &edits)?)
        .map_err(|e| format!("Cannot save {key}.psd: {e}"))?;
    emit_log(&format!("Painted \"{name}\" in psd/{key}.psd"));
    psd_pipeline::process_held(
        project_id,
        key,
        &psd_pipeline::ProcessOptions::default(),
        emit_log,
    )
}

/// Take a layer's own rectangle out of the canvas-sized buffer `rgba()`
/// hands back.
///
/// Three traps here, all silent. `rgba()` returns the layer composited onto
/// the *whole canvas*, not its own rect, so the read is a window into that
/// buffer rather than a copy. And `layer_right()` / `layer_bottom()` are
/// **inclusive** in this crate (`width() == right - left + 1`), so the size
/// is taken from `width()` and `height()` and every edge below is exclusive.
///
/// The third is why the rectangle handed back is the layer's **own** rather
/// than the part of it that fits. Anything hanging off the canvas edge was
/// never in `rgba()` to begin with, so those pixels are gone whatever this
/// does — but the *rectangle* is not, and it is load-bearing. `P | anchor` is
/// a twelve-pixel dot centred on the anchor, and `psd_marks::layout` puts the
/// anchor on the very edge of a sketch's canvas or, when the anchor space is
/// not one of the spaces the ink covers, outside it altogether. Clamping the
/// rectangle to the canvas therefore moved the mark's centre three pixels on
/// the first rewrite, and deleted the mark outright when the whole dot was
/// past the edge — a rename in the inspector, a New layer, or a stroke laid
/// down in pen mode, and the file came back with no anchor in it. So the
/// rect is kept and the part of it that is off the canvas comes back clear.
pub(crate) fn crop(
    layer: &psd::PsdLayer,
    canvas_w: u32,
    canvas_h: u32,
) -> (i32, i32, u32, u32, Vec<u8>) {
    let left = layer.layer_left();
    let top = layer.layer_top();
    let width = layer.width() as u32;
    let height = layer.height() as u32;
    if width == 0 || height == 0 {
        return (left, top, 0, 0, Vec::new());
    }

    let mut out = vec![0u8; (width as usize) * (height as usize) * 4];

    // The window of the layer that is actually on the canvas, which is the
    // only part `rgba()` can answer for.
    let x0 = left.max(0);
    let y0 = top.max(0);
    let x1 = (left + width as i32).min(canvas_w as i32);
    let y1 = (top + height as i32).min(canvas_h as i32);
    let canvas = layer.rgba();
    let expected = (canvas_w as usize) * (canvas_h as usize) * 4;
    if x1 > x0 && y1 > y0 && canvas.len() >= expected {
        let run = ((x1 - x0) as usize) * 4;
        for y in y0..y1 {
            let from = ((y as usize) * (canvas_w as usize) + x0 as usize) * 4;
            let into = (((y - top) as usize) * (width as usize)
                + ((x0 - left) as usize))
                * 4;
            out[into..into + run].copy_from_slice(&canvas[from..from + run]);
        }
    }
    (left, top, width, height, out)
}

/// The reason the *inspector* cannot rewrite a file, or None when it can.
///
/// The same answer as `unrebuildable_because` now that the list is a tree and
/// `write` puts one back. It stays a separate name because the two are asked
/// by different callers for different reasons, and the inspector is the one
/// that will grow another restriction first.
pub(crate) fn unwritable_because(doc: &Psd) -> Option<String> {
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
/// Only ever called from `psd_pipeline::rename_and_process`, which is holding
/// the pipeline lock — hence `write_held`.
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
        edits.push(LayerEdit::keep(layer.index, renamed, layer.depth));
    }
    if !changed {
        return Ok(false);
    }

    write_held(project_id, key, &edits, emit_log)?;
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
