//! A lassoed sketch becoming a PSD, all the way through the pipeline.
//!
//! The path `editor/stroke-actions.ts` takes: ink rasterised at double size on
//! a transparent ground, marked with the spaces it was drawn over and where
//! the ink sits inside them, written, parsed. Every other conversion in this
//! editor sends a rectangle of artwork that fills most of its canvas; a sketch
//! sends a few percent of one, and it is the only conversion whose footprint
//! is measured from the anchor *down* — so its marks land in places nothing
//! else reaches.
//!
//! What these pin is that the thing psd-to-json exports is the ink. A sketch
//! that writes correctly and exports blank looks, from inside the editor,
//! exactly like a sketch that vanished: the PSD opens perfectly in Photoshop
//! and the canvas shows nothing.

use super::swatch;
use crate::project::{GameOptions, Genre, Projection};
use crate::psd_write::{self, AnchorMarks, MarkLine, MarkPoint};
use crate::{psd_pipeline, store};

/// Ink: a transparent buffer with one opaque diagonal run through it.
fn ink(width: u32, height: u32) -> Vec<u8> {
    let mut rgba = vec![0u8; (width * height * 4) as usize];
    for x in 0..width {
        let y = (x * height / width).min(height - 1);
        let at = ((y * width + x) * 4) as usize;
        rgba[at..at + 4].copy_from_slice(&[32, 30, 29, 255]);
    }
    rgba
}

fn at(x: f32, y: f32) -> MarkPoint {
    MarkPoint { x, y }
}

