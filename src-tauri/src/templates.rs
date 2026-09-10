//! Starter templates. "Isometric" and "Orthogonal" are, as the spec puts it,
//! codebase template selections: each scaffolds a real runnable Phaser 4
//! project into the project's `game/` directory, which is what the code modal
//! edits and what Publish zips.

use crate::project::Projection;
use serde_json::json;
use std::fs;
use std::path::Path;

const INDEX_HTML: &str = include_str!("../templates/common/index.html");
const STYLES_CSS: &str = include_str!("../templates/common/css/styles.css");
const GRID_JS: &str = include_str!("../templates/common/js/grid.js");
const NAVIGATION_JS: &str = include_str!("../templates/common/js/navigation.js");

const ISO_MAIN_JS: &str = include_str!("../templates/isometric/js/main.js");
const ISO_SCENE_JS: &str = include_str!("../templates/isometric/js/WorldScene.js");
const ORTHO_MAIN_JS: &str = include_str!("../templates/orthogonal/js/main.js");
const ORTHO_SCENE_JS: &str = include_str!("../templates/orthogonal/js/WorldScene.js");

/// The psd-to-phaser UMD build, vendored by scripts/vendor-p2p.mjs. Exports
/// carry it verbatim — it is the only non-Phaser dependency they ship.
pub const P2P_UMD: &str = include_str!("../vendor/psd-to-phaser.umd.js");

/// The Phaser build the editor itself runs, copied from node_modules by
/// scripts/vendor-p2p.mjs.
pub const PHASER: &str = include_str!("../vendor/phaser.min.js");

/// The document a fresh project opens with: one empty terrain layer.
pub fn starter_doc(projection: Projection, grid_size: u32) -> String {
    let doc = json!({
        "version": 1,
        "projection": projection.as_str(),
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
pub fn scaffold_game(
    dir: &Path,
    project_name: &str,
    projection: Projection,
    grid_size: u32,
) -> Result<(), String> {
    let (main_js, scene_js) = match projection {
        Projection::Isometric => (ISO_MAIN_JS, ISO_SCENE_JS),
        Projection::Orthogonal => (ORTHO_MAIN_JS, ORTHO_SCENE_JS),
    };

    let config = json!({
        "projection": projection.as_str(),
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
        ("js/main.js", main_js.to_string()),
        ("js/WorldScene.js", scene_js.to_string()),
        ("js/grid.js", GRID_JS.to_string()),
        ("js/navigation.js", NAVIGATION_JS.to_string()),
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
