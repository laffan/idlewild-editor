//! What the scaffolded JavaScript does, read off the templates themselves.
//!
//! Split from `scaffolds` for the 700-line rule, along the seam those two
//! sentences describe. Next door is about what *creating* a project writes:
//! which files land, what the starter document says, what a managed block's
//! Reset answers with. These are about the contents of those files — the
//! order `canvas.js` loads and places in, the guard `syncPatterns` waits on,
//! and the set of blocks each template marks.
//!
//! They are text assertions over `templates::template_file`, and deliberately:
//! the alternative is running the scaffold, which would mean a browser, a
//! WebGL context and psd-to-phaser. What they are for is drift — a rename, a
//! block left open, a guard moved above the thing it guards — and a template
//! is the one artefact where reading the source *is* the test.

use crate::project::{GameOptions, ProjectMeta, Projection, Scaffold};
use crate::templates;

/// A meta to ask the templates a question about, without a project on disk.
fn seed(
    projection: Projection,
    scaffold: Scaffold,
    grid_size: u32,
    options: GameOptions,
) -> ProjectMeta {
    ProjectMeta::new(
        "seed".into(),
        "Seed".into(),
        projection,
        scaffold,
        grid_size,
        options,
    )
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
            Scaffold::Topdown,
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
            Scaffold::Topdown,
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
            Scaffold::Topdown,
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
        (Scaffold::Topdown, "js/shared/canvas.js", &canvas[..]),
        (Scaffold::Topdown, "js/shared/character.js", &topdown[..]),
        (Scaffold::Platformer, "js/shared/character.js", &platformer[..]),
        (Scaffold::Topdown, "js/main.js", &main[..]),
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

    for scaffold in [Scaffold::Topdown, Scaffold::Platformer, Scaffold::P2p] {
        let scene = templates::scene_file("Scene1", scaffold);
        assert!(
            !scene.contains("// idlewild:"),
            "a scene file is the author's, end to end",
        );
    }
}
