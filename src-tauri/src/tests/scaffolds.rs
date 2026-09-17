//! What a project is made of, and what creating one writes to disk.
//!
//! The starter document, the runnable game each template selection scaffolds
//! into `game/`, the tree the code modal edits, and the guards that keep a
//! path from climbing out of the store. What leaving with a project *takes*
//! is next door in `exports`, split off along that seam for the 700-line
//! rule. The PSD pipeline is next door again in `tests.rs`; all three share
//! only the store they create projects in.

use crate::project::{GameOptions, Genre, ProjectMeta, Projection};
use crate::{publish, store, templates};

/// A meta to ask the templates a question about, without a project on disk.
///
/// `template_files` and `starter_doc` answer for a project rather than for a
/// list of fields, which is what lets the options reach both — so a test that
/// only wants the text still has to say which project it means.
fn seed(projection: Projection, genre: Genre, grid_size: u32, options: GameOptions) -> ProjectMeta {
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
        Genre::Topdown,
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
        Genre::Platformer,
        32,
        GameOptions::default(),
    ));
    let value: serde_json::Value = serde_json::from_str(&blank).expect("valid JSON");
    assert_eq!(value["projection"], "blank");
    assert_eq!(value["genre"], "platformer");
}

/// Each genre scaffolds its own scene and only the module that scene uses,
/// and both axes reach the config the scene reads at runtime.
#[test]
fn each_style_scaffolds_the_program_it_runs() {
    let top = store::create_project(
        "Top",
        Projection::Blank,
        Genre::Topdown,
        48,
        GameOptions::default(),
    )
    .expect("project should be created");
    let side = store::create_project(
        "Side",
        Projection::Orthogonal,
        Genre::Platformer,
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

/// A project's meta survives a round trip through disk, genre included — and
/// one written before the choice existed still reads, as top down.
#[test]
fn project_meta_defaults_a_missing_genre_to_top_down() {
    let meta = store::create_project(
        "Legacy",
        Projection::Orthogonal,
        Genre::Platformer,
        32,
        GameOptions::default(),
    )
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
    let meta = store::create_project(
        "Scaffold test",
        Projection::Orthogonal,
        Genre::Topdown,
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
        Genre::Topdown,
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
        Genre::Topdown,
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

/// The scaffold loads its PSDs through the plugin's multi-file path, and does
/// not place the document before that has finished.
///
/// `load` keys a texture on the layer's own name, so two PSDs each holding a
/// `S | layer 1` — which is what New layer names its rows — share one:
/// Phaser declines a key it already holds without saying so, and one file's
/// artwork is drawn for the other's. `loadMultiple` keys it
/// `<psdKey>_<layerName>`, and `place` reads back the flag it sets.
///
/// The second half is the cost of the first. `loadMultiple` queues its images
/// from a promise callback, one microtask after Phaser has run `create`, so a
/// `placeDocument` that did not wait would place against textures that had not
/// arrived. The two halves are asserted together because either alone is a
/// broken game.
///
/// One assertion where there were two: both genres share `shared/canvas.js`
/// now, so there is one loader rather than a pair that could drift.
#[test]
fn the_canvas_loads_psds_namespaced_and_waits_for_them() {
    let canvas = templates::template_file(
        "js/shared/canvas.js",
        &seed(
            Projection::Orthogonal,
            Genre::Topdown,
            32,
            GameOptions::default(),
        ),
    )
    .expect("the canvas module has a scaffold");

    assert!(
        canvas.contains("scene.P2P.load.loadMultiple(scene, psds)"),
        "the scaffold does not load its PSDs namespaced"
    );
    assert!(
        !canvas.contains("scene.P2P.load.load(scene,"),
        "the scaffold still loads a PSD on the path that collides"
    );
    assert!(
        canvas.contains("if (!scene.psdsReady) return;"),
        "the scaffold places its document before its textures are in"
    );
}

/// A pattern layer waits for the same load `placeDocument` waits for.
///
/// It is the sharper half of the same rule. `placeDocument` runs once and
/// would simply place nothing; `syncPatterns` runs every frame and **keeps
/// what it makes**, so a single call against a file whose `data.json` has
/// parsed and whose images have not caches a group with no sprites in it,
/// against the tile it belongs to, for as long as the camera stays there. And
/// `create` is exactly that moment. The symptom is a pattern layer that never
/// appears in the exported game while the editor draws it correctly, which is
/// as far from the cause as a bug gets.
#[test]
fn patterns_are_held_until_the_psds_are_in() {
    let canvas = templates::template_file(
        "js/shared/canvas.js",
        &seed(
            Projection::Orthogonal,
            Genre::Topdown,
            32,
            GameOptions::default(),
        ),
    )
    .expect("the canvas module has a scaffold");

    let body = canvas
        .split_once("export function syncPatterns(scene) {")
        .expect("the scaffold generates its patterns")
        .1;
    let guard = body
        .find("if (!scene.psdsReady) return;")
        .expect("syncPatterns does not wait for the PSDs");
    let place = body
        .find("scene.P2P.place(")
        .expect("syncPatterns places nothing");
    assert!(
        guard < place,
        "a pattern element is placed before its textures are in"
    );
}

/// Whatever is waiting on the document is woken however the load ends.
///
/// `whenPsdsReady` is the scaffold's answer to the one thing `create` cannot
/// do: the textures are queued from a promise callback that lands after Phaser
/// has called it, so anything reading one has to wait. What it waits on is
/// `psdsReady` rather than the plugin's own `psdLoadComplete`, and the
/// difference is the file that never arrives — `ready` runs on the timeout
/// too, so a waiter listening to the plugin would sit there for ever on
/// exactly the load that went wrong. The signal also goes out *after*
/// `placeDocument`, so what a waiter makes stands on a document that is
/// already there rather than racing it.
#[test]
fn a_waiter_is_woken_however_the_load_ends() {
    let canvas = templates::template_file(
        "js/shared/canvas.js",
        &seed(
            Projection::Orthogonal,
            Genre::Topdown,
            32,
            GameOptions::default(),
        ),
    )
    .expect("the canvas module has a scaffold");

    let ready = canvas
        .split_once("const ready = () => {")
        .expect("loadDocument settles the load")
        .1
        .split_once("};")
        .expect("the settle closes")
        .0;

    let emit = ready
        .find(r#"scene.events.emit("psdsReady")"#)
        .expect("the load settles without waking anything that waited");
    let place = ready
        .find("placeDocument(scene)")
        .expect("the load settles without placing the document");
    assert!(
        place < emit,
        "a waiter is woken before the document it stands on is placed"
    );

    // The timeout runs the same settle, which is what covers a file that
    // never arrives.
    assert!(
        canvas.contains("setTimeout(ready, 15000)"),
        "a load that never finishes never wakes what is waiting on it"
    );

    let waiter = canvas
        .split_once("export function whenPsdsReady(scene, fn) {")
        .expect("the scaffold offers no way to wait for the document")
        .1
        .split_once('}')
        .expect("the waiter closes")
        .0;
    assert!(
        waiter.contains(r#"scene.events.once("psdsReady", fn)"#),
        "the waiter listens for the plugin rather than for the settle, so a \
         timed-out load would never run it"
    );
    assert!(
        waiter.contains("if (scene.psdsReady) fn();"),
        "the waiter never runs for a document that is already in"
    );
}

/// Every marked block in the scaffold closes, and each file carries the set it
/// is meant to — the code modal finds a block by id, so a template that
/// renamed one would silently stop offering its Reset.
///
/// The lists are written out rather than derived, because what the assertion
/// is for is drift: a rename, a block left open, a block quietly dropped.
/// `canvas.js` is one file for both genres and `character.js` is one per
/// genre, and the two genres' differ — a top-down character sorts itself into
/// an isometric ordering, and a platformer is seen from the side, where
/// nothing sorts on Y at all.
///
/// A **scene** file is not here on purpose: it has no blocks, because every
/// line of it is the author's.
#[test]
fn the_scaffold_marks_the_blocks_it_should_and_closes_every_one() {
    let canvas = [
        "sceneOf",
        "loadDocument",
        "whenPsdsReady",
        "updateCanvas",
        "applyCamera",
        "placeDocument",
        "paintBackgrounds",
        "placePatterns",
        "paintFill",
        "nearPoints",
        "drawOrder",
        "applyDepth",
        "applyScale",
        "applyHidden",
        "pointsToVectors",
        "gradientCorners",
        "patternRule",
    ];
    let topdown = [
        "spawnCharacter",
        "updateCharacter",
        "sortCharacter",
        "readColliders",
        "walkDepth",
    ];
    let platformer = ["spawnCharacter", "updateCharacter", "readSolids"];
    // `main.js` is the same file for both genres. Both of its blocks read a
    // setting out of the generated config and hand it to Phaser, which is why
    // they are marked at all: they are the editor's answer arriving in the
    // author's file, and Reset has to be able to put either back.
    let main = ["pixelPerfect", "presentation"];

    for (genre, file, expected) in [
        (Genre::Topdown, "js/shared/canvas.js", &canvas[..]),
        (Genre::Topdown, "js/shared/character.js", &topdown[..]),
        (Genre::Platformer, "js/shared/character.js", &platformer[..]),
        (Genre::Topdown, "js/main.js", &main[..]),
    ] {
        let text = templates::template_file(
            file,
            &seed(Projection::Orthogonal, genre, 32, GameOptions::default()),
        )
        .expect("the file has a scaffold");

        let mut open: Vec<&str> = Vec::new();
        let mut closed: Vec<&str> = Vec::new();
        for line in text.lines().map(str::trim) {
            if let Some(id) = line.strip_prefix("// idlewild:begin ") {
                open.push(id);
            } else if let Some(id) = line.strip_prefix("// idlewild:end ") {
                closed.push(id);
            }
        }
        assert_eq!(open, closed, "{file} has a marker without its pair");
        assert_eq!(open, expected, "{file} marks a different set of blocks");
    }

    let scene = templates::scene_file("Scene1");
    assert!(
        !scene.contains("// idlewild:"),
        "a scene file is the author's, end to end",
    );
}
