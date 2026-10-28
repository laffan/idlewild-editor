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
//! The *scaffold* is how much program the drawing is handed to, offered as
//! four categories of progressive simplicity. **Game** is `Topdown` or
//! `Platformer`, whole games that need a file each because a character that
//! walks a floor plan and one that runs along a cross-section are different
//! programs. **PSD to Phaser** (`P2p`) is psd-to-phaser wired up and the
//! artwork placed in each scene's own `create`. **Phaser** is a Phaser game
//! running and nothing loaded into it. **Vanilla** is not a Phaser project at
//! all.
//!
//! ## Five trees
//!
//! ```text
//! Topdown / Platformer      P2p                   Phaser          Vanilla
//! ──────────────────────    ──────────────────    ────────────    ────────────
//! index.html                index.html            index.html      index.html
//! styles.css                styles.css            style.css       style.css
//! js/main.js                js/main.js            script.js       script.js
//! js/game.config.json       js/game.config.json   game.config…    game.config…
//! js/lib/                   js/lib/               lib/
//! js/scenes/index.js        js/scenes/index.js
//! js/scenes/<Scene>.js      js/scenes/<Scene>.js
//! js/shared/canvas.js
//! js/shared/grid.js
//! js/shared/character.js
//! js/shared/navigation.js
//!   — or physics.js
//! js/prefabs/character.js
//! ```
//!
//! **Only a Game has `js/shared/`.** The two games draw the document from the
//! config — `canvas.js` loads it, places it, paints its fills and backdrops
//! and generates its patterns — because the character walking it needs the
//! whole document as data. Everything simpler shows none of the editor's own
//! machinery: a PSD to Phaser project's `main.js` loads every PSD in a `Load`
//! scene, the way psd-to-phaser's own demos do, and each scene file places
//! artwork with `this.P2P.place` in `create` — written out line by line when
//! the scene file is (see `scene_file_with`), and dragged in from the sidebar
//! after that. A print project is a PSD to Phaser project, with
//! `ExportForPrint()` served beside Phaser rather than written into the tree.
//!
//! `js/lib/` is the one directory that is not on disk in the store: Phaser and
//! psd-to-phaser are 1.5 MB that would be identical in every project and are
//! already in this binary, so `file_server` answers for them while a project is
//! being played and `publish` writes them into the zip. A `Phaser` project
//! asks for Phaser alone, under `lib/` beside its page, and a `Vanilla` one
//! for neither. A print project's `ExportForPrint()` is the third file served
//! this way (`PRINT_RUNTIME`). Everything else is real files the code modal
//! can open.
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
//! its own — which is the same argument the simpler scaffolds make one step
//! further out, by having no `js/shared/` at all. A file you are meant to work
//! in should not be mostly somebody else's, and neither should a *project*.
//!
//! ## One file per scene, named after it
//!
//! `template_files` answers for the files a project has from the moment it is
//! created. The scene files do not belong there, because how many there are and
//! what they are called is a fact about the *document* — so they are
//! `scene_file`, written and renamed by `store::sync_scene_files` as scenes
//! come and go in the sidebar. The class and the Phaser key are the filename,
//! which is how `this.scene.start("Cave")` means what it looks like it means.
//! A `Phaser` or `Vanilla` project has no scenes to keep in step and gets
//! none of this; the guard is in `sync_scene_files`.
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
//! a switch — on the two Game scaffolds, which have that file. On the rest
//! there is nothing to switch, and the sheets do not offer it.

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

const P2P_MAIN_JS: &str = include_str!("../templates/p2p/js/main.js");
const P2P_SCENE_JS: &str = include_str!("../templates/p2p/js/scenes/Scene.js");
/// The scene a PSD to Phaser project was given before the scaffold stopped
/// writing `js/shared/`: five calls into `canvas.js`. A project that still has
/// that file gets this for a scene added to it, because its `main.js` has no
/// `Load` scene and a scene that only placed would place nothing.
const LEGACY_P2P_SCENE_JS: &str = include_str!("../templates/p2p/legacy/Scene.js");

