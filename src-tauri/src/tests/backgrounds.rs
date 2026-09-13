//! The file New Background writes for an image backdrop.
//!
//! A backdrop is asked for in *tiles*, and a tile is psd-to-json's own slice
//! — so what has to be true is that the file comes out the size the count
//! implies, that the artist opens a document with a row named for what it is
//! for, and that the editor can still find the space the backdrop's top-left
//! stands on. All three are things only a round trip through the real writer
//! and the real pipeline can say.
//!
//! The sizes here are deliberately small. The default is thirty tiles by ten
//! at a 512px slice, which is a 78-megapixel buffer — right for a backdrop,
//! wrong for a test that runs on every commit.

use crate::project::{GameOptions, Genre, Projection};
use crate::psd_background;
use crate::psd_write::{AnchorMarks, MarkPoint};
use crate::{psd_pipeline, store};

/// A backdrop's marks: anchored on one space, artwork starting *at* it.
///
/// Not centred on it, the way an imported image is. A backdrop has an opinion
/// about where it begins and none about where its middle is, and a strip
/// thirty tiles wide centred on the origin would start fifteen tiles off the
/// left of everything anybody has built.
fn marks(size: f32) -> AnchorMarks {
    AnchorMarks {
        outline: vec![
            MarkPoint { x: 0.0, y: 0.0 },
            MarkPoint { x: size, y: 0.0 },
            MarkPoint { x: size, y: size },
            MarkPoint { x: 0.0, y: size },
        ],
        lines: vec![],
        art: Some(MarkPoint { x: 0.0, y: 0.0 }),
        margin: None,
        cols: 1,
        rows: 1,
        art_on_top: false,
    }
}

#[test]
fn a_background_is_as_many_tiles_across_as_it_was_asked_for() {
    let bytes = psd_background::psd_from_empty_tiles_marked(256, 128, &marks(32.0))
        .expect("an empty backdrop should be written");
    let parsed = psd::Psd::from_bytes(&bytes).expect("PSD should parse");
    // The canvas is the union of the artwork and the grid footprint, and the
    // artwork contains the footprint here, so it is the artwork.
    assert_eq!((parsed.width(), parsed.height()), (256, 128));
}

/// Past the ceiling is a sentence rather than an allocation nobody recovers
/// from. Sixty tiles by forty at a 512px slice is 629 megapixels.
#[test]
fn a_backdrop_too_big_to_hold_says_so() {
    let err = psd_background::psd_from_empty_tiles_marked(60 * 512, 40 * 512, &marks(32.0))
        .expect_err("a backdrop this big should be refused");
    assert!(err.contains("megapixel"), "unhelpful refusal: {err}");
}

/// The shape of the file, as psd-to-json reads it back.
///
/// `T | Background` is the tileset the runtime loads a piece at a time, and
/// `P | anchor` is what tells the editor which grid space the top-left corner
/// sits on. Both have to survive the round trip, or a backdrop is a file
/// nobody can paint and the editor cannot place.
#[test]
fn a_background_carries_a_tile_group_and_an_anchor() {
    let meta = store::create_project(
        "Backdrop",
        Projection::Orthogonal,
        Genre::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let bytes = psd_background::psd_from_empty_tiles_marked(256, 128, &marks(32.0))
            .expect("an empty backdrop should be written");
        let psd_dir = store::psd_dir(&meta.id).expect("psd dir");
        std::fs::write(psd_dir.join("backdrop.psd"), &bytes).expect("PSD should save");

        let manifest = psd_pipeline::process(
            &meta.id,
            "backdrop",
            &psd_pipeline::ProcessOptions::default(),
            |_| {},
        )
        .expect("psd-to-json should process it");
        let parsed: serde_json::Value =
            serde_json::from_str(&manifest).expect("manifest should be JSON");
        let layers = parsed["layers"].as_array().expect("layers array");

        let tiles = layers
            .iter()
            .find(|l| l["name"] == "Background")
            .unwrap_or_else(|| panic!("no tile group in {layers:?}"));
        assert_eq!(tiles["category"], "tileset");

        // The anchor is a top-level layer, which is the rule an object layer
        // enforces and what the editor reads the backdrop's position from.
        let anchor = layers
            .iter()
            .find(|l| l["name"] == "anchor")
            .unwrap_or_else(|| panic!("no anchor in {layers:?}"));
        assert_eq!(anchor["category"], "point");
        assert_eq!(anchor["x"].as_f64().unwrap().round(), 0.0);
        assert_eq!(anchor["y"].as_f64().unwrap().round(), 0.0);
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}
