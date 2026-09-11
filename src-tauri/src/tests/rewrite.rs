//! Rewriting the layers this editor generated, keeping the rest of the file.
//!
//! The difference between a second Apply and a first one. A first writes the
//! PSD from nothing, which is right for an import; a second has to rebuild
//! the file that is already there, or the afternoon somebody spent painting
//! over a generated block-out goes with it.
//!
//! An extrusion's artwork is a *group* — silhouette, shading and the lines
//! between spaces — so a rewrite has to put a tree back rather than a list,
//! which is the other half of what these pin.
//!
//! Split from `tests.rs` for the 700-line rule; they share the `swatch` it
//! defines.

use super::swatch;
use crate::psd_write::{self, Part};
use psd::{GroupBuilder, LayerBuilder, Psd, PsdBuilder};

/// The shape of the file an extrusion writes.
#[test]
fn an_extrusion_writes_a_group_of_parts() {
    let bytes = psd_write::psd_from_parts_marked(
        "extrude-abc",
        16,
        16,
        &parts(16, 16),
        &square(16.0),
    )
    .expect("a group should be written");

    let doc = Psd::from_bytes(&bytes).expect("the file should parse");
    let group = doc
        .groups()
        .values()
        .find(|g| g.name() == "G | extrude-abc")
        .expect("the artwork should be a group named after the key");

    let inside: Vec<&str> = doc
        .layers()
        .iter()
        .filter(|l| l.parent_id() == Some(group.id()))
        .map(|l| l.name())
        .collect();
    // Top-first, as Photoshop's panel reads and as the editor sends them.
    assert_eq!(
        inside,
        vec!["S | lines-abc", "S | shading-abc", "S | shape-abc"]
    );

    // The marks stay outside it, where psd-to-json reads them from.
    let top: Vec<&str> = doc
        .layers()
        .iter()
        .filter(|l| l.parent_id().is_none())
        .map(|l| l.name())
        .collect();
    assert!(top.contains(&"P | anchor"), "got {top:?}");
    assert!(top.iter().any(|n| n.starts_with("Z | grid")), "got {top:?}");
}

/// Every part shares its geometry, which is what makes resizing the placed
/// group exact: psd-to-phaser scales each child about its own origin.
#[test]
fn every_part_is_written_at_the_same_size_and_place() {
    let bytes =
        psd_write::psd_from_parts_marked("extrude-abc", 20, 12, &parts(20, 12), &square(20.0))
            .expect("a group should be written");
    let doc = Psd::from_bytes(&bytes).expect("the file should parse");

    let boxes: Vec<(i32, i32, u32, u32)> = doc
        .layers()
        .iter()
        .filter(|l| l.name().starts_with("S | "))
        .map(|l| (l.layer_left(), l.layer_top(), l.width() as u32, l.height() as u32))
        .collect();
    assert_eq!(boxes.len(), 3);
    assert!(
        boxes.windows(2).all(|w| w[0] == w[1]),
        "the parts should share one rectangle, got {boxes:?}"
    );
}

