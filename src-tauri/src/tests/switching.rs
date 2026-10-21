//! The Phaser scaffold, and moving a project from one scaffold to another.
//!
//! A switch writes the new scaffold's files and takes the old one's away, and
//! every file it overwrites or removes is in `game/Backups/` first. These pin
//! the three things that would lose work or break a project if they slipped:
//! what is backed up, what is left behind, and what a PSD to Phaser scene is
//! written with.

use crate::print::Output;
use crate::project::{GameOptions, Projection, Scaffold};
use crate::scaffold_switch::{switch_scaffold, BACKUPS_DIR};
use crate::{publish, store};
use std::collections::HashMap;

fn files_of(id: &str) -> Vec<String> {
    let mut paths: Vec<String> = store::list_game_files(id)
        .expect("files should list")
        .into_iter()
        .filter(|f| !f.is_dir)
        .map(|f| f.path)
        .collect();
    paths.sort();
    paths
}

fn cleanup(ids: &[&str], result: std::thread::Result<()>) {
    for id in ids {
        store::delete_project(id).ok();
    }
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// Phaser: Vanilla's three files with Phaser on the page, and nothing loaded.
#[test]
fn the_phaser_scaffold_is_vanilla_with_phaser_running() {
    let meta = store::create_project(
        "Running",
        Projection::Orthogonal,
        Scaffold::Phaser,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        assert_eq!(
            files_of(&meta.id),
            ["game.config.json", "index.html", "script.js", "style.css"],
        );
        let index = store::read_game_file(&meta.id, "index.html").expect("index should read");
        assert!(index.contains("<script src=\"lib/phaser.min.js\"></script>"));
        assert!(!index.contains("psd-to-phaser.umd.js"));
        assert_eq!(
            store::read_meta(&meta.id).expect("meta").options.character,
            false
        );

        // Shipped Phaser, where its page asks for it, and not the plugin.
        let (_, entries) = publish::site_entries(&meta.id).expect("a site should list");
        let rels: Vec<&str> = entries.iter().map(|e| e.rel.as_str()).collect();
        assert!(rels.contains(&"lib/phaser.min.js"), "{rels:?}");
        assert!(
            !rels.iter().any(|rel| rel.ends_with("psd-to-phaser.umd.js")),
            "{rels:?}"
        );
    });
    cleanup(&[&meta.id], result);
}

/// A Game onto PSD to Phaser: `js/shared/` goes, into the backup, and the
/// scene file is written with the placement code the frontend sent.
#[test]
fn switching_a_game_to_p2p_backs_up_what_it_replaces() {
    let meta = store::create_project(
        "Moving",
        Projection::Orthogonal,
        Scaffold::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        // An edit of the author's to the old scene, which must survive.
        let scene = store::read_game_file(&meta.id, "js/scenes/Scene1.js").expect("scene");
        let edited = format!("{scene}\n// mine\n");
        store::write_game_file(&meta.id, "js/scenes/Scene1.js", &edited).expect("write");

        // The links to the old scene files go with them.
        let links = store::project_dir(&meta.id).expect("dir").join("code-links.json");
        std::fs::write(&links, "{}").expect("write");
        let code = "    const tree = this.P2P.place(this, \"tree\", \"tree\");\n    \
                    tree.setPosition(1, 2);\n";
        let placements = HashMap::from([("scene-main".to_string(), code.to_string())]);
        let report =
            switch_scaffold(&meta.id, Scaffold::P2p, &placements).expect("switch should run");

        assert_eq!(report.meta.genre, Scaffold::P2p);
        assert!(!links.exists(), "a switch forgets the links to the files it rewrote");
        assert_eq!(report.meta.options.character, false);
        let backup = report.backup.expect("something was backed up");
        assert!(backup.starts_with(&format!("{BACKUPS_DIR}/")) && backup.ends_with("-topdown"));
        for rel in [
            "js/shared/canvas.js",
            "js/shared/character.js",
            "js/scenes/Scene1.js",
        ] {
            assert!(
                report.backed_up.iter().any(|b| b == rel),
                "{rel} in {:?}",
                report.backed_up
            );
        }
        let saved = store::read_game_file(&meta.id, &format!("{backup}/js/scenes/Scene1.js"))
            .expect("the old scene is in the backup");
        assert!(saved.ends_with("// mine\n"), "with the author's edit in it");

        let live: Vec<String> = files_of(&meta.id)
            .into_iter()
            .filter(|p| !p.starts_with(BACKUPS_DIR))
            .collect();
        assert!(!live
            .iter()
            .any(|p| p.starts_with("js/shared") || p.starts_with("js/prefabs")));
        let scene = store::read_game_file(&meta.id, "js/scenes/Scene1.js").expect("scene");
        assert!(scene.contains("    // Place PSDs here.\n    const tree = this.P2P.place"));
        // Centred on the origin, as Draw's screen boundary is.
        assert!(scene.contains("    this.cameras.main.centerOn(0, 0);\n    // Place PSDs here.\n"));
        assert!(!scene.contains("import "));

        // The document and the config follow the meta.
        let doc: serde_json::Value =
            serde_json::from_str(&store::read_doc(&meta.id).expect("doc")).expect("json");
        assert_eq!(doc["genre"], "p2p");
        let config: serde_json::Value = serde_json::from_str(
            &store::read_game_file(&meta.id, "js/game.config.json").expect("config"),
        )
        .expect("json");
        assert_eq!(config["genre"], "p2p");

        // And a publish leaves the backups out.
        let (_, entries) = publish::site_entries(&meta.id).expect("a site should list");
        assert!(!entries.iter().any(|e| e.rel.starts_with(BACKUPS_DIR)));
    });
    cleanup(&[&meta.id], result);
}

