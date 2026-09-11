//! Rewriting the layers this editor generated, keeping the rest of the file.
//!
//! The difference between a second Apply and a first one. A first writes the
//! PSD from nothing, which is right for an import; a second has to rebuild
//! the file that is already there, or the afternoon somebody spent painting
//! over a generated block-out goes with it.
//!
//! Split from `tests.rs` for the 700-line rule; they share the `swatch` it
//! defines.

use super::swatch;
use crate::psd_write;

/// Applying a continued extrusion must not take the file back to what the
/// editor writes from nothing.
///
/// The round trip that found this: extrude, Apply, open the PSD and paint a
/// layer over the greybox, re-parse, carry the shape on, Apply again — and
/// the painted layer was gone, because the second Apply wrote a *new* file.
/// `rewrite_marked` rebuilds the one that is there instead.
#[test]
fn rewriting_a_marked_psd_keeps_the_layers_it_did_not_write() {
    use crate::psd_write::{AnchorMarks, MarkPoint};
    use psd::{LayerBuilder, Psd, PsdBuilder};

    let at = |x: f32, y: f32| MarkPoint { x, y };
    let square = |w: f32| AnchorMarks {
        outline: vec![at(0.0, 0.0), at(w, 0.0), at(w, w), at(0.0, w)],
        lines: vec![],
        art: Some(at(0.0, 0.0)),
        cols: 1,
        rows: 1,
    };

    // What Apply writes the first time: artwork, footprint, anchor.
    let first = psd_write::psd_from_rgba_marked(
        "extrude-abc",
        16,
        16,
        swatch(16, 16, [200, 200, 200, 255]),
        Some(&square(16.0)),
    )
    .expect("the first apply should write a PSD");

    // What someone then does in Photoshop: a layer of their own over it.
    let doc = Psd::from_bytes(&first).expect("the file should parse");
    let mut rebuilt = PsdBuilder::new(doc.width(), doc.height());
    for layer in doc.layers().iter().rev() {
        let (left, top, w, h, pixels) = crate::psd_layers::crop(layer, doc.width(), doc.height());
        rebuilt.add_layer(LayerBuilder::new(layer.name()).rgba(w, h, pixels).at(left, top));
    }
    rebuilt.add_layer(
        LayerBuilder::new("S | paint")
            .rgba(4, 4, swatch(4, 4, [10, 20, 30, 255]))
            .at(2, 2),
    );
    let painted = rebuilt.to_bytes().expect("the painted file should write");
    let anchor_before = anchor_of(&painted);

    // And the second Apply, with the shape pulled bigger so the canvas grows.
    let second = psd_write::rewrite_marked(
        &painted,
        "extrude-abc",
        48,
        48,
        swatch(48, 48, [180, 180, 180, 255]),
        &square(48.0),
    )
    .expect("a second apply should rewrite the file");

    let out = Psd::from_bytes(&second).expect("the rewritten file should parse");
    let names: Vec<&str> = out.layers().iter().map(|l| l.name()).collect();
    assert!(
        names.contains(&"S | paint"),
        "the painted layer should survive, got {names:?}"
    );
    assert!(names.contains(&"S | extrude-abc"), "got {names:?}");
    assert!(names.contains(&"P | anchor"), "got {names:?}");

    // The artwork is the new one, not the old.
    let art = out
        .layers()
        .iter()
        .find(|l| l.name() == "S | extrude-abc")
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
    let err = psd_write::rewrite_marked(b"not a psd at all", "k", 8, 8, swatch(8, 8, [0, 0, 0, 0]), &marks)
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
