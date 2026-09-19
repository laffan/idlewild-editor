//! Adding a layer to a PSD, and drawing into one.
//!
//! The two writes PSD Edit mode is built on. Both go through the same rebuild a
//! rewrite does, so what these pin is the part that is specific to them: an
//! added layer is real but has nothing in it, and ink laid into a layer joins
//! what is already there rather than replacing it.
//!
//! The compositing itself is checked pixel by pixel, because every way it can
//! be wrong is quiet — ink in the wrong place, ink that erased the artwork
//! under it, a layer rectangle that grew back to the corner of the canvas.

use super::swatch;
use crate::psd_paint::{self, Paint, Patch};
use crate::project::{GameOptions, Projection, Scaffold};
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
        erase_base64: None,
    }
}

/// The same, carrying a mask of its own over the same rectangle.
///
/// `taken` is the mask's alpha, which is the whole of what `cut` reads.
fn rubbed(
    left: i32,
    top: i32,
    width: u32,
    height: u32,
    rgba: [u8; 4],
    taken: u8,
) -> Paint {
    Paint {
        erase_base64: Some(STANDARD.encode(swatch(width, height, [0, 0, 0, taken]))),
        ..ink(left, top, width, height, rgba)
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

/// A turned-round brush reaches the artwork that was already there.
///
/// The thing the mask exists for: the raster the editor sends is drawn on a
/// clear ground, so an erasing stroke in it has taken out the session's own
/// ink and nothing else. The layer's own pixels are only reachable from here.
#[test]
fn an_eraser_takes_the_layer_s_own_pixels_out() {
    let base = patch(0, 0, 4, 4, [10, 20, 30, 255]);
    let cut = psd_paint::cut(base, &patch(2, 2, 4, 4, [0, 0, 0, 255]));

    // The rectangle does not grow: there is nothing outside it to take away.
    assert_eq!((cut.left, cut.top, cut.width, cut.height), (0, 0, 4, 4));
    assert_eq!(pixel(&cut, 0, 0), [10, 20, 30, 255], "outside the mask");
    // Gone, and the colour left exactly as it was — a pixel erased to nothing
    // is a thinner version of itself rather than a greyer one, which is what
    // keeps a *partial* erase from tinting the artwork.
    assert_eq!(pixel(&cut, 3, 3), [10, 20, 30, 0], "under the mask");
}

/// A soft eraser thins rather than clears, and its edge is not a step.
#[test]
fn a_half_covered_pixel_keeps_half_of_itself() {
    let cut = psd_paint::cut(
        patch(0, 0, 1, 1, [9, 9, 9, 200]),
        &patch(0, 0, 1, 1, [0, 0, 0, 128]),
    );
    let [r, _, _, a] = pixel(&cut, 0, 0);
    assert_eq!(r, 9, "the colour does not move");
    // 200 x (1 - 128/255) = 99.6
    assert!((98..=101).contains(&a), "expected about 100, got {a}");
}

/// Erasing happens first and the ink goes over what is left, which is the
/// order the strokes were drawn in: rub a hole, then draw into it, and what
/// lands is the new ink over bare canvas rather than over the old artwork.
#[test]
fn ink_goes_over_what_the_eraser_left() {
    let cut = psd_paint::cut(
        patch(0, 0, 2, 2, [10, 20, 30, 255]),
        &patch(0, 0, 2, 2, [0, 0, 0, 255]),
    );
    let over = psd_paint::over(Some(cut), patch(0, 0, 2, 2, [200, 0, 0, 128]));
    let [r, g, _, a] = pixel(&over, 0, 0);
    // Half-transparent red on *nothing*, so it stays red rather than becoming
    // a blend with the artwork that was rubbed out from under it.
    assert_eq!((r, g), (200, 0), "the old artwork should not show through");
    assert_eq!(a, 128);
}

/// Two erase strokes that cross are one mask, and it composes to the same
/// thing rubbing twice would have left: `1 - (a1 + a2(1 - a1))` is
/// `(1 - a1)(1 - a2)`. Asserted here because the editor relies on it to send
/// one buffer instead of one per stroke — see `drawing/rasterise.ts`.
#[test]
fn overlapping_erasers_compose_like_rubbing_twice() {
    let union = psd_paint::over(
        Some(patch(0, 0, 1, 1, [0, 0, 0, 128])),
        patch(0, 0, 1, 1, [0, 0, 0, 128]),
    );
    let once = psd_paint::cut(
        patch(0, 0, 1, 1, [0, 0, 0, 255]),
        &patch(0, 0, 1, 1, [0, 0, 0, 128]),
    );
    let twice = psd_paint::cut(once, &patch(0, 0, 1, 1, [0, 0, 0, 128]));
    let joined = psd_paint::cut(patch(0, 0, 1, 1, [0, 0, 0, 255]), &union);
    let [_, _, _, a_twice] = pixel(&twice, 0, 0);
    let [_, _, _, a_joined] = pixel(&joined, 0, 0);
    assert!(
        a_twice.abs_diff(a_joined) <= 1,
        "one mask left {a_joined}, two passes left {a_twice}"
    );
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

/// The round trip the inspector's New layer button and PSD Edit mode make.
#[test]
fn a_layer_can_be_added_and_then_drawn_into() {
    let meta = store::create_project(
        "Pen",
        Projection::Orthogonal,
        Scaffold::Topdown,
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
/// An eraser in PSD Edit mode reaches the artwork already in the file.
///
/// The end of the path the mask exists for. Everything above this checks the
/// arithmetic; this checks that it survives being written into a PSD, parsed
/// back out of one, and re-read — which is where a mask that was decoded but
/// never applied, or applied to the wrong row, would show up.
#[test]
fn rubbing_in_psd_edit_mode_thins_the_layer_that_was_there() {
    let meta = store::create_project(
        "Rub",
        Projection::Orthogonal,
        Scaffold::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let id = &meta.id;
        let bytes =
            psd_write::psd_from_rgba_marked("wall", 32, 32, swatch(32, 32, [9, 9, 9, 255]), None)
                .expect("PSD should be written");
        std::fs::write(
            store::psd_dir(id).expect("psd dir").join("wall.psd"),
            &bytes,
        )
        .expect("PSD should save");

        // The artwork: an opaque block in the file's only layer.
        psd_layers::paint(id, "wall", 0, "S | wall", ink(4, 4, 8, 8, [200, 30, 10, 255]), |_| {})
            .expect("the artwork should land");

        // Now rub a 4 x 4 hole out of the middle of it, with no ink at all —
        // which is exactly the gesture that used to do nothing whatever.
        let clear = Paint {
            rgba_base64: STANDARD.encode(swatch(4, 4, [0, 0, 0, 0])),
            ..rubbed(6, 6, 4, 4, [0, 0, 0, 0], 255)
        };
        psd_layers::paint(id, "wall", 0, "S | wall", clear, |_| {})
            .expect("the rub should land");

        // Read back through the file rather than through the editor's own
        // list, because the file is the thing that had to change.
        let written = std::fs::read(store::psd_dir(id).expect("psd dir").join("wall.psd"))
            .expect("the PSD should still be there");
        let doc = psd::Psd::from_bytes(&written).expect("it should parse");
        let (left, top, width, _, rgba) =
            psd_layers::crop(doc.layer_by_idx(0), doc.width(), doc.height());
        let at = |x: i32, y: i32| {
            let i = (((y - top) as usize) * (width as usize) + ((x - left) as usize)) * 4;
            [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]
        };
        assert_eq!(at(4, 4), [200, 30, 10, 255], "outside the rub, untouched");
        assert_eq!(at(7, 7)[3], 0, "the artwork under the rub is gone");
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// Rubbing on its own does not drag the layer's rectangle out to meet it.
///
/// A session that only erased sends a buffer of nothing for its ink, and
/// laying that on would grow the row to cover the rubbing with a margin of
/// transparent pixels — a bigger sprite on disk for a gesture that took
/// something away. The same "blank has no rectangle worth keeping" rule the
/// New layer route relies on, read from the other side.
#[test]
fn a_rub_outside_a_layer_leaves_its_rectangle_alone() {
    let meta = store::create_project(
        "Reach",
        Projection::Orthogonal,
        Scaffold::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let id = &meta.id;
        let bytes =
            psd_write::psd_from_rgba_marked("shed", 32, 32, swatch(32, 32, [9, 9, 9, 255]), None)
                .expect("PSD should be written");
        std::fs::write(
            store::psd_dir(id).expect("psd dir").join("shed.psd"),
            &bytes,
        )
        .expect("PSD should save");

        psd_layers::add(id, "shed", |_| {}).expect("a layer should be added");
        psd_layers::paint(id, "shed", 0, "S | layer-1", ink(4, 4, 6, 6, [200, 30, 10, 255]), |_| {})
            .expect("the ink should land");
        let before = psd_layers::read(id, "shed").expect("layers should read");
        assert_eq!(
            (before.layers[0].x, before.layers[0].width),
            (4, 6),
            "the layer is exactly its ink to begin with"
        );

        // Rub the far corner, where this layer has nothing at all.
        let nowhere = Paint {
            rgba_base64: STANDARD.encode(swatch(6, 6, [0, 0, 0, 0])),
            ..rubbed(20, 20, 6, 6, [0, 0, 0, 0], 255)
        };
        psd_layers::paint(id, "shed", 0, "S | layer-1", nowhere, |_| {})
            .expect("the rub should land");

        let after = psd_layers::read(id, "shed").expect("layers should read");
        assert_eq!(
            (after.layers[0].x, after.layers[0].y, after.layers[0].width, after.layers[0].height),
            (4, 4, 6, 6),
            "a rub that touched nothing left the rectangle where it was"
        );
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// Applying in PSD Edit mode re-parses the file, and the assets on disk say so.
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
    use crate::project::{GameOptions, Projection, Scaffold};
    use crate::psd_layers;
    use crate::store;

    let meta = store::create_project(
        "Painting",
        Projection::Orthogonal,
        Scaffold::Topdown,
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

        // New layer, then ink into it — PSD Edit mode's own route.
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
                erase_base64: None,
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
