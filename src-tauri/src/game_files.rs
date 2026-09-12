//! The command surface over the project's editable `game/` tree — what the
//! code modal's file column and its editor call.
//!
//! Nine thin wrappers over `store`, which is where the rules are: a path that
//! would climb out of `game/` is refused, a destination that already exists is
//! refused, and a folder cannot be moved inside itself. The modal has no undo,
//! so silently overwriting is the one mistake this surface must never make.
//!
//! Split from `lib.rs` for the 700-line rule. They were already a section of
//! their own there, and they are the only commands that are entirely about
//! files the user edits.

use crate::project::GameFile;
use crate::store;

#[tauri::command]
pub fn list_game_files(id: String) -> Result<Vec<GameFile>, String> {
    store::list_game_files(&id)
}

#[tauri::command]
pub fn read_game_file(id: String, path: String) -> Result<String, String> {
    store::read_game_file(&id, &path)
}

/// One file of `game/` as the scaffold wrote it.
///
/// The code modal marks the lines the editor maintains and offers a Reset
/// beside each managed block; this is what Reset puts back. It is asked for
/// on every open, so a file the template does not write answers with an error
/// and the modal simply treats that file as the user's alone.
#[tauri::command]
pub fn read_game_template(id: String, path: String) -> Result<String, String> {
    store::read_game_template(&id, &path)
}

#[tauri::command]
pub fn write_game_file(id: String, path: String, content: String) -> Result<(), String> {
    store::write_game_file(&id, &path, &content)
}

#[tauri::command]
pub fn create_game_file(id: String, path: String) -> Result<(), String> {
    store::create_game_file(&id, &path)
}

#[tauri::command]
pub fn create_game_dir(id: String, path: String) -> Result<(), String> {
    store::create_game_dir(&id, &path)
}

/// Move or rename, which are the same operation with different intent.
#[tauri::command]
pub fn move_game_path(id: String, from: String, to: String) -> Result<(), String> {
    store::move_game_path(&id, &from, &to)
}

/// Copy, returning the path the copy actually took.
#[tauri::command]
pub fn copy_game_path(id: String, path: String) -> Result<String, String> {
    store::copy_game_path(&id, &path)
}

#[tauri::command]
pub fn delete_game_path(id: String, path: String) -> Result<(), String> {
    store::delete_game_path(&id, &path)
}

