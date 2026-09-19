//! What a manifest says about the shape of the file it came from.
//!
//! The frontend mirrors this and has no way to check it. `lib/manifest.ts`
//! reads a PSD's layer order straight off the array psd-to-json writes and
//! records it on every placement, because once a placement is in the document
//! nothing in it says which of two layers was above. So the order is pinned
//! here, at the boundary where it is actually decided.
//!
//! The *rewrite* of a stack lives here too, for the same reason it is one
//! subject: `layers()` reads top-first and `add_layer` stacks bottom-up, so
//! what a manifest says about order and what a rewrite has to preserve about
//! it are two halves of one question, and they were a file apart.
//!
//! Split from `tests.rs` for the 700-line rule; it shares the store the rest
//! of the suite creates projects in, and `swatch`.

use super::swatch;
use crate::project::{GameOptions, Projection, Scaffold};
use crate::{psd_pipeline, psd_write, store};

/// The manifest lists a PSD's layers top-first, and says how they were stacked.
///
/// The editor reads the order straight off the array — `stackOrder` in
/// `lib/manifest.ts` numbers the last entry zero — and records it on every
/// placement, because once a placement is in the document nothing in it says
/// which of two layers was above. If psd-to-json ever listed them the other
/// way up, every multi-layer PSD would be drawn upside down and nothing in
/// the frontend would notice. So the order is pinned here, at the boundary
/// where it is decided.
#[test]
fn a_manifest_lists_layers_top_first() {
    use psd::{LayerBuilder, PsdBuilder};

    let meta = store::create_project(
        "Stacking",
        Projection::Orthogonal,
        Scaffold::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        // `add_layer` stacks bottom-up, so this is a hut with the ground at
        // the back, walls over it and a roof on top.
        let mut builder = PsdBuilder::new(32, 32);
        for name in ["S | ground", "S | walls", "S | roof"] {
            builder.add_layer(
                LayerBuilder::new(name).rgba(32, 32, swatch(32, 32, [9, 9, 9, 255])),
            );
        }
        std::fs::write(
            store::psd_dir(&meta.id).unwrap().join("hut.psd"),
            builder.to_bytes().expect("PSD should build"),
        )
        .expect("PSD should save");

        let manifest = psd_pipeline::process(
            &meta.id,
            "hut",
            &psd_pipeline::ProcessOptions::default(),
            |_| {},
        )
        .expect("processing should succeed");
        let parsed: serde_json::Value =
            serde_json::from_str(&manifest).expect("manifest should be JSON");
        let layers = parsed["layers"].as_array().expect("layers array");

        let names: Vec<&str> = layers
            .iter()
            .map(|l| l["name"].as_str().unwrap_or_default())
            .collect();
        assert_eq!(
            names,
            ["roof", "walls", "ground"],
            "the roof is on top, so it is listed first"
        );

        // And psd-to-json's own number for the same thing, counting up from
        // the back — which is what a placement's `order` mirrors.
        let depths: Vec<i64> = layers
            .iter()
            .map(|l| l["initialDepth"].as_i64().unwrap_or(-1))
            .collect();
        assert_eq!(depths, [2, 1, 0], "initialDepth counts up from the back");
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// Reading and rewriting a PSD's layer stack from the inspector.
///
/// The order round trip is the load-bearing part: `layers()` reads top-first
/// and `add_layer` stacks bottom-up, so a rewrite that forgot to reverse
/// would silently invert every file it touched.
#[test]
fn psd_layers_can_be_reordered_and_renamed() {
    use crate::psd_layers::{self, LayerEdit};
    use crate::psd_write::{AnchorMarks, MarkPoint};

    let meta = store::create_project(
        "Layers",
        Projection::Orthogonal,
        Scaffold::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let id = &meta.id;
        let at = |x: f32, y: f32| MarkPoint { x, y };
        let marks = AnchorMarks {
            outline: vec![at(0.0, 0.0), at(32.0, 0.0), at(32.0, 32.0), at(0.0, 32.0)],
            lines: vec![],
            art: None,
            margin: None,
            cols: 1,
            rows: 1,
        };
        let bytes = psd_write::psd_from_rgba_marked(
            "hut",
            32,
            32,
            swatch(32, 32, [9, 9, 9, 255]),
            Some(&marks),
        )
        .expect("marked PSD should be written");
        std::fs::write(store::psd_dir(id).expect("psd dir").join("hut.psd"), &bytes)
            .expect("PSD should save");

        // Read: top-first, as Photoshop shows it, with the pipe convention
        // spelled out so the inspector can say what each layer becomes.
        let before = psd_layers::read(id, "hut").expect("layers should read");
        assert!(before.writable, "a flat PSD should be writable");
        assert_eq!(before.blocked_by, None);
        let names: Vec<&str> = before.layers.iter().map(|l| l.name.as_str()).collect();
        // The artwork on top and the two marks under it, which is how every
        // file this editor writes is stacked — see `psd_marks`.
        assert_eq!(names, ["S | hut", "P | anchor", "Z | grid"]);
        let categories: Vec<&str> =
            before.layers.iter().map(|l| l.category.as_str()).collect();
        assert_eq!(categories, ["sprite", "point", "zone"]);

        // Write: put the sprite at the bottom and rename it, leaving the
        // rest alone — a real reorder, which is what the round trip is for.
        let edits = vec![
            LayerEdit::keep(1, "P | anchor".into(), 0),
            LayerEdit::keep(2, "Z | grid".into(), 0),
            LayerEdit::keep(0, "T | hut".into(), 0),
        ];
        let manifest = psd_layers::write(id, "hut", &edits, |_| {})
            .expect("rewrite should succeed");

        let after = psd_layers::read(id, "hut").expect("layers should read back");
        let names: Vec<&str> = after.layers.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(
            names,
            ["P | anchor", "Z | grid", "T | hut"],
            "the order asked for is the order stored"
        );

        // The canvas and each layer's geometry survive the rebuild.
        assert_eq!((after.width, after.height), (before.width, before.height));
        let sprite = &after.layers[2];
        let was = &before.layers[0];
        assert_eq!((sprite.x, sprite.y), (was.x, was.y));
        assert_eq!((sprite.width, sprite.height), (was.width, was.height));

        // And the rename reached psd-to-json: a tileset now, not a sprite.
        let parsed: serde_json::Value =
            serde_json::from_str(&manifest).expect("manifest should be JSON");
        let layers = parsed["layers"].as_array().expect("layers array");
        let hut = layers
            .iter()
            .find(|l| l["name"] == "hut")
            .expect("the renamed layer should be in the manifest");
        assert_eq!(hut["category"], "tileset");

        // An empty stack is refused rather than writing a file with nothing
        // in it, and an unknown index is an error rather than a silent skip.
        assert!(psd_layers::write(id, "hut", &[], |_| {}).is_err());
        assert!(psd_layers::write(
            id,
            "hut",
            &[LayerEdit::keep(99, "S | x".into(), 0)],
            |_| {},
        )
        .is_err());
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}