const NAVIGATION_JS: &str = include_str!("../templates/common/js/shared/navigation.js");
const TOPDOWN_CHARACTER_JS: &str = include_str!("../templates/topdown/js/shared/character.js");
const TOPDOWN_PREFAB_JS: &str = include_str!("../templates/topdown/js/prefabs/character.js");

const PHYSICS_JS: &str = include_str!("../templates/platformer/js/shared/physics.js");
const PLATFORMER_CHARACTER_JS: &str = include_str!("../templates/platformer/js/shared/character.js");
const PLATFORMER_PREFAB_JS: &str = include_str!("../templates/platformer/js/prefabs/character.js");

const PRINT_JS: &str = include_str!("../templates/print/idlewild-print.js");

const PHASER_HTML: &str = include_str!("../templates/phaser/index.html");
const PHASER_CSS: &str = include_str!("../templates/phaser/style.css");
const PHASER_JS: &str = include_str!("../templates/phaser/script.js");

const VANILLA_HTML: &str = include_str!("../templates/vanilla/index.html");
const VANILLA_CSS: &str = include_str!("../templates/vanilla/style.css");
const VANILLA_JS: &str = include_str!("../templates/vanilla/script.js");

/// `ExportForPrint()`, as a print project's page loads it: from the runtime
/// directory, beside Phaser and psd-to-phaser, and like them answered by
/// `file_server` and written by `publish` rather than kept on disk. It is the
/// editor's code, and a print project's tree is the author's.
pub const PRINT_RUNTIME: &str = "idlewild-print.js";

/// The comment in a PSD to Phaser scene's `create` that placement lines are
/// written under.
const PLACE_ANCHOR: &str = "    // Place PSDs here.\n";

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
                        "name": "Objects",
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
/// `P2p` has no `js/shared/` at all: its `main.js` loads the PSDs and its
/// scenes place them. `Phaser` and `Vanilla` are three files and the generated
/// config, and only the first of them mentions Phaser.
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
    let page = |html: &str| html.replace("__PROJECT_NAME__", &meta.name);

    match meta.genre {
        Scaffold::Vanilla => {
            return Ok(vec![
                ("index.html", page(VANILLA_HTML)),
                ("style.css", VANILLA_CSS.to_string()),
                ("script.js", VANILLA_JS.to_string()),
                config,
            ])
        }
        Scaffold::Phaser => {
            return Ok(vec![
                ("index.html", page(PHASER_HTML)),
                ("style.css", PHASER_CSS.to_string()),
                ("script.js", PHASER_JS.to_string()),
                config,
            ])
        }
        Scaffold::P2p => {
            let main_js = if meta.output.is_print() {
                print_main(P2P_MAIN_JS)
            } else {
                P2P_MAIN_JS.to_string()
            };
            return Ok(vec![
                ("index.html", page(INDEX_HTML)),
                ("styles.css", STYLES_CSS.to_string()),
                ("js/main.js", main_js),
                config,
            ]);
        }
        Scaffold::Topdown | Scaffold::Platformer => {}
    }

    let mut files = vec![
        ("index.html", page(INDEX_HTML)),
        ("styles.css", STYLES_CSS.to_string()),
        ("js/main.js", MAIN_JS.to_string()),
        ("js/shared/canvas.js", CANVAS_JS.to_string()),
        ("js/shared/grid.js", GRID_JS.to_string()),
    ];

    // The three files a character needs. `js/prefabs/character.js` is
    // written whether or not the project wants a character *today*: the
    // switch is `config.character`, which `shared/character.js` reads — so a
    // project that starts without one has a prefab waiting rather than a file
    // to go and create when the box is ticked.
    let (character_js, prefab_js, helper) = if meta.genre == Scaffold::Platformer {
        (PLATFORMER_CHARACTER_JS, PLATFORMER_PREFAB_JS, ("js/shared/physics.js", PHYSICS_JS))
    } else {
        (TOPDOWN_CHARACTER_JS, TOPDOWN_PREFAB_JS, ("js/shared/navigation.js", NAVIGATION_JS))
    };
    files.push(("js/shared/character.js", character_js.to_string()));
    files.push((helper.0, helper.1.to_string()));
    files.push(("js/prefabs/character.js", prefab_js.to_string()));

    files.push(config);
    Ok(files)
}

