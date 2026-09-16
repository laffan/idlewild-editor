//! Starter templates. As the spec puts it, these are codebase template
//! selections: each combination scaffolds a real runnable Phaser 4 project
//! into the project's `game/` directory, which is what the code modal edits
//! and what Publish zips.
//!
//! Two axes. The *projection* is the shape of the space — isometric diamonds,
//! orthogonal squares, or a blank canvas whose cells are single pixels — and
//! it does not need a file of its own: the difference lives entirely in
//! `grid.js`, which reads it out of `game.config.json`. The *genre* needs one
//! file, because a character that walks a floor plan and one that runs along a
//! cross-section are different programs — `shared/character.js` and the prefab
//! under it.
//!
//! ## Template code and your code are different files
//!
//! They used to be the same file. `js/scenes/WorldScene.js` was a thousand
//! lines, nearly all of them the editor's, marked block by block and shown in
//! a different colour — and whatever you wrote went in between them. That is a
//! fine mechanism for a handful of lines and the wrong shape for a program:
//! the file you were meant to work in was mostly somebody else's.
//!
//! So the machinery is in `js/shared/` and a scene is a short file of its own:
//!
//! ```text
//! index.html
//! styles.css
//! js/main.js                 registers the scenes and starts the game
//! js/game.config.json        generated — see `game_config`
//! js/lib/                    the two runtimes, filled in by the server and the exporter
//! js/scenes/index.js         generated — the scene list `main.js` reads
//! js/scenes/<Scene>.js       one per scene in the editor, and yours
//! js/shared/canvas.js        the document, drawn: loading, camera, fills, placements, patterns
//! js/shared/character.js     the genre's wiring between the document and what moves in it
//! js/shared/grid.js          the projection, and the document's geometry
//! js/shared/…                the genre's own module: navigation.js or physics.js
//! js/prefabs/character.js    the body, the walk and the artwork — yours
//! ```
//!
//! `js/lib/` is the one directory that is not on disk in the store: Phaser and
//! psd-to-phaser are 1.5 MB that would be identical in every project and are
//! already in this binary, so `file_server` answers for them while a project is
//! being played and `publish` writes them into the zip. Everything else is
//! real files the code modal can open.
//!
//! ## One file per scene, named after it
//!
//! `template_files` answers for the files every project has. The scene files
//! do not belong there, because how many there are and what they are called is
//! a fact about the *document* — so they are `scene_file`, written and renamed
//! by `store::sync_scene_files` as scenes come and go in the sidebar. The class
//! and the Phaser key are the filename, which is how `this.scene.start("Cave")`
//! means what it looks like it means.
//!
//! ## Options
//!
//! All of `GameOptions` reaches the game through the generated config, so a
//! toggle in Project Options takes effect on the next save without anything
//! rewriting code somebody may have edited. `character` used to be the
//! exception — it was a scaffold-time conditional, `// idlewild:if character`,
//! resolved once when the files were written, which is why Project Options
//! could only report it. `shared/character.js` reads `config.character` and
//! answers no instead, so the scaffold is the same either way and the switch is
//! a switch.

use crate::project::{Genre, ProjectMeta};
use serde_json::json;
use std::fs;
use std::path::Path;

const INDEX_HTML: &str = include_str!("../templates/common/index.html");
const STYLES_CSS: &str = include_str!("../templates/common/styles.css");
const GRID_JS: &str = include_str!("../templates/common/js/shared/grid.js");
const CANVAS_JS: &str = include_str!("../templates/common/js/shared/canvas.js");
const MAIN_JS: &str = include_str!("../templates/common/js/main.js");
const SCENE_JS: &str = include_str!("../templates/common/js/scenes/Scene.js");

const NAVIGATION_JS: &str = include_str!("../templates/common/js/shared/navigation.js");
const TOPDOWN_CHARACTER_JS: &str = include_str!("../templates/topdown/js/shared/character.js");
const TOPDOWN_PREFAB_JS: &str = include_str!("../templates/topdown/js/prefabs/character.js");

const PHYSICS_JS: &str = include_str!("../templates/platformer/js/shared/physics.js");
const PLATFORMER_CHARACTER_JS: &str = include_str!("../templates/platformer/js/shared/character.js");
const PLATFORMER_PREFAB_JS: &str = include_str!("../templates/platformer/js/prefabs/character.js");

/// Where the scaffold's files live now, and where they lived before.
///
/// A project's `game/` tree is its own copy and nothing rewrites it, so every
/// project made before the layout moved still has its files where they were.
/// Those are the same files — the scaffold's blocks have the same ids and the
/// same contents — so a managed block's Reset has to go on working in them,
/// and an old path is read as the new one's. The imports at the top of a moved
/// file differ, and that is not a problem: they are outside every marked
/// block, so nothing compares them.
///
/// `js/scenes/WorldScene.js` is deliberately **not** here. The file that
/// replaced it is a short one with no blocks in it at all, so answering with
/// that would not restore anything; a project holding the old thousand-line
/// scene keeps it, keeps running it, and owns every line of it from now on.
const MOVED: [(&str, &str); 4] = [
    ("js/grid.js", "js/shared/grid.js"),
    ("js/navigation.js", "js/shared/navigation.js"),
    ("js/physics.js", "js/shared/physics.js"),
    ("css/styles.css", "styles.css"),
];