/// Applying a continued extrusion must not take the file back to what the
/// editor writes from nothing.
///
/// The round trip that found this: extrude, Apply, open the PSD and paint a
/// layer over the greybox, re-parse, carry the shape on, Apply again — and
/// the painted layer was gone, because the second Apply wrote a *new* file.
/// `rewrite_marked` rebuilds the one that is there instead.
#[test]
fn rewriting_a_marked_psd_keeps_the_layers_it_did_not_write() {

    // What Apply writes the first time: the group, the footprint, the anchor.
    let first =
        psd_write::psd_from_parts_marked("extrude-abc", 16, 16, &parts(16, 16), &square(16.0))
            .expect("the first apply should write a PSD");

    // What someone then does in Photoshop: a layer of their own over it.
    let painted = with_extra_layer(&first, "S | paint", 2, 2);
    let anchor_before = anchor_of(&painted);

    // And the second Apply, with the shape pulled bigger so the canvas grows.
    let second = psd_write::rewrite_parts_marked(
        &painted,
        "extrude-abc",
        48,
        48,
        &parts(48, 48),
        &square(48.0),
    )
    .expect("a second apply should rewrite the file");

    let out = Psd::from_bytes(&second).expect("the rewritten file should parse");
    let names: Vec<&str> = out.layers().iter().map(|l| l.name()).collect();
    assert!(
        names.contains(&"S | paint"),
        "the painted layer should survive, got {names:?}"
    );
    assert!(names.contains(&"S | shape-abc"), "got {names:?}");
    assert!(names.contains(&"P | anchor"), "got {names:?}");

    // The artwork is the new one, not the old.
    let art = out
        .layers()
        .iter()
        .find(|l| l.name() == "S | shape-abc")
        .expect("the artwork should be there");
    assert_eq!((art.width() as u32, art.height() as u32), (48, 48));

    // And the painted layer kept its place *on the artwork*: the canvas moved
    // under it, so what stays fixed is its offset from the anchor.
    let anchor_after = anchor_of(&second);
    let paint = out
        .layers()
        .iter()
        .find(|l| l.name() == "S | paint")
        .expect("the painted layer should be there");
    assert_eq!(
        (
            paint.layer_left() - anchor_after.0,
            paint.layer_top() - anchor_after.1
        ),
        (2 - anchor_before.0, 2 - anchor_before.1),
        "the painted layer should hold its position relative to the anchor"
    );
}

/// A file the fork cannot rebuild is refused rather than flattened — the same
/// rule a rename follows, for the same reason.
#[test]
fn rewriting_refuses_a_file_it_would_flatten() {
    use crate::psd_write::{AnchorMarks, MarkPoint};

    let at = |x: f32, y: f32| MarkPoint { x, y };
    let marks = AnchorMarks {
        outline: vec![at(0.0, 0.0), at(8.0, 0.0), at(8.0, 8.0), at(0.0, 8.0)],
        lines: vec![],
        art: Some(at(0.0, 0.0)),
        cols: 1,
        rows: 1,
    };
    let err = psd_write::rewrite_parts_marked(b"not a psd at all", "k", 8, 8, &parts(8, 8), &marks)
        .expect_err("nonsense should not be rewritten");
    assert!(err.contains("Cannot parse"), "got {err}");
}

/// The anchor mark's centre, which is the fixed point everything else in the
/// file is positioned against.
fn anchor_of(bytes: &[u8]) -> (i32, i32) {
    let doc = psd::Psd::from_bytes(bytes).expect("the file should parse");
    let layer = doc
        .layers()
        .iter()
        .find(|l| l.name() == "P | anchor")
        .expect("a marked file has an anchor");
    (
        layer.layer_left() + layer.width() as i32 / 2,
        layer.layer_top() + layer.height() as i32 / 2,
    )
}

/// A group someone made in Photoshop comes back a group, with what was in it
/// still in it. Groups are the one thing a rewrite *has* to understand now,
/// because the artwork it regenerates is one.
#[test]
fn rewriting_keeps_a_group_of_their_own() {
    let first =
        psd_write::psd_from_parts_marked("extrude-abc", 16, 16, &parts(16, 16), &square(16.0))
            .expect("the first apply should write a PSD");

    // Their own group, with a layer inside it, added over ours.
    let doc = Psd::from_bytes(&first).expect("the file should parse");
    let mut rebuilt = PsdBuilder::new(doc.width(), doc.height());
    carry_across(&doc, &mut rebuilt);
    rebuilt.add_group(
        GroupBuilder::new("G | theirs").add_layer(
            LayerBuilder::new("S | detail")
                .rgba(4, 4, swatch(4, 4, [1, 2, 3, 255]))
                .at(1, 1),
        ),
    );
    let theirs = rebuilt.to_bytes().expect("their file should write");

    let second =
        psd_write::rewrite_parts_marked(&theirs, "extrude-abc", 16, 16, &parts(16, 16), &square(16.0))
            .expect("a rewrite should keep their group");

    let out = Psd::from_bytes(&second).expect("the rewritten file should parse");
    let group = out
        .groups()
        .values()
        .find(|g| g.name() == "G | theirs")
        .expect("their group should survive");
    let inside: Vec<&str> = out
        .layers()
        .iter()
        .filter(|l| l.parent_id() == Some(group.id()))
        .map(|l| l.name())
        .collect();
    assert_eq!(inside, vec!["S | detail"]);
    // And ours is still a group of three beside it.
    assert_eq!(out.groups().len(), 2);
}

