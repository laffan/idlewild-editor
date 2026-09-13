//! Adding a layer to a PSD, and drawing into one.
//!
//! The two writes pen mode is built on. Both go through the same rebuild a
//! rewrite does, so what these pin is the part that is specific to them: an
//! added layer is real but has nothing in it, and ink laid into a layer joins
//! what is already there rather than replacing it.
//!
//! The compositing itself is checked pixel by pixel, because every way it can
//! be wrong is quiet — ink in the wrong place, ink that erased the artwork
//! under it, a layer rectangle that grew back to the corner of the canvas.

use super::swatch;
use crate::psd_paint::{self, Paint, Patch};
use crate::project::{GameOptions, Genre, Projection};
use crate::{psd_layers, psd_write, store};
use base64::{engine::general_purpose::STANDARD, Engine as _};

/// A patch of one colour, at a place on the canvas.
fn patch(left: i32, top: i32, width: u32, height: u32, rgba: [u8; 4]) -> Patch {
    Patch {
        left,
        top,
        width,
        height,
        rgba: swatch(width, height, rgba),
    }
}

fn ink(left: i32, top: i32, width: u32, height: u32, rgba: [u8; 4]) -> Paint {
    Paint {
        x: left,
        y: top,
        width,
        height,
        rgba_base64: STANDARD.encode(swatch(width, height, rgba)),
    }
}

/// One pixel of a patch, as RGBA.
fn pixel(p: &Patch, x: u32, y: u32) -> [u8; 4] {
    let at = ((y as usize) * (p.width as usize) + x as usize) * 4;
    [
        p.rgba[at],
        p.rgba[at + 1],
        p.rgba[at + 2],
        p.rgba[at + 3],
    ]
}

#[test]
fn ink_lands_over_the_artwork_and_the_layer_grows_to_hold_both() {
    let base = patch(0, 0, 4, 4, [10, 20, 30, 255]);
    let over = psd_paint::over(Some(base), patch(2, 2, 4, 4, [200, 0, 0, 255]));

    // The rectangle covering both, not either one of them.
    assert_eq!((over.left, over.top, over.width, over.height), (0, 0, 6, 6));
    // What was there, where the ink did not reach.
    assert_eq!(pixel(&over, 0, 0), [10, 20, 30, 255]);
    // The ink, where it did.
    assert_eq!(pixel(&over, 3, 3), [200, 0, 0, 255]);
    // And nothing outside either, rather than an opaque black margin.
    assert_eq!(pixel(&over, 5, 0), [0, 0, 0, 0]);
}

#[test]
fn a_half_transparent_stroke_blends_rather_than_replacing() {
    let over = psd_paint::over(
        Some(patch(0, 0, 1, 1, [0, 0, 0, 255])),
        patch(0, 0, 1, 1, [255, 255, 255, 128]),
    );
    let [r, _, _, a] = pixel(&over, 0, 0);
    assert_eq!(a, 255, "opaque under half-transparent ink stays opaque");
    assert!((120..=136).contains(&r), "expected a mid grey, got {r}");
}

/// The rule that keeps a layer drawn into from scratch tight to its ink.
#[test]
fn a_blank_layer_contributes_no_rectangle() {
    let empty = patch(0, 0, 1, 1, [0, 0, 0, 0]);
    assert!(empty.is_blank());
    assert!(!patch(0, 0, 1, 1, [0, 0, 0, 1]).is_blank());
}

#[test]
fn ink_past_the_edge_of_the_canvas_is_trimmed_rather_than_refused() {
    let clipped = psd_paint::clip(patch(-2, -2, 4, 4, [1, 2, 3, 255]), 8, 8)
        .expect("the half that is on the canvas should survive");
    assert_eq!(
        (clipped.left, clipped.top, clipped.width, clipped.height),
        (0, 0, 2, 2)
    );
    assert_eq!(pixel(&clipped, 0, 0), [1, 2, 3, 255]);

    assert!(
        psd_paint::clip(patch(20, 20, 4, 4, [1, 2, 3, 255]), 8, 8).is_none(),
        "a stroke entirely off the canvas leaves the layer alone"
    );
}

