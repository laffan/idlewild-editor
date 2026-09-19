//! Starter templates. As the spec puts it, these are codebase template
//! selections: each one scaffolds a real runnable project into the project's
//! `game/` directory, which is what the code modal edits and what Publish
//! zips.
//!
//! Two axes, and they are no longer the same *kind* of choice.
//!
//! The *projection* is the shape of the space — isometric diamonds, orthogonal
//! squares, or a blank canvas whose cells are single pixels — and it does not
//! need a file of its own: the difference lives entirely in `grid.js`, which
//! reads it out of `game.config.json`. It is what the editor draws, and every
//! scaffold below gets the same drawing.
//!
//! The *scaffold* is how much program the drawing is handed to, and there are
//! four answers. `Topdown` and `Platformer` are whole games, and they need a
//! file each because a character that walks a floor plan and one that runs
//! along a cross-section are different programs. `P2p` is the wiring and
//! nothing above it. `Vanilla` is not a Phaser project at all.
//!
//! ## Four trees
//!
//! ```text
//! Topdown / Platformer            P2p                     Vanilla
//! ────────────────────────────    ────────────────────    ────────────────
//! index.html                      index.html              index.html
//! styles.css                      styles.css              style.css
//! js/main.js                      js/main.js              script.js
//! js/game.config.json             js/game.config.json     game.config.json
//! js/lib/                         js/lib/
//! js/scenes/index.js              js/scenes/index.js
//! js/scenes/<Scene>.js            js/scenes/<Scene>.js
//! js/shared/canvas.js             js/shared/canvas.js
//! js/shared/grid.js               js/shared/grid.js
//! js/shared/character.js
//! js/shared/navigation.js
//!   — or physics.js
//! js/prefabs/character.js
//! ```
//!
//! `js/main.js` registers the scenes and starts the game; `js/shared/canvas.js`
//! draws the document — loading, camera, fills, placements, patterns — and is
//! the same file whichever of the three Phaser scaffolds wrote it;
//! `js/shared/grid.js` is the projection and the document's geometry;
//! `js/shared/character.js` is the wiring between the document and whatever
//! moves in it, and `js/prefabs/character.js` is the body, the walk and the
//! artwork, which are yours.
//!
//! `js/lib/` is the one directory that is not on disk in the store: Phaser and
//! psd-to-phaser are 1.5 MB that would be identical in every project and are
//! already in this binary, so `file_server` answers for them while a project is
//! being played and `publish` writes them into the zip. A `Vanilla` project
//! asks for neither and is shipped neither. Everything else is real files the
//! code modal can open.
//!
//! **Every tree gets the same `assets/`.** The PSD pipeline runs on import and
//! writes its output beside `game/` rather than inside it, so what a scaffold
//! decides is the code around the artwork and never the artwork — which is the
//! whole point of the two that scaffold less. See `publish::site_entries`.
//!
//! ## Template code and your code are different files
//!
//! They used to be the same file. `js/scenes/WorldScene.js` was a thousand
//! lines, nearly all of them the editor's, marked block by block and shown in
//! a different colour — and whatever you wrote went in between them. That is a
//! fine mechanism for a handful of lines and the wrong shape for a program:
//! the file you were meant to work in was mostly somebody else's.
//!
//! So the machinery moved to `js/shared/` and a scene became a short file of
//! its own — which is the same argument the two leaner scaffolds make one step
//! further out. A file you are meant to work in should not be mostly somebody
//! else's, and neither should a *project*.
//!
//! ## One file per scene, named after it
//!
//! `template_files` answers for the files a project has from the moment it is
//! created. The scene files do not belong there, because how many there are and
//! what they are called is a fact about the *document* — so they are
//! `scene_file`, written and renamed by `store::sync_scene_files` as scenes
//! come and go in the sidebar. The class and the Phaser key are the filename,
//! which is how `this.scene.start("Cave")` means what it looks like it means.
//! A `Vanilla` project has no scenes to keep in step and gets none of this;
//! the guard is in `sync_scene_files`.
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
//! a switch — on the two scaffolds that have that file. On the other two there
//! is nothing to switch, and the sheets do not offer it.

use crate::project::{ProjectMeta, Scaffold};
use serde_json::json;
use std::fs;
use std::path::Path;

const INDEX_HTML: &str = include_str!("../templates/common/index.html");
const STYLES_CSS: &str = include_str!("../templates/common/styles.css");
const GRID_JS: &str = include_str!("../templates/common/js/shared/grid.js");
const CANVAS_JS: &str = include_str!("../templates/common/js/shared/canvas.js");
const MAIN_JS: &str = include_str!("../templates/common/js/main.js");
const SCENE_JS: &str = include_str!("../templates/common/js/scenes/Scene.js");
const P2P_SCENE_JS: &str = include_str!("../templates/p2p/js/scenes/Scene.js");

const NAVIGATION_JS: &str = include_str!("../templates/common/js/shared/navigation.js");
const TOPDOWN_CHARACTER_JS: &str = include_str!("../templates/topdown/js/shared/character.js");
const TOPDOWN_PREFAB_JS: &str = include_str!("../templates/topdown/js/prefabs/character.js");

