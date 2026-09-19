//! What a project is made of, and what creating one writes to disk.
//!
//! The starter document, the runnable project each scaffold writes into
//! `game/`, the tree the code modal edits, and the guards that keep a path
//! from climbing out of the store. What the JavaScript in those files *does*
//! is next door in `scaffold_code`, and what leaving with a project *takes*
//! is next door again in `exports` — both split off for the 700-line rule.
//! The PSD pipeline is in `tests.rs`; all of them share only the store they
//! create projects in.

use crate::project::{GameOptions, ProjectMeta, Projection, Scaffold};
use crate::{publish, store, templates};

/// A meta to ask the templates a question about, without a project on disk.
///
/// `template_files` and `starter_doc` answer for a project rather than for a
/// list of fields, which is what lets the options reach both — so a test that
/// only wants the text still has to say which project it means.
fn seed(projection: Projection, genre: Scaffold, grid_size: u32, options: GameOptions) -> ProjectMeta {
    ProjectMeta::new(
        "seed".into(),
        "Seed".into(),
        projection,
        genre,
        grid_size,
        options,
    )
}

#[test]
fn relative_paths_cannot_escape_the_project() {
    assert!(store::safe_relative("js/scenes/WorldScene.js").is_ok());
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
    let doc = templates::starter_doc(&seed(
        Projection::Isometric,
        Scaffold::Topdown,
        128,
        GameOptions::default(),
    ));
    let value: serde_json::Value = serde_json::from_str(&doc).expect("valid JSON");
    assert_eq!(value["projection"], "isometric");
    assert_eq!(value["genre"], "topdown");
    assert_eq!(value["gridSize"], 128);
    // One scene, holding the one layer a project starts with. `Scene1`
    // rather than `Main`, because a scene's name is a filename and a class
    // name now as well as a label — and Scene1, Scene2, Cave is a sequence
    // somebody can rename into, where Main sits outside one.
    assert_eq!(value["scenes"].as_array().map(Vec::len), Some(1));
    assert_eq!(value["scenes"][0]["name"], templates::FIRST_SCENE);
    assert_eq!(value["activeSceneId"], value["scenes"][0]["id"]);
    assert_eq!(value["scenes"][0]["layers"].as_array().map(Vec::len), Some(1));

    // Both axes reach the document, because the editor reads its play mode
    // out of it rather than out of the project's meta.
    let blank = templates::starter_doc(&seed(
        Projection::Blank,
        Scaffold::Platformer,
        32,
        GameOptions::default(),
    ));
    let value: serde_json::Value = serde_json::from_str(&blank).expect("valid JSON");
    assert_eq!(value["projection"], "blank");
    assert_eq!(value["genre"], "platformer");
}