/// `ExportForPrint()` as this build serves it — and as it refreshes the copy
/// a print project made before it was served keeps in `js/shared/print.js`.
pub(crate) fn print_js() -> &'static str {
    PRINT_JS
}

/// `js/main.js` for a print project: the same file, with the paper behind the
/// scenes rather than the sky, and `ExportForPrint()` installed on the game it
/// starts.
///
/// Three anchored replacements of the scaffold's own text rather than a second
/// copy of a hundred-line file, so the two cannot drift apart — and a test
/// pins each anchor, so a change to `main.js` that moves one fails loudly
/// rather than producing a print project that cannot print.
pub(crate) fn print_main(main_js: &str) -> String {
    let mut out = main_js.replacen(
        "import config from \"./game.config.json\" with { type: \"json\" };\n",
        &format!(
            "import config from \"./game.config.json\" with {{ type: \"json\" }};\n\
             import {{ installPrint }} from \"./lib/{PRINT_RUNTIME}\";\n"
        ),
        1,
    );
    out = out.replacen(
        "  backgroundColor: \"#d9e6ef\",",
        "  // The paper. A print project's screen is the sheet it prints onto.\n  \
         backgroundColor: \"#ffffff\",",
        1,
    );
    out = out.replacen("new Phaser.Game({", "const game = new Phaser.Game({", 1);
    out.push_str(
        "\n// The moment the page is printed: call `ExportForPrint()` from any scene\n\
         // and the game stops, and the page as it stands goes to Output. The\n\
         // options are listed under ExportForPrint() in the manual's Printing page.\n\
         installPrint(game, config);\n",
    );
    out
}

/// One scene's file, as the scaffold writes it.
///
/// `class` is the scene's file name without the extension, which is also its
/// class name and its Phaser key — see `scene_names::scene_file_name`. It is
/// the only thing substituted. A `Phaser` or `Vanilla` project has no scenes
/// at all and never asks; it answers with the `P2p` scene rather than
/// panicking, because a wrong answer nobody reads is better than an unwrap
/// somewhere else.
pub fn scene_file_for(class: &str, meta: &ProjectMeta) -> String {
    scene_file_with(class, meta, "")
}

/// The same, with `placements` — lines of `this.P2P.place` and what follows
/// each — written into `create`.
///
/// What the frontend sends when a project is switched onto PSD to Phaser and
/// its scene files are written afresh: the document's placements as code, in
/// the order they draw. The editor does not keep them in step afterwards.
/// From then on the scene file is the author's, and Draw is where artwork is
/// made rather than where the program is written. A Game scene draws the
/// document from the config instead and takes none.
pub fn scene_file_with(class: &str, meta: &ProjectMeta, placements: &str) -> String {
    if meta.genre.has_character() {
        return scene_file(class, meta.genre);
    }
    // The camera, before the placements: the world's origin in the middle of
    // the screen, which is where Draw's dashed screen boundary is drawn. A
    // fresh Phaser camera has the origin at its top-left instead, so artwork
    // laid out inside that boundary starts half off the screen. A print
    // project's camera is put on its page by `ExportForPrint()`'s runtime.
    let mut camera = String::new();
    if !meta.output.is_print() {
        camera.push_str(
            "    // The world's origin in the middle of the screen, where Draw's dashed\n    \
             // screen boundary is centred.\n    \
             this.cameras.main.centerOn(0, 0);\n",
        );
        if meta.options.default_zoom != 1.0 {
            camera.push_str(&format!(
                "    this.cameras.main.setZoom({});\n",
                meta.options.default_zoom
            ));
        }
    }
    let mut lines = String::new();
    lines.push_str(placements);
    // The one line a print project needs that a game does not: where the
    // page is printed. Written in rather than left commented out, so a new
    // print project prints the moment it starts — which is what makes Output
    // show a page the first time it is opened.
    if meta.output.is_print() {
        lines.push_str(
            "\n    // Print the page: this stops the scenes and sends the page to Output.\n    \
             // Every option is optional — see Printing in the manual.\n    \
             ExportForPrint({ name: \"page\", formats: \"png\" });\n",
        );
    }
    let anchored = format!("{camera}{PLACE_ANCHOR}{lines}");
    scene_file(class, meta.genre).replacen(PLACE_ANCHOR, &anchored, 1)
}

