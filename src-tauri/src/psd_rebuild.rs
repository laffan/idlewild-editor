//! Turning an edit list back into a PSD.
//!
//! The other half of `psd_layers`: that one reads the stack and decides what
//! a change to it means, this one writes the file that change describes. It
//! is apart because three different operations end here — a rewrite the user
//! typed, an added layer, ink laid into one layer — and every awkward part of
//! putting a PSD back together is worth having in exactly one place.
//!
//! ## What is awkward about it
//!
//! `PsdBuilder` stacks bottom-up while every list in this editor reads
//! top-first, so the tree goes back in reversed. `nest` reads the flat run of
//! rows the inspector shows into the tree its depths describe. And a layer's
//! pixels come out of `crop`, which is a windowed read of a canvas-sized
//! buffer rather than a copy — see the note on it in `psd_layers`.

use crate::psd_layers::{crop, rows, Item, LayerEdit, Row};
use crate::psd_paint::{self, Patch};
use psd::{GroupBuilder, LayerBuilder, Psd, PsdBuilder};

/// The file rebuilt from a whole tree of edits, as bytes.
///
/// Split out of `write` because two other operations are the same rebuild
/// over a list nobody typed: `add` puts one extra row on the front of the
/// file's own order, and `paint` hands one row some ink. Doing either through
/// this rather than through a second builder is what keeps the awkward parts
/// — the crop, the inclusive edges, the reversal — written once.
pub(crate) fn rebuild(doc: &Psd, edits: &[LayerEdit]) -> Result<Vec<u8>, String> {
    let source = rows(doc);
    let tree = nest(edits, 0, &mut 0);
    let mut builder = PsdBuilder::new(doc.width(), doc.height());
    // The tree reads top-first and `add_*` stacks bottom-up.
    for node in tree.iter().rev() {
        emit(doc, &source, node, &mut builder)?;
    }
    builder
        .to_bytes()
        .map_err(|e| format!("Failed to write the PSD: {e:?}"))
}

/// One edited row and whatever the rows after it put inside it.
struct Node<'a> {
    edit: &'a LayerEdit,
    children: Vec<Node<'a>>,
}

/// Read a flat run of rows back into the tree its depths describe.
///
/// A row belongs to the last row shallower than it, which is what the indent
/// in the list is saying. Anything deeper than one step past its predecessor
/// is taken as one step: the list cannot show a gap, so there is no gap to
/// honour.
fn nest<'a>(edits: &'a [LayerEdit], depth: usize, at: &mut usize) -> Vec<Node<'a>> {
    let mut out = Vec::new();
    while *at < edits.len() {
        let edit = &edits[*at];
        if edit.depth < depth {
            break;
        }
        *at += 1;
        let children = nest(edits, depth + 1, at);
        out.push(Node { edit, children });
    }
    out
}

/// Put one node of the edited tree into the file being built.
fn emit(
    doc: &Psd,
    source: &[Row],
    node: &Node<'_>,
    into: &mut PsdBuilder,
) -> Result<(), String> {
    match built(doc, source, node)? {
        Some(Built::Layer(layer)) => {
            into.add_layer(layer);
        }
        Some(Built::Group(group)) => {
            into.add_group(group);
        }
        None => {}
    }
    Ok(())
}

enum Built {
    Layer(LayerBuilder),
    Group(GroupBuilder),
}

