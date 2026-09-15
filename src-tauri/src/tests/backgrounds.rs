//! The file New Background writes for an image backdrop.
//!
//! A backdrop is asked for in *grid spaces* and written in pixels, which the
//! editor works out — so what has to be true here is that the file comes out
//! the size it was told, that the artist opens a document with a row named
//! for what it is for, and that the editor can still find the space the
//! backdrop's top-left stands on. All three are things only a round trip
//! through the real writer and the real pipeline can say.
//!
//! And one more, which cost a backdrop that was written, parsed and never
//! drawn: **what a painted `T |` group becomes**. It becomes a tileset whose
//! textures are named per slice, holding a sprite child that psd-to-phaser
//! never loads as a sprite — so anything asking "has this layer's texture
//! arrived" has to ask that question per category. See `textureNeeds` in
//! `src/lib/manifest.ts`; the last test here is what pins the shape it reads.
//!
//! The sizes here are deliberately small. A real backdrop is tens of
//! megapixels — right for a backdrop, wrong for a test that runs on every
//! commit.

use crate::project::{GameOptions, Genre, Projection};
use crate::psd_background;
use crate::psd_write::{AnchorMarks, MarkPoint};
use crate::{psd_pipeline, store};

/// A backdrop's marks: anchored on one space, artwork starting *at* it.
///
/// Not centred on it, the way an imported image is. A backdrop has an opinion
/// about where it begins and none about where its middle is, and a strip
/// thirty spaces wide centred on the origin would start fifteen spaces off
/// the left of everything anybody has built.
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
    }
}

#[test]
fn a_background_is_the_size_it_was_asked_for() {
    let bytes = psd_background::psd_from_empty_tiles_marked(256, 128, &marks(32.0))
        .expect("an empty backdrop should be written");
    let parsed = psd::Psd::from_bytes(&bytes).expect("PSD should parse");
    // The canvas is the union of the artwork and the grid footprint, and the
    // artwork contains the footprint here, so it is the artwork.
    assert_eq!((parsed.width(), parsed.height()), (256, 128));
}

/// Past the ceiling is a sentence rather than an allocation nobody recovers
/// from.
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

/// What a painted `T | Background` becomes, which is not what it looks like.
///
/// The group comes back as a **tileset**, cut into 512px slices whose
/// textures are `Background_tile_<col>_<row>`. Nothing is ever loaded under
/// the name `Background`, and the sprite layer inside it — the row the artist
/// actually paints into — is loaded as no sprite either: psd-to-phaser's
/// categoriser descends into a group and stops at a tileset.
///
/// Both halves of that were being got wrong at once. The editor's gate asked
/// whether a texture named `Background` had arrived, which it never does, so
/// a painted backdrop was placed exactly never; and the loader warned that
/// `background` had no texture, which is true and means nothing. This test is
/// the shape both now read.
#[test]
fn a_painted_backdrop_is_a_tileset_of_slices() {
    let meta = store::create_project(
        "Backdrop tiles",
        Projection::Orthogonal,
        Genre::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        // Painted rather than clear, because an empty layer is not what an
        // artist hands back and not what this is about.
        let marks = marks(64.0);
        let layout = crate::psd_marks::layout(600, 400, &marks);
        let mut builder = psd::PsdBuilder::new(layout.canvas_width, layout.canvas_height);
        builder.add_group(
            psd::GroupBuilder::new(psd_background::BACKGROUND_GROUP).add_layer(
                psd::LayerBuilder::new(psd_background::BACKGROUND_SPRITE)
                    .rgba(600, 400, super::swatch(600, 400, [10, 120, 200, 255]))
                    .at(layout.art_left, layout.art_top),
            ),
        );
        for layer in crate::psd_marks::layers(&layout, &marks) {
            builder.add_layer(layer);
        }
        let bytes = builder.to_bytes().expect("a painted backdrop should be written");
        let psd_dir = store::psd_dir(&meta.id).expect("psd dir");
        std::fs::write(psd_dir.join("painted.psd"), &bytes).expect("PSD should save");

        let manifest = psd_pipeline::process(
            &meta.id,
            "painted",
            &psd_pipeline::ProcessOptions::default(),
            |_| {},
        )
        .expect("psd-to-json should process it");
        let parsed: serde_json::Value =
            serde_json::from_str(&manifest).expect("manifest should be JSON");

        // The runtime needs this to place the slices at all — without it
        // psd-to-phaser falls back to 150 and lays the backdrop out wrong.
        assert_eq!(parsed["tile_slice_size"], 512);

        let tiles = parsed["layers"]
            .as_array()
            .expect("layers array")
            .iter()
            .find(|l| l["name"] == "Background")
            .expect("no tile group in the manifest");
        assert_eq!(tiles["category"], "tileset");
        // 600 x 400 over a 512px slice: two across, one down.
        assert_eq!(tiles["columns"], 2);
        assert_eq!(tiles["rows"], 1);

        // The painted row is a child of the tileset rather than a layer of
        // its own, which is why nothing waits for a texture named after it.
        let inside = tiles["children"].as_array().expect("tileset children");
        assert_eq!(inside.len(), 1);
        assert_eq!(inside[0]["name"], "background");
        assert_eq!(inside[0]["category"], "sprite");

        // And the slices are really on disk, under the names the plugin will
        // ask for: `<tileset>/<slice>/<tileset>_tile_<col>_<row>.png`.
        let out = store::assets_dir(&meta.id)
            .expect("assets dir")
            .join("painted")
            .join("tiles")
            .join("Background")
            .join("512");
        for col in 0..2 {
            let tile = out.join(format!("Background_tile_{col}_0.png"));
            assert!(tile.exists(), "missing slice: {}", tile.display());
        }
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}
