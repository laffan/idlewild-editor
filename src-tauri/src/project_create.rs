//! Making a project, and the one setting only a print project has.
//!
//! Split from `store.rs` for the 700-line rule, along the seam print opened:
//! creating a project is where a game and a page first differ, and the sheet
//! of paper is the one thing about a page that can change afterwards. Both are
//! re-exported from `store`, so every caller still says `store::create_project`.

use crate::print::Output;
use crate::project::{now_ms, GameOptions, ProjectMeta, Projection, Scaffold};
use crate::store::{game_dir, project_dir, read_meta, sync_game_config, write_doc, write_meta};
use std::fs;

/// Write a new project to disk: its meta, its `game/` tree and its document.
///
/// `character` is clamped rather than taken. It defaults to on and a scaffold
/// with no `shared/character.js` has nothing for it to reach, so a P2P or
/// vanilla project would otherwise record a controller it has no file for.
/// The sheets do not offer the row; this is what makes the answer on disk
/// agree with the tree beside it whichever way the store is reached.
// Every code project's way in, and the one the test suite takes; the command
// itself goes through `create_project_for`, which knows about print.
#[cfg_attr(not(test), allow(dead_code))]
pub fn create_project(
    name: &str,
    projection: Projection,
    scaffold: Scaffold,
    grid_size: u32,
    options: GameOptions,
) -> Result<ProjectMeta, String> {
    create_project_for(
        name,
        projection,
        scaffold,
        grid_size,
        options,
        Output::default(),
    )
}

/// The same, for a project that says what it is for — a game or a page.
///
/// A print project needs a Phaser scaffold, because `ExportForPrint()` reads
/// the page off a running Phaser scene and a vanilla page has none to read.
/// The sheet greys Vanilla out under Print; this is the same answer for any
/// other way in.
pub fn create_project_for(
    name: &str,
    projection: Projection,
    scaffold: Scaffold,
    grid_size: u32,
    options: GameOptions,
    output: Output,
) -> Result<ProjectMeta, String> {
    if output.is_print() && !scaffold.is_phaser() {
        return Err("A print project needs a Phaser scaffold".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let dir = project_dir(&id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let meta = ProjectMeta::new(
        id.clone(),
        name.to_string(),
        projection,
        scaffold,
        grid_size,
        GameOptions {
            character: options.character && scaffold.has_character(),
            // A page is measured in points, one to the world pixel, so the
            // game that prints it has to be looking at it at 1×. The editor's
            // own camera is free to go anywhere; this is the game's.
            default_zoom: if output.is_print() {
                1.0
            } else {
                options.default_zoom
            },
            ..options
        },
    );
    let meta = ProjectMeta {
        output: Output {
            dpi: output.dpi(),
            ..output
        },
        ..meta
    };
    write_meta(&meta)?;
    // Scaffolded before the document is written, because writing a document
    // regenerates the config inside `game/` and there has to be a `game/` to
    // regenerate it in.
    crate::templates::scaffold_game(&game_dir(&id)?, &meta)?;
    write_doc(&id, &crate::templates::starter_doc(&meta))?;
    Ok(meta)
}

/// Change the sheet a print project is laid out on: its size, which way
/// round, where its corner is in the world, and what a page is written as.
/// What Page Setup, the frame on the canvas and the preview's bar all write.
///
/// Only what the patch names changes. The kind and the DPI are not in it: they
/// are facts about every PSD the project has already written — see
/// `print.rs`. A code project refuses, because it has no page.
pub fn set_page(id: &str, patch: &crate::print::PagePatch) -> Result<ProjectMeta, String> {
    let mut meta = read_meta(id)?;
    if !meta.output.is_print() {
        return Err("Only a print project has a page".into());
    }
    let mut output = meta.output.clone();
    patch.apply(&mut output)?;
    meta.output = output;
    meta.updated_at = now_ms();
    write_meta(&meta)?;
    let _ = sync_game_config(id);
    if meta.output.boards().len() > 1 {
        refresh_print_js(id);
    }
    Ok(meta)
}

/// Bring a print project's `js/shared/print.js` up to this build's, so one
/// made before artboards captures every artboard rather than the first.
///
/// The file is the editor's — it says so at its top — and nothing in a
/// project's own code is expected to live in it. One whose first line is no
/// longer the editor's has been rewritten by hand, and is left alone.
fn refresh_print_js(id: &str) {
    let Ok(game) = crate::store::game_dir(id) else { return };
    let path = game.join("js/shared/print.js");
    let Ok(current) = std::fs::read_to_string(&path) else { return };
    let ours = crate::templates::print_js();
    let header = ours.lines().next().unwrap_or_default();
    if current != ours && current.lines().next() == Some(header) {
        let _ = std::fs::write(&path, ours);
    }
}
