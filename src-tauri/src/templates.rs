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
//!
//! ## The shape of what it writes
//!
//! ```text
//! index.html
//! styles.css
//! js/main.js
//! js/game.config.json     generated — see `game_config`
//! js/lib/                 the two runtimes, filled in by the server and the exporter
//! js/scenes/WorldScene.js the genre's program
//! js/prefabs/character.js what walks it, when New Game asked for one
//! js/shared/grid.js       the projection, and the document's geometry
//! js/shared/…             the genre's own module: navigation.js or physics.js
//! ```
//!
//! `js/lib/` is the one directory that is not on disk in the store: Phaser and
//! psd-to-phaser are 1.5 MB that would be identical in every project and are
//! already in this binary, so `file_server` answers for them while a project is
//! being played and `publish` writes them into the zip. Everything else is
//! real files the code modal can open.
//!
//! ## Options, and lines a scaffold can leave out
//!
//! Most of `GameOptions` reaches the game through the generated config, so a
//! toggle in Project Options takes effect on the next save without anything
//! rewriting the user's code. `character` cannot work that way — leaving a
//! character out means not writing the lines that make one — so the templates
//! carry it as a scaffold-time conditional:
//!
//! ```js
//! // idlewild:if character
//! this.spawnCharacter();
//! // idlewild:end if
//! ```
//!
//! The marker lines never reach disk. What is between them does only when the
//! named option is on. It is deliberately not the managed-block mechanism:
//! that is about lines the editor goes on owning after they are written, and
//! this is about a choice made once, before the file exists. Both halves of
//! the editor ask the same function for the same project, so a managed block's
//! Reset compares like with like.

use crate::project::{GameOptions, Genre, ProjectMeta};
use serde_json::json;
use std::fs;
use std::path::Path;

const INDEX_HTML: &str = include_str!("../templates/common/index.html");
const STYLES_CSS: &str = include_str!("../templates/common/styles.css");
const GRID_JS: &str = include_str!("../templates/common/js/shared/grid.js");
const MAIN_JS: &str = include_str!("../templates/common/js/main.js");

const NAVIGATION_JS: &str = include_str!("../templates/common/js/shared/navigation.js");
const TOPDOWN_SCENE_JS: &str = include_str!("../templates/topdown/js/scenes/WorldScene.js");
const TOPDOWN_CHARACTER_JS: &str = include_str!("../templates/topdown/js/prefabs/character.js");

const PHYSICS_JS: &str = include_str!("../templates/platformer/js/shared/physics.js");
const PLATFORMER_SCENE_JS: &str = include_str!("../templates/platformer/js/scenes/WorldScene.js");
const PLATFORMER_CHARACTER_JS: &str =
    include_str!("../templates/platformer/js/prefabs/character.js");

/// Where the scene and the prefab live now, and where they lived before.
///
/// A project's `game/` tree is its own copy and nothing rewrites it, so every
/// project made before the layout moved still has its scene at `js/`. Those
/// files are the same files — the scaffold's blocks have the same ids and the
/// same contents — and a managed block's Reset has to go on working in them,
/// so an old path is read as the new one's. The imports at the top of a moved
/// file differ, and that is not a problem: they are outside every marked
/// block, so nothing compares them.
const MOVED: [(&str, &str); 5] = [
    ("js/WorldScene.js", "js/scenes/WorldScene.js"),
    ("js/grid.js", "js/shared/grid.js"),
    ("js/navigation.js", "js/shared/navigation.js"),
    ("js/physics.js", "js/shared/physics.js"),
    ("css/styles.css", "styles.css"),
];

/// The psd-to-phaser UMD build, vendored by scripts/vendor-p2p.mjs. Exports
/// carry it verbatim — it is the only non-Phaser dependency they ship.
pub const P2P_UMD: &str = include_str!("../vendor/psd-to-phaser.umd.js");

/// The Phaser build the editor itself runs, copied from node_modules by
/// scripts/vendor-p2p.mjs.
pub const PHASER: &str = include_str!("../vendor/phaser.min.js");

/// Where a runnable tree keeps the two runtimes, inside `game/`.
pub const RUNTIME_DIR: &str = "js/lib/";

/// Where projects scaffolded before the layout moved keep them.
pub const LEGACY_RUNTIME_DIR: &str = "lib/";

/// The document a fresh project opens with: one scene, one empty layer.
///
/// A project is one place until it is two, so the first scene is called Main
/// — which is also the name a project written before scenes gets when the
/// editor migrates it, so the two kinds of project read the same afterwards.
pub fn starter_doc(meta: &ProjectMeta) -> String {
    let doc = json!({
        "version": 2,
        "projection": meta.projection.as_str(),
        "genre": meta.genre.as_str(),
        "gridSize": meta.grid_size,
        "activeSceneId": "scene-main",
        "scenes": [
            {
                "id": "scene-main",
                "name": "Main",
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
            }
        ]
    });
    serde_json::to_string_pretty(&doc).unwrap_or_else(|_| "{}".into())
}

