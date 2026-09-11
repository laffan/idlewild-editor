//! `.idlewild` — the round trip, and what an untrusted archive may not do.
//!
//! The interesting half is not that a zip round-trips. It is that the *whole*
//! project does: an extruded layer's solid, the source PSDs it was written
//! from, and the code that was edited beside it. A project that came back
//! without its extrusions would look fine and refuse to open a face.
//!
//! The other half is that an archive is a file someone hands you. The entry
//! allowlist is what keeps it from writing outside the project it claims to
//! be, and that is worth a test with a hostile zip in it rather than an
//! assertion about a constant.

use crate::archive;
use crate::project::{Genre, Projection};
use crate::store;
use std::io::Write;
use std::path::{Path, PathBuf};

/// A document with something of every kind in it: two scenes, an extrusion,
/// and a placement of the extruded file in each of them.
fn document() -> String {
    serde_json::json!({
        "version": 2,
        "projection": "isometric",
        "genre": "topdown",
        "gridSize": 64,
        "activeSceneId": "scene-cave",
        "scenes": [
            {
                "id": "scene-main",
                "name": "Main",
                "camera": { "x": 10.0, "y": 20.0, "zoom": 2.0 },
                "layers": [{
                    "id": "layer-terrain",
                    "name": "Terrain",
                    "locked": false,
                    "visible": true,
                    "fills": [{ "id": "f1", "cells": [{ "cx": 1, "cy": 2 }], "color": "#ec3013" }],
                    "placements": [{
                        "id": "p1",
                        "psdKey": "tower",
                        "layerPath": "G | extrude-tower/S | shape-tower",
                        "x": 64.0, "y": 64.0, "width": 128.0, "height": 192.0
                    }],
                    "zones": [],
                    "strokes": []
                }]
            },
            {
                "id": "scene-cave",
                "name": "Cave",
                "layers": [{
                    "id": "layer-walls",
                    "name": "Walls",
                    "locked": false,
                    "visible": true,
                    "fills": [],
                    "placements": [{
                        "id": "p2",
                        "psdKey": "tower",
                        "layerPath": "G | extrude-tower/S | shape-tower",
                        "x": 0.0, "y": 0.0, "width": 128.0, "height": 192.0
                    }],
                    "zones": [],
                    "strokes": []
                }]
            }
        ],
        "extrusions": {
            "tower": {
                "voxels": ["0,0,0", "0,0,1", "1,0,0"],
                "anchor": { "cx": 1, "cy": 2 }
            }
        }
    })
    .to_string()
}