/// Onto Vanilla, with a file of the author's in the way: it is overwritten,
/// and it is in the backup. The whole `js/` tree goes.
#[test]
fn a_file_sharing_a_name_is_backed_up_before_it_is_overwritten() {
    let meta = store::create_project(
        "Clash",
        Projection::Blank,
        Scaffold::P2p,
        16,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        store::write_game_file(&meta.id, "script.js", "// my own script\n").expect("write");
        store::write_game_file(&meta.id, "notes.txt", "kept\n").expect("write");

        let report = switch_scaffold(&meta.id, Scaffold::Vanilla, &HashMap::new()).expect("switch");
        let backup = report.backup.expect("something was backed up");
        assert_eq!(
            store::read_game_file(&meta.id, &format!("{backup}/script.js")).expect("backed up"),
            "// my own script\n",
        );
        let live: Vec<String> = files_of(&meta.id)
            .into_iter()
            .filter(|p| !p.starts_with(BACKUPS_DIR))
            .collect();
        assert_eq!(
            live,
            [
                "game.config.json",
                "index.html",
                "notes.txt",
                "script.js",
                "style.css"
            ],
            "the old tree is gone, and a file no scaffold writes is left alone",
        );
        assert!(store::read_game_file(&meta.id, "script.js")
            .expect("script")
            .contains("fetch("));
    });
    cleanup(&[&meta.id], result);
}

/// Picking the scaffold a project already has rewrites it; a file it would
/// write unchanged is neither rewritten nor backed up.
#[test]
fn rewriting_the_same_scaffold_backs_up_only_what_changes() {
    let meta = store::create_project(
        "Again",
        Projection::Blank,
        Scaffold::P2p,
        16,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let untouched = switch_scaffold(&meta.id, Scaffold::P2p, &HashMap::new()).expect("switch");
        assert!(untouched.backup.is_none(), "{:?}", untouched.backed_up);

        store::write_game_file(&meta.id, "js/main.js", "// broken\n").expect("write");
        let repaired = switch_scaffold(&meta.id, Scaffold::P2p, &HashMap::new()).expect("switch");
        assert_eq!(repaired.backed_up, ["js/main.js"]);
        assert!(store::read_game_file(&meta.id, "js/main.js")
            .expect("main")
            .contains("class Load"));
    });
    cleanup(&[&meta.id], result);
}

/// A print project is always PSD to Phaser, and a switch says so.
#[test]
fn a_print_project_stays_psd_to_phaser() {
    let meta = store::create_project_for(
        "Sheet",
        Projection::Blank,
        Scaffold::P2p,
        16,
        GameOptions::default(),
        Output {
            kind: crate::print::OutputKind::Print,
            ..Output::default()
        },
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        assert!(switch_scaffold(&meta.id, Scaffold::Phaser, &HashMap::new()).is_err());
        assert!(switch_scaffold(&meta.id, Scaffold::P2p, &HashMap::new()).is_ok());
        let scene = store::read_game_file(&meta.id, "js/scenes/Scene1.js").expect("scene");
        assert!(scene.contains("ExportForPrint({ name: \"page\", formats: \"png\" });"));
    });
    cleanup(&[&meta.id], result);
}

/// A PSD to Phaser project made while the scaffold still wrote `js/shared/`
/// gets that scene for a scene added to it: its `main.js` has no `Load`.
#[test]
fn a_p2p_project_with_the_old_tree_gets_the_old_scene() {
    let meta = store::create_project(
        "Older",
        Projection::Blank,
        Scaffold::P2p,
        16,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        store::write_game_file(&meta.id, "js/shared/canvas.js", "// the old machinery\n")
            .expect("write");
        store::write_doc(
            &meta.id,
            &serde_json::json!({
                "version": 2,
                "projection": "blank",
                "genre": "p2p",
                "gridSize": 16,
                "activeSceneId": "scene-main",
                "scenes": [
                    { "id": "scene-main", "name": "Scene1", "layers": [] },
                    { "id": "s2", "name": "Cave", "layers": [] }
                ]
            })
            .to_string(),
        )
        .expect("document should save");
        let cave = store::read_game_file(&meta.id, "js/scenes/Cave.js").expect("scene");
        assert!(cave.contains("placeDocument(this)"), "{cave}");
        assert!(cave.contains("class Cave extends"));
    });
    cleanup(&[&meta.id], result);
}
