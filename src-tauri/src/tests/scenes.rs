//! One file per scene, named after it.
//!
//! A scene in the sidebar and a file in `js/scenes/` are the same thing said
//! twice, and keeping them in step is `store::sync_scene_files`, run from the
//! same save that rewrites the config. Three things can happen — a scene
//! appears, a scene is renamed, a scene goes — and each has a way of going
//! quietly wrong: a file nothing imports, a file whose class says one name
//! while its path says another, or somebody's code deleted when it should have
//! been carried.
//!
//! The name is the hinge. It is a label in the sidebar, a filename, a class
//! name and the Phaser key all at once, and only the first of those will take
//! "Title Screen".

use crate::game_config::{scene_file_name, scene_file_names};
use crate::project::{GameOptions, Genre, Projection};
use crate::store;

/// A document with the given scenes, in order, each with one empty layer.
fn doc_with(scenes: &[(&str, &str)]) -> String {
    let scenes: Vec<serde_json::Value> = scenes
        .iter()
        .map(|(id, name)| {
            serde_json::json!({
                "id": id,
                "name": name,
                "layers": [{
                    "id": format!("layer-{id}"),
                    "name": "Terrain",
                    "locked": false,
                    "visible": true,
                    "fills": [],
                    "placements": [],
                    "zones": [],
                    "strokes": []
                }]
            })
        })
        .collect();
    serde_json::json!({
        "version": 2,
        "activeSceneId": scenes[0]["id"],
        "scenes": scenes,
    })
    .to_string()
}