fn built(doc: &Psd, source: &[Row], node: &Node<'_>) -> Result<Option<Built>, String> {
    let name = node.edit.name.trim();
    let Some(index) = node.edit.index else {
        // A row that is not in the file yet. It is a layer rather than a
        // group because nothing offers to add a group, and it carries either
        // the ink it was created with or the single transparent pixel `add`
        // describes.
        return Ok(Some(Built::Layer(
            raster(name, blank_or(doc, node)?).visible(node.edit.visible.unwrap_or(true)),
        )));
    };
    let row = source
        .get(index)
        .ok_or_else(|| format!("No layer {index} in this PSD"))?;

    match row.item {
        Item::Group(id) => {
            let group = &doc.groups()[&id];
            // Visibility is the one property an edit may change; the rest
            // come off the file, because nothing offers a way to say them.
            let mut out = GroupBuilder::new(name)
                .opacity(group.opacity())
                .visible(node.edit.visible.unwrap_or(group.visible()))
                .blend_mode(group.blend_mode());
            for child in node.children.iter().rev() {
                match built(doc, source, child)? {
                    Some(Built::Layer(layer)) => out = out.add_layer(layer),
                    Some(Built::Group(inner)) => out = out.add_group(inner),
                    None => {}
                }
            }
            Ok(Some(Built::Group(out)))
        }
        Item::Layer(at) => {
            let layer = doc.layer_by_idx(at);
            let (left, top, width, height, pixels) = crop(layer, doc.width(), doc.height());
            let held = (width > 0 && height > 0).then(|| Patch {
                left,
                top,
                width,
                height,
                rgba: pixels,
            });
            // A rewrite never loses a row. A layer with no rectangle at all —
            // an empty one somebody left in the file — keeps its place as the
            // same clear pixel `psd_layers::add` writes, which is a row to
            // rename and reorder and nothing the game can see.
            let patch = painted(doc, node, held)?.unwrap_or(Patch {
                left,
                top,
                width: 1,
                height: 1,
                rgba: vec![0, 0, 0, 0],
            });
            Ok(Some(Built::Layer(
                raster(name, patch)
                    .opacity(layer.opacity())
                    .visible(node.edit.visible.unwrap_or(layer.visible()))
                    .blend_mode(layer.blend_mode()),
            )))
        }
    }
}

/// A layer builder holding one patch of pixels where the patch sits.
fn raster(name: &str, patch: Patch) -> LayerBuilder {
    LayerBuilder::new(name)
        .rgba(patch.width, patch.height, patch.rgba)
        .at(patch.left, patch.top)
}

/// What a row's pixels come to once this edit's ink has been laid over them.
///
/// None when there is nothing left to write, which is a layer that was
/// entirely off the canvas and has had no ink added to bring it back on.
fn painted(
    doc: &Psd,
    node: &Node<'_>,
    held: Option<Patch>,
) -> Result<Option<Patch>, String> {
    let Some(paint) = &node.edit.paint else {
        return Ok(held);
    };
    let ink = psd_paint::clip(paint.decode()?, doc.width(), doc.height());
    let taken = match paint.decode_erase()? {
        Some(mask) => psd_paint::clip(mask, doc.width(), doc.height()),
        None => None,
    };
    if ink.is_none() && taken.is_none() {
        // Every stroke fell outside the canvas. The layer keeps what it had.
        return Ok(held);
    }
    // A blank layer has no rectangle worth keeping — see `psd_paint`.
    let mut base = held.filter(|patch| !patch.is_blank());
    // **Erasing first, ink over what is left**, which is the order the strokes
    // were drawn in: a session that rubbed a hole and then drew into it sends
    // the hole in the mask and the new ink in the buffer, and laying the ink
    // first would have the hole take it straight back out again.
    if let Some(mask) = taken {
        base = base.map(|patch| psd_paint::cut(patch, &mask));
    }
    // Ink that is entirely transparent is not laid on at all. It arrives that
    // way from a session that only *rubbed* — nothing was drawn — and laying
    // it would grow the layer's rectangle to cover the rubbing with a margin
    // of nothing, which is the same "blank has no rectangle worth keeping"
    // rule read from the other side.
    Ok(match ink.filter(|patch| !patch.is_blank()) {
        Some(ink) => Some(psd_paint::over(base, ink)),
        None => base,
    })
}

/// The pixels a brand-new row starts life with: its ink, or one clear pixel.
fn blank_or(doc: &Psd, node: &Node<'_>) -> Result<Patch, String> {
    let clear = || Patch {
        left: 0,
        top: 0,
        width: 1,
        height: 1,
        rgba: vec![0, 0, 0, 0],
    };
    Ok(painted(doc, node, Some(clear()))?.unwrap_or_else(clear))
}
