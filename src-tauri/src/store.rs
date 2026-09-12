//! On-disk project store.
//!
//! Layout, under the platform app-data directory:
//!
//! ```text
//! com.idlewild.editor/
//!   projects/
//!     <id>/
//!       meta.json          ProjectMeta
//!       doc.json           GameDoc (layers, fills, placements, zones, strokes)
//!       thumbnail.png      home-screen preview, written by the editor
//!       psd/               source PSDs (imported, or converted from PNG)
//!       assets/<key>/      psd-to-json output: data.json + sprites/tiles
//!       game/              the editable project source the code modal shows
//! ```

use crate::project::{now_ms, GameFile, GameOptions, Genre, ProjectMeta, Projection};
use std::fs;
use std::path::{Path, PathBuf};

pub fn app_data_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir().ok_or("Cannot determine data directory")?;
    let dir = base.join("com.idlewild.editor");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn projects_dir() -> Result<PathBuf, String> {
    let dir = app_data_dir()?.join("projects");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn project_dir(id: &str) -> Result<PathBuf, String> {
    // `id` comes from uuid::new_v4 on our side, but never trust it into a
    // path join — a traversal here would write outside the store.
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("Invalid project id: {id}"));
    }
    Ok(projects_dir()?.join(id))
}

pub fn psd_dir(id: &str) -> Result<PathBuf, String> {
    let dir = project_dir(id)?.join("psd");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn assets_dir(id: &str) -> Result<PathBuf, String> {
    let dir = project_dir(id)?.join("assets");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn game_dir(id: &str) -> Result<PathBuf, String> {
    let dir = project_dir(id)?.join("game");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn meta_path(id: &str) -> Result<PathBuf, String> {
    Ok(project_dir(id)?.join("meta.json"))
}

fn doc_path(id: &str) -> Result<PathBuf, String> {
    Ok(project_dir(id)?.join("doc.json"))
}

pub fn read_meta(id: &str) -> Result<ProjectMeta, String> {
    let json = fs::read_to_string(meta_path(id)?)
        .map_err(|e| format!("Cannot read project {id}: {e}"))?;
    serde_json::from_str(&json).map_err(|e| format!("Corrupt meta.json for {id}: {e}"))
}

pub fn write_meta(meta: &ProjectMeta) -> Result<(), String> {
    let json = serde_json::to_string_pretty(meta).map_err(|e| e.to_string())?;
    fs::write(meta_path(&meta.id)?, json).map_err(|e| e.to_string())
}

/// Every project, newest edit first. Unreadable directories are skipped
/// rather than failing the whole listing — one corrupt project should not
/// hide the rest.
pub fn list_projects() -> Result<Vec<ProjectMeta>, String> {
    let dir = projects_dir()?;
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let Some(id) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if let Ok(meta) = read_meta(&id) {
            out.push(meta);
        }
    }
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(out)
}

pub fn create_project(
    name: &str,
    projection: Projection,
    genre: Genre,
    grid_size: u32,
    options: GameOptions,
) -> Result<ProjectMeta, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let dir = project_dir(&id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let meta = ProjectMeta::new(
        id.clone(),
        name.to_string(),
        projection,
        genre,
        grid_size,
        options,
    );
    write_meta(&meta)?;
    // Scaffolded before the document is written, because writing a document
    // regenerates the config inside `game/` and there has to be a `game/` to
    // regenerate it in.
    crate::templates::scaffold_game(&game_dir(&id)?, &meta)?;
    write_doc(&id, &crate::templates::starter_doc(&meta))?;
    Ok(meta)
}

/// Change what a project is rendered with, and hand back the meta as written.
///
/// Only the three options that are settings rather than history: `character`
/// is a fact about what the scaffold wrote and unticking it afterwards would
/// not take a character out of code that already has one.
///
/// The config the project's own code reads carries all three, so it is
/// rewritten here — otherwise the editor would change and the game would not
/// until the next time something touched the document.
pub fn set_project_options(
    id: &str,
    pixel_art: bool,
    round_pixels: bool,
    default_zoom: f64,
) -> Result<ProjectMeta, String> {
    let mut meta = read_meta(id)?;
    meta.options.pixel_art = pixel_art;
    meta.options.round_pixels = round_pixels;
    meta.options.default_zoom = default_zoom;
    meta.updated_at = now_ms();
    write_meta(&meta)?;
    let _ = sync_game_config(id);
    Ok(meta)
}

pub fn rename_project(id: &str, name: &str) -> Result<ProjectMeta, String> {
    let mut meta = read_meta(id)?;
    meta.name = name.to_string();
    meta.updated_at = now_ms();
    write_meta(&meta)?;
    Ok(meta)
}

pub fn delete_project(id: &str) -> Result<(), String> {
    let dir = project_dir(id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn duplicate_project(id: &str) -> Result<ProjectMeta, String> {
    let src = project_dir(id)?;
    let mut meta = read_meta(id)?;
    let new_id = uuid::Uuid::new_v4().to_string();
    let dst = project_dir(&new_id)?;
    copy_dir(&src, &dst)?;

    meta.id = new_id;
    meta.name = format!("{} copy", meta.name);
    meta.created_at = now_ms();
    meta.updated_at = meta.created_at;
    write_meta(&meta)?;
    Ok(meta)
}

pub fn read_doc(id: &str) -> Result<String, String> {
    fs::read_to_string(doc_path(id)?).map_err(|e| format!("Cannot read document: {e}"))
}

/// Persist the document and stamp the project's `updatedAt`/`layerCount` so
/// the home screen stays honest without a second round trip.
pub fn write_doc(id: &str, doc_json: &str) -> Result<(), String> {
    fs::write(doc_path(id)?, doc_json).map_err(|e| e.to_string())?;

    if let Ok(mut meta) = read_meta(id) {
        meta.updated_at = now_ms();
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(doc_json) {
            // Every scene's layers, because the home screen's count is about
            // the project rather than about whichever scene was left open.
            // A document written before scenes still keeps them at the top.
            let counted = value
                .get("scenes")
                .and_then(|s| s.as_array())
                .map(|scenes| {
                    scenes
                        .iter()
                        .filter_map(|scene| scene.get("layers")?.as_array())
                        .map(|layers| layers.len())
                        .sum::<usize>()
                })
                .or_else(|| value.get("layers").and_then(|l| l.as_array()).map(Vec::len));
            if let Some(count) = counted {
                meta.layer_count = count as u32;
            }
        }
        write_meta(&meta)?;
    }
    // The document has moved, so the file the project's own code reads has to
    // move with it — see `sync_game_config` for why a failure here is not a
    // failed save.
    let _ = sync_game_config(id);
    Ok(())
}

/// Rewrite `game/js/game.config.json` from the live document.
///
/// The config is the document in the shape the project's own code reads, and
/// the project's own code is what play mode runs — so it is regenerated on
/// every save rather than only on the way out to a zip. Before this, the file
/// the code modal opened was the empty one the scaffold wrote, whatever had
/// been built on the canvas since, and a project could be played for an hour
/// without its own config ever mentioning a single thing in it.
///
/// A failure here never fails the save. `doc.json` is the truth and this is
/// derived from it: a project whose document is mid-migration is better off
/// with a stale config and a written document than with neither.
pub fn sync_game_config(id: &str) -> Result<(), String> {
    let meta = read_meta(id)?;
    let doc = read_doc(id)?;
    let config = crate::game_config::from_document(&meta, &doc)?;
    let body = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    let path = game_dir(id)?.join(safe_relative(crate::game_config::CONFIG_REL)?);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // An unchanged config is not rewritten: the code modal watches this file
    // and a save storm on a drag would otherwise reload the editor under the
    // user's caret once per frame.
    if fs::read_to_string(&path).ok().as_deref() == Some(body.as_str()) {
        return Ok(());
    }
    fs::write(&path, body).map_err(|e| format!("Cannot write the game config: {e}"))
}

/// One file of `game/` as the scaffold first wrote it — what a managed
/// block's Reset in the code modal restores.
///
/// The generated config is the exception, and the interesting one: its
/// pristine form is not the empty file the scaffold wrote but the document as
/// it stands now, because that is what the editor would write into it on the
/// next save. Resetting it means regenerating it, not blanking it.
pub fn read_game_template(id: &str, rel: &str) -> Result<String, String> {
    let meta = read_meta(id)?;
    if rel == crate::game_config::CONFIG_REL {
        let config = crate::game_config::from_document(&meta, &read_doc(id)?)?;
        return serde_json::to_string_pretty(&config).map_err(|e| e.to_string());
    }
    crate::templates::template_file(rel, &meta)
}

pub fn write_thumbnail(id: &str, png: &[u8]) -> Result<(), String> {
    fs::write(project_dir(id)?.join("thumbnail.png"), png).map_err(|e| e.to_string())
}

pub fn read_thumbnail(id: &str) -> Result<Option<String>, String> {
    let path = project_dir(id)?.join("thumbnail.png");
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(Some(format!("data:image/png;base64,{b64}")))
}

// ── the editable game/ tree, as the code modal sees it ──────────────────────

/// Reject anything that would escape the directory it is joined onto.
/// `join` does not resolve `..`, so a prefix check alone is not a guard.
pub fn safe_relative(rel: &str) -> Result<PathBuf, String> {
    let path = Path::new(rel);
    for part in path.components() {
        use std::path::Component;
        match part {
            Component::Normal(_) => {}
            _ => return Err(format!("Unsafe path: {rel}")),
        }
    }
    Ok(path.to_path_buf())
}

pub fn list_game_files(id: &str) -> Result<Vec<GameFile>, String> {
    let root = game_dir(id)?;
    let mut out = Vec::new();
    collect_game_files(&root, &root, &mut out)?;
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

fn collect_game_files(root: &Path, dir: &Path, out: &mut Vec<GameFile>) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let is_dir = path.is_dir();
        out.push(GameFile { path: rel, is_dir });
        if is_dir {
            collect_game_files(root, &path, out)?;
        }
    }
    Ok(())
}

pub fn read_game_file(id: &str, rel: &str) -> Result<String, String> {
    let path = game_dir(id)?.join(safe_relative(rel)?);
    fs::read_to_string(&path).map_err(|e| format!("Cannot read {rel}: {e}"))
}

pub fn write_game_file(id: &str, rel: &str, content: &str) -> Result<(), String> {
    let path = game_dir(id)?.join(safe_relative(rel)?);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, content).map_err(|e| format!("Cannot write {rel}: {e}"))
}

// ── managing the game tree ──────────────────────────────────────────────────
//
// Everything below refuses a path that would climb out of `game/` and a
// destination that already exists. Overwriting silently is the one mistake a
// file manager must never make, and the code modal has no undo.

pub fn create_game_file(id: &str, rel: &str) -> Result<(), String> {
    let path = game_dir(id)?.join(safe_relative(rel)?);
    if path.exists() {
        return Err(format!("{rel} already exists"));
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, "").map_err(|e| format!("Cannot create {rel}: {e}"))
}

pub fn create_game_dir(id: &str, rel: &str) -> Result<(), String> {
    let path = game_dir(id)?.join(safe_relative(rel)?);
    if path.exists() {
        return Err(format!("{rel} already exists"));
    }
    fs::create_dir_all(&path).map_err(|e| format!("Cannot create {rel}: {e}"))
}

/// Move or rename a file or folder inside the tree.
///
/// A folder moved into itself would take its own destination with it, so the
/// prefix check is a correctness guard, not a nicety.
pub fn move_game_path(id: &str, from: &str, to: &str) -> Result<(), String> {
    let root = game_dir(id)?;
    let src = root.join(safe_relative(from)?);
    let dst = root.join(safe_relative(to)?);

    if !src.exists() {
        return Err(format!("{from} does not exist"));
    }
    if dst.exists() {
        return Err(format!("{to} already exists"));
    }
    if src.is_dir() && dst.starts_with(&src) {
        return Err(format!("Cannot move {from} inside itself"));
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&src, &dst).map_err(|e| format!("Cannot move {from}: {e}"))
}

/// Copy a file or folder, returning the path the copy actually took.
pub fn copy_game_path(id: &str, rel: &str) -> Result<String, String> {
    let root = game_dir(id)?;
    let src = root.join(safe_relative(rel)?);
    if !src.exists() {
        return Err(format!("{rel} does not exist"));
    }

    let taken = next_free_copy(&root, rel)?;
    let dst = root.join(&taken);
    if src.is_dir() {
        copy_dir(&src, &dst)?;
    } else {
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::copy(&src, &dst).map_err(|e| format!("Cannot copy {rel}: {e}"))?;
    }
    Ok(taken.to_string_lossy().replace('\\', "/"))
}

pub fn delete_game_path(id: &str, rel: &str) -> Result<(), String> {
    let path = game_dir(id)?.join(safe_relative(rel)?);
    if !path.exists() {
        return Ok(());
    }
    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| format!("Cannot delete {rel}: {e}"))
    } else {
        fs::remove_file(&path).map_err(|e| format!("Cannot delete {rel}: {e}"))
    }
}

/// `main.js` → `main copy.js` → `main copy 2.js`, keeping the extension
/// where a file manager keeps it.
fn next_free_copy(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let path = Path::new(rel);
    let parent = path.parent().unwrap_or(Path::new(""));
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| format!("Cannot name a copy of {rel}"))?;
    let ext = path.extension().and_then(|e| e.to_str());

    for n in 1..1000 {
        let name = match (n, ext) {
            (1, Some(e)) => format!("{stem} copy.{e}"),
            (1, None) => format!("{stem} copy"),
            (_, Some(e)) => format!("{stem} copy {n}.{e}"),
            (_, None) => format!("{stem} copy {n}"),
        };
        let candidate = parent.join(name);
        if !root.join(&candidate).exists() {
            return Ok(candidate);
        }
    }
    Err(format!("Too many copies of {rel}"))
}

pub fn copy_dir(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())?.flatten() {
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