/// Every file the scaffold writes, as (path within `game/`, contents).
///
/// Split out of `scaffold_game` because the code modal needs the same answer
/// for one file at a time: a managed block's Reset restores the lines the
/// scaffold wrote, so the scaffold has to be askable rather than only
/// runnable. See `store::read_game_template`.
///
/// Each genre carries only the module it uses — A\* for top down, the body
/// step for a platformer — so what lands in `game/` is the program the
/// project actually runs rather than a library of alternatives to read past.
pub fn template_files(meta: &ProjectMeta) -> Result<Vec<(&'static str, String)>, String> {
    let (scene_js, character_js, helper) = match meta.genre {
        Genre::Topdown => (
            TOPDOWN_SCENE_JS,
            TOPDOWN_CHARACTER_JS,
            ("js/shared/navigation.js", NAVIGATION_JS),
        ),
        Genre::Platformer => (
            PLATFORMER_SCENE_JS,
            PLATFORMER_CHARACTER_JS,
            ("js/shared/physics.js", PHYSICS_JS),
        ),
    };

    // Empty, because a scaffold runs before anything has been drawn. Every
    // save rewrites it from the live document — see `game_config`.
    let config = crate::game_config::empty(meta);

    let mut files = vec![
        (
            "index.html",
            INDEX_HTML.replace("__PROJECT_NAME__", &meta.name),
        ),
        ("styles.css", STYLES_CSS.to_string()),
        ("js/main.js", resolve(MAIN_JS, &meta.options)),
        ("js/scenes/WorldScene.js", resolve(scene_js, &meta.options)),
        ("js/shared/grid.js", GRID_JS.to_string()),
        (helper.0, helper.1.to_string()),
        (
            crate::game_config::CONFIG_REL,
            serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?,
        ),
    ];
    // No character, no prefab: an unticked box means the project has not got
    // one rather than has one it never calls.
    if meta.options.character {
        files.push((
            "js/prefabs/character.js",
            resolve(character_js, &meta.options),
        ));
    }
    Ok(files)
}

/// One scaffolded file, as it was first written.
///
/// A path this genre does not scaffold — the other genre's helper, or a file
/// the user made — has no pristine form to go back to, and says so rather
/// than answering with something plausible. A path from before the layout
/// moved is the exception: it is the same file under its old name, so it
/// answers with the file it became.
pub fn template_file(rel: &str, meta: &ProjectMeta) -> Result<String, String> {
    let wanted = MOVED
        .iter()
        .find(|(old, _)| *old == rel)
        .map(|(_, new)| *new)
        .unwrap_or(rel);

    template_files(meta)?
        .into_iter()
        .find(|(path, _)| *path == wanted)
        .map(|(_, contents)| contents)
        .ok_or_else(|| format!("{rel} is not a file this template writes"))
}

/// Write the runnable project source into `game/`.
pub fn scaffold_game(dir: &Path, meta: &ProjectMeta) -> Result<(), String> {
    for (rel, contents) in template_files(meta)? {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&path, contents).map_err(|e| format!("Cannot write {rel}: {e}"))?;
    }
    Ok(())
}

/// Apply the scaffold-time conditionals in one template file.
///
/// `// idlewild:if <option>` opens a run and `// idlewild:end if` closes it.
/// The markers themselves never reach disk, and what is between them is kept
/// only when that option is on. An unknown option name keeps nothing — a typo
/// should leave a template visibly short rather than quietly unconditional —
/// and a run left open by a missing `end if` ends with the file.
///
/// One level deep, deliberately: the only thing this expresses is "the project
/// asked for a character", and a nested condition would be a templating
/// language growing out of a single checkbox.
fn resolve(text: &str, options: &GameOptions) -> String {
    let mut out: Vec<&str> = Vec::new();
    let mut keeping: Option<bool> = None;
    // A run was just dropped, so the blank line that separated it from what
    // follows would otherwise be left doubled up against the one before it.
    let mut just_dropped = false;

    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(option) = trimmed.strip_prefix("// idlewild:if ") {
            keeping = Some(match option.trim() {
                "character" => options.character,
                _ => false,
            });
            continue;
        }
        if trimmed == "// idlewild:end if" {
            just_dropped = keeping == Some(false);
            keeping = None;
            continue;
        }
        if !keeping.unwrap_or(true) {
            continue;
        }
        if just_dropped {
            just_dropped = false;
            if trimmed.is_empty() && out.last().map(|l| l.trim().is_empty()) == Some(true) {
                continue;
            }
        }
        out.push(line);
    }

    let mut body = out.join("\n");
    // `lines()` drops the trailing newline every one of these files ends with.
    if text.ends_with('\n') {
        body.push('\n');
    }
    body
}
