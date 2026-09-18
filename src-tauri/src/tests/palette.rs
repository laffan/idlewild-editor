//! The palette strip a PSD carries out to another app.
//!
//! Three things about it are decisions rather than mechanics, and all three
//! would fail silently: it **replaces** rather than stacks, so the third share
//! of a file does not leave three strips in it; it comes **out** again when the
//! toggle is off, so turning the toggle off is something a file already sent
//! can be told about; and it is named outside the pipe convention, so a
//! project that turns the toggle on does not find a swatch strip loaded into
//! its running game as a sprite.
//!
//! The last of those is the one worth the whole file. Nothing in the editor
//! would notice — the strip would simply be in the manifest, and the first
//! sign of it would be a palette drawn over somebody's tileset.
//!
//! Split from `tests.rs` for the 700-line rule; it shares the store the rest
//! of the suite creates projects in, and `swatch`.

use super::swatch;
use crate::project::{GameOptions, Genre, ProjectMeta, Projection};
use crate::psd_palette::{self, PaletteStrip, LAYER_NAME};
use crate::{psd_layers, psd_pipeline, store};
use psd::{LayerBuilder, PsdBuilder};

/// A project holding one two-layer PSD called `hut`.
fn project(name: &str) -> ProjectMeta {
    let meta = store::create_project(
        name,
        Projection::Orthogonal,
        Genre::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let mut builder = PsdBuilder::new(32, 32);
    for layer in ["S | ground", "S | roof"] {
        builder.add_layer(LayerBuilder::new(layer).rgba(32, 32, swatch(32, 32, [9, 9, 9, 255])));
    }
    std::fs::write(
        store::psd_dir(&meta.id).unwrap().join("hut.psd"),
        builder.to_bytes().expect("PSD should build"),
    )
    .expect("PSD should save");

    meta
}

/// Every top-level row of `hut.psd`, top-first, as the inspector would list it.
fn names(id: &str) -> Vec<String> {
    psd_layers::read(id, "hut")
        .expect("the stack should read")
        .layers
        .into_iter()
        .filter(|row| row.depth == 0)
        .map(|row| row.name)
        .collect()
}

fn strip(colors: &[&str]) -> PaletteStrip {
    PaletteStrip {
        colors: colors.iter().map(|c| c.to_string()).collect(),
        // A quarter of this project's grid, which is what the editor sends.
        cell: 8,
    }
}

/// The strip goes on top, and a second send replaces it rather than stacking.
#[test]
fn a_palette_is_replaced_rather_than_repeated() {
    let meta = project("Palette");
    let result = std::panic::catch_unwind(|| {
        let id = &meta.id;

        let first = psd_palette::sync(id, "hut", Some(&strip(&["#ff0000", "#00ff00"])))
            .expect("the palette should attach");
        assert!(first.changed);
        assert_eq!(first.skipped, None);
        assert_eq!(names(id), vec![LAYER_NAME, "S | roof", "S | ground"]);

        // Sent again, with a palette somebody has since changed. One strip,
        // and it is the new one — three sends leaving three strips behind is
        // the failure this pins.
        psd_palette::sync(id, "hut", Some(&strip(&["#0000ff"])))
            .expect("the palette should attach again");
        psd_palette::sync(id, "hut", Some(&strip(&["#0000ff"])))
            .expect("the palette should attach again");
        assert_eq!(names(id), vec![LAYER_NAME, "S | roof", "S | ground"]);
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// Turning the toggle off takes the strip back out of a file that has one.
#[test]
fn a_palette_comes_out_again() {
    let meta = project("Palette off");
    let result = std::panic::catch_unwind(|| {
        let id = &meta.id;

        psd_palette::sync(id, "hut", Some(&strip(&["#ff0000"]))).expect("attach");
        assert_eq!(names(id).len(), 3);

        let off = psd_palette::sync(id, "hut", None).expect("the strip should come out");
        assert!(off.changed);
        assert_eq!(names(id), vec!["S | roof", "S | ground"]);

        // And a file with no strip and nothing asked for is not rewritten at
        // all, which is every project that has never turned the toggle on.
        let again = psd_palette::sync(id, "hut", None).expect("nothing to do");
        assert!(!again.changed);
        assert_eq!(again.skipped, None);
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// psd-to-json must not see the strip as artwork.
///
/// The layer is named outside the pipe convention on purpose — see
/// `psd_palette` — and this is the assertion that says so at the boundary
/// where it is decided rather than in a comment. A strip that arrived in the
/// manifest would be loaded into the running game as a sprite, and the first
/// sign of it would be a row of swatches drawn over somebody's tileset.
#[test]
fn the_pipeline_ignores_the_palette() {
    let meta = project("Palette pipeline");
    let result = std::panic::catch_unwind(|| {
        let id = &meta.id;
        psd_palette::sync(id, "hut", Some(&strip(&["#ff0000", "#00ff00", "#0000ff"])))
            .expect("attach");

        let manifest = psd_pipeline::process(
            id,
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
            .filter_map(|layer| layer["name"].as_str())
            .collect();
        assert_eq!(names, vec!["roof", "ground"]);
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// The squares are the colours, at the size the editor asked for.
///
/// The one thing the other three do not look at: they check the *layer* is in
/// the right place, and this checks it is a palette rather than a rectangle of
/// something. Read back off the file rather than off `draw`, so the hex, the
/// layout and the round trip through `psd_rebuild` are all in it.
#[test]
fn the_strip_is_the_palette() {
    let meta = project("Palette pixels");
    let result = std::panic::catch_unwind(|| {
        let id = &meta.id;
        psd_palette::sync(id, "hut", Some(&strip(&["#ff0000", "#00ff00", "#0000ff"])))
            .expect("attach");

        let bytes = std::fs::read(store::psd_dir(id).unwrap().join("hut.psd"))
            .expect("the PSD should read");
        let doc = psd::Psd::from_bytes(&bytes).expect("the PSD should parse");
        let layer = doc
            .layer_by_name(LAYER_NAME)
            .expect("the strip should be in the file");

        // Three 8px squares in a row, in the top-left corner of a 32px canvas.
        let rgba = layer.rgba();
        let at = |x: usize, y: usize| {
            let px = (y * 32 + x) * 4;
            [rgba[px], rgba[px + 1], rgba[px + 2], rgba[px + 3]]
        };
        assert_eq!(at(4, 4), [255, 0, 0, 255]);
        assert_eq!(at(12, 4), [0, 255, 0, 255]);
        assert_eq!(at(20, 4), [0, 0, 255, 255]);
        // And nothing past the third square: the strip is three cells wide,
        // not the width of the canvas.
        assert_eq!(at(28, 4)[3], 0);
        // Nor below it — one row, because three squares of 8 fit across 32.
        assert_eq!(at(4, 12)[3], 0);
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// The artwork underneath is untouched by a send.
///
/// A rewrite goes through `psd_rebuild`, which reassembles every layer from
/// its pixels: the risk is not that the strip is wrong but that the file
/// around it quietly stops being what it was.
#[test]
fn the_artwork_survives_a_send() {
    let meta = project("Palette artwork");
    let result = std::panic::catch_unwind(|| {
        let id = &meta.id;
        psd_palette::sync(id, "hut", Some(&strip(&["#ff0000"]))).expect("attach");

        let bytes = std::fs::read(store::psd_dir(id).unwrap().join("hut.psd"))
            .expect("the PSD should read");
        let doc = psd::Psd::from_bytes(&bytes).expect("the PSD should parse");
        assert_eq!(doc.width(), 32);
        assert_eq!(doc.height(), 32);

        let roof = doc
            .layer_by_name("S | roof")
            .expect("the artwork should still be there");
        assert_eq!(roof.rgba().len(), 32 * 32 * 4);
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}