/// A scene added to a PSD to Phaser project made before the scaffold stopped
/// writing `js/shared/`: the five `canvas.js` calls it has always had, since
/// that project's `main.js` has no `Load` scene to load anything for it.
pub fn legacy_scene_file_for(class: &str, meta: &ProjectMeta) -> String {
    let scene = LEGACY_P2P_SCENE_JS.replace("__SCENE_CLASS__", class);
    if !meta.output.is_print() {
        return scene;
    }
    scene
        .replacen("  updateCanvas,\n} from", "  updateCanvas,\n  whenPsdsReady,\n} from", 1)
        .replacen(
            "    placePatterns(this);\n",
            "    placePatterns(this);\n\n    \
             // Wait for PSDs to load\n    \
             whenPsdsReady(this, () => {\n      \
               // This following line stops the script and prepares it for print output.\n      \
               // Every option is optional — see js/shared/print.js.\n\n      \
               ExportForPrint({ name: \"page\", formats: \"png\" });\n    \
             });\n",
            1,
        )
}

pub fn scene_file(class: &str, scaffold: Scaffold) -> String {
    let template = if scaffold.has_character() {
        SCENE_JS
    } else {
        P2P_SCENE_JS
    };
    template.replace("__SCENE_CLASS__", class)
}

/// Files a scaffold wrote once and writes no longer, and what they were.
///
/// A PSD to Phaser project made before the scaffold stopped writing
/// `js/shared/` still has those files and still runs them; their blocks keep
/// a Reset because this is where its pristine text is found.
fn legacy_file(rel: &str, meta: &ProjectMeta) -> Option<&'static str> {
    if !meta.genre.uses_p2p() {
        return None;
    }
    match rel {
        "js/shared/canvas.js" => Some(CANVAS_JS),
        "js/shared/grid.js" => Some(GRID_JS),
        "js/shared/print.js" if meta.output.is_print() => Some(PRINT_JS),
        _ => None,
    }
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
        return Ok(scene_file_for(&class, meta));
    }

    let wanted = MOVED
        .iter()
        .find(|(old, _)| *old == rel)
        .map(|(_, new)| *new)
        .unwrap_or(rel);

    if let Some(found) = template_files(meta)?
        .into_iter()
        .find(|(path, _)| *path == wanted)
        .map(|(_, contents)| contents)
    {
        return Ok(found);
    }
    legacy_file(wanted, meta)
        .map(str::to_string)
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
    let mut files = template_files(meta)?;
    // An empty scene list, so `sync_scene_files` can tell a PSD to Phaser tree
    // from one made before per-scene files — the test it uses is that this
    // file or `js/shared/canvas.js` is there. The first save fills it in.
    if meta.genre == Scaffold::P2p {
        files.push((SCENE_INDEX_REL, crate::store::scene_index(&[])));
    }
    for (rel, contents) in files {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&path, contents).map_err(|e| format!("Cannot write {rel}: {e}"))?;
    }
    Ok(())
}
