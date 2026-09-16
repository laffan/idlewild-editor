//! The per-project options: pixel-perfect rendering, the zoom a scene opens
//! at, and whether New Game wrote a character controller.
//!
//! All four are settings that reach the running game through the generated
//! config, so the test is that the config carries them and that changing one
//! rewrites it. The character controller used to be the exception — a
//! scaffold-time conditional, resolved when the files were written — so it has
//! a test of its own for the thing that changed: the same tree lands either
//! way, and the switch is in the config.

use crate::project::{GameOptions, Genre, ProjectMeta, Projection};
use crate::{publish, store, templates};

fn without_character() -> GameOptions {
    GameOptions {
        character: false,
        ..GameOptions::default()
    }
}

/// The character controller is a **setting** now, not a fact about what was
/// written: the same files land either way, and `shared/character.js` reads
/// the answer out of the generated config.
///
/// That is the whole of the change, so the whole of the test is that the
/// scaffold does not differ and the config does.
#[test]
fn the_character_is_a_setting_rather_than_a_scaffold() {
    for genre in [Genre::Topdown, Genre::Platformer] {
        let bare = store::create_project(
            "Bare",
            Projection::Orthogonal,
            genre,
            32,
            without_character(),
        )
        .expect("project should be created");
        let walker =
            store::create_project("Walker", Projection::Orthogonal, genre, 32, GameOptions::default())
                .expect("project should be created");

        let result = std::panic::catch_unwind(|| {
            let paths = |id: &str| -> Vec<String> {
                store::list_game_files(id)
                    .expect("files should list")
                    .into_iter()
                    .map(|f| f.path)
                    .collect()
            };
            assert_eq!(
                paths(&bare.id),
                paths(&walker.id),
                "{genre:?} scaffolds the same tree either way"
            );
            // The prefab is there whether or not it is spawned: ticking the
            // box should be a save, not a file appearing in the project.
            assert!(paths(&bare.id).iter().any(|p| p == "js/prefabs/character.js"));

            let character = |id: &str| -> bool {
                let config: serde_json::Value = serde_json::from_str(
                    &store::read_game_file(id, "js/game.config.json").expect("config should read"),
                )
                .expect("config should be JSON");
                config["character"] == serde_json::Value::Bool(true)
            };
            assert!(!character(&bare.id), "{genre:?} should not spawn one");
            assert!(character(&walker.id), "{genre:?} should spawn one");

            // The directive was a scaffold-time thing and is gone entirely.
            // Nothing in a project's own files should mention it.
            let module = store::read_game_file(&bare.id, "js/shared/character.js")
                .expect("the character module should read");
            assert!(
                !module.contains("idlewild:if"),
                "{genre:?} left a conditional marker in the file"
            );
            assert!(module.contains("config.character === false"));
        });

        store::delete_project(&bare.id).ok();
        store::delete_project(&walker.id).ok();
        if let Err(payload) = result {
            std::panic::resume_unwind(payload);
        }
    }
}

/// Turning it off afterwards is a setting changing, not a file going away.
#[test]
fn the_character_can_be_turned_off_after_the_fact() {
    let meta = store::create_project(
        "Switch",
        Projection::Orthogonal,
        Genre::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let read = || -> serde_json::Value {
            serde_json::from_str(
                &store::read_game_file(&meta.id, "js/game.config.json")
                    .expect("config should read"),
            )
            .expect("config should be JSON")
        };
        assert_eq!(read()["character"], true);

        let off = store::set_project_options(&meta.id, false, false, 1.0, false)
            .expect("options should save");
        assert!(!off.options.character);
        assert_eq!(read()["character"], false);
        // And the prefab is still there to come back to.
        assert!(store::read_game_file(&meta.id, "js/prefabs/character.js").is_ok());

        store::set_project_options(&meta.id, false, false, 1.0, true).expect("options should save");
        assert_eq!(read()["character"], true);
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// The rendering options reach the game the way everything else about the
/// document does: through the generated config, so a toggle in Project Options
/// takes effect without anything rewriting the user's code.
#[test]
fn the_rendering_options_reach_the_config_and_can_be_changed() {
    let meta = store::create_project(
        "Crisp",
        Projection::Orthogonal,
        Genre::Topdown,
        16,
        GameOptions {
            pixel_art: true,
            round_pixels: true,
            default_zoom: 3.0,
            character: true,
        },
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let read = || -> serde_json::Value {
            serde_json::from_str(
                &store::read_game_file(&meta.id, "js/game.config.json")
                    .expect("config should read"),
            )
            .expect("config should be JSON")
        };

        let config = read();
        assert_eq!(config["pixelArt"], true);
        assert_eq!(config["roundPixels"], true);
        assert_eq!(config["zoom"], 3.0);
        assert_eq!(config["grid"], 16);

        // Changing them rewrites the config rather than waiting for whatever
        // happens to touch the document next.
        let updated = store::set_project_options(&meta.id, false, false, 1.5, true)
            .expect("options should save");
        assert!(!updated.options.pixel_art);
        assert_eq!(updated.options.default_zoom, 1.5);
        assert!(updated.options.character);

        let config = read();
        assert_eq!(config["pixelArt"], false);
        assert_eq!(config["zoom"], 1.5);

        // A zoom of zero is a blank screen, so nonsense is brought back into
        // range on the way out rather than passed to a camera.
        store::set_project_options(&meta.id, false, false, 0.0, true).expect("options should save");
        assert_eq!(read()["zoom"], 1.0);
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// Where an export puts the two runtimes: beside the code that loads them,
/// which is where this project's own `index.html` asks for them.
#[test]
fn an_export_puts_the_runtimes_where_the_page_asks_for_them() {
    let meta = store::create_project(
        "Runtimes",
        Projection::Orthogonal,
        Genre::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let zip = publish::build_zip(&meta.id).expect("zip should build");
        let names = zip_names(&zip);
        for name in ["phaser.min.js", "psd-to-phaser.umd.js"] {
            assert!(
                names.contains(&format!("runtimes/js/lib/{name}")),
                "{name} should ship beside the code that loads it: {names:?}"
            );
        }

        // A project scaffolded before the tree moved loads them from `lib/`,
        // and its page is its own — so the export follows the page.
        store::write_game_file(
            &meta.id,
            "index.html",
            "<html><head><script src=\"lib/phaser.min.js\"></script></head></html>",
        )
        .expect("page should write");
        let names = zip_names(&publish::build_zip(&meta.id).expect("zip should build"));
        assert!(
            names.contains(&"runtimes/lib/phaser.min.js".to_string()),
            "{names:?}"
        );
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

fn zip_names(bytes: &[u8]) -> Vec<String> {
    let archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).expect("a readable zip");
    archive.file_names().map(str::to_string).collect()
}
