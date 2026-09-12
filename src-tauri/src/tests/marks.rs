//! The orienting marks an import writes into a PSD, end to end.
//!
//! `P | anchor` and `Z | grid` are what make a PSD worth opening: they say
//! where on the grid the artwork is pinned and how much room it has. These
//! run the real writer and the real pipeline, because the value of a mark is
//! entirely in what psd-to-json reports back about it — a footprint drawn
//! half a space off is a mark that lies, and nothing but a round trip catches
//! that.
//!
//! Split from `tests.rs` for the 700-line rule; the two share the store they
//! both create projects in, and `swatch`.

use super::swatch;
use crate::project::{GameOptions, Genre, Projection};
use crate::{psd_pipeline, psd_write, store};

/// A paste, end to end.
///
/// The numbers are what `planFor` works out for a 128×96 image pasted onto a
/// 32-pixel orthogonal grid, already doubled into the PSD's own pixels: the
/// artwork covers two spaces across and two down, and sits centred in them.
/// This pins that a paste produces the same two orienting marks every other
/// import does — before it, a pasted screenshot opened in Photoshop had
/// nothing to draw against.
#[test]
fn a_pasted_image_carries_its_anchor_and_footprint() {
    use crate::psd_write::{AnchorMarks, MarkPoint};

    let meta = store::create_project(
        "Pasted",
        Projection::Orthogonal,
        Genre::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let marks = AnchorMarks {
            outline: vec![
                MarkPoint { x: 0.0, y: 0.0 },
                MarkPoint { x: 128.0, y: 0.0 },
                MarkPoint { x: 128.0, y: 128.0 },
                MarkPoint { x: 0.0, y: 128.0 },
            ],
            lines: vec![],
            // The artwork fills the footprint's width and is centred in its
            // height — a paste says where it goes rather than being centred
            // on the anchor, which is the footprint's top-left corner.
            art: Some(MarkPoint { x: 0.0, y: 16.0 }),
            margin: None,
            cols: 2,
            rows: 2,
            art_on_top: false,
        };

        let bytes = psd_write::psd_from_rgba_marked(
            "pasted",
            128,
            96,
            swatch(128, 96, [9, 9, 9, 255]),
            Some(&marks),
        )
        .expect("marked PSD should be written");

        // The canvas is the union of artwork and footprint, and here the
        // footprint contains the artwork, so it is the footprint.
        let parsed = psd::Psd::from_bytes(&bytes).expect("PSD should parse");
        assert_eq!((parsed.width(), parsed.height()), (128, 128));

        let psd_dir = store::psd_dir(&meta.id).expect("psd dir");
        std::fs::write(psd_dir.join("pasted.psd"), &bytes).expect("PSD should save");
        let manifest = psd_pipeline::process(
            &meta.id,
            "pasted",
            &psd_pipeline::ProcessOptions::default(),
            |_| {},
        )
        .expect("psd-to-json should process it");

        let parsed: serde_json::Value =
            serde_json::from_str(&manifest).expect("manifest should be JSON");
        let layers = parsed["layers"].as_array().expect("layers array");
        let by_category = |c: &str| {
            layers
                .iter()
                .find(|l| l["category"] == c)
                .unwrap_or_else(|| panic!("no {c} in {layers:?}"))
        };

        // Both marks reached the file, and neither is a sprite — so neither
        // reaches the game as pixels.
        let point = by_category("point");
        assert_eq!(point["x"].as_f64().unwrap().round(), 0.0);
        assert_eq!(point["y"].as_f64().unwrap().round(), 0.0);

        let zone = by_category("zone");
        assert_eq!(zone["width"], 128);
        assert_eq!(zone["height"], 128);
        assert_eq!(zone["name"], "grid-2x2");

        let sprite = by_category("sprite");
        assert_eq!(sprite["name"], "pasted");
        assert_eq!((sprite["width"].clone(), sprite["height"].clone()),
                   (serde_json::json!(128), serde_json::json!(96)));
        assert_eq!(sprite["y"].as_f64().unwrap().round(), 16.0);
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// The orienting marks an import writes into its PSD.
///
/// Both have to survive psd-to-json as *metadata*: the anchor as a point at
/// exactly the spot the editor put it, the grid footprint as a zone with the
/// selection's bounds — and neither as an image, or the game would render a
/// red dot and a tile outline over every imported sprite.
#[test]
fn an_import_marks_its_anchor_and_grid_footprint() {
    use crate::psd_write::{AnchorMarks, MarkPoint};

    let meta = store::create_project(
        "Marks",
        Projection::Orthogonal,
        Genre::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        // One orthogonal grid space at the anchor: a 32 px square whose
        // top-left corner is the anchor itself.
        let marks = AnchorMarks {
            outline: vec![
                MarkPoint { x: 0.0, y: 0.0 },
                MarkPoint { x: 32.0, y: 0.0 },
                MarkPoint { x: 32.0, y: 32.0 },
                MarkPoint { x: 0.0, y: 32.0 },
            ],
            // One space has nothing to divide.
            lines: vec![],
            // An image import has no opinion; it gets centred.
            art: None,
            margin: None,
            cols: 1,
            rows: 1,
            art_on_top: false,
        };

        let bytes = psd_write::psd_from_rgba_marked(
            "hut",
            64,
            64,
            swatch(64, 64, [40, 40, 40, 255]),
            Some(&marks),
        )
        .expect("marked PSD should be written");

        // The artwork is centred on the anchor and the footprint sits where
        // the grid selection was, so the canvas is the union of the two.
        let parsed = psd::Psd::from_bytes(&bytes).expect("marked PSD should parse");
        assert_eq!((parsed.width(), parsed.height()), (64, 64));

        let psd_dir = store::psd_dir(&meta.id).expect("psd dir");
        std::fs::write(psd_dir.join("hut.psd"), &bytes).expect("PSD should save");
        let manifest = psd_pipeline::process(
            &meta.id,
            "hut",
            &psd_pipeline::ProcessOptions::default(),
            |_| {},
        )
        .expect("psd-to-json should process the marked file");

        let parsed: serde_json::Value =
            serde_json::from_str(&manifest).expect("manifest should be JSON");
        let layers = parsed["layers"].as_array().expect("layers should be an array");

        let find = |category: &str| {
            layers
                .iter()
                .find(|l| l["category"] == category)
                .unwrap_or_else(|| panic!("no {category} in {layers:?}"))
        };

        // The point lands on the anchor exactly: psd-to-json reports a point
        // as its layer's centre, which is what the even dot diameter is for.
        let point = find("point");
        assert_eq!(point["name"], "anchor");
        assert_eq!(point["x"], 32.0);
        assert_eq!(point["y"], 32.0);

        // The zone carries the grid selection's own bounds.
        let zone = find("zone");
        assert_eq!(zone["name"], "grid");
        assert_eq!(zone["x"], 32);
        assert_eq!(zone["y"], 32);
        assert_eq!(zone["width"], 32);
        assert_eq!(zone["height"], 32);

        // And only the artwork becomes pixels.
        let sprite = find("sprite");
        assert_eq!(sprite["name"], "hut");
        assert!(sprite["filePath"].is_string(), "the sprite should export");
        assert!(point["filePath"].is_null(), "a point must not export an image");
        assert!(zone["filePath"].is_null(), "a zone must not export an image");

        let images: Vec<String> = psd_pipeline::list_output_files(&meta.id, "hut")
            .expect("outputs should list")
            .into_iter()
            .filter(|f| !f.is_json)
            .map(|f| f.filename)
            .collect();
        assert_eq!(images.len(), 1, "one image expected, got {images:?}");
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// A footprint spanning several spaces draws the divisions between them.
///
/// The outline alone says how much room the artwork has; the divisions say
/// where each space in it begins, which is what an artist lines a
/// multi-space sprite up against. This reads the pixels back out of the PSD
/// rather than trusting the drawing code, because the whole value of the
/// mark is that it is visible.
#[test]
fn a_multi_space_footprint_draws_its_divisions() {
    use crate::psd_write::{AnchorMarks, MarkLine, MarkPoint};

    let at = |x: f32, y: f32| MarkPoint { x, y };
    // Two orthogonal 32 px spaces side by side, anchored on the left one.
    let marks = AnchorMarks {
        outline: vec![at(0.0, 0.0), at(64.0, 0.0), at(64.0, 32.0), at(0.0, 32.0)],
        lines: vec![MarkLine {
            a: at(32.0, 0.0),
            b: at(32.0, 32.0),
        }],
        art: None,
        margin: None,
        cols: 2,
        rows: 1,
        art_on_top: false,
    };

    let bytes = psd_write::psd_from_rgba_marked(
        "pair",
        64,
        32,
        swatch(64, 32, [0, 0, 0, 255]),
        Some(&marks),
    )
    .expect("marked PSD should be written");

    let doc = psd::Psd::from_bytes(&bytes).expect("marked PSD should parse");
    let zone = doc
        .layers()
        .iter()
        .find(|l| l.name().starts_with("Z |"))
        .expect("a zone layer should exist");
    assert_eq!(zone.name(), "Z | grid-2x1", "the name carries the span");

    assert_eq!((zone.width(), zone.height()), (64, 32));
    assert_eq!((zone.layer_left(), zone.layer_top()), (32, 16));

    // `rgba()` hands back the layer composited onto the whole canvas, not
    // its own rect, so read it in canvas coordinates.
    let canvas_w = doc.width() as usize;
    let rgba = zone.rgba();
    let alpha_at = |x: i32, y: i32| {
        let cx = (zone.layer_left() + x) as usize;
        let cy = (zone.layer_top() + y) as usize;
        rgba[(cy * canvas_w + cx) * 4 + 3]
    };

    // Down the middle of the footprint: the division, drawn but lighter than
    // the boundary so the two read differently.
    let division = alpha_at(32, 16);
    let outline = alpha_at(0, 16);
    let wash = alpha_at(16, 16);
    assert!(division > wash, "the division should be visible: {division} vs {wash}");
    assert!(
        division < outline,
        "the division should be lighter than the outline: {division} vs {outline}"
    );
    // And the interior between the lines is only a wash, not solid.
    assert!(wash > 0 && wash < 60, "the interior should be a wash, got {wash}");
}

/// A margin grows the canvas and moves nothing on it.
///
/// Extrude and the fill conversion ask for a space of clear canvas around
/// what they write, so there is somewhere to paint the eaves that hang past
/// the wall. The whole value of it depends on one thing: the artwork must
/// keep its offset from the anchor, because that offset is what puts the
/// picture on its grid space. A margin that shifted the art relative to the
/// dot would move every placement of the file the next time it was read.
///
/// So this writes the same PSD twice, with and without, and compares.
#[test]
fn a_margin_grows_the_canvas_without_moving_the_artwork() {
    use crate::psd_marks;
    use crate::psd_write::{AnchorMarks, MarkPoint};

    let at = |x: f32, y: f32| MarkPoint { x, y };
    // One orthogonal 32 px space, with the artwork sitting exactly on it.
    let plain = AnchorMarks {
        outline: vec![at(0.0, 0.0), at(32.0, 0.0), at(32.0, 32.0), at(0.0, 32.0)],
        lines: vec![],
        art: Some(at(0.0, 0.0)),
        margin: None,
        cols: 1,
        rows: 1,
        art_on_top: false,
    };
    let roomy = AnchorMarks {
        margin: Some(at(32.0, 16.0)),
        ..AnchorMarks {
            outline: plain.outline.clone(),
            lines: vec![],
            art: Some(at(0.0, 0.0)),
            margin: None,
            cols: 1,
            rows: 1,
            art_on_top: false,
        }
    };

    let tight = psd_marks::layout(32, 32, &plain);
    let padded = psd_marks::layout(32, 32, &roomy);

    assert_eq!(padded.canvas_width, tight.canvas_width + 64);
    assert_eq!(padded.canvas_height, tight.canvas_height + 32);

    // The artwork and the anchor both move out with the canvas by the same
    // amount, so where the picture sits on the grid is unchanged.
    assert_eq!(padded.art_left - padded.anchor_x, tight.art_left - tight.anchor_x);
    assert_eq!(padded.art_top - padded.anchor_y, tight.art_top - tight.anchor_y);
    assert_eq!(padded.art_left, tight.art_left + 32);
    assert_eq!(padded.art_top, tight.art_top + 16);

    // And it is real room, not a bigger picture: the layer written into the
    // file is still the 32 × 32 the caller handed over.
    let bytes = psd_write::psd_from_rgba_marked(
        "roomy",
        32,
        32,
        swatch(32, 32, [0, 0, 0, 255]),
        Some(&roomy),
    )
    .expect("marked PSD should be written");
    let doc = psd::Psd::from_bytes(&bytes).expect("marked PSD should parse");
    assert_eq!((doc.width(), doc.height()), (96, 64));
    let art = doc
        .layers()
        .iter()
        .find(|l| l.name().starts_with("S |"))
        .expect("the artwork layer should exist");
    assert_eq!((art.width(), art.height()), (32, 32));
    assert_eq!((art.layer_left(), art.layer_top()), (32, 16));
}
