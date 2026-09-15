//! What an export carries out of a project.
//!
//! Split from `scaffolds` for the 700-line rule and along its own seam: those
//! tests are about what creating a project *writes*, these about what leaving
//! with one *takes* — the document in the shape the game reads, the spaces
//! every placed PSD blocks, a document too broken to read at all, and the
//! artwork on its own. They share the store they create projects in and nothing
//! else.

use crate::project::{GameOptions, Genre, Projection};
use crate::{export_assets, psd_pipeline, psd_write, publish, store};

/// The bug this pins: an export shipped the game tree and the processed
/// assets but left `game.config.json` as the empty one the scaffold wrote, so
/// a published game drew its grid and its character and nothing else. The
/// document has to reach the archive, and it reaches it through that file.
#[test]
fn an_export_carries_the_document_in_its_config() {
    let meta = store::create_project(
        "Export",
        Projection::Orthogonal,
        Genre::Topdown,
        32,
        GameOptions::default(),
    )
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

/// What a placed PSD blocks has to reach the exported game, or a published
/// project walks through the towers the editor walks around.
///
/// The collider rides on the first placement of each unit and on none of the
/// others: a PSD placed as three layers is one thing standing on one patch of
/// ground, and three copies of that patch would be three identical rectangles
/// in the runtime's solid list.
#[test]
fn an_export_carries_what_each_placed_psd_blocks() {
    let meta = store::create_project(
        "Colliders",
        Projection::Isometric,
        Genre::Topdown,
        64,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let doc = serde_json::json!({
            "version": 1,
            "projection": "isometric",
            "gridSize": 64,
            "colliders": {
                "tower": { "cells": [{ "cx": 0, "cy": 0 }, { "cx": 1, "cy": 0 }], "blocking": true },
                "path": { "cells": [{ "cx": 0, "cy": 0 }], "blocking": false }
            },
            "layers": [{
                "id": "layer-1",
                "name": "Terrain",
                "locked": false,
                "visible": true,
                "fills": [],
                "placements": [
                    {
                        "id": "p1", "instance": "u1", "psdKey": "tower",
                        "layerPath": "tower", "x": 0.0, "y": 0.0,
                        "width": 64.0, "height": 64.0, "anchor": { "cx": 2, "cy": 3 }
                    },
                    {
                        "id": "p2", "instance": "u1", "psdKey": "tower",
                        "layerPath": "roof", "x": 0.0, "y": 0.0,
                        "width": 64.0, "height": 64.0, "anchor": { "cx": 2, "cy": 3 }
                    },
                    {
                        "id": "p3", "instance": "u2", "psdKey": "path",
                        "layerPath": "path", "x": 0.0, "y": 0.0,
                        "width": 64.0, "height": 64.0, "anchor": { "cx": 0, "cy": 0 }
                    }
                ],
                "zones": [],
                "strokes": []
            }]
        });
        store::write_doc(&meta.id, &doc.to_string()).expect("document should write");

        let zip = publish::build_zip(&meta.id).expect("zip should build");
        let config: serde_json::Value = serde_json::from_str(
            &read_from_zip(&zip, "colliders/js/game.config.json")
                .expect("the archive should carry a config"),
        )
        .expect("config should be JSON");

        let placements = &config["layers"][0]["placements"];
        // Offsets and the anchor, unresolved: adding them up needs the
        // projection, which lives in the runtime's own grid.js.
        assert_eq!(placements[0]["anchor"], serde_json::json!({ "cx": 2.0, "cy": 3.0 }));
        assert_eq!(placements[0]["collider"]["blocking"], true);
        assert_eq!(
            placements[0]["collider"]["cells"],
            serde_json::json!([{ "cx": 0.0, "cy": 0.0 }, { "cx": 1.0, "cy": 0.0 }])
        );
        // The second layer of the same unit carries none.
        assert!(placements[1]["collider"].is_null());
        // A walkable one still travels: the runtime reads `blocking`, and a
        // collider dropped here could not be switched back on without a
        // re-export.
        assert_eq!(placements[2]["collider"]["blocking"], false);

        // And every scene carries the same map, because a collider is a fact
        // about the file: the same PSD standing in a second scene blocks the
        // same spaces there.
        let in_scene = &config["scenes"][0]["layers"][0]["placements"][0];
        assert_eq!(in_scene["collider"], placements[0]["collider"]);
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
    let meta = store::create_project(
        "Corrupt",
        Projection::Isometric,
        Genre::Platformer,
        64,
        GameOptions::default(),
    )
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

/// **Export Assets** is the third exit, and the only one that hands back
/// artwork rather than a program.
///
/// Three things have to be true of it and none of them is true of the other two
/// exits. It takes a *list* — the files nobody asked for stay out. It answers
/// the "assets, sources, or both" question separately from that list, because
/// the sprite sheets go into another engine and the PSDs go into Photoshop and
/// wanting one is not wanting the other. And the paths inside are the store's
/// own — `psd/<key>.psd` and `assets/<key>/…` — so there is one layout to learn
/// rather than a second invented for the zip.
#[test]
fn export_assets_takes_the_files_and_the_halves_it_was_asked_for() {
    let meta = store::create_project(
        "Assets",
        Projection::Orthogonal,
        Genre::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let psd_dir = store::psd_dir(&meta.id).expect("psd dir");
        for key in ["tower", "tree"] {
            let bytes = psd_write::psd_from_rgba_marked(
                key,
                4,
                4,
                super::swatch(4, 4, [10, 20, 30, 255]),
                None,
            )
            .expect("a PSD should be written");
            std::fs::write(psd_dir.join(format!("{key}.psd")), &bytes).expect("save");
            psd_pipeline::process(
                &meta.id,
                key,
                &psd_pipeline::ProcessOptions::default(),
                |_| {},
            )
            .expect("psd-to-json should process it");
        }

        // Both halves of one file, and nothing about the other.
        let both = export_assets::build_zip(
            &meta.id,
            &["tower".to_string()],
            export_assets::Wanted {
                assets: true,
                psds: true,
            },
        )
        .expect("both halves should export");
        let names = names_in_zip(&both);
        assert!(
            names.iter().any(|n| n == "assets/psd/tower.psd"),
            "no source PSD in {names:?}"
        );
        assert!(
            names.iter().any(|n| n == "assets/assets/tower/data.json"),
            "no processed manifest in {names:?}"
        );
        assert!(
            !names.iter().any(|n| n.contains("tree")),
            "a file nobody asked for came along: {names:?}"
        );

        // The sources on their own: what opens in Photoshop, and nothing a
        // runtime would read.
        let sources = export_assets::build_zip(
            &meta.id,
            &["tower".to_string(), "tree".to_string()],
            export_assets::Wanted {
                assets: false,
                psds: true,
            },
        )
        .expect("the sources should export");
        let names = names_in_zip(&sources);
        assert_eq!(
            names,
            vec!["assets/psd/tower.psd", "assets/psd/tree.psd"],
            "sources only should be exactly the two files"
        );

        // And the generated half on its own: what another engine can read, with
        // no source file in it at all.
        let generated = export_assets::build_zip(
            &meta.id,
            &["tree".to_string()],
            export_assets::Wanted {
                assets: true,
                psds: false,
            },
        )
        .expect("the assets should export");
        let names = names_in_zip(&generated);
        assert!(
            names.iter().all(|n| n.starts_with("assets/assets/tree/")),
            "assets only should carry nothing else: {names:?}"
        );
        assert!(!names.is_empty(), "assets only came out empty");
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// A zip nobody can use is a zip that should not have been written.
///
/// Both refusals are sentences rather than empty archives: an export somebody
/// has to open to discover was empty is worse than one that did not happen.
#[test]
fn export_assets_refuses_an_archive_with_nothing_in_it() {
    let meta = store::create_project(
        "Empty",
        Projection::Orthogonal,
        Genre::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let none = export_assets::Wanted {
            assets: false,
            psds: false,
        };
        let err = export_assets::build_zip(&meta.id, &["tower".to_string()], none)
            .expect_err("neither half is not a choice");
        assert!(err.contains("Choose"), "unhelpful refusal: {err}");

        let both = export_assets::Wanted {
            assets: true,
            psds: true,
        };
        let err = export_assets::build_zip(&meta.id, &[], both)
            .expect_err("no files is not a choice either");
        assert!(err.contains("Nothing selected"), "unhelpful refusal: {err}");

        // A key the project has not got is skipped, not failed on — but an
        // archive that comes out empty because of it says so.
        let err = export_assets::build_zip(&meta.id, &["nobody".to_string()], both)
            .expect_err("an empty result should be refused");
        assert!(err.contains("anything to export"), "unhelpful refusal: {err}");
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// Every PSD in a project, which is what the picker opens with.
#[test]
fn export_assets_lists_what_is_on_disk_rather_than_what_is_placed() {
    let meta = store::create_project(
        "Listing",
        Projection::Orthogonal,
        Genre::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        assert!(
            export_assets::list(&meta.id).expect("list").is_empty(),
            "a fresh project has no PSDs"
        );

        let psd_dir = store::psd_dir(&meta.id).expect("psd dir");
        let bytes =
            psd_write::psd_from_rgba_marked("hut", 4, 4, super::swatch(4, 4, [1, 2, 3, 255]), None)
                .expect("a PSD should be written");
        std::fs::write(psd_dir.join("hut.psd"), &bytes).expect("save");
        // Not a PSD, so not in the list.
        std::fs::write(psd_dir.join("notes.txt"), b"ignore me").expect("save");

        let listed = export_assets::list(&meta.id).expect("list");
        assert_eq!(listed.len(), 1, "only the PSD should be listed: {listed:?}");
        assert_eq!(listed[0].key, "hut");
        assert!(listed[0].bytes > 0);
        // Written but never processed, so there is nothing generated to export
        // and the row has to say so rather than promising assets it has not got.
        assert!(!listed[0].has_assets);

        psd_pipeline::process(
            &meta.id,
            "hut",
            &psd_pipeline::ProcessOptions::default(),
            |_| {},
        )
        .expect("psd-to-json should process it");
        assert!(export_assets::list(&meta.id).expect("list")[0].has_assets);
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// The entry names in a zip, sorted — a zip's own order is the writer's.
fn names_in_zip(bytes: &[u8]) -> Vec<String> {
    let archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).expect("zip should read");
    let mut names: Vec<String> = archive.file_names().map(str::to_string).collect();
    names.sort();
    names
}