/// A project with a document, a source PSD, a processed asset and an edited
/// file in `game/` — one of everything an archive is supposed to carry.
fn seeded(name: &str) -> String {
    let meta = store::create_project(name, Projection::Isometric, Genre::Topdown, 64)
        .expect("project should be created");
    store::write_doc(&meta.id, &document()).expect("document should save");

    std::fs::write(
        store::psd_dir(&meta.id).expect("psd dir").join("tower.psd"),
        b"not really a psd, but bytes that have to arrive",
    )
    .expect("source psd should write");

    let asset = store::assets_dir(&meta.id).expect("assets dir").join("tower");
    std::fs::create_dir_all(&asset).expect("asset dir should be created");
    std::fs::write(asset.join("data.json"), r#"{"name":"tower"}"#)
        .expect("manifest should write");

    store::write_game_file(&meta.id, "js/WorldScene.js", "// edited by hand\n")
        .expect("scene should save");
    meta.id
}

fn temp(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join("idlewild-archive-tests");
    std::fs::create_dir_all(&dir).expect("temp dir should be created");
    dir.join(name)
}

#[test]
fn a_project_survives_a_round_trip_through_an_idlewild_file() {
    let source = seeded("Round trip");
    let file = temp("round-trip.idlewild");

    let result = std::panic::catch_unwind(|| {
        archive::export(&source, &file).expect("export should write the archive");
        let opened = archive::import(&file).expect("import should read it back");

        // A fresh id, because an id is a fact about this store rather than
        // about the project — and importing twice has to give two projects.
        assert_ne!(opened.id, source, "an import takes an id of its own");
        assert_eq!(opened.name, "Round trip");
        assert_eq!(opened.projection, Projection::Isometric);
        assert_eq!(opened.genre, Genre::Topdown);
        assert_eq!(opened.grid_size, 64);
        assert_eq!(
            opened.created_at,
            store::read_meta(&source).expect("source meta").created_at,
            "when a project was made does not change by being carried",
        );

        // The document, whole — and the extrusion with it, which is the
        // difference between a project that opens and one that opens and can
        // still pull a face.
        let doc: serde_json::Value =
            serde_json::from_str(&store::read_doc(&opened.id).expect("document should read"))
                .expect("document should be JSON");
        assert_eq!(doc["extrusions"]["tower"]["voxels"][1], "0,0,1");
        assert_eq!(doc["extrusions"]["tower"]["anchor"]["cx"], 1);

        // Every scene, the one that was open, and each scene's own camera —
        // a scene is a place, and you come back to where you were standing.
        assert_eq!(doc["scenes"].as_array().map(Vec::len), Some(2));
        assert_eq!(doc["activeSceneId"], "scene-cave");
        assert_eq!(doc["scenes"][0]["camera"]["zoom"], 2.0);
        assert_eq!(
            doc["scenes"][0]["layers"][0]["placements"][0]["psdKey"],
            "tower",
        );
        assert_eq!(
            doc["scenes"][1]["layers"][0]["placements"][0]["psdKey"],
            "tower",
        );

        // The source PSD: the whole reason this format exists beside the
        // site export, which carries processed output and nothing to edit.
        let psd = store::psd_dir(&opened.id).expect("psd dir").join("tower.psd");
        assert!(psd.exists(), "the source PSD should travel");

        // Processed assets, so an import opens without a re-parse.
        assert!(store::assets_dir(&opened.id)
            .expect("assets dir")
            .join("tower/data.json")
            .exists());

        // And the code, as it was edited rather than as the template writes it.
        assert_eq!(
            store::read_game_file(&opened.id, "js/WorldScene.js").expect("scene should read"),
            "// edited by hand\n",
        );

        // The generated config is rebuilt around the document that arrived.
        let config: serde_json::Value = serde_json::from_str(
            &store::read_game_file(&opened.id, "js/game.config.json").expect("config"),
        )
        .expect("config should be JSON");
        assert_eq!(config["psdKeys"][0], "tower");
        assert_eq!(config["grid"], 64);
        assert_eq!(config["scenes"].as_array().map(Vec::len), Some(2));
        assert_eq!(config["activeScene"], "scene-cave");

        store::delete_project(&opened.id).ok();
    });

    store::delete_project(&source).ok();
    std::fs::remove_file(&file).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

#[test]
fn an_archive_carries_no_id_of_its_own() {
    let source = seeded("No id");
    let file = temp("no-id.idlewild");

    let result = std::panic::catch_unwind(|| {
        archive::export(&source, &file).expect("export should write the archive");
        let names = entry_names(&file);

        assert!(names.contains(&"idlewild.json".to_string()));
        assert!(names.contains(&"doc.json".to_string()));
        assert!(names.iter().any(|n| n.starts_with("psd/")));
        assert!(names.iter().any(|n| n.starts_with("assets/")));
        assert!(names.iter().any(|n| n.starts_with("game/")));
        assert!(
            !names.contains(&"meta.json".to_string()),
            "meta.json names a directory in this store; it has no meaning elsewhere",
        );
    });

    store::delete_project(&source).ok();
    std::fs::remove_file(&file).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

#[test]
fn a_file_from_a_newer_build_is_refused_by_name() {
    let file = temp("from-the-future.idlewild");
    write_zip(
        &file,
        &[(
            "idlewild.json",
            &serde_json::json!({
                "format": 99,
                "app": "Idlewild 9.0.0",
                "exportedAt": 0,
                "project": {
                    "name": "Later", "projection": "blank", "genre": "topdown",
                    "gridSize": 32, "createdAt": 0, "layerCount": 1
                }
            })
            .to_string(),
        )],
    );

    let err = archive::import(&file).expect_err("a newer format should be refused");
    assert!(err.contains("newer Idlewild"), "unhelpful error: {err}");
    std::fs::remove_file(&file).ok();
}

#[test]
fn a_zip_that_is_not_a_project_says_so() {
    let file = temp("just-a-zip.idlewild");
    write_zip(&file, &[("readme.txt", "hello")]);
    let err = archive::import(&file).expect_err("a zip with no manifest should be refused");
    assert!(err.contains("idlewild.json"), "unhelpful error: {err}");
    std::fs::remove_file(&file).ok();
}

/// An archive is a file someone hands you, so what it may write is a list
/// rather than a hope.
#[test]
fn an_archive_cannot_write_outside_the_project_it_claims_to_be() {
    let file = temp("hostile.idlewild");
    let outside = store::app_data_dir().expect("app data").join("escaped.txt");
    std::fs::remove_file(&outside).ok();

    write_zip(
        &file,
        &[
            (
                "idlewild.json",
                &serde_json::json!({
                    "format": 1, "app": "handmade", "exportedAt": 0,
                    "project": {
                        "name": "Hostile", "projection": "blank", "genre": "topdown",
                        "gridSize": 32, "createdAt": 0, "layerCount": 1
                    }
                })
                .to_string(),
            ),
            ("doc.json", &document()),
            // Three ways out, and none of them is on the list.
            ("../../escaped.txt", "climbed"),
            ("../escaped.txt", "climbed"),
            ("meta.json", r#"{"id":"somewhere-else"}"#),
        ],
    );

    let opened = archive::import(&file).expect("the rest of it still imports");
    let result = std::panic::catch_unwind(|| {
        assert!(!outside.exists(), "an entry climbed out of the store");
        let root = store::project_dir(&opened.id).expect("project dir");
        assert!(!root.join("escaped.txt").exists());
        // The import wrote this one itself, around the manifest, rather than
        // taking the archive's word for where the project lives.
        let meta = store::read_meta(&opened.id).expect("meta should read");
        assert_eq!(meta.id, opened.id);
        assert_eq!(meta.name, "Hostile");
        // A missing `game/` is scaffolded rather than left as a project that
        // cannot be played.
        assert!(root.join("game/index.html").exists());
    });

    store::delete_project(&opened.id).ok();
    std::fs::remove_file(&file).ok();
    std::fs::remove_file(&outside).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

fn entry_names(path: &Path) -> Vec<String> {
    let file = std::fs::File::open(path).expect("archive should open");
    let mut zip = zip::ZipArchive::new(file).expect("archive should read");
    (0..zip.len())
        .map(|i| zip.by_index(i).expect("entry").name().to_string())
        .collect()
}

/// A zip built by hand, so a test can put in it what an export never would.
fn write_zip(path: &Path, entries: &[(&str, &str)]) {
    let file = std::fs::File::create(path).expect("archive should write");
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for (name, body) in entries {
        zip.start_file(*name, options).expect("entry should start");
        zip.write_all(body.as_bytes()).expect("entry should write");
    }
    zip.finish().expect("archive should finish");
}
