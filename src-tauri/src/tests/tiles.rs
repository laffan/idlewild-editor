//! Tile layers, where they cross the bridge.
//!
//! The first rule of the feature is that a tile layer's data is
//! indistinguishable from data Tiled wrote, and the config is the one place
//! that could quietly stop being true. Every other record in the document is
//! reshaped on its way out — a fill's cells are reduced to a unit, a
//! placement picks up its collider — and this one must not be.
//!
//! Its own module rather than another case in `config`, which had reached the
//! seven hundred lines the rest of this codebase keeps to.

use crate::project::{GameOptions, Projection, Scaffold};
use crate::store;

/// A tile layer reaches the game exactly as Tiled wrote it.
///
/// The first rule of the feature, asserted at the one place it could quietly
/// stop being true. Every other record in the document is reshaped on its way
/// into the config — a fill's cells are reduced to a unit, a placement picks
/// up its collider — and a tile layer must not be, because what makes it
/// worth having is that it *is* a Tiled tile layer. So the chunks come out
/// with the same gids in the same order, the tilesets come out beside the
/// layers rather than inside them, and nothing here knows what either means.
#[test]
fn a_tile_layer_and_its_palettes_reach_the_config_unchanged() {
    let meta = store::create_project(
        "Tiled",
        Projection::Orthogonal,
        Scaffold::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        store::write_doc(
            &meta.id,
            &serde_json::json!({
                "version": 2,
                "projection": "orthogonal",
                "genre": "topdown",
                "gridSize": 32,
                "activeSceneId": "scene-main",
                "tilesets": [{
                    "firstgid": 1,
                    "name": "ground",
                    "image": "assets/ground/sprites/ground.png",
                    "imagewidth": 64,
                    "imageheight": 32,
                    "tilewidth": 32,
                    "tileheight": 32,
                    "spacing": 0,
                    "margin": 0,
                    "columns": 2,
                    "tilecount": 2
                }],
                "scenes": [{
                    "id": "scene-main",
                    "name": "Main",
                    "layers": [{
                        "id": "layer-tiles",
                        "name": "Ground",
                        "kind": "tile",
                        "visible": true,
                        "fills": [],
                        "placements": [],
                        "points": [],
                        "zones": [],
                        "strokes": [],
                        "tiles": {
                            "type": "tilelayer",
                            "id": 1,
                            "name": "Ground",
                            "opacity": 1,
                            "visible": true,
                            "x": 0,
                            "y": 0,
                            "startx": 0,
                            "starty": 0,
                            "width": 16,
                            "height": 16,
                            "chunks": [{
                                "x": 0, "y": 0, "width": 16, "height": 16,
                                // Suffixed because a bare literal in `json!`
                                // is inferred as `i32`, and this one is a gid
                                // with Tiled's horizontal-flip flag set —
                                // 0x80000000 above every signed 32-bit value.
                                "data": [1, 2, 0, 2147483649u32]
                            }]
                        }
                    }]
                }]
            })
            .to_string(),
        )
        .expect("document should save");

        let config: serde_json::Value = serde_json::from_str(
            &store::read_game_file(&meta.id, "js/game.config.json").expect("config should read"),
        )
        .expect("config should be JSON");

        // Beside the layers, because a gid means the nth tile across every
        // tileset in the map and one list is what all of them are read
        // against.
        assert_eq!(config["tilesets"][0]["firstgid"], 1);
        assert_eq!(config["tilesets"][0]["columns"], 2);

        let tiles = &config["layers"][0]["tiles"];
        assert_eq!(config["layers"][0]["kind"], "tile");
        assert_eq!(tiles["type"], "tilelayer");
        // The gids, in order, flag and all: 0x80000000 on the last one says
        // that tile is flipped horizontally, and a reader that treated a gid
        // as a plain index would have turned it into something else.
        assert_eq!(
            tiles["chunks"][0]["data"],
            serde_json::json!([1, 2, 0, 2147483649u32])
        );
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// A PSD drawn in layers, merged into the one picture a palette is cut from.
///
/// The default a tile palette now takes. Three things have to be true of it
/// and each is a way it went wrong before: the layers have to come out in the
/// order the file stacks them, with what is in front on top; a layer somebody
/// turned off has to stay off, because the canvas does not draw it either;
/// and the two orienting marks every import writes have to stay out of it,
/// because a red anchor dot baked into a palette is a red dot in every tile
/// cut from that corner.
#[test]
fn a_psd_merges_into_one_picture_for_its_palette() {
    use crate::{psd_flatten, psd_pipeline};
    use psd::{LayerBuilder, PsdBuilder};

    let meta = store::create_project(
        "Merging",
        Projection::Orthogonal,
        Scaffold::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        // `add_layer` stacks bottom-up. Red across the whole canvas, blue over
        // its left half, a green layer with its eye off, and the anchor mark
        // in the top-left corner.
        let mut builder = PsdBuilder::new(4, 2);
        builder.add_layer(
            LayerBuilder::new("S | ground").rgba(4, 2, super::swatch(4, 2, [255, 0, 0, 255])),
        );
        builder.add_layer(
            LayerBuilder::new("S | water")
                .rgba(2, 2, super::swatch(2, 2, [0, 0, 255, 255]))
                .at(0, 0),
        );
        builder.add_layer(
            LayerBuilder::new("S | fog")
                .rgba(4, 2, super::swatch(4, 2, [0, 255, 0, 255]))
                .visible(false),
        );
        builder.add_layer(
            LayerBuilder::new("P | anchor")
                .rgba(1, 1, super::swatch(1, 1, [236, 48, 19, 255]))
                .at(3, 0),
        );
        std::fs::write(
            store::psd_dir(&meta.id).unwrap().join("hut.psd"),
            builder.to_bytes().expect("PSD should build"),
        )
        .expect("PSD should save");
        psd_pipeline::process(
            &meta.id,
            "hut",
            &psd_pipeline::ProcessOptions::default(),
            |_| {},
        )
        .expect("processing should succeed");

        let art = psd_flatten::write(&meta.id, "hut").expect("the file should merge");
        assert_eq!(art.file_path, psd_flatten::MERGED_FILE);
        // The whole canvas, not the union of the layers: a palette is cut on
        // the project's grid from the file's own corner, so a merge trimmed
        // to its artwork would shift every tile in it.
        assert_eq!((art.width, art.height), (4, 2));

        let merged = psd_pipeline::output_dir(&meta.id, "hut")
            .unwrap()
            .join(psd_flatten::MERGED_FILE);
        let pixels = image::open(&merged)
            .expect("the merge should be a readable PNG")
            .to_rgba8();
        assert_eq!(pixels.dimensions(), (4, 2));
        // Blue over red where the two overlap, red where only the ground is.
        assert_eq!(pixels.get_pixel(0, 0).0, [0, 0, 255, 255]);
        assert_eq!(pixels.get_pixel(2, 1).0, [255, 0, 0, 255]);
        // Nothing green anywhere: the hidden layer is not on the canvas and
        // must not be in the palette.
        assert!(
            pixels.pixels().all(|p| p.0[1] != 255),
            "a layer with its eye off is not part of the picture"
        );
        // And the anchor mark's corner is the ground's colour rather than the
        // mark's, although this file has it lit.
        assert_eq!(pixels.get_pixel(3, 0).0, [255, 0, 0, 255]);
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// A re-parse rebuilds the merged picture, and only for a file that has one.
///
/// `process` clears `assets/<key>/` so stale sprites never outlive an import,
/// and the merged picture lives in there — so without this a palette cut from
/// a merged file would point at a picture the next edit to that file deleted,
/// and the tiles made from it would stop drawing with nothing to say why.
///
/// The second half matters as much: a project with no merged palette must not
/// start carrying a second copy of every picture in it. The two are one test
/// because the difference between them is the document, and reading the
/// document is the whole of how this decides.
#[test]
fn a_re_parse_rebuilds_a_merged_palettes_picture() {
    use crate::{psd_flatten, psd_pipeline, psd_write};

    let meta = store::create_project(
        "Rebuild",
        Projection::Orthogonal,
        Scaffold::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let bytes = psd_write::psd_from_rgba_marked(
            "hut",
            8,
            8,
            super::swatch(8, 8, [4, 5, 6, 255]),
            None,
        )
        .expect("a PSD should be written");
        std::fs::write(store::psd_dir(&meta.id).unwrap().join("hut.psd"), &bytes)
            .expect("save");

        let merged = psd_pipeline::output_dir(&meta.id, "hut")
            .unwrap()
            .join(psd_flatten::MERGED_FILE);

        // No palette in the document: a re-parse writes nothing extra.
        psd_pipeline::process(
            &meta.id,
            "hut",
            &psd_pipeline::ProcessOptions::default(),
            |_| {},
        )
        .expect("processing should succeed");
        assert!(
            !merged.exists(),
            "a project with no merged palette carries no merged picture"
        );

        // Now the document says this file is cut as one palette, in the same
        // properties `lib/tiled/types.ts` writes.
        store::write_doc(
            &meta.id,
            &serde_json::json!({
                "version": 2,
                "projection": "orthogonal",
                "gridSize": 32,
                "activeSceneId": "scene-main",
                "tilesets": [{
                    "firstgid": 1,
                    "name": "hut",
                    "image": "assets/hut/merged.png",
                    "imagewidth": 8,
                    "imageheight": 8,
                    "tilewidth": 32,
                    "tileheight": 32,
                    "spacing": 0,
                    "margin": 0,
                    "columns": 1,
                    "tilecount": 1,
                    "properties": [
                        { "name": "idlewild:psd", "type": "string", "value": "hut" },
                        { "name": "idlewild:layer", "type": "string", "value": "*merged*" }
                    ]
                }],
                "scenes": [{ "id": "scene-main", "name": "Main", "layers": [] }]
            })
            .to_string(),
        )
        .expect("document should write");

        psd_pipeline::process(
            &meta.id,
            "hut",
            &psd_pipeline::ProcessOptions::default(),
            |_| {},
        )
        .expect("processing should succeed");
        assert!(
            merged.exists(),
            "the picture a merged palette is cut from survives a re-parse"
        );
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}