/// Write a sketch into a fresh project and parse it, then hand the manifest to
/// `check`. The project goes whatever happens.
fn sketched(name: &str, marks: AnchorMarks, size: (u32, u32), check: impl Fn(&str) + std::panic::RefUnwindSafe) {
    let meta = store::create_project(
        "Sketch",
        Projection::Isometric,
        Genre::Topdown,
        64,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let id = &meta.id;
        let (w, h) = size;
        let bytes = psd_write::psd_from_rgba_marked(name, w, h, ink(w, h), Some(&marks))
            .expect("the sketch should convert");
        std::fs::write(
            store::psd_dir(id).expect("psd dir").join(format!("{name}.psd")),
            &bytes,
        )
        .expect("PSD should save");

        let manifest = psd_pipeline::process(
            id,
            name,
            &psd_pipeline::ProcessOptions::default(),
            |_| {},
        )
        .expect("the pipeline should run");
        check(&manifest);

        // And the pixels psd-to-phaser will load, which is the half a correct
        // manifest says nothing about.
        let parsed: serde_json::Value =
            serde_json::from_str(&manifest).expect("manifest should be JSON");
        let art = parsed["layers"]
            .as_array()
            .expect("layers array")
            .iter()
            .find(|l| l["name"] == name)
            .expect("the artwork should be in the manifest");
        let png = psd_pipeline::output_dir(id, name)
            .expect("output dir")
            .join(art["filePath"].as_str().expect("the sprite should export"));
        let image = image::open(&png)
            .unwrap_or_else(|e| panic!("{} should decode: {e}", png.display()))
            .to_rgba8();
        assert_eq!(image.dimensions(), (w, h), "the sprite is the ink's own size");
        let opaque = image.pixels().filter(|p| p.0[3] > 0).count();
        assert!(
            opaque >= (w as usize) / 2,
            "the exported sprite is blank: {opaque} of {} pixels carry ink",
            image.pixels().count()
        );
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

#[test]
fn a_sketch_converts_to_artwork_the_editor_can_draw() {
    let marks = AnchorMarks {
        outline: vec![at(-64.0, -32.0), at(64.0, -32.0), at(64.0, 32.0), at(-64.0, 32.0)],
        lines: vec![MarkLine {
            a: at(0.0, -32.0),
            b: at(0.0, 32.0),
        }],
        art: Some(at(-40.0, -20.0)),
        margin: None,
        cols: 2,
        rows: 1,
        art_on_top: false,
    };
    sketched("sketch-abc", marks, (120, 80), |manifest| {
        let parsed: serde_json::Value = serde_json::from_str(manifest).expect("JSON");
        let layers = parsed["layers"].as_array().expect("layers array");
        let art = layers
            .iter()
            .find(|l| l["name"] == "sketch-abc")
            .expect("the artwork should be in the manifest");
        assert_eq!(art["category"], "sprite");
        assert_eq!(art["width"], 120);
        assert_eq!(art["height"], 80);
    });
}

/// The case a sketch reaches and nothing else does.
///
/// `marksForCells` measures the footprint from the anchor space's own world
/// point, and on an isometric grid every space is at or below it — so `layout`
/// puts the anchor on the very top edge of the canvas and the dot drawn around
/// it six pixels *above* the canvas. Everything the editor places is measured
/// from that mark, so an anchor that reads back a few pixels down is artwork a
/// few pixels out of place, and one that reads back somewhere else entirely is
/// artwork nobody can find.
#[test]
fn a_sketch_anchored_on_the_top_edge_keeps_its_mark() {
    // Captured from the editor: the footprint runs from the anchor down.
    let marks = AnchorMarks {
        outline: vec![at(-256.0, 0.0), at(192.0, 0.0), at(192.0, 224.0), at(-256.0, 224.0)],
        lines: vec![],
        art: Some(at(-150.0, 38.0)),
        margin: None,
        cols: 5,
        rows: 5,
        art_on_top: false,
    };
    sketched("sketch-edge", marks, (284, 156), |manifest| {
        let parsed: serde_json::Value = serde_json::from_str(manifest).expect("JSON");
        let layers = parsed["layers"].as_array().expect("layers array");
        let mark = layers
            .iter()
            .find(|l| l["name"] == "anchor")
            .expect("the mark should be in the manifest");
        assert_eq!(mark["x"], 256.0);
        assert_eq!(mark["y"], 0.0, "the mark reads back on the edge it was put on");

        let art = layers
            .iter()
            .find(|l| l["name"] == "sketch-edge")
            .expect("the artwork should be in the manifest");
        assert_eq!(art["x"], 106);
        assert_eq!(art["y"], 38);
    });
}

/// The artwork is the row the author cares about, so it is the row on top.
///
/// The two marks are the editor's and read-only in the inspector's list; a
/// stack that buried the one layer somebody might rename under both of them
/// read backwards. It is only the *order* that moves — the marks are still in
/// the file, still found by name, and still drawn over the ink in Photoshop's
/// canvas rather than under it, because a sketch is mostly transparent.
#[test]
fn a_sketch_puts_its_artwork_above_the_marks() {
    let marks = AnchorMarks {
        outline: vec![at(-64.0, 0.0), at(64.0, 0.0), at(64.0, 64.0), at(-64.0, 64.0)],
        lines: vec![],
        art: Some(at(-40.0, 8.0)),
        margin: None,
        cols: 2,
        rows: 2,
        art_on_top: true,
    };
    let bytes = psd_write::psd_from_rgba_marked("sketch-top", 60, 40, ink(60, 40), Some(&marks))
        .expect("the sketch should convert");
    let doc = psd::Psd::from_bytes(&bytes).expect("the file should parse");

    let names = rows_of(&doc);
    assert_eq!(names[0], "S | sketch-top", "the artwork is the first row");
    assert!(names.contains(&"P | anchor".to_string()), "got {names:?}");
    assert!(
        names.iter().any(|n| n.starts_with("Z | grid")),
        "got {names:?}"
    );
}

/// An import has no opinion about where its artwork belongs in the stack, so
/// it keeps the arrangement it always had: marks over artwork, where they stay
/// visible while somebody paints underneath them.
#[test]
fn an_import_still_puts_its_marks_over_the_artwork() {
    let marks = AnchorMarks {
        outline: vec![at(-32.0, -32.0), at(32.0, -32.0), at(32.0, 32.0), at(-32.0, 32.0)],
        lines: vec![],
        art: None,
        margin: None,
        cols: 1,
        rows: 1,
        art_on_top: false,
    };
    let bytes =
        psd_write::psd_from_rgba_marked("tower", 40, 40, swatch(40, 40, [1, 2, 3, 255]), Some(&marks))
            .expect("the import should convert");
    let doc = psd::Psd::from_bytes(&bytes).expect("the file should parse");
    let names = rows_of(&doc);
    // Top-first, so the artwork being last is the artwork being underneath.
    assert_eq!(names.last().map(String::as_str), Some("S | tower"), "got {names:?}");
}

/// The stack as the inspector lists it: top-first, as Photoshop's panel reads.
fn rows_of(doc: &psd::Psd) -> Vec<String> {
    crate::psd_layers::rows(doc)
        .iter()
        .map(|row| match row.item {
            crate::psd_layers::Item::Layer(at) => doc.layer_by_idx(at).name().to_string(),
            crate::psd_layers::Item::Group(id) => doc.groups()[&id].name().to_string(),
        })
        .collect()
}
