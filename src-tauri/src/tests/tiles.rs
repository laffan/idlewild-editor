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
