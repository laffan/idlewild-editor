//! What a project is made of, and what creating one writes to disk.
//!
//! The starter document, the runnable game each template selection scaffolds
//! into `game/`, the tree the code modal edits, and the guards that keep a
//! path from climbing out of the store. The PSD pipeline is next door in
//! `tests.rs`; the two share only the store they both create projects in.

use crate::project::{Genre, Projection};
use crate::{publish, store, templates};

#[test]
fn relative_paths_cannot_escape_the_project() {
    assert!(store::safe_relative("js/WorldScene.js").is_ok());
    assert!(store::safe_relative("../../../etc/passwd").is_err());
    assert!(store::safe_relative("/etc/passwd").is_err());
}

#[test]
fn project_ids_are_validated_before_they_reach_the_filesystem() {
    assert!(store::project_dir("../escape").is_err());
    assert!(store::project_dir("").is_err());
    assert!(store::project_dir("a1b2-c3d4").is_ok());
}

#[test]
fn publish_names_survive_awkward_project_titles() {
    assert_eq!(publish::sanitise_name("Nine Roads"), "nine-roads");
    assert_eq!(publish::sanitise_name("  "), "idlewild-game");
    assert_eq!(publish::sanitise_name("a/b:c"), "a-b-c");
}

#[test]
fn starter_documents_carry_the_chosen_template_and_grid() {
    let doc = templates::starter_doc(Projection::Isometric, Genre::Topdown, 128);
    let value: serde_json::Value = serde_json::from_str(&doc).expect("valid JSON");
    assert_eq!(value["projection"], "isometric");
    assert_eq!(value["genre"], "topdown");
    assert_eq!(value["gridSize"], 128);
    // One scene, holding the one layer a project starts with.
    assert_eq!(value["scenes"].as_array().map(Vec::len), Some(1));
    assert_eq!(value["scenes"][0]["name"], "Main");
    assert_eq!(value["activeSceneId"], value["scenes"][0]["id"]);
    assert_eq!(value["scenes"][0]["layers"].as_array().map(Vec::len), Some(1));

    // Both axes reach the document, because the editor reads its play mode
    // out of it rather than out of the project's meta.
    let blank = templates::starter_doc(Projection::Blank, Genre::Platformer, 32);
    let value: serde_json::Value = serde_json::from_str(&blank).expect("valid JSON");
    assert_eq!(value["projection"], "blank");
    assert_eq!(value["genre"], "platformer");
}

