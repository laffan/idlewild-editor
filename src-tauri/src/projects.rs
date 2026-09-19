//! The command surface over a project as a whole: the list on the home
//! screen, the four things that can happen to one of them, the document, and
//! the thumbnail the home screen draws.
//!
//! `project.rs` is the *shape* of a project — the structs both sides of the
//! IPC boundary agree on. This is the shape of the *store* of them: what the
//! frontend can ask to be done to the projects on disk. They are named for
//! that difference, one and many.
//!
//! Split from `lib.rs` for the 700-line rule, as `game_files.rs` was. They
//! were already a section of their own there, and every one of them is a thin
//! wrapper over `store` — which is where the rules actually live.

use crate::project::{GameOptions, Presentation, ProjectMeta, Projection, Scaffold};
use crate::store;

#[tauri::command]
pub fn list_projects() -> Result<Vec<ProjectMeta>, String> {
    store::list_projects()
}

/// `genre` is optional so a caller that predates the choice still works; it
/// means top down, which is what every project made before it was. `options`
/// is optional for the same reason, and means the defaults — no pixel
/// snapping, zoom 1, and a character controller, which is what every project
/// scaffolded before New Project asked.
#[tauri::command]
pub fn create_project(
    name: String,
    projection: String,
    grid_size: u32,
    genre: Option<String>,
    options: Option<GameOptions>,
) -> Result<ProjectMeta, String> {
    let projection = match projection.as_str() {
        "isometric" => Projection::Isometric,
        "orthogonal" => Projection::Orthogonal,
        "blank" => Projection::Blank,
        other => return Err(format!("Unknown template: {other}")),
    };
    // The parameter is still called `genre` because the field on disk is —
    // see `Scaffold`. `None` is every project made before the choice existed.
    let scaffold = match genre.as_deref() {
        None | Some("topdown") => Scaffold::Topdown,
        Some("platformer") => Scaffold::Platformer,
        Some("p2p") => Scaffold::P2p,
        Some("vanilla") => Scaffold::Vanilla,
        Some(other) => return Err(format!("Unknown scaffold: {other}")),
    };
    // Gravity has no direction on a diamond grid seen from above, and there
    // is no scaffold that could honestly be written for the pair. The two that
    // scaffold no character have nothing to fall, so they pair with anything.
    if projection == Projection::Isometric && scaffold == Scaffold::Platformer {
        return Err("An isometric project cannot be a platformer".into());
    }
    store::create_project(
        &name,
        projection,
        scaffold,
        grid_size,
        options.unwrap_or_default(),
    )
}

/// Change how a project renders: pixel art, whole-pixel drawing, the zoom a
/// scene opens at. What Project Options writes.
///
/// The scaffold's own choice — whether a character controller was written — is
/// not here: a project's `game/` tree is its own copy, and unticking a box
/// would not take a character out of code that already has one.
#[tauri::command]
pub fn set_project_options(
    id: String,
    pixel_art: bool,
    round_pixels: bool,
    default_zoom: f64,
    character: bool,
) -> Result<ProjectMeta, String> {
    store::set_project_options(&id, pixel_art, round_pixels, default_zoom, character)
}

/// Change the page the game sits on: its size, where it sits, the space around
/// it, its corners and what is behind it. What Page Setup writes.
///
/// One struct across the bridge rather than six arguments, unlike
/// `set_project_options` above. That one grew a parameter at a time and shows
/// it; this has six from the start, and six positional booleans and numbers is
/// a call nobody can read at either end.
#[tauri::command]
pub fn set_project_presentation(
    id: String,
    presentation: Presentation,
) -> Result<ProjectMeta, String> {
    store::set_presentation(&id, presentation)
}

#[tauri::command]
pub fn rename_project(id: String, name: String) -> Result<ProjectMeta, String> {
    store::rename_project(&id, &name)
}

#[tauri::command]
pub fn delete_project(id: String) -> Result<(), String> {
    store::delete_project(&id)
}

#[tauri::command]
pub fn duplicate_project(id: String) -> Result<ProjectMeta, String> {
    store::duplicate_project(&id)
}

#[tauri::command]
pub fn read_project_meta(id: String) -> Result<ProjectMeta, String> {
    store::read_meta(&id)
}

/// Read the document — and, on the way, bring the generated config level
/// with it.
///
/// Opening a project is the one moment the whole document is in hand and
/// nothing is about to change it. Every save keeps
/// `game/js/game.config.json` in step from then on, but a project made before
/// that was true has an empty one on disk, and Play runs the project's own
/// code against that file. Syncing here is what stops such a project opening
/// to a canvas full of work and playing an empty world.
#[tauri::command]
pub fn read_document(id: String) -> Result<String, String> {
    let doc = store::read_doc(&id)?;
    let _ = store::sync_game_config(&id);
    Ok(doc)
}

#[tauri::command]
pub fn write_document(id: String, doc: String) -> Result<(), String> {
    store::write_doc(&id, &doc)
}

#[tauri::command]
pub fn read_thumbnail(id: String) -> Result<Option<String>, String> {
    store::read_thumbnail(&id)
}

/// The editor renders its own thumbnail from the live canvas and posts the
/// PNG back here as base64.
#[tauri::command]
pub fn write_thumbnail(id: String, png_base64: String) -> Result<(), String> {
    use base64::Engine;
    let data = png_base64
        .split_once(",")
        .map(|(_, rest)| rest)
        .unwrap_or(&png_base64);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("Bad thumbnail data: {e}"))?;
    store::write_thumbnail(&id, &bytes)
}
