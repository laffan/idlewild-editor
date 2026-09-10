//! End-to-end coverage of the PSD pipeline.
//!
//! This is the load-bearing path: every image entering the editor becomes a
//! PSD, and psd-to-json turns it into the folder psd-to-phaser loads. If the
//! write half of the psd fork and the read half of psd-to-json ever disagree,
//! it shows up here rather than on an iPad.

use crate::project::Projection;
use crate::{psd_pipeline, psd_write, publish, store, templates};

/// Solid-colour RGBA, so a round trip can be checked pixel by pixel.
fn swatch(width: u32, height: u32, rgba: [u8; 4]) -> Vec<u8> {
    let mut out = Vec::with_capacity((width * height * 4) as usize);
    for _ in 0..width * height {
        out.extend_from_slice(&rgba);
    }
    out
}

#[test]
fn rgba_becomes_a_readable_psd() {
    let bytes = psd_write::psd_from_rgba("sketch", 16, 8, swatch(16, 8, [236, 48, 19, 255]))
        .expect("PSD should be written");

    let parsed = psd::Psd::from_bytes(&bytes).expect("PSD should parse back");
    assert_eq!(parsed.width(), 16);
    assert_eq!(parsed.height(), 8);

    // psd-to-json classifies by the pipe convention, so the name has to
    // survive the round trip or the layer is silently ignored downstream.
    let names: Vec<&str> = parsed.layers().iter().map(|l| l.name()).collect();
    assert!(
        names.iter().any(|n| n.contains("sketch")),
        "layer names were {names:?}"
    );
    assert!(
        names.iter().any(|n| n.starts_with("S |")),
        "sprite prefix missing from {names:?}"
    );
}

#[test]
fn rgba_length_is_validated() {
    let err = psd_write::psd_from_rgba("bad", 4, 4, vec![0; 10]).unwrap_err();
    assert!(err.contains("expected"), "unhelpful error: {err}");
}

#[test]
fn png_bytes_convert_to_psd() {
    let mut png = Vec::new();
    let image = image::RgbaImage::from_raw(4, 4, swatch(4, 4, [0, 128, 255, 255]))
        .expect("swatch should fit");
    image
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .expect("PNG should encode");

    let psd_bytes = psd_write::psd_from_image_bytes_marked("imported", &png, None)
        .expect("PNG should convert");
    let parsed = psd::Psd::from_bytes(&psd_bytes).expect("converted PSD should parse");
    assert_eq!((parsed.width(), parsed.height()), (4, 4));
}

#[test]
fn stems_are_safe_for_paths_and_keys() {
    assert_eq!(psd_write::sanitise_stem("Screen Shot 2026"), "Screen_Shot_2026");
    assert_eq!(psd_write::sanitise_stem("../../etc/passwd"), "etc_passwd");
    assert_eq!(psd_write::sanitise_stem("///"), "image");
}

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
fn starter_documents_carry_the_chosen_projection_and_grid() {
    let doc = templates::starter_doc(Projection::Isometric, 128);
    let value: serde_json::Value = serde_json::from_str(&doc).expect("valid JSON");
    assert_eq!(value["projection"], "isometric");
    assert_eq!(value["gridSize"], 128);
    assert_eq!(value["layers"].as_array().map(Vec::len), Some(1));
}