const PHYSICS_JS: &str = include_str!("../templates/platformer/js/shared/physics.js");
const PLATFORMER_CHARACTER_JS: &str = include_str!("../templates/platformer/js/shared/character.js");
const PLATFORMER_PREFAB_JS: &str = include_str!("../templates/platformer/js/prefabs/character.js");

const VANILLA_HTML: &str = include_str!("../templates/vanilla/index.html");
const VANILLA_CSS: &str = include_str!("../templates/vanilla/style.css");
const VANILLA_JS: &str = include_str!("../templates/vanilla/script.js");

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

/// Every file the scaffold writes that is the same in every project of its
/// kind, as (path within `game/`, contents).
///
/// Split out of `scaffold_game` because the code modal needs the same answer
/// for one file at a time: a managed block's Reset restores the lines the
/// scaffold wrote, so the scaffold has to be askable rather than only
/// runnable. See `store::read_game_template`.
///
/// **Each scaffold carries only what it runs.** A top-down project gets A\*
/// and a platformer the body step, so what lands in `game/` is the program the
/// project actually runs rather than a library of alternatives to read past.
/// `P2p` takes that to its end: the document is drawn and nothing moves over
/// it, so there is no `character.js`, no prefab and neither helper. `Vanilla`
/// is three files and the generated config, and not one of them mentions
/// Phaser.
///
/// The scene files are not here; see `scene_file`.
pub fn template_files(meta: &ProjectMeta) -> Result<Vec<(&'static str, String)>, String> {
    // Empty, because a scaffold runs before anything has been drawn. Every
    // save rewrites it from the live document — see `game_config`.
    let config = (
        crate::game_config::config_rel(meta.genre),
        serde_json::to_string_pretty(&crate::game_config::empty(meta))
            .map_err(|e| e.to_string())?,
    );

    if meta.genre == Scaffold::Vanilla {
        return Ok(vec![
            (
                "index.html",
                VANILLA_HTML.replace("__PROJECT_NAME__", &meta.name),
            ),
            ("style.css", VANILLA_CSS.to_string()),
            ("script.js", VANILLA_JS.to_string()),
            config,
        ]);
    }

    let mut files = vec![
        (
            "index.html",
            INDEX_HTML.replace("__PROJECT_NAME__", &meta.name),
        ),
        ("styles.css", STYLES_CSS.to_string()),
        ("js/main.js", MAIN_JS.to_string()),
        ("js/shared/canvas.js", CANVAS_JS.to_string()),
        ("js/shared/grid.js", GRID_JS.to_string()),
    ];

    // The three files a character needs, on the two scaffolds that have one.
    // `js/prefabs/character.js` is always written where it is written at all,
    // whether or not the project wants a character *today*: the switch is
    // `config.character`, which `shared/character.js` reads — so a project
    // that starts without one has a prefab waiting rather than a file to go
    // and create when the box is ticked.
    let character = match meta.genre {
        Scaffold::Topdown => Some((
            TOPDOWN_CHARACTER_JS,
            TOPDOWN_PREFAB_JS,
            ("js/shared/navigation.js", NAVIGATION_JS),
        )),
        Scaffold::Platformer => Some((
            PLATFORMER_CHARACTER_JS,
            PLATFORMER_PREFAB_JS,
            ("js/shared/physics.js", PHYSICS_JS),
        )),
        Scaffold::P2p | Scaffold::Vanilla => None,
    };
    if let Some((character_js, prefab_js, helper)) = character {
        files.push(("js/shared/character.js", character_js.to_string()));
        files.push((helper.0, helper.1.to_string()));
        files.push(("js/prefabs/character.js", prefab_js.to_string()));
    }

    files.push(config);
    Ok(files)
}

/// One scene's file, as the scaffold writes it.
///
/// `class` is the scene's file name without the extension, which is also its
/// class name and its Phaser key — see `scene_names::scene_file_name`. It is
/// the only thing substituted: the file is the imports and the class, with no
/// prose over it. Every scene in a project would otherwise open on the same
/// page of explanation, and what it explained is in `js/shared/` where the
/// code it is about is.
///
/// Two shapes, because a `P2p` scene has no character to spawn and no
/// `shared/character.js` to import one from — a scene that called either would
/// be a scene that will not load. `Vanilla` has no scenes at all and never
/// asks; it answers with the `P2p` scene rather than panicking, because a
/// wrong answer nobody reads is better than an unwrap somewhere else.
pub fn scene_file(class: &str, scaffold: Scaffold) -> String {
    let template = if scaffold.has_character() {
        SCENE_JS
    } else {
        P2P_SCENE_JS
    };
    template.replace("__SCENE_CLASS__", class)
}

/// One scaffolded file, as it was first written.
///
/// A path this scaffold does not write — another scaffold's helper, or a file
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
        return Ok(scene_file(&class, meta.genre));
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
        .ok_or_else(|| format!("{rel} is not a file this scaffold writes"))
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
/// its starter document. A `Vanilla` project has none, and that same function
/// is where it says so.
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