/// Where the per-scene files go, and what the generated list is called.
pub const SCENES_DIR: &str = "js/scenes";
pub const SCENE_INDEX_REL: &str = "js/scenes/index.js";

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

/// What the first scene of a new project is called.
///
/// `Scene1` rather than `Main`, because the name is now a filename and a class
/// name as well as a label in the sidebar — and a project's scenes reading
/// Scene1, Scene2, Cave is a sequence somebody can rename into, where Main
/// sits outside one.
pub const FIRST_SCENE: &str = "Scene1";

/// The document a fresh project opens with: one scene, one empty layer.
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
                "name": FIRST_SCENE,
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

/// Every file the scaffold writes that is the same in every project, as
/// (path within `game/`, contents).
///
/// Split out of `scaffold_game` because the code modal needs the same answer
/// for one file at a time: a managed block's Reset restores the lines the
/// scaffold wrote, so the scaffold has to be askable rather than only
/// runnable. See `store::read_game_template`.
///
/// Each genre carries only the module it uses — A\* for top down, the body
/// step for a platformer — so what lands in `game/` is the program the
/// project actually runs rather than a library of alternatives to read past.
/// The scene files are not here; see `scene_file`.
pub fn template_files(meta: &ProjectMeta) -> Result<Vec<(&'static str, String)>, String> {
    let (character_js, prefab_js, helper) = match meta.genre {
        Genre::Topdown => (
            TOPDOWN_CHARACTER_JS,
            TOPDOWN_PREFAB_JS,
            ("js/shared/navigation.js", NAVIGATION_JS),
        ),
        Genre::Platformer => (
            PLATFORMER_CHARACTER_JS,
            PLATFORMER_PREFAB_JS,
            ("js/shared/physics.js", PHYSICS_JS),
        ),
    };

    // Empty, because a scaffold runs before anything has been drawn. Every
    // save rewrites it from the live document — see `game_config`.
    let config = crate::game_config::empty(meta);

    Ok(vec![
        (
            "index.html",
            INDEX_HTML.replace("__PROJECT_NAME__", &meta.name),
        ),
        ("styles.css", STYLES_CSS.to_string()),
        ("js/main.js", MAIN_JS.to_string()),
        ("js/shared/canvas.js", CANVAS_JS.to_string()),
        ("js/shared/character.js", character_js.to_string()),
        ("js/shared/grid.js", GRID_JS.to_string()),
        (helper.0, helper.1.to_string()),
        // Always written, whether or not the project wants a character today.
        // The switch is `config.character`, which `shared/character.js` reads
        // — so a project that starts without one has a prefab waiting rather
        // than a file to go and create when the box is ticked.
        ("js/prefabs/character.js", prefab_js.to_string()),
        (
            crate::game_config::CONFIG_REL,
            serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?,
        ),
    ])
}

/// One scene's file, as the scaffold writes it.
///
/// `class` is the scene's file name without the extension, which is also its
/// class name and its Phaser key — see `game_config::scene_file_name`. It is
/// the only thing substituted: the file is the imports and the class, with no
/// prose over it. Every scene in a project would otherwise open on the same
/// page of explanation, and what it explained is in `js/shared/` where the
/// code it is about is.
pub fn scene_file(class: &str) -> String {
    SCENE_JS.replace("__SCENE_CLASS__", class)
}

/// One scaffolded file, as it was first written.
///
/// A path this genre does not scaffold — the other genre's helper, or a file
/// the user made — has no pristine form to go back to, and says so rather
/// than answering with something plausible. A path from before the layout
/// moved is the exception: it is the same file under its old name, so it
/// answers with the file it became.
///
/// A **scene** file answers with the scaffold for a scene of that name. There
/// is nothing marked in it, so nothing in one is locked and no block offers a
/// Reset; what the answer is for is the other half of the mechanism, which
/// would otherwise read a file with no blocks as a file missing all of them.
pub fn template_file(rel: &str, meta: &ProjectMeta) -> Result<String, String> {
    if let Some(class) = scene_class_of(rel) {
        return Ok(scene_file(&class));
    }

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

/// The class name a scene file's path implies, or None for anything that is
/// not one. `index.js` is the generated list rather than a scene.
pub fn scene_class_of(rel: &str) -> Option<String> {
    let stem = rel.strip_prefix("js/scenes/")?.strip_suffix(".js")?;
    if stem.is_empty() || stem == "index" || stem.contains('/') {
        return None;
    }
    Some(stem.to_string())
}

/// Write the runnable project source into `game/`.
///
/// The scene files are not written here: they are the document's, so
/// `store::sync_scene_files` writes them from the config on the first save —
/// which for a new project happens immediately, because creating one writes
/// its starter document.
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
