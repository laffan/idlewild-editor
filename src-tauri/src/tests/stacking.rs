//! What a manifest says about the shape of the file it came from.
//!
//! The frontend mirrors this and has no way to check it. `lib/manifest.ts`
//! reads a PSD's layer order straight off the array psd-to-json writes and
//! records it on every placement, because once a placement is in the document
//! nothing in it says which of two layers was above. So the order is pinned
//! here, at the boundary where it is actually decided.
//!
//! Split from `tests.rs` for the 700-line rule; it shares the store the rest
//! of the suite creates projects in, and `swatch`.

use super::swatch;
use crate::project::{Genre, Projection};
use crate::{psd_pipeline, store};

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

    let meta = store::create_project("Stacking", Projection::Orthogonal, Genre::Topdown, 32)
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
