//! The per-project options: pixel-perfect rendering, the zoom a scene opens
//! at, and whether New Game wrote a character controller.
//!
//! Two of the three are settings that reach the running game through the
//! generated config, so the test is that the config carries them and that
//! changing one rewrites it. The third is a scaffold-time conditional, so the
//! test is what is — and is not — in the files on disk.

use crate::project::{GameOptions, Genre, ProjectMeta, Projection};
use crate::{publish, store, templates};

fn without_character() -> GameOptions {
    GameOptions {
        character: false,
        ..GameOptions::default()
    }
}

/// An unticked character controller means the lines are not there, rather than
/// there and never called.
#[test]
fn a_project_can_be_scaffolded_without_a_character() {
    for genre in [Genre::Topdown, Genre::Platformer] {
        let meta = store::create_project(
            "Bare",
            Projection::Orthogonal,
            genre,
            32,
            without_character(),
        )
        .expect("project should be created");

        let result = std::panic::catch_unwind(|| {
            let paths: Vec<String> = store::list_game_files(&meta.id)
                .expect("files should list")
                .into_iter()
                .map(|f| f.path)
                .collect();
            assert!(
                !paths.iter().any(|p| p.starts_with("js/prefabs")),
                "{genre:?} should have no prefabs at all: {paths:?}"
            );

            let scene = store::read_game_file(&meta.id, "js/scenes/WorldScene.js")
                .expect("scene should read");
            assert!(
                !scene.contains("spawnCharacter"),
                "{genre:?} should not spawn a character it has not got"
            );
            assert!(
                !scene.contains("prefabs/character.js"),
                "{genre:?} should not import a prefab it has not got"
            );
            // The directive is a scaffold-time thing. Nothing in a project's
            // own files should mention it, either way.
            assert!(
                !scene.contains("idlewild:if") && !scene.contains("idlewild:end if"),
                "{genre:?} left a conditional marker in the file"
            );
            // And the document is still placed: leaving the character out is
            // not leaving the game out.
            assert!(scene.contains("placeDocument"));
        });

        store::delete_project(&meta.id).ok();
        if let Err(payload) = result {
            std::panic::resume_unwind(payload);
        }
    }
}

/// With the box ticked — the default — the prefab is there, the scene calls
/// it, and the markers are still gone.
#[test]
fn the_default_project_has_a_character_and_no_markers() {
    for genre in [Genre::Topdown, Genre::Platformer] {
        let meta = store::create_project(
            "Walker",
            Projection::Orthogonal,
            genre,
            32,
            GameOptions::default(),
        )
        .expect("project should be created");

        let result = std::panic::catch_unwind(|| {
            let scene = store::read_game_file(&meta.id, "js/scenes/WorldScene.js")
                .expect("scene should read");
            assert!(
                scene.contains("spawnCharacter"),
                "{genre:?} should spawn one"
            );
            assert!(scene.contains("prefabs/character.js"));
            assert!(
                !scene.contains("idlewild:if"),
                "{genre:?} left a conditional marker in the file"
            );
            assert!(store::read_game_file(&meta.id, "js/prefabs/character.js").is_ok());
        });

        store::delete_project(&meta.id).ok();
        if let Err(payload) = result {
            std::panic::resume_unwind(payload);
        }
    }
}

/// A managed block's Reset asks for the file as the scaffold wrote it, so the
/// pristine form has to honour the same options the project was made with.
#[test]
fn the_pristine_form_follows_the_options_the_project_was_made_with() {
    let bare = templates::template_file(
        "js/scenes/WorldScene.js",
        &ProjectMeta::new(
            "seed".into(),
            "Seed".into(),
            Projection::Orthogonal,
            Genre::Topdown,
            32,
            without_character(),
        ),
    )
    .expect("the scene has a scaffold");
    assert!(!bare.contains("spawnCharacter"));

    let walker = templates::template_file(
        "js/scenes/WorldScene.js",
        &ProjectMeta::new(
            "seed".into(),
            "Seed".into(),
            Projection::Orthogonal,
            Genre::Topdown,
            32,
            GameOptions::default(),
        ),
    )
    .expect("the scene has a scaffold");
    assert!(walker.contains("spawnCharacter"));

    // The prefab is not a file a character-less project can reset, because it
    // is not a file that project has.
    assert!(templates::template_file(
        "js/prefabs/character.js",
        &ProjectMeta::new(
            "seed".into(),
            "Seed".into(),
            Projection::Orthogonal,
            Genre::Topdown,
            32,
            without_character(),
        ),
    )
    .is_err());
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
        let updated =
            store::set_project_options(&meta.id, false, false, 1.5).expect("options should save");
        assert!(!updated.options.pixel_art);
        assert_eq!(updated.options.default_zoom, 1.5);
        // The scaffold's own choice is not a setting, and is not touched.
        assert!(updated.options.character);

        let config = read();
        assert_eq!(config["pixelArt"], false);
        assert_eq!(config["zoom"], 1.5);

        // A zoom of zero is a blank screen, so nonsense is brought back into
        // range on the way out rather than passed to a camera.
        store::set_project_options(&meta.id, false, false, 0.0).expect("options should save");
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
