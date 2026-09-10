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

use crate::project::{now_ms, GameFile, ProjectMeta, Projection};
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
    grid_size: u32,
) -> Result<ProjectMeta, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let dir = project_dir(&id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let meta = ProjectMeta::new(id.clone(), name.to_string(), projection, grid_size);
    write_meta(&meta)?;
    write_doc(&id, &crate::templates::starter_doc(projection, grid_size))?;
    crate::templates::scaffold_game(&game_dir(&id)?, name, projection, grid_size)?;
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
            if let Some(layers) = value.get("layers").and_then(|l| l.as_array()) {
                meta.layer_count = layers.len() as u32;
            }
        }
        write_meta(&meta)?;
    }
    Ok(())
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
