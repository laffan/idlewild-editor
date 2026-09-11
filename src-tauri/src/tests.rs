//! End-to-end coverage of the PSD pipeline.
//!
//! This is the load-bearing path: every image entering the editor becomes a
//! PSD, and psd-to-json turns it into the folder psd-to-phaser loads. If the
//! write half of the psd fork and the read half of psd-to-json ever disagree,
//! it shows up here rather than on an iPad.
//!
//! Neighbours split off for the 700-line rule, sharing only the store they
//! create projects in and `swatch`. `marks` is the orienting marks an import
//! writes and psd-to-json reports back. `rewrite` is what a *second* write to
//! the same file has to keep. `scaffolds` is what a *project* is made of —
//! the starter document, the runnable game each template selection writes,
//! what an export carries, and the tree the code modal edits.

mod archive;
mod config;
mod marks;
mod rewrite;
mod scaffolds;
mod server;
mod stacking;

use crate::project::{Genre, Projection};
use crate::{psd_pipeline, psd_write, publish, store};

/// Solid-colour RGBA, so a round trip can be checked pixel by pixel.
pub(super) fn swatch(width: u32, height: u32, rgba: [u8; 4]) -> Vec<u8> {
    let mut out = Vec::with_capacity((width * height * 4) as usize);
    for _ in 0..width * height {
        out.extend_from_slice(&rgba);
    }
    out
}