/// The whole path a dropped image takes: convert, process, and land in the
/// folder shape `P2P.load.load(scene, key, 'assets/<key>')` expects.
#[test]
fn a_project_round_trips_an_image_through_psd_to_json() {
    let meta = store::create_project("Pipeline test", Projection::Isometric, 64)
        .expect("project should be created");

    // Everything below runs against the real store, so clean up whatever
    // happens — including on a failed assertion.
    let result = std::panic::catch_unwind(|| {
        let psd_bytes =
            psd_write::psd_from_rgba("tower", 32, 48, swatch(32, 48, [32, 30, 29, 255]))
                .expect("PSD should be written");
        let psd_dir = store::psd_dir(&meta.id).expect("psd dir");
        std::fs::write(psd_dir.join("tower.psd"), psd_bytes).expect("PSD should save");

        let manifest = psd_pipeline::process(
            &meta.id,
            "tower",
            &psd_pipeline::ProcessOptions::default(),
            |_| {},
        )
        .expect("psd-to-json should process the file");

        let parsed: serde_json::Value =
            serde_json::from_str(&manifest).expect("manifest should be JSON");
        assert_eq!(parsed["width"], 32);
        assert_eq!(parsed["height"], 48);

        assert!(
            psd_pipeline::is_processed(&meta.id, "tower"),
            "data.json should exist after processing"
        );

        let outputs =
            psd_pipeline::list_output_files(&meta.id, "tower").expect("outputs should list");
        assert!(
            outputs.iter().any(|f| f.is_json),
            "no manifest among {:?}",
            outputs.iter().map(|f| &f.relative_path).collect::<Vec<_>>()
        );

        // A publish of the same project must be a real, non-empty archive
        // carrying both runtimes.
        let zip = publish::build_zip(&meta.id).expect("zip should build");
        assert!(zip.len() > 1024, "archive was {} bytes", zip.len());
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// psd-to-phaser resolves a placement path by walking the manifest's layers
/// by name. The frontend anchors an imported image on the top-level layer it
/// finds there, so a converted image's layer must be named for its key —
/// otherwise every import places an empty group.
#[test]
fn a_converted_image_names_its_layer_after_the_key() {
    let meta = store::create_project("Naming", Projection::Isometric, 64)
        .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let bytes = psd_write::psd_from_rgba("build", 8, 8, swatch(8, 8, [1, 2, 3, 255]))
            .expect("PSD should be written");
        std::fs::write(
            store::psd_dir(&meta.id).unwrap().join("build.psd"),
            bytes,
        )
        .expect("PSD should save");

        let manifest =
            psd_pipeline::process(&meta.id, "build", &psd_pipeline::ProcessOptions::default(), |_| {})
                .expect("processing should succeed");
        let parsed: serde_json::Value =
            serde_json::from_str(&manifest).expect("manifest should be JSON");

        let layers = parsed["layers"].as_array().expect("layers array");
        assert_eq!(layers.len(), 1, "one sprite layer, got {layers:?}");
        assert_eq!(
            layers[0]["name"], "build",
            "the top-level layer must carry the key"
        );
        assert_eq!(
            layers[0]["category"], "sprite",
            "the S | prefix must classify it as a sprite"
        );
        // The path the old code asked for does not exist in the manifest.
        assert!(
            layers.iter().all(|l| l["name"] != "root"),
            "there is no 'root' layer to place"
        );
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

#[test]
fn a_new_project_scaffolds_a_runnable_game() {
    let meta = store::create_project("Scaffold test", Projection::Orthogonal, 32)
        .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let files = store::list_game_files(&meta.id).expect("files should list");
        let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        for expected in [
            "index.html",
            "js/main.js",
            "js/WorldScene.js",
            "js/grid.js",
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
        assert_eq!(config["grid"], 32);
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// PSD keys reach the pipeline from the document — a file on disk — and now
/// name a path the shell is asked to hand to another application, so a key
/// that could climb out of the project must never resolve to a path.
#[test]
fn psd_keys_cannot_escape_the_project() {
    assert!(psd_pipeline::safe_key("tower-01_a").is_ok());
    for bad in ["../../etc/passwd", "a/b", "with space", "", "dot.dot"] {
        assert!(
            psd_pipeline::safe_key(bad).is_err(),
            "{bad:?} should have been rejected"
        );
    }
}

/// The other half of the PSD round trip: the file is edited outside the app
/// and comes back over the old one. The key has to survive, because every
/// placement in the document points at it.
#[test]
fn reimporting_replaces_the_file_behind_a_key() {
    let meta = store::create_project("Re-import", Projection::Orthogonal, 32)
        .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let psd_dir = store::psd_dir(&meta.id).expect("psd dir");
        let original = psd_write::psd_from_rgba("hut", 16, 16, swatch(16, 16, [10, 20, 30, 255]))
            .expect("PSD should be written");
        std::fs::write(psd_dir.join("hut.psd"), original).expect("PSD should save");
        psd_pipeline::process(&meta.id, "hut", &psd_pipeline::ProcessOptions::default(), |_| {})
            .expect("the first parse should succeed");

        // The edited file, standing in for whatever came back from Photoshop:
        // a different size, dropped into a differently named temporary file.
        let edited = psd_write::psd_from_rgba("hut", 48, 24, swatch(48, 24, [1, 2, 3, 255]))
            .expect("edited PSD should be written");
        let inbox = psd_dir.join("whatever-the-editor-called-it.psd");
        std::fs::write(&inbox, edited).expect("edited PSD should save");

        let imported = psd_pipeline::reimport_and_process(&meta.id, "hut", &inbox, |_| {})
            .expect("re-import should succeed");

        assert_eq!(imported.key, "hut", "the key must not change");
        assert_eq!((imported.width, imported.height), (48, 24));

        // The store holds the new file under the old name, and no second one.
        let stored = std::fs::read(psd_dir.join("hut.psd")).expect("hut.psd should still exist");
        let parsed = psd::Psd::from_bytes(&stored).expect("stored PSD should parse");
        assert_eq!((parsed.width(), parsed.height()), (48, 24));

        let manifest: serde_json::Value =
            serde_json::from_str(&imported.manifest).expect("manifest should be JSON");
        assert_eq!(manifest["width"], 48);
        assert_eq!(manifest["height"], 24);

        // A key with no PSD behind it is a re-import of nothing, not a new
        // import that quietly invents one.
        assert!(
            psd_pipeline::reimport_and_process(&meta.id, "absent", &inbox, |_| {}).is_err(),
            "re-importing an unknown key should fail"
        );
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

    let meta = store::create_project("Marks", Projection::Orthogonal, 32)
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
            cols: 1,
            rows: 1,
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