/// Each of the two whole-game scaffolds writes its own character module and
/// only the helper that module uses, and both axes reach the config the scene
/// reads at runtime.
#[test]
fn each_style_scaffolds_the_program_it_runs() {
    let top = store::create_project(
        "Top",
        Projection::Blank,
        Scaffold::Topdown,
        48,
        GameOptions::default(),
    )
    .expect("project should be created");
    let side = store::create_project(
        "Side",
        Projection::Orthogonal,
        Scaffold::Platformer,
        48,
        GameOptions::default(),
    )
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
        assert!(top_paths.iter().any(|p| p == "js/shared/navigation.js"));
        assert!(
            !top_paths.iter().any(|p| p == "js/shared/physics.js"),
            "a top-down project ships no body step: {top_paths:?}"
        );

        let side_paths = paths(&side.id);
        assert!(side_paths.iter().any(|p| p == "js/shared/physics.js"));
        assert!(
            !side_paths.iter().any(|p| p == "js/shared/navigation.js"),
            "a platformer ships no pathfinder: {side_paths:?}"
        );

        // What differs between the genres is the *character* — what moves,
        // and what stops it. How a document is drawn is the same question
        // either way, so `shared/canvas.js` is one file both of them get.
        let top_character = store::read_game_file(&top.id, "js/shared/character.js")
            .expect("the character module should read");
        let side_character = store::read_game_file(&side.id, "js/shared/character.js")
            .expect("the character module should read");
        assert!(top_character.contains("isWalkable"));
        assert!(side_character.contains("solidsFromDocument"));
        assert_eq!(
            store::read_game_file(&top.id, "js/shared/canvas.js").ok(),
            store::read_game_file(&side.id, "js/shared/canvas.js").ok(),
            "both genres draw a document the same way",
        );
        assert!(store::read_game_file(&top.id, "js/prefabs/character.js")
            .expect("the prefab should read")
            .contains("findPath"));
        assert!(store::read_game_file(&side.id, "js/prefabs/character.js")
            .expect("the prefab should read")
            .contains("stepBody"));

        // Neither draws a grid. The editor's lattice is scaffolding to build
        // on; a game is the thing that was built.
        for module in [&top_character, &side_character] {
            assert!(
                !module.contains("drawGrid"),
                "a played scene should not draw the editor's grid"
            );
        }

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

/// Blank PSD to Phaser: the plugin wired up, the document placed, and nothing
/// above it.
///
/// What it is *not* carrying is the point of it. There is no
/// `shared/character.js`, no prefab and neither helper, so a project that
/// wants something to move in it has nothing to read past first — and the
/// scene file has to match, because a scene importing a module the scaffold
/// did not write is a scene that will not load.
#[test]
fn the_p2p_scaffold_wires_the_plugin_and_nothing_above_it() {
    let bare = store::create_project(
        "Bare",
        Projection::Isometric,
        Scaffold::P2p,
        64,
        GameOptions::default(),
    )
    .expect("project should be created");
    let top = store::create_project(
        "Whole",
        Projection::Isometric,
        Scaffold::Topdown,
        64,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let paths: Vec<String> = store::list_game_files(&bare.id)
            .expect("files should list")
            .into_iter()
            .map(|f| f.path)
            .collect();

        for expected in [
            "index.html",
            "styles.css",
            "js/main.js",
            "js/scenes/Scene1.js",
            "js/scenes/index.js",
            "js/shared/canvas.js",
            "js/shared/grid.js",
            "js/game.config.json",
        ] {
            assert!(
                paths.iter().any(|p| p == expected),
                "{expected} missing from {paths:?}"
            );
        }
        for absent in [
            "js/shared/character.js",
            "js/shared/navigation.js",
            "js/shared/physics.js",
            "js/prefabs/character.js",
        ] {
            assert!(
                !paths.iter().any(|p| p == absent),
                "a P2P project should not ship {absent}: {paths:?}"
            );
        }

        // The machinery is the same file. What a P2P project gives up is the
        // character, not the way a document is drawn.
        assert_eq!(
            store::read_game_file(&bare.id, "js/shared/canvas.js").ok(),
            store::read_game_file(&top.id, "js/shared/canvas.js").ok(),
            "every Phaser scaffold draws a document the same way",
        );

        let scene =
            store::read_game_file(&bare.id, "js/scenes/Scene1.js").expect("scene should read");
        assert!(scene.contains("placeDocument"), "the document is still placed");
        assert!(
            !scene.contains("character.js") && !scene.contains("spawnCharacter"),
            "a P2P scene imports nothing the scaffold did not write: {scene}"
        );
        assert!(
            !scene.contains("// idlewild:"),
            "a scene file is the author's, end to end",
        );

        // And the config agrees with the tree: `character` is off because
        // there is no `shared/character.js` for the switch to reach.
        let config: serde_json::Value = serde_json::from_str(
            &store::read_game_file(&bare.id, "js/game.config.json").expect("config should read"),
        )
        .expect("config should be JSON");
        assert_eq!(config["genre"], "p2p");
        assert_eq!(config["character"], false);
        assert_eq!(
            store::read_meta(&bare.id)
                .expect("meta should read")
                .options
                .character,
            false,
            "a scaffold with no character module records no character",
        );

        // And it cannot be turned on afterwards either. Project Options hides
        // the row, so nothing in the app sends this — but the store is what
        // the config is generated from, and a `true` reaching it would put a
        // character in a config whose project has no module to read it.
        let forced = store::set_project_options(&bare.id, false, false, 1.0, true)
            .expect("options should save");
        assert_eq!(forced.options.character, false);
        let config: serde_json::Value = serde_json::from_str(
            &store::read_game_file(&bare.id, "js/game.config.json").expect("config should read"),
        )
        .expect("config should be JSON");
        assert_eq!(config["character"], false);
    });

    store::delete_project(&bare.id).ok();
    store::delete_project(&top.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// Vanilla: a page, a stylesheet, a script and the document as data.
///
/// Four files, none of which mentions Phaser, and no `js/` at all — which is
/// why the generated config sits at the root here and under `js/` everywhere
/// else. The artwork is not in this list because it never was: the pipeline
/// writes `assets/` beside `game/`, so what the scaffold decides is the code
/// around the artwork and never the artwork.
#[test]
fn a_vanilla_project_is_a_page_and_its_assets() {
    let meta = store::create_project(
        "Plain",
        Projection::Blank,
        Scaffold::Vanilla,
        16,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let mut paths: Vec<String> = store::list_game_files(&meta.id)
            .expect("files should list")
            .into_iter()
            .filter(|f| !f.is_dir)
            .map(|f| f.path)
            .collect();
        paths.sort();
        assert_eq!(
            paths,
            vec![
                "game.config.json".to_string(),
                "index.html".to_string(),
                "script.js".to_string(),
                "style.css".to_string(),
            ],
            "a vanilla project is these four files and nothing else",
        );

        let index = store::read_game_file(&meta.id, "index.html").expect("index should read");
        assert!(index.contains("Plain"), "the name should reach the title");
        assert!(!index.contains("__PROJECT_NAME__"));
        // By what it loads rather than by what it mentions: the comment in
        // the page says which runtimes are *not* there, which is the useful
        // thing to say on a page whose whole point is that nothing is wired up.
        assert!(
            !index.contains("<script src=") && !index.contains("js/lib/"),
            "a vanilla page loads no runtime: {index}"
        );
        assert!(index.contains("style.css") && index.contains("script.js"));

        // The config is the same file by another name, and the save that
        // rewrites it finds it where the scaffold put it.
        let config: serde_json::Value = serde_json::from_str(
            &store::read_game_file(&meta.id, "game.config.json").expect("config should read"),
        )
        .expect("config should be JSON");
        assert_eq!(config["genre"], "vanilla");
        assert_eq!(config["projection"], "blank");
        assert_eq!(config["grid"], 16);
        assert_eq!(config["character"], false);

        // The save path writes the config where the scaffold put it, rather
        // than creating a `js/` for the sake of one constant — and it does
        // not scaffold a scene file on the way past, because there is no
        // `shared/canvas.js` and so nothing for a scene to be.
        store::write_doc(
            &meta.id,
            &serde_json::json!({
                "version": 2,
                "projection": "blank",
                "genre": "vanilla",
                "gridSize": 16,
                "activeSceneId": "s1",
                "scenes": [{ "id": "s1", "name": "Only", "layers": [] }]
            })
            .to_string(),
        )
        .expect("document should save");
        let saved: serde_json::Value = serde_json::from_str(
            &store::read_game_file(&meta.id, "game.config.json").expect("config should read"),
        )
        .expect("config should be JSON");
        assert_eq!(saved["scenes"][0]["name"], "Only");
        assert!(
            store::read_game_file(&meta.id, "js/game.config.json").is_err(),
            "a vanilla project grows no js/ directory on save"
        );

        // A published vanilla site carries neither runtime: 1.5 MB of
        // JavaScript nothing on the page includes is 1.5 MB to work out you
        // can delete.
        let (_, entries) = publish::site_entries(&meta.id).expect("a site should list");
        let rels: Vec<&str> = entries.iter().map(|e| e.rel.as_str()).collect();
        assert!(rels.contains(&"index.html"));
        assert!(rels.contains(&"game.config.json"));
        assert!(
            !rels.iter().any(|rel| rel.starts_with("js/lib/")),
            "a vanilla site ships no Phaser: {rels:?}"
        );
        // Exactly one config: the generated one replaces the scaffold's copy
        // rather than sitting beside it, wherever that copy lives.
        assert_eq!(
            rels.iter().filter(|rel| **rel == "game.config.json").count(),
            1
        );
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// A project's meta survives a round trip through disk, scaffold included —
/// and one written before the choice existed still reads, as top down.
#[test]
fn project_meta_defaults_a_missing_genre_to_top_down() {
    let meta = store::create_project(
        "Legacy",
        Projection::Orthogonal,
        Scaffold::Platformer,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        assert_eq!(
            store::read_meta(&meta.id).expect("meta should read").genre,
            Scaffold::Platformer,
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
        assert_eq!(parsed.genre, Scaffold::Topdown);
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

#[test]
fn a_new_project_scaffolds_a_runnable_game() {
    let meta = store::create_project(
        "Scaffold test",
        Projection::Orthogonal,
        Scaffold::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let files = store::list_game_files(&meta.id).expect("files should list");
        let paths: Vec<&str> = files.iter().map(|f| f.path.as_str()).collect();
        for expected in [
            "index.html",
            "styles.css",
            "js/main.js",
            // One file per scene, named after it, plus the generated list
            // `main.js` registers — see `sync_scene_files`.
            "js/scenes/Scene1.js",
            "js/scenes/index.js",
            "js/prefabs/character.js",
            "js/shared/canvas.js",
            "js/shared/character.js",
            "js/shared/grid.js",
            // The top-down genre's own module; a platformer gets physics.js
            // instead — see `each_style_scaffolds_the_program_it_runs`.
            "js/shared/navigation.js",
            "js/game.config.json",
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
    let meta = store::create_project(
        "Files",
        Projection::Orthogonal,
        Scaffold::Topdown,
        32,
        GameOptions::default(),
    )
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

/// What a managed block's Reset in the code modal puts back.
#[test]
fn a_scaffolded_file_can_be_asked_for_its_pristine_form() {
    let meta = store::create_project(
        "Pristine",
        Projection::Orthogonal,
        Scaffold::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let canvas = store::read_game_template(&meta.id, "js/shared/canvas.js")
            .expect("the canvas module has a scaffold");
        assert_eq!(
            canvas,
            store::read_game_file(&meta.id, "js/shared/canvas.js").expect("module should read"),
            "an untouched file and its template are the same thing"
        );
        // A project made before the tree was restructured keeps its grid at
        // the old path, and Reset has to go on working in it: the old name
        // answers with the file it became.
        assert_eq!(
            store::read_game_template(&meta.id, "js/grid.js")
                .expect("the old path is the same file"),
            store::read_game_template(&meta.id, "js/shared/grid.js")
                .expect("the grid has a scaffold"),
        );
        // The markers the code modal reads ownership from. They moved with
        // the code: the machinery is in `shared/`, so that is where the lines
        // the editor goes on owning are.
        assert!(canvas.contains("// idlewild:begin placeDocument"));
        assert!(canvas.contains("// idlewild:end placeDocument"));

        // A scene file is the user's end to end, so it has none at all — and
        // it still answers, because a file with no blocks and a file with no
        // scaffold are read differently by the modal.
        let scene = store::read_game_template(&meta.id, "js/scenes/Scene1.js")
            .expect("a scene has a scaffold");
        assert!(
            !scene.contains("// idlewild:begin"),
            "a scene file is nobody's but the author's",
        );
        assert!(scene.contains("class Scene1 extends Phaser.Scene"));

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