#[test]
fn rgba_becomes_a_readable_psd() {
    let bytes = psd_write::psd_from_rgba_marked("sketch", 16, 8, swatch(16, 8, [236, 48, 19, 255]), None)
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
    let err = psd_write::psd_from_rgba_marked("bad", 4, 4, vec![0; 10], None).unwrap_err();
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

/// Bytes off a clipboard have no name to read, so the `8BPS` signature is
/// what says a paste is already a document. Handing one to the image decoder
/// only ever produced "failed to decode image" for a file that was fine.
#[test]
fn psd_bytes_pass_through_instead_of_being_decoded() {
    let original = psd_write::psd_from_rgba_marked("tower", 6, 4, swatch(6, 4, [10, 20, 30, 255]), None)
        .expect("swatch should convert");
    assert!(psd_write::is_psd(&original));

    let passed = psd_write::psd_from_image_bytes_marked("pasted", &original, None)
        .expect("a PSD should be taken as it is");
    // Byte-identical: the file arrives as its author built it, layer stack
    // and all, rather than being flattened into a one-layer wrapper.
    assert_eq!(passed, original);

    let mut png = Vec::new();
    image::RgbaImage::from_raw(2, 2, swatch(2, 2, [1, 2, 3, 255]))
        .expect("swatch should fit")
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .expect("PNG should encode");
    assert!(!psd_write::is_psd(&png));

    // A paste sends marks, and a pasted *document* still ignores them: adding
    // our two layers would mean rebuilding someone else's stack, which is the
    // same reason a `.psd` imported from Files is copied rather than written.
    let marks = crate::psd_write::AnchorMarks {
        outline: vec![
            crate::psd_write::MarkPoint { x: 0.0, y: 0.0 },
            crate::psd_write::MarkPoint { x: 64.0, y: 0.0 },
            crate::psd_write::MarkPoint { x: 64.0, y: 64.0 },
            crate::psd_write::MarkPoint { x: 0.0, y: 64.0 },
        ],
        lines: vec![],
        art: None,
        cols: 1,
        rows: 1,
    };
    let marked = psd_write::psd_from_image_bytes_marked("pasted", &original, Some(&marks))
        .expect("a PSD should still be taken as it is");
    assert_eq!(marked, original);
}

/// The bug this pins: the iPadOS document picker resolves `NSURL`s, which
/// reach the frontend as `file://` strings, so every re-import from Files
/// failed with "No such file or directory" the moment the Files browser
/// started opening at all.
#[test]
fn a_picked_source_may_arrive_as_a_file_url() {
    use std::path::PathBuf;
    let path = |s: &str| PathBuf::from(s);

    // What macOS hands back, unchanged — including a literal % in a name,
    // which is not an escape when it is not in a URL.
    assert_eq!(psd_write::source_path("/Users/me/tower.psd"), path("/Users/me/tower.psd"));
    assert_eq!(psd_write::source_path("/tmp/100%25.psd"), path("/tmp/100%25.psd"));

    // What iPadOS hands back.
    assert_eq!(
        psd_write::source_path("file:///private/var/mobile/Inbox/tower.psd"),
        path("/private/var/mobile/Inbox/tower.psd")
    );
    // Percent escapes, including a multi-byte character split across two.
    assert_eq!(
        psd_write::source_path("file:///tmp/my%20sketch.psd"),
        path("/tmp/my sketch.psd")
    );
    assert_eq!(
        psd_write::source_path("file:///tmp/caf%C3%A9.psd"),
        path("/tmp/café.psd")
    );
    // An authority, which names the same local file.
    assert_eq!(
        psd_write::source_path("file://localhost/tmp/tower.psd"),
        path("/tmp/tower.psd")
    );
    // A truncated escape is left as it stands rather than eaten.
    assert_eq!(psd_write::source_path("file:///tmp/a%2.psd"), path("/tmp/a%2.psd"));
}

#[test]
fn stems_are_safe_for_paths_and_keys() {
    assert_eq!(psd_write::sanitise_stem("Screen Shot 2026"), "Screen_Shot_2026");
    assert_eq!(psd_write::sanitise_stem("../../etc/passwd"), "etc_passwd");
    assert_eq!(psd_write::sanitise_stem("///"), "image");
}

/// The whole path a dropped image takes: convert, process, and land in the
/// folder shape `P2P.load.load(scene, key, 'assets/<key>')` expects.
#[test]
fn a_project_round_trips_an_image_through_psd_to_json() {
    let meta = store::create_project("Pipeline test", Projection::Isometric, Genre::Topdown, 64)
        .expect("project should be created");

    // Everything below runs against the real store, so clean up whatever
    // happens — including on a failed assertion.
    let result = std::panic::catch_unwind(|| {
        let psd_bytes =
            psd_write::psd_from_rgba_marked("tower", 32, 48, swatch(32, 48, [32, 30, 29, 255]), None)
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
    let meta = store::create_project("Naming", Projection::Isometric, Genre::Topdown, 64)
        .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let bytes = psd_write::psd_from_rgba_marked("build", 8, 8, swatch(8, 8, [1, 2, 3, 255]), None)
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

/// PSD keys reach the pipeline from the document — a file on disk — and now
/// name a path the shell is asked to hand to another application, so a key
/// that could climb out of the project must never resolve to a path.
/// The bug this pins: renaming a PSD renamed the file and re-ran the
/// pipeline, but left the layer *inside* it holding the old name — so the
/// layers panel showed the new name on the left and the old one in its grey
/// detail column, which is the layer path, for no reason a user could work
/// out.
#[test]
fn renaming_a_psd_renames_the_layer_it_named_after_itself() {
    use psd::{LayerBuilder, PsdBuilder};

    let meta = store::create_project("Layer names", Projection::Orthogonal, Genre::Topdown, 32)
        .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        // Two layers: one named after the file, one named by a person.
        let mut builder = PsdBuilder::new(8, 8);
        builder.add_layer(
            LayerBuilder::new("S | before").rgba(8, 8, swatch(8, 8, [1, 2, 3, 255])),
        );
        builder.add_layer(
            LayerBuilder::new("S | hand painted").rgba(8, 8, swatch(8, 8, [4, 5, 6, 255])),
        );
        let bytes = builder.to_bytes().expect("PSD should build");

        let psd_dir = store::psd_dir(&meta.id).expect("psd dir");
        std::fs::write(psd_dir.join("before.psd"), &bytes).expect("PSD should save");
        psd_pipeline::process(&meta.id, "before", &psd_pipeline::ProcessOptions::default(), |_| {})
            .expect("first parse");

        let renamed = psd_pipeline::rename_and_process(&meta.id, "before", "after", |_| {})
            .expect("rename should succeed");
        assert_eq!(renamed.key, "after");

        let parsed: serde_json::Value =
            serde_json::from_str(&renamed.manifest).expect("manifest should be JSON");
        let names: Vec<String> = parsed["layers"]
            .as_array()
            .expect("layers")
            .iter()
            .map(|l| l["name"].as_str().unwrap_or_default().to_string())
            .collect();

        assert!(
            names.contains(&"after".to_string()),
            "the layer named after the file should follow it: {names:?}"
        );
        assert!(
            !names.contains(&"before".to_string()),
            "the old name should be gone: {names:?}"
        );
        // Somebody's own name for a layer is not the file's to change.
        assert!(
            names.contains(&"hand painted".to_string()),
            "a hand-named layer should be untouched: {names:?}"
        );
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

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
    let meta = store::create_project("Re-import", Projection::Orthogonal, Genre::Topdown, 32)
        .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let psd_dir = store::psd_dir(&meta.id).expect("psd dir");
        let original = psd_write::psd_from_rgba_marked("hut", 16, 16, swatch(16, 16, [10, 20, 30, 255]), None)
            .expect("PSD should be written");
        std::fs::write(psd_dir.join("hut.psd"), original).expect("PSD should save");
        psd_pipeline::process(&meta.id, "hut", &psd_pipeline::ProcessOptions::default(), |_| {})
            .expect("the first parse should succeed");

        // The edited file, standing in for whatever came back from Photoshop:
        // a different size, dropped into a differently named temporary file.
        let edited = psd_write::psd_from_rgba_marked("hut", 48, 24, swatch(48, 24, [1, 2, 3, 255]), None)
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

/// Renaming a PSD moves the file, the assets under it, and nothing else.
///
/// The key names three things at once — the file's stem, the directory
/// psd-to-json writes into, and what psd-to-phaser registers the file under —
/// so a rename has to leave all three agreeing. What it must *not* touch is
/// the layer inside the file: a placement points at its layer by name, and
/// the point of renaming a file is not to claim anything about its contents.
#[test]
fn renaming_a_psd_moves_its_file_and_its_assets() {
    let meta = store::create_project("Rename", Projection::Orthogonal, Genre::Topdown, 32)
        .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let psd_dir = store::psd_dir(&meta.id).expect("psd dir");
        let bytes = psd_write::psd_from_rgba_marked(
            "pasted-m2k9f1",
            12,
            20,
            swatch(12, 20, [9, 9, 9, 255]),
            None,
        )
        .expect("PSD should be written");
        std::fs::write(psd_dir.join("pasted-m2k9f1.psd"), bytes).expect("PSD should save");
        psd_pipeline::process(
            &meta.id,
            "pasted-m2k9f1",
            &psd_pipeline::ProcessOptions::default(),
            |_| {},
        )
        .expect("the first parse should succeed");

        let renamed = psd_pipeline::rename_and_process(&meta.id, "pasted-m2k9f1", "hero", |_| {})
            .expect("rename should succeed");
        assert_eq!(renamed.key, "hero");
        assert_eq!((renamed.width, renamed.height), (12, 20));

        assert!(psd_dir.join("hero.psd").exists(), "the file should have moved");
        assert!(
            !psd_dir.join("pasted-m2k9f1.psd").exists(),
            "the old file should be gone, not copied"
        );
        assert!(psd_pipeline::is_processed(&meta.id, "hero"));
        assert!(
            !psd_pipeline::is_processed(&meta.id, "pasted-m2k9f1"),
            "the old asset directory should have gone with it"
        );

        // The layer was named after the file, so it follows it — and every
        // placement's `layerPath` is repointed with it. See
        // `renaming_a_psd_renames_the_layer_it_named_after_itself` for the
        // other half of that rule.
        let manifest: serde_json::Value =
            serde_json::from_str(&renamed.manifest).expect("manifest should be JSON");
        assert_eq!(manifest["layers"][0]["name"], "hero");

        // A rename onto a name already in use would silently eat a file.
        let other = psd_write::psd_from_rgba_marked("hero", 4, 4, swatch(4, 4, [0, 0, 0, 255]), None)
            .expect("PSD should be written");
        std::fs::write(psd_dir.join("second.psd"), other).expect("PSD should save");
        assert!(
            psd_pipeline::rename_and_process(&meta.id, "second", "hero", |_| {}).is_err(),
            "renaming onto an existing key should fail"
        );
        assert!(psd_dir.join("second.psd").exists(), "the refused rename must not move it");

        assert!(
            psd_pipeline::rename_and_process(&meta.id, "absent", "anything", |_| {}).is_err(),
            "renaming a key with no file behind it should fail"
        );
        assert!(
            psd_pipeline::rename_and_process(&meta.id, "hero", "../escape", |_| {}).is_err(),
            "a key that could climb out of the project should be refused"
        );
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// Reading and rewriting a PSD's layer stack from the inspector.
///
/// The order round trip is the load-bearing part: `layers()` reads top-first
/// and `add_layer` stacks bottom-up, so a rewrite that forgot to reverse
/// would silently invert every file it touched.
#[test]
fn psd_layers_can_be_reordered_and_renamed() {
    use crate::psd_layers::{self, LayerEdit};
    use crate::psd_write::{AnchorMarks, MarkPoint};

    let meta = store::create_project("Layers", Projection::Orthogonal, Genre::Topdown, 32)
        .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let id = &meta.id;
        let at = |x: f32, y: f32| MarkPoint { x, y };
        let marks = AnchorMarks {
            outline: vec![at(0.0, 0.0), at(32.0, 0.0), at(32.0, 32.0), at(0.0, 32.0)],
            lines: vec![],
            art: None,
            cols: 1,
            rows: 1,
        };
        let bytes = psd_write::psd_from_rgba_marked(
            "hut",
            32,
            32,
            swatch(32, 32, [9, 9, 9, 255]),
            Some(&marks),
        )
        .expect("marked PSD should be written");
        std::fs::write(store::psd_dir(id).expect("psd dir").join("hut.psd"), &bytes)
            .expect("PSD should save");

        // Read: top-first, as Photoshop shows it, with the pipe convention
        // spelled out so the inspector can say what each layer becomes.
        let before = psd_layers::read(id, "hut").expect("layers should read");
        assert!(before.writable, "a flat PSD should be writable");
        assert_eq!(before.blocked_by, None);
        let names: Vec<&str> = before.layers.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(names, ["P | anchor", "Z | grid", "S | hut"]);
        let categories: Vec<&str> =
            before.layers.iter().map(|l| l.category.as_str()).collect();
        assert_eq!(categories, ["point", "zone", "sprite"]);

        // Write: put the sprite on top and rename it, leaving the rest alone.
        let edits = vec![
            LayerEdit { index: 2, name: "T | hut".into(), depth: 0 },
            LayerEdit { index: 0, name: "P | anchor".into(), depth: 0 },
            LayerEdit { index: 1, name: "Z | grid".into(), depth: 0 },
        ];
        let manifest = psd_layers::write(id, "hut", &edits, |_| {})
            .expect("rewrite should succeed");

        let after = psd_layers::read(id, "hut").expect("layers should read back");
        let names: Vec<&str> = after.layers.iter().map(|l| l.name.as_str()).collect();
        assert_eq!(
            names,
            ["T | hut", "P | anchor", "Z | grid"],
            "the order asked for is the order stored"
        );

        // The canvas and each layer's geometry survive the rebuild.
        assert_eq!((after.width, after.height), (before.width, before.height));
        let sprite = &after.layers[0];
        let was = &before.layers[2];
        assert_eq!((sprite.x, sprite.y), (was.x, was.y));
        assert_eq!((sprite.width, sprite.height), (was.width, was.height));

        // And the rename reached psd-to-json: a tileset now, not a sprite.
        let parsed: serde_json::Value =
            serde_json::from_str(&manifest).expect("manifest should be JSON");
        let layers = parsed["layers"].as_array().expect("layers array");
        let hut = layers
            .iter()
            .find(|l| l["name"] == "hut")
            .expect("the renamed layer should be in the manifest");
        assert_eq!(hut["category"], "tileset");

        // An empty stack is refused rather than writing a file with nothing
        // in it, and an unknown index is an error rather than a silent skip.
        assert!(psd_layers::write(id, "hut", &[], |_| {}).is_err());
        assert!(psd_layers::write(
            id,
            "hut",
            &[LayerEdit { index: 99, name: "S | x".into(), depth: 0 }],
            |_| {},
        )
        .is_err());
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// Every sprite layer exports a PNG named after the layer, not after the file.
///
/// This is what the frontend's texture eviction depends on: psd-to-phaser
/// keys a sprite's texture on the layer's own name, so a reload has to know
/// the names to clear them — and a texture it fails to clear makes Phaser
/// silently drop the file, which hangs the whole load. See
/// `src/game/psd-loader.ts`.
///
/// A layer with nothing painted on it is included on purpose: an artist who
/// adds a layer in Photoshop and saves before drawing still gets a sprite
/// entry and a real file, so nothing downstream may assume otherwise.
#[test]
fn every_sprite_layer_exports_a_png_named_after_the_layer() {
    use psd::{LayerBuilder, PsdBuilder};

    let meta = store::create_project("Layer names", Projection::Isometric, Genre::Topdown, 64)
        .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let mut builder = PsdBuilder::new(64, 64);
        builder.add_layer(
            LayerBuilder::new("S | sketch").rgba(64, 64, swatch(64, 64, [1, 2, 3, 255])),
        );
        builder.add_layer(
            LayerBuilder::new("S | haze").rgba(64, 64, swatch(64, 64, [0, 0, 0, 0])),
        );
        std::fs::write(
            store::psd_dir(&meta.id).unwrap().join("art.psd"),
            builder.to_bytes().expect("PSD should be written"),
        )
        .expect("PSD should save");

        let manifest = psd_pipeline::process(
            &meta.id,
            "art",
            &psd_pipeline::ProcessOptions::default(),
            |_| {},
        )
        .expect("processing should succeed");

        let parsed: serde_json::Value =
            serde_json::from_str(&manifest).expect("manifest should be JSON");
        let names: Vec<&str> = parsed["layers"]
            .as_array()
            .expect("layers array")
            .iter()
            .map(|l| l["name"].as_str().unwrap_or_default())
            .collect();
        assert!(names.contains(&"sketch"), "got {names:?}");
        assert!(
            names.contains(&"haze"),
            "an unpainted layer still reaches the manifest: {names:?}"
        );

        let files: Vec<String> = psd_pipeline::list_output_files(&meta.id, "art")
            .expect("outputs should list")
            .into_iter()
            .map(|f| f.relative_path)
            .collect();
        for expected in ["sprites/sketch.png", "sprites/haze.png"] {
            assert!(files.contains(&expected.to_string()), "{expected} missing from {files:?}");
        }
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}