fn project() -> crate::project::ProjectMeta {
    store::create_project(
        "Scenes",
        Projection::Orthogonal,
        Genre::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created")
}

#[test]
fn a_scene_name_becomes_a_class_name() {
    assert_eq!(scene_file_name("Scene1"), "Scene1");
    // Every word capitalised, everything else a word break: a name somebody
    // typed has to come out as an identifier.
    assert_eq!(scene_file_name("Title Screen"), "TitleScreen");
    assert_eq!(scene_file_name("the-deep cave!"), "TheDeepCave");
    // Neither of these is a legal identifier on its own.
    assert_eq!(scene_file_name("2"), "Scene2");
    assert_eq!(scene_file_name("   "), "Scene");
    assert_eq!(scene_file_name("🙂"), "Scene");
}

/// Two scenes may share a name; two files may not.
#[test]
fn colliding_names_take_a_counter_and_the_first_keeps_its_own() {
    let scenes: Vec<crate::game_config::Scene> =
        serde_json::from_value(serde_json::json!([
            { "id": "a", "name": "Cave" },
            { "id": "b", "name": "Cave" },
            { "id": "c", "name": "cave" },
            // The generated list sits beside them under this name, so a scene
            // cannot have it.
            { "id": "d", "name": "Index" },
        ]))
        .expect("scenes should parse");
    assert_eq!(
        scene_file_names(&scenes),
        vec!["Cave", "Cave2", "Cave3", "Index2"],
    );
}

/// Renaming carries what is in the file, and rewrites the two places the old
/// name appears in it.
#[test]
fn renaming_a_scene_moves_its_file_and_its_class() {
    let meta = project();
    let result = std::panic::catch_unwind(|| {
        let read = |path: &str| store::read_game_file(&meta.id, path);

        // The scaffold's first scene, with a line of somebody's own in it.
        let scene = read("js/scenes/Scene1.js").expect("the first scene should be there");
        assert!(scene.contains("class Scene1 extends Phaser.Scene"));
        store::write_game_file(
            &meta.id,
            "js/scenes/Scene1.js",
            &scene.replace("  create() {", "  create() {\n    this.mine = 1;"),
        )
        .expect("scene should write");

        store::write_doc(&meta.id, &doc_with(&[("scene-main", "Title Screen")]))
            .expect("document should write");

        assert!(
            read("js/scenes/Scene1.js").is_err(),
            "the old file should have moved rather than been left behind"
        );
        let moved = read("js/scenes/TitleScreen.js").expect("the renamed scene should be there");
        assert!(moved.contains("class TitleScreen extends Phaser.Scene"));
        assert!(moved.contains("super(\"TitleScreen\")"));
        assert!(
            moved.contains("this.mine = 1;"),
            "a rename must carry what was written in the file",
        );

        // And the generated list follows it, because `main.js` reads that
        // rather than naming the scenes itself.
        let index = read("js/scenes/index.js").expect("the list should be there");
        assert!(index.contains("import TitleScreen from \"./TitleScreen.js\";"));
        assert!(index.contains("export const scenes = [TitleScreen];"));
        assert!(index.contains("export const byFile = { TitleScreen };"));
        assert!(!index.contains("Scene1"));
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// A scene added in the sidebar gets a file; one removed loses it; and the
/// list keeps the document's order, because the first entry is what the game
/// opens on.
#[test]
fn scenes_added_and_removed_take_their_files_with_them() {
    let meta = project();
    let result = std::panic::catch_unwind(|| {
        let read = |path: &str| store::read_game_file(&meta.id, path);

        store::write_doc(
            &meta.id,
            &doc_with(&[("scene-main", "Scene1"), ("scene-2", "Cave")]),
        )
        .expect("document should write");
        assert!(read("js/scenes/Scene1.js").is_ok());
        let cave = read("js/scenes/Cave.js").expect("the new scene should be scaffolded");
        assert!(cave.contains("class Cave extends Phaser.Scene"));
        assert_eq!(
            read("js/scenes/index.js")
                .expect("the list should be there")
                .contains("export const scenes = [Scene1, Cave];"),
            true,
        );

        // Reordering them in the sidebar reorders the list, which is how the
        // scene the game opens on is chosen.
        store::write_doc(
            &meta.id,
            &doc_with(&[("scene-2", "Cave"), ("scene-main", "Scene1")]),
        )
        .expect("document should write");
        assert!(read("js/scenes/index.js")
            .expect("the list should be there")
            .contains("export const scenes = [Cave, Scene1];"));

        // Deleting a scene takes its file. The sheet that asks already says
        // everything on the scene goes with it, and the file it was written
        // in is part of that — an orphan nothing imports is worse.
        store::write_doc(&meta.id, &doc_with(&[("scene-2", "Cave")]))
            .expect("document should write");
        assert!(read("js/scenes/Cave.js").is_ok());
        assert!(read("js/scenes/Scene1.js").is_err());
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// A file whose class somebody renamed by hand still moves, and keeps what
/// they called it: the path is the editor's to keep in step, and what is
/// inside is the author's.
#[test]
fn a_hand_renamed_class_is_left_alone() {
    assert_eq!(
        store::rename_scene_class(
            "export default class Mine extends Phaser.Scene {\n  super(\"Mine\")\n}",
            "Scene1",
            "Cave",
        ),
        "export default class Mine extends Phaser.Scene {\n  super(\"Mine\")\n}",
    );
}

/// Projects made before per-scene files are left exactly as they are.
///
/// They have one `js/scenes/WorldScene.js` and a `main.js` that imports it by
/// name, so a second scene file beside it would be a file nothing loads — and
/// an `index.js` nothing reads. The test is `js/shared/canvas.js`, which only
/// the new scaffold writes.
#[test]
fn an_older_project_keeps_its_single_scene() {
    let meta = project();
    let result = std::panic::catch_unwind(|| {
        // Wind the tree back to what an older project has.
        store::delete_game_path(&meta.id, "js/shared/canvas.js").expect("file should delete");
        store::delete_game_path(&meta.id, "js/scenes/Scene1.js").expect("file should delete");
        store::delete_game_path(&meta.id, "js/scenes/index.js").expect("file should delete");
        store::write_game_file(&meta.id, "js/scenes/WorldScene.js", "// mine\n")
            .expect("scene should write");

        store::write_doc(&meta.id, &doc_with(&[("scene-main", "Cave")]))
            .expect("document should write");

        assert!(store::read_game_file(&meta.id, "js/scenes/index.js").is_err());
        assert!(store::read_game_file(&meta.id, "js/scenes/Cave.js").is_err());
        assert_eq!(
            store::read_game_file(&meta.id, "js/scenes/WorldScene.js").as_deref(),
            Ok("// mine\n"),
        );
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// Dump a scaffolded tree somewhere a browser can load it.
///
/// Ignored by default: it is a hook for looking at the real thing rather than
/// an assertion, and it writes outside the store. `cargo test dump_a_runnable
/// -- --ignored --nocapture`, with `IDLEWILD_DUMP` naming the directory.
#[test]
#[ignore]
fn dump_a_runnable_tree() {
    let dir = std::path::PathBuf::from(
        std::env::var("IDLEWILD_DUMP").unwrap_or_else(|_| "/tmp/idlewild-dump".into()),
    );
    let _ = std::fs::remove_dir_all(&dir);
    let meta = crate::project::ProjectMeta::new(
        "dump".into(),
        "Dump".into(),
        Projection::Isometric,
        if std::env::var("IDLEWILD_SIDE").is_ok() {
            Genre::Platformer
        } else {
            Genre::Topdown
        },
        64,
        GameOptions::default(),
    );
    crate::templates::scaffold_game(&dir, &meta).expect("scaffold should write");

    std::fs::create_dir_all(dir.join("js/scenes")).expect("scenes dir should exist");
    let scenes = vec![
        ("scene-main".to_string(), "Scene1".to_string(), "Scene1".to_string()),
        ("scene-2".to_string(), "Cave".to_string(), "Cave".to_string()),
    ];
    for (_, file, name) in &scenes {
        std::fs::write(
            dir.join(format!("js/scenes/{file}.js")),
            crate::templates::scene_file(file, name),
        )
        .expect("scene should write");
    }
    std::fs::write(dir.join("js/scenes/index.js"), store::scene_index(&scenes))
        .expect("index should write");

    std::fs::create_dir_all(dir.join("js/lib")).expect("lib should exist");
    std::fs::write(
        dir.join("js/lib/phaser.min.js"),
        crate::templates::PHASER,
    )
    .expect("phaser should write");
    std::fs::write(
        dir.join("js/lib/psd-to-phaser.umd.js"),
        crate::templates::P2P_UMD,
    )
    .expect("p2p should write");
    println!("wrote {}", dir.display());
}
