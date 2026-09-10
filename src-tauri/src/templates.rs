//! Starter templates. As the spec puts it, these are codebase template
//! selections: each combination scaffolds a real runnable Phaser 4 project
//! into the project's `game/` directory, which is what the code modal edits
//! and what Publish zips.
//!
//! Two axes. The *projection* is the shape of the space — isometric diamonds,
//! orthogonal squares, or a blank canvas whose cells are single pixels — and
//! it does not need a scene of its own: the difference lives entirely in
//! `grid.js`, which reads it out of `game.config.json`. The *genre* does need
//! one, because a character that walks a floor plan and a character that runs
//! along a cross-section are different programs.
//!
//! That is why there is one scene per genre rather than one per pair. The
//! isometric and orthogonal scenes used to be separate files that differed
//! only in a comment.

use crate::project::{Genre, Projection};
use serde_json::json;
use std::fs;
use std::path::Path;

const INDEX_HTML: &str = include_str!("../templates/common/index.html");
const STYLES_CSS: &str = include_str!("../templates/common/css/styles.css");
const GRID_JS: &str = include_str!("../templates/common/js/grid.js");
const MAIN_JS: &str = include_str!("../templates/common/js/main.js");

const NAVIGATION_JS: &str = include_str!("../templates/common/js/navigation.js");
const TOPDOWN_SCENE_JS: &str = include_str!("../templates/topdown/js/WorldScene.js");

const PHYSICS_JS: &str = include_str!("../templates/platformer/js/physics.js");
const PLATFORMER_SCENE_JS: &str = include_str!("../templates/platformer/js/WorldScene.js");

/// The psd-to-phaser UMD build, vendored by scripts/vendor-p2p.mjs. Exports
/// carry it verbatim — it is the only non-Phaser dependency they ship.
pub const P2P_UMD: &str = include_str!("../vendor/psd-to-phaser.umd.js");

/// The Phaser build the editor itself runs, copied from node_modules by
/// scripts/vendor-p2p.mjs.
pub const PHASER: &str = include_str!("../vendor/phaser.min.js");

/// The document a fresh project opens with: one empty terrain layer.
pub fn starter_doc(projection: Projection, genre: Genre, grid_size: u32) -> String {
    let doc = json!({
        "version": 1,
        "projection": projection.as_str(),
        "genre": genre.as_str(),
        "gridSize": grid_size,
        "layers": [
            {
                "id": "layer-terrain",
                "name": "Terrain",
                "locked": false,
                "visible": true,
                "fills": [],
                "placements": [],
                "zones": [],
                "strokes": []
            }
        ]
    });
    serde_json::to_string_pretty(&doc).unwrap_or_else(|_| "{}".into())
}

/// Write the runnable project source into `game/`.
///
/// Each genre carries only the module it uses — A\* for top down, the body
/// step for a platformer — so what lands in `game/` is the program the
/// project actually runs rather than a library of alternatives to read past.
pub fn scaffold_game(
    dir: &Path,
    project_name: &str,
    projection: Projection,
    genre: Genre,
    grid_size: u32,
) -> Result<(), String> {
    let (scene_js, helper) = match genre {
        Genre::Topdown => (TOPDOWN_SCENE_JS, ("js/navigation.js", NAVIGATION_JS)),
        Genre::Platformer => (PLATFORMER_SCENE_JS, ("js/physics.js", PHYSICS_JS)),
    };

    let config = json!({
        "projection": projection.as_str(),
        "genre": genre.as_str(),
        "grid": grid_size,
        "gridSpan": 24,
        "spawn": { "cx": 0, "cy": 0 },
        "psdKeys": [],
        "layers": [],
        "psdPipeline": "psd-to-json@tauri"
    });

    let files: Vec<(&str, String)> = vec![
        ("index.html", INDEX_HTML.replace("__PROJECT_NAME__", project_name)),
        ("css/styles.css", STYLES_CSS.to_string()),
        ("js/main.js", MAIN_JS.to_string()),
        ("js/WorldScene.js", scene_js.to_string()),
        ("js/grid.js", GRID_JS.to_string()),
        (helper.0, helper.1.to_string()),
        (
            "js/game.config.json",
            serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?,
        ),
    ];

    for (rel, contents) in files {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&path, contents).map_err(|e| format!("Cannot write {rel}: {e}"))?;
    }
    Ok(())
}