/// A file written before extrusions were groups has its artwork as one
/// top-level sprite. Carrying it on replaces that sprite with the group.
#[test]
fn rewriting_migrates_the_lone_sprite_an_older_build_wrote() {
    let old = psd_write::psd_from_rgba_marked(
        "extrude-abc",
        16,
        16,
        swatch(16, 16, [200, 200, 200, 255]),
        Some(&square(16.0)),
    )
    .expect("the old shape should write");
    let painted = with_extra_layer(&old, "S | paint", 2, 2);

    let out = psd_write::rewrite_parts_marked(
        &painted,
        "extrude-abc",
        16,
        16,
        &parts(16, 16),
        &square(16.0),
    )
    .expect("an older file should still be carried on");

    let doc = Psd::from_bytes(&out).expect("the rewritten file should parse");
    let names: Vec<&str> = doc.layers().iter().map(|l| l.name()).collect();
    assert!(
        !names.contains(&"S | extrude-abc"),
        "the lone sprite should be gone, got {names:?}"
    );
    assert!(names.contains(&"S | shape-abc"), "got {names:?}");
    assert!(names.contains(&"S | paint"), "got {names:?}");
    assert_eq!(doc.groups().len(), 1);
}

/// The three parts an extrusion sends, top-first as the panel lists them.
fn parts(width: u32, height: u32) -> Vec<Part> {
    [
        ("lines-abc", [90u8, 90, 90, 255]),
        ("shading-abc", [140, 140, 140, 255]),
        ("shape-abc", [230, 230, 230, 255]),
    ]
    .into_iter()
    .map(|(name, colour)| Part {
        name: name.to_string(),
        rgba: swatch(width, height, colour),
    })
    .collect()
}

/// A square footprint of the given side, anchored at its top-left.
fn square(side: f32) -> psd_write::AnchorMarks {
    use crate::psd_write::MarkPoint;
    let at = |x: f32, y: f32| MarkPoint { x, y };
    psd_write::AnchorMarks {
        outline: vec![at(0.0, 0.0), at(side, 0.0), at(side, side), at(0.0, side)],
        lines: vec![],
        art: Some(at(0.0, 0.0)),
        cols: 1,
        rows: 1,
    }
}

/// The same file with one more layer on top — what Photoshop is standing in
/// for in these.
fn with_extra_layer(bytes: &[u8], name: &str, x: i32, y: i32) -> Vec<u8> {
    let doc = Psd::from_bytes(bytes).expect("the file should parse");
    let mut rebuilt = PsdBuilder::new(doc.width(), doc.height());
    carry_across(&doc, &mut rebuilt);
    rebuilt.add_layer(
        LayerBuilder::new(name)
            .rgba(4, 4, swatch(4, 4, [10, 20, 30, 255]))
            .at(x, y),
    );
    rebuilt.to_bytes().expect("the edited file should write")
}

/// Copy a file's layers into a builder, keeping their order and grouping.
fn carry_across(doc: &Psd, into: &mut PsdBuilder) {
    for id in doc.group_ids_in_order() {
        let group = &doc.groups()[id];
        let mut built = GroupBuilder::new(group.name());
        for idx in group.contained_layers().rev() {
            let layer = doc.layer_by_idx(idx);
            let (left, top, w, h, pixels) =
                crate::psd_layers::crop(layer, doc.width(), doc.height());
            built = built.add_layer(LayerBuilder::new(layer.name()).rgba(w, h, pixels).at(left, top));
        }
        into.add_group(built);
    }
    for (idx, layer) in doc.layers().iter().enumerate().rev() {
        if layer.parent_id().is_some() {
            continue;
        }
        let _ = idx;
        let (left, top, w, h, pixels) = crate::psd_layers::crop(layer, doc.width(), doc.height());
        into.add_layer(LayerBuilder::new(layer.name()).rgba(w, h, pixels).at(left, top));
    }
}
