//! What the generated config carries.
//!
//! `game/js/game.config.json` is the document in the shape the project's own
//! code reads it, and play mode runs that code — so a field missing here is a
//! game that draws the wrong thing with nothing to say why. Every one of
//! these is a bug that got out: an empty config beside a full canvas, a scene
//! switch that exported the wrong scene, and a multi-layer PSD drawn upside
//! down because the file's stack never reached the game.
//!
//! Split from `scaffolds` for the 700-line rule; it shares the store the rest
//! of the suite creates projects in.

use crate::project::{GameOptions, Genre, Projection};
use crate::{store, templates};

/// The config the project's own code reads follows the document.
///
/// It used to be written once, empty, and rewritten only on the way out to a
/// zip — so the file the code modal opened described nothing that had been
/// built, and play mode, which now runs that code, would have run against an
/// empty world. Every save regenerates it.
#[test]
fn saving_the_document_rewrites_the_config_the_game_reads() {
    let meta = store::create_project(
        "Synced",
        Projection::Orthogonal,
        Genre::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let config = |id: &str| -> serde_json::Value {
            serde_json::from_str(
                &store::read_game_file(id, "js/game.config.json").expect("config should read"),
            )
            .expect("config should be JSON")
        };

        // A fresh project has the shape of the space and nothing in it.
        assert_eq!(config(&meta.id)["layers"].as_array().map(Vec::len), Some(1));
        assert_eq!(config(&meta.id)["psdKeys"].as_array().map(Vec::len), Some(0));

        store::write_doc(
            &meta.id,
            &serde_json::json!({
                "version": 1,
                "projection": "orthogonal",
                "genre": "topdown",
                "gridSize": 32,
                "layers": [{
                    "id": "layer-terrain",
                    "name": "Terrain",
                    "visible": true,
                    "fills": [{ "id": "f1", "cells": [{ "cx": 3, "cy": 4 }], "color": "#ec3013" }],
                    "placements": [{
                        "id": "p1",
                        "psdKey": "tower",
                        "layerPath": "S | tower",
                        "x": 64.0, "y": 64.0, "width": 32.0, "height": 32.0
                    }],
                    "zones": [],
                    "strokes": []
                }]
            })
            .to_string(),
        )
        .expect("document should save");

        let after = config(&meta.id);
        assert_eq!(after["psdKeys"][0], "tower");
        assert_eq!(after["layers"][0]["fills"][0]["cells"][0]["cx"], 3.0);
        assert_eq!(after["layers"][0]["placements"][0]["psdKey"], "tower");

        // A document that will not parse leaves the last good config alone
        // rather than failing the save that carries the real work.
        store::write_doc(&meta.id, "{ not json").expect("the document still saves");
        assert_eq!(config(&meta.id)["psdKeys"][0], "tower");

        // The migration path, which `read_document` takes on every open: a
        // project made before the config was kept in step has the empty one
        // the scaffold wrote, and opening it is what brings it level.
        store::write_game_file(&meta.id, "js/game.config.json", "{}")
            .expect("a stale config should write");
        assert!(config(&meta.id)["psdKeys"].is_null());
        store::sync_game_config(&meta.id).expect_err("a broken document has nothing to sync");

        store::write_doc(
            &meta.id,
            &templates::starter_doc(&store::read_meta(&meta.id).expect("meta should read")),
        )
        .expect("document should save");
        store::write_game_file(&meta.id, "js/game.config.json", "{}")
            .expect("a stale config should write");
        store::sync_game_config(&meta.id).expect("a readable document syncs");
        assert_eq!(config(&meta.id)["grid"], 32);
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// The config, once a project is several places.
///
/// `layers` stays the *open* scene's, because that is what every project's
/// own `WorldScene.js` reads and a project scaffolded before scenes kept its
/// own copy of that file. `scenes` carries all of them beside it, and the PSD
/// keys cover every scene so a switch in someone's own code has its textures.
#[test]
fn the_config_carries_every_scene_and_places_the_open_one() {
    let meta = store::create_project(
        "Scened",
        Projection::Orthogonal,
        Genre::Topdown,
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
                "activeSceneId": "scene-cave",
                "scenes": [
                    {
                        "id": "scene-main",
                        "name": "Main",
                        "layers": [{
                            "id": "l1", "name": "Terrain", "visible": true,
                            "fills": [], "zones": [], "strokes": [],
                            "placements": [{
                                "id": "p1", "psdKey": "tower", "layerPath": "tower",
                                "x": 0.0, "y": 0.0, "width": 32.0, "height": 32.0,
                                "order": 2, "instance": "unit-1"
                            }]
                        }]
                    },
                    {
                        "id": "scene-cave",
                        "name": "Cave",
                        "layers": [{
                            "id": "l2", "name": "Walls", "visible": true,
                            "fills": [], "zones": [], "strokes": [],
                            "placements": [{
                                "id": "p2", "psdKey": "stalactite", "layerPath": "stalactite",
                                "x": 64.0, "y": 64.0, "width": 32.0, "height": 32.0
                            }]
                        }]
                    }
                ]
            })
            .to_string(),
        )
        .expect("document should save");

        let config: serde_json::Value = serde_json::from_str(
            &store::read_game_file(&meta.id, "js/game.config.json").expect("config should read"),
        )
        .expect("config should be JSON");

        assert_eq!(config["activeScene"], "scene-cave");
        assert_eq!(config["scenes"].as_array().map(Vec::len), Some(2));
        assert_eq!(config["scenes"][0]["name"], "Main");
        assert_eq!(config["scenes"][1]["name"], "Cave");

        // `layers` is the open scene's, not the first one's.
        assert_eq!(config["layers"][0]["placements"][0]["psdKey"], "stalactite");

        // A PSD is a stack and the order is the artwork, so both of the
        // fields that say which way up it goes have to reach the game: how
        // high the layer sat in its file, and the unit its siblings share.
        // Without them the exported game drew every multi-layer PSD upside
        // down, which is what an extrusion's parts made obvious.
        let main = &config["scenes"][0]["layers"][0]["placements"][0];
        assert_eq!(main["order"], 2);
        assert_eq!(main["instance"], "unit-1");

        // Every scene's keys, so switching does not need a reload.
        let keys: Vec<&str> = config["psdKeys"]
            .as_array()
            .expect("psdKeys")
            .iter()
            .filter_map(|k| k.as_str())
            .collect();
        assert!(keys.contains(&"tower"), "keys were {keys:?}");
        assert!(keys.contains(&"stalactite"), "keys were {keys:?}");

        // Layers are counted across the project rather than per scene: the
        // home screen's number is about the project.
        assert_eq!(store::read_meta(&meta.id).expect("meta").layer_count, 2);
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// A project written before scenes still exports what is in it.
///
/// The editor migrates a document the first time it opens one, but the config
/// is regenerated on the way *in* as well — so this runs against a document
/// that has never been through the frontend.
#[test]
fn a_document_written_before_scenes_still_reaches_the_config() {
    let meta = store::create_project(
        "Legacy doc",
        Projection::Blank,
        Genre::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        store::write_doc(
            &meta.id,
            &serde_json::json!({
                "version": 1,
                "projection": "blank",
                "genre": "topdown",
                "gridSize": 32,
                "layers": [{
                    "id": "l1", "name": "Terrain", "visible": true,
                    "fills": [], "zones": [], "strokes": [],
                    "placements": [{
                        "id": "p1", "psdKey": "hut", "layerPath": "hut",
                        "x": 0.0, "y": 0.0, "width": 32.0, "height": 32.0
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

        assert_eq!(config["psdKeys"][0], "hut");
        assert_eq!(config["layers"][0]["placements"][0]["psdKey"], "hut");
        // One scene, named the same thing the editor's own migration names it.
        assert_eq!(config["scenes"].as_array().map(Vec::len), Some(1));
        assert_eq!(config["scenes"][0]["name"], "Main");
        assert_eq!(config["activeScene"], "scene-main");
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// Where the character starts is the open scene's start point.
///
/// `spawn` was the origin, always, and the two scaffolded scenes have read it
/// since they were written — so making a point the scene's start is a matter
/// of that field answering differently, and every project's own
/// `spawnCharacter` follows without being touched.
///
/// The designation lives on the scene rather than on the point, which is what
/// makes "one per scene" a fact about the document instead of a rule someone
/// has to enforce. A scene that names no point, or names one that has been
/// deleted, is the origin again — the fallback every one of those files
/// already writes.
#[test]
fn the_config_spawns_on_the_scenes_start_point() {
    let meta = store::create_project(
        "Spawned",
        Projection::Orthogonal,
        Genre::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let config = |id: &str| -> serde_json::Value {
            serde_json::from_str(
                &store::read_game_file(id, "js/game.config.json").expect("config should read"),
            )
            .expect("config should be JSON")
        };
        let doc = |start: serde_json::Value| {
            serde_json::json!({
                "version": 2,
                "projection": "orthogonal",
                "genre": "topdown",
                "gridSize": 32,
                "activeSceneId": "scene-main",
                "scenes": [{
                    "id": "scene-main",
                    "name": "Main",
                    "startPointId": start,
                    "layers": [{
                        "id": "l1", "name": "Terrain", "visible": true,
                        "fills": [], "placements": [], "zones": [], "strokes": [],
                        "points": [
                            { "id": "pt-gate", "name": "Gate", "cell": { "cx": 5, "cy": -2 } },
                            { "id": "pt-cave", "name": "Cave", "cell": { "cx": 0, "cy": 9 } }
                        ]
                    }]
                }]
            })
            .to_string()
        };

        store::write_doc(&meta.id, &doc(serde_json::json!("pt-gate")))
            .expect("document should save");
        let after = config(&meta.id);
        assert_eq!(after["spawn"]["cx"], 5.0);
        assert_eq!(after["spawn"]["cy"], -2.0);

        // The points themselves travel too, so a project's own code can read
        // the other one by name.
        let points = &after["layers"][0]["points"];
        assert_eq!(points.as_array().map(Vec::len), Some(2));
        assert_eq!(points[1]["name"], "Cave");
        assert_eq!(points[1]["cell"]["cy"], 9.0);
        assert_eq!(after["scenes"][0]["startPointId"], "pt-gate");

        // A scene naming a point that is not there starts where a scene with
        // no start point starts: the origin, which is what every scaffolded
        // `spawnCharacter` falls back to anyway.
        store::write_doc(&meta.id, &doc(serde_json::json!("pt-gone")))
            .expect("document should save");
        assert_eq!(config(&meta.id)["spawn"]["cx"], 0.0);

        store::write_doc(&meta.id, &doc(serde_json::Value::Null))
            .expect("document should save");
        assert_eq!(config(&meta.id)["spawn"]["cy"], 0.0);
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// A point a long way out still has ground under it.
///
/// `gridSpan` is both how far the grid is drawn and how far the character may
/// walk, so a start point outside it would put the character outside the
/// world on the first frame — walking on nothing, in a scene whose own spawn
/// put it there.
#[test]
fn the_span_reaches_a_point_put_down_a_long_way_out() {
    let meta = store::create_project(
        "Distant",
        Projection::Orthogonal,
        Genre::Topdown,
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
                "scenes": [{
                    "id": "scene-main",
                    "name": "Main",
                    "startPointId": "pt-far",
                    "layers": [{
                        "id": "l1", "name": "Terrain", "visible": true,
                        "fills": [], "placements": [], "zones": [], "strokes": [],
                        "points": [{ "id": "pt-far", "name": "Far", "cell": { "cx": 60, "cy": 0 } }]
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
        assert!(
            config["gridSpan"].as_i64().unwrap_or(0) >= 60,
            "the span should hold the point: {}",
            config["gridSpan"]
        );
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}
