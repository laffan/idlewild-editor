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

    let psd_bytes = psd_write::psd_from_image_bytes("imported", &png)
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