/// The round trip the inspector's New layer button and pen mode make.
#[test]
fn a_layer_can_be_added_and_then_drawn_into() {
    let meta = store::create_project(
        "Pen",
        Projection::Orthogonal,
        Genre::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let id = &meta.id;
        let bytes =
            psd_write::psd_from_rgba_marked("hut", 32, 32, swatch(32, 32, [9, 9, 9, 255]), None)
                .expect("PSD should be written");
        std::fs::write(store::psd_dir(id).expect("psd dir").join("hut.psd"), &bytes)
            .expect("PSD should save");

        psd_layers::add(id, "hut", |_| {}).expect("a layer should be added");
        let list = psd_layers::read(id, "hut").expect("layers should read");
        let names: Vec<&str> = list.layers.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(
            names,
            ["S | layer-1", "S | hut"],
            "the new layer goes on top, as a sprite"
        );
        // Real, and empty: one transparent pixel is the smallest thing the
        // fork will write, and the editor knows not to place it.
        assert_eq!((list.layers[0].width, list.layers[0].height), (1, 1));

        // A second press does not collide with the first.
        psd_layers::add(id, "hut", |_| {}).expect("a second layer should be added");
        let list = psd_layers::read(id, "hut").expect("layers should read");
        let names: Vec<&str> = list.layers.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, ["S | layer-2", "S | layer-1", "S | hut"]);

        // Draw into the lower of the two new layers, six pixels in.
        let manifest = psd_layers::paint(
            id,
            "hut",
            1,
            "S | layer-1",
            ink(6, 6, 4, 4, [200, 30, 10, 255]),
            |_| {},
        )
        .expect("the ink should land");

        let after = psd_layers::read(id, "hut").expect("layers should read back");
        let painted = &after.layers[1];
        assert_eq!(painted.name, "S | layer-1");
        // The blank placeholder left no trace: the layer is exactly the ink,
        // rather than a rectangle reaching back to the canvas corner.
        assert_eq!((painted.x, painted.y), (6, 6));
        assert_eq!((painted.width, painted.height), (4, 4));

        // And the pipeline ran over the result, so the game can see it.
        let parsed: serde_json::Value =
            serde_json::from_str(&manifest).expect("manifest should be JSON");
        let layers = parsed["layers"].as_array().expect("layers array");
        let entry = layers
            .iter()
            .find(|l| l["name"] == "layer-1")
            .expect("the painted layer should be in the manifest");
        assert_eq!(entry["category"], "sprite");
        assert_eq!(entry["width"], 4);

        // Painting again joins what is there rather than starting over.
        psd_layers::paint(
            id,
            "hut",
            1,
            "S | layer-1",
            ink(20, 20, 4, 4, [10, 200, 30, 255]),
            |_| {},
        )
        .expect("the second stroke should land");
        let after = psd_layers::read(id, "hut").expect("layers should read back");
        let painted = &after.layers[1];
        assert_eq!((painted.x, painted.y), (6, 6));
        assert_eq!(
            (painted.width, painted.height),
            (18, 18),
            "the layer covers both strokes"
        );

        // A row that has moved under the drawing is refused rather than
        // painted into, because getting that wrong is silent.
        assert!(
            psd_layers::paint(id, "hut", 1, "S | somewhere-else", ink(0, 0, 1, 1, [0; 4]), |_| {})
                .is_err()
        );
        assert!(
            psd_layers::paint(id, "hut", 99, "S | layer-1", ink(0, 0, 1, 1, [0; 4]), |_| {})
                .is_err()
        );
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}
/// Applying in pen mode re-parses the file, and the assets on disk say so.
///
/// The half nobody can see from the editor. Ink goes into the PSD, the
/// pipeline runs over it, and what the game loads is the sprite that run
/// wrote — so if this stopped happening, the canvas would show the drawing
/// (it re-places from the manifest it is handed) and a game started
/// afterwards would not, which is the kind of disagreement that reads as the
/// drawing having been lost.
///
/// It is the New layer route on purpose: that layer goes in as a single
/// transparent pixel, so the sprite on disk before and after are a 1 × 1
/// nothing and the drawing — two files that cannot be mistaken for each
/// other, which is the whole proof that the paint reached the pipeline rather
/// than only the file.
#[test]
fn applying_ink_re_parses_and_writes_the_sprite() {
    use crate::project::{GameOptions, Genre, Projection};
    use crate::psd_layers;
    use crate::store;

    let meta = store::create_project(
        "Painting",
        Projection::Orthogonal,
        Genre::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let outcome = std::panic::catch_unwind(|| {
        let id = &meta.id;
        let bytes =
            crate::psd_write::psd_from_rgba_marked("probe", 8, 8, vec![255u8; 8 * 8 * 4], None)
                .expect("a psd should be written");
        std::fs::write(store::psd_dir(id).unwrap().join("probe.psd"), &bytes).unwrap();
        crate::psd_pipeline::process(
            id,
            "probe",
            &crate::psd_pipeline::ProcessOptions::default(),
            |_| {},
        )
        .expect("the first parse should land");

        let sprites = store::assets_dir(id).unwrap().join("probe").join("sprites");
        assert!(sprites.join("probe.png").exists(), "the artwork it started with");

        // New layer, then ink into it — pen mode's own route.
        psd_layers::add(id, "probe", |_| {}).expect("a layer should be added");
        let list = psd_layers::read(id, "probe").expect("the list should read");
        let row = list
            .layers
            .iter()
            .find(|l| l.name.starts_with("S | layer-"))
            .expect("the new row")
            .clone();
        assert_eq!((row.width, row.height), (1, 1), "it starts as one clear pixel");
        // A clear pixel is still exported — it is a layer like any other, and
        // this is the file the paint has to replace.
        let before = std::fs::read(sprites.join("layer-1.png"))
            .expect("even one clear pixel is a sprite");

        let manifest = psd_layers::paint(
            id,
            "probe",
            row.index,
            &row.name,
            crate::psd_paint::Paint {
                x: 1,
                y: 1,
                width: 4,
                height: 4,
                rgba_base64: {
                    use base64::Engine;
                    base64::engine::general_purpose::STANDARD.encode(vec![255u8; 4 * 4 * 4])
                },
            },
            |_| {},
        )
        .expect("the paint should land");

        // The pipeline ran: the sprite on disk is the drawing rather than the
        // clear pixel it replaced, and the manifest the editor is handed back
        // describes it at the ink's own size.
        let after = std::fs::read(sprites.join("layer-1.png"))
            .expect("the sprite should still be there");
        assert_ne!(
            before, after,
            "painting re-parses, so the asset the game loads is rewritten",
        );
        let parsed: serde_json::Value =
            serde_json::from_str(&manifest).expect("the manifest should parse");
        let entry = parsed["layers"]
            .as_array()
            .expect("layers")
            .iter()
            .find(|l| l["name"] == "layer-1")
            .expect("the painted layer is in the manifest");
        assert_eq!(entry["width"], 4);
        assert_eq!(entry["height"], 4);
    });

    store::delete_project(&meta.id).ok();
    outcome.expect("the paint should not panic");
}