/// Each genre scaffolds its own scene and only the module that scene uses,
/// and both axes reach the config the scene reads at runtime.
#[test]
fn each_style_scaffolds_the_program_it_runs() {
    let top = store::create_project("Top", Projection::Blank, Genre::Topdown, 48)
        .expect("project should be created");
    let side = store::create_project("Side", Projection::Orthogonal, Genre::Platformer, 48)
        .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let paths = |id: &str| -> Vec<String> {
            store::list_game_files(id)
                .expect("files should list")
                .into_iter()
                .map(|f| f.path)
                .collect()
        };

        let top_paths = paths(&top.id);
        assert!(top_paths.iter().any(|p| p == "js/navigation.js"));
        assert!(
            !top_paths.iter().any(|p| p == "js/physics.js"),
            "a top-down project ships no body step: {top_paths:?}"
        );

        let side_paths = paths(&side.id);
        assert!(side_paths.iter().any(|p| p == "js/physics.js"));
        assert!(
            !side_paths.iter().any(|p| p == "js/navigation.js"),
            "a platformer ships no pathfinder: {side_paths:?}"
        );

        // The scenes really are different programs, not one file twice.
        let top_scene =
            store::read_game_file(&top.id, "js/WorldScene.js").expect("scene should read");
        let side_scene =
            store::read_game_file(&side.id, "js/WorldScene.js").expect("scene should read");
        assert!(top_scene.contains("findPath"));
        assert!(side_scene.contains("stepBody"));

        let config: serde_json::Value = serde_json::from_str(
            &store::read_game_file(&top.id, "js/game.config.json").expect("config should read"),
        )
        .expect("config should be JSON");
        assert_eq!(config["projection"], "blank");
        assert_eq!(config["genre"], "topdown");
        assert_eq!(config["grid"], 48);
    });

    store::delete_project(&top.id).ok();
    store::delete_project(&side.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// A project's meta survives a round trip through disk, genre included — and
/// one written before the choice existed still reads, as top down.
#[test]
fn project_meta_defaults_a_missing_genre_to_top_down() {
    let meta = store::create_project("Legacy", Projection::Orthogonal, Genre::Platformer, 32)
        .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        assert_eq!(
            store::read_meta(&meta.id).expect("meta should read").genre,
            Genre::Platformer,
        );

        // What every meta.json on disk looked like before the field existed.
        let json = serde_json::json!({
            "id": meta.id,
            "name": "Legacy",
            "projection": "orthogonal",
            "gridSize": 32,
            "createdAt": 0,
            "updatedAt": 0,
        });
        let parsed: crate::project::ProjectMeta =
            serde_json::from_value(json).expect("an older meta should still read");
        assert_eq!(parsed.genre, Genre::Topdown);
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

#[test]
fn a_new_project_scaffolds_a_runnable_game() {
    let meta = store::create_project("Scaffold test", Projection::Orthogonal, Genre::Topdown, 32)
        .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let files = store::list_game_files(&meta.id).expect("files should list");
        let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        for expected in [
            "index.html",
            "js/main.js",
            "js/WorldScene.js",
            "js/grid.js",
            // The top-down scene's own module; a platformer gets physics.js
            // instead — see `each_style_scaffolds_the_program_it_runs`.
            "js/navigation.js",
            "js/game.config.json",
            "css/styles.css",
        ] {
            assert!(paths.contains(&expected), "{expected} missing from {paths:?}");
        }

        let index = store::read_game_file(&meta.id, "index.html").expect("index should read");
        assert!(
            index.contains("Scaffold test"),
            "the project name should reach the page title"
        );
        assert!(
            !index.contains("__PROJECT_NAME__"),
            "the placeholder should have been substituted"
        );

        let config: serde_json::Value = serde_json::from_str(
            &store::read_game_file(&meta.id, "js/game.config.json").expect("config should read"),
        )
        .expect("config should be JSON");
        assert_eq!(config["projection"], "orthogonal");
        assert_eq!(config["genre"], "topdown");
        assert_eq!(config["grid"], 32);
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// Managing the game tree from the code modal.
///
/// The guards matter more than the happy paths: the modal has no undo, so a
/// move that silently overwrote, or a folder dragged into itself, would take
/// work with it.
#[test]
fn the_game_tree_can_be_managed_without_losing_files() {
    let meta = store::create_project("Files", Projection::Orthogonal, Genre::Topdown, 32)
        .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let id = &meta.id;
        let listing = || {
            let mut paths: Vec<String> = store::list_game_files(id)
                .expect("files should list")
                .into_iter()
                .map(|f| f.path)
                .collect();
            paths.sort();
            paths
        };

        // Create, and refuse to create over something that is already there.
        store::create_game_dir(id, "js/systems").expect("folder should be created");
        store::create_game_file(id, "js/systems/spawn.js").expect("file should be created");
        assert!(listing().contains(&"js/systems/spawn.js".to_string()));
        assert!(
            store::create_game_file(id, "js/systems/spawn.js").is_err(),
            "creating over an existing file should fail"
        );

        // Move, and refuse to move onto something that is already there.
        store::move_game_path(id, "js/systems/spawn.js", "js/spawn.js")
            .expect("move should succeed");
        assert!(listing().contains(&"js/spawn.js".to_string()));
        assert!(!listing().contains(&"js/systems/spawn.js".to_string()));
        assert!(
            store::move_game_path(id, "js/spawn.js", "js/main.js").is_err(),
            "moving onto an existing file should fail"
        );

        // A folder cannot be moved inside itself: the destination would go
        // with it, and the whole subtree would be lost.
        assert!(
            store::move_game_path(id, "js", "js/nested").is_err(),
            "moving a folder into itself should fail"
        );

        // Copy names itself the way a file manager does, extension kept.
        let copy = store::copy_game_path(id, "js/main.js").expect("copy should succeed");
        assert_eq!(copy, "js/main copy.js");
        let second = store::copy_game_path(id, "js/main.js").expect("second copy");
        assert_eq!(second, "js/main copy 2.js");
        assert!(listing().contains(&"js/main.js".to_string()), "the original stays");

        // A copied folder brings its contents.
        let folder = store::copy_game_path(id, "js").expect("folder copy");
        assert_eq!(folder, "js copy");
        assert!(listing().contains(&"js copy/main.js".to_string()));

        // Delete takes a folder whole, and is quiet about what is not there.
        store::delete_game_path(id, "js copy").expect("delete should succeed");
        assert!(!listing().iter().any(|p| p.starts_with("js copy")));
        store::delete_game_path(id, "js/never-existed.js")
            .expect("deleting nothing should not be an error");

        // And none of it can climb out of game/.
        for bad in ["../meta.json", "js/../../doc.json"] {
            assert!(store::create_game_file(id, bad).is_err(), "{bad} should be refused");
            assert!(store::delete_game_path(id, bad).is_err(), "{bad} should be refused");
            assert!(
                store::move_game_path(id, "js/main.js", bad).is_err(),
                "{bad} should be refused as a destination"
            );
        }
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// The bug this pins: an export shipped the game tree and the processed
/// assets but left `game.config.json` as the empty one the scaffold wrote, so
/// a published game drew its grid and its character and nothing else. The
/// document has to reach the archive, and it reaches it through that file.
#[test]
fn an_export_carries_the_document_in_its_config() {
    let meta = store::create_project("Export", Projection::Orthogonal, Genre::Topdown, 32)
        .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let doc = serde_json::json!({
            "version": 1,
            "projection": "orthogonal",
            "gridSize": 32,
            "layers": [{
                "id": "layer-1",
                "name": "Terrain",
                "locked": false,
                "visible": true,
                "fills": [{
                    "id": "f1",
                    "cells": [{ "cx": 2, "cy": 3 }],
                    "kind": "color",
                    "color": "#112233",
                    "walkable": false
                }],
                "placements": [{
                    "id": "p1",
                    "psdKey": "tower",
                    "layerPath": "roof",
                    "x": 64.0,
                    "y": 96.0,
                    "width": 100.0,
                    "height": 50.0,
                    "naturalWidth": 200.0,
                    "naturalHeight": 100.0,
                    "anchor": { "cx": 2, "cy": 3 }
                }],
                "zones": [{
                    "id": "z1",
                    "name": "ledge",
                    "blocking": true,
                    "points": [{ "x": 0.0, "y": 0.0 }, { "x": 10.0, "y": 0.0 }, { "x": 5.0, "y": 8.0 }]
                }],
                "strokes": []
            }]
        });
        store::write_doc(&meta.id, &doc.to_string()).expect("document should write");

        let zip = publish::build_zip(&meta.id).expect("zip should build");
        let config = read_from_zip(&zip, "export/js/game.config.json")
            .expect("the archive should carry a config");
        let config: serde_json::Value =
            serde_json::from_str(&config).expect("config should be JSON");

        assert_eq!(config["psdKeys"], serde_json::json!(["tower"]));
        let placement = &config["layers"][0]["placements"][0];
        assert_eq!(placement["psdKey"], "tower");
        assert_eq!(placement["layerPath"], "roof");
        assert_eq!(placement["x"], 64.0);
        // The displayed size travels beside the exported size: their ratio is
        // the scale, and without it every import draws at twice its size.
        assert_eq!(placement["width"], 100.0);
        assert_eq!(placement["naturalWidth"], 200.0);

        assert_eq!(config["layers"][0]["fills"][0]["color"], "#112233");
        assert_eq!(config["layers"][0]["fills"][0]["walkable"], false);
        assert_eq!(config["layers"][0]["zones"][0]["blocking"], true);

        // Exactly one config in the archive: the generated one replaces the
        // scaffold's rather than sitting beside it.
        assert_eq!(count_in_zip(&zip, "export/js/game.config.json"), 1);
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// A document that will not parse is not a reason to hand back nothing: the
/// export is still a runnable game, just an empty one.
#[test]
fn an_export_survives_a_document_it_cannot_read() {
    let meta = store::create_project("Corrupt", Projection::Isometric, Genre::Platformer, 64)
        .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        store::write_doc(&meta.id, "{ not json").expect("document should write");
        let zip = publish::build_zip(&meta.id).expect("zip should still build");
        let config = read_from_zip(&zip, "corrupt/js/game.config.json")
            .expect("the archive should carry a config");
        let config: serde_json::Value =
            serde_json::from_str(&config).expect("config should be JSON");

        assert_eq!(config["layers"], serde_json::json!([]));
        // The shape of the space still comes from meta.json, which parsed.
        assert_eq!(config["projection"], "isometric");
        assert_eq!(config["genre"], "platformer");
        assert_eq!(config["grid"], 64);
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

fn read_from_zip(bytes: &[u8], name: &str) -> Option<String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).ok()?;
    let mut file = archive.by_name(name).ok()?;
    let mut out = String::new();
    std::io::Read::read_to_string(&mut file, &mut out).ok()?;
    Some(out)
}

fn count_in_zip(bytes: &[u8], name: &str) -> usize {
    let Ok(archive) = zip::ZipArchive::new(std::io::Cursor::new(bytes)) else {
        return 0;
    };
    archive.file_names().filter(|n| *n == name).count()
}

/// The config the project's own code reads follows the document.
///
/// It used to be written once, empty, and rewritten only on the way out to a
/// zip — so the file the code modal opened described nothing that had been
/// built, and play mode, which now runs that code, would have run against an
/// empty world. Every save regenerates it.
#[test]
fn saving_the_document_rewrites_the_config_the_game_reads() {
    let meta = store::create_project("Synced", Projection::Orthogonal, Genre::Topdown, 32)
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
            &templates::starter_doc(Projection::Orthogonal, Genre::Topdown, 32),
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

/// What a managed block's Reset in the code modal puts back.
#[test]
fn a_scaffolded_file_can_be_asked_for_its_pristine_form() {
    let meta = store::create_project("Pristine", Projection::Orthogonal, Genre::Topdown, 32)
        .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let scene = store::read_game_template(&meta.id, "js/WorldScene.js")
            .expect("the scene has a scaffold");
        assert_eq!(
            scene,
            store::read_game_file(&meta.id, "js/WorldScene.js").expect("scene should read"),
            "an untouched file and its template are the same thing"
        );
        // The markers the code modal reads ownership from.
        assert!(scene.contains("// idlewild:begin placeDocument"));
        assert!(scene.contains("// idlewild:end placeDocument"));

        // The generated config's pristine form is the document as it stands,
        // not the empty file a new project scaffolds with: Reset there means
        // regenerate.
        let fresh = store::read_game_template(&meta.id, "js/game.config.json")
            .expect("the config regenerates");
        let value: serde_json::Value = serde_json::from_str(&fresh).expect("config should be JSON");
        assert_eq!(value["grid"], 32);

        // A file this template does not write has nothing to go back to, and
        // says so rather than answering with the other genre's.
        assert!(store::read_game_template(&meta.id, "js/physics.js").is_err());
        assert!(store::read_game_template(&meta.id, "js/mine.js").is_err());
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// Every marked block in a scaffolded scene closes, and both genres carry the
/// same set — the code modal finds a block by id, so a template that renamed
/// one on one side would silently stop offering its Reset on that side.
#[test]
fn both_scenes_mark_the_same_blocks_and_close_every_one() {
    for genre in [Genre::Topdown, Genre::Platformer] {
        let scene = templates::template_file(
            "js/WorldScene.js",
            "Marks",
            Projection::Orthogonal,
            genre,
            32,
        )
        .expect("the scene has a scaffold");

        let mut open: Vec<&str> = Vec::new();
        let mut closed: Vec<&str> = Vec::new();
        for line in scene.lines().map(str::trim) {
            if let Some(id) = line.strip_prefix("// idlewild:begin ") {
                open.push(id);
            } else if let Some(id) = line.strip_prefix("// idlewild:end ") {
                closed.push(id);
            }
        }
        assert_eq!(open, closed, "{genre:?} has a marker without its pair");
        assert_eq!(
            open,
            [
                "preload",
                "drawGrid",
                "placeDocument",
                "paintFill",
                "applyScale",
                "pointsToVectors",
            ],
            "{genre:?} marks a different set of blocks",
        );
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
    let meta = store::create_project("Scened", Projection::Orthogonal, Genre::Topdown, 32)
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
                                "x": 0.0, "y": 0.0, "width": 32.0, "height": 32.0
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
    let meta = store::create_project("Legacy doc", Projection::Blank, Genre::Topdown, 32)
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
