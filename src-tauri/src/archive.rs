//! `.idlewild` — a whole project, as one file.
//!
//! Publish has two exits and they answer different questions. **Export site**
//! is a zip you can serve: the game, its processed assets, the two runtimes,
//! and nothing you would edit it with. **Export project** is this one — the
//! project itself, so it can be opened somewhere else and carried on with.
//! The source PSDs are the difference, and they are the part you cannot get
//! back from a published site.
//!
//! What travels:
//!
//! ```text
//! <name>.idlewild            (a zip)
//!   idlewild.json            format, app version, and the project's own fields
//!   doc.json                 layers, fills, placements, zones, strokes, extrusions
//!   thumbnail.png            if one has been taken
//!   psd/                     the source files — the reason this format exists
//!   assets/                  psd-to-json's output, so an import opens without a re-parse
//!   game/                    the project's own code, as it was edited
//! ```
//!
//! **Extrusions travel in `doc.json`.** `GameDoc.extrusions` is a map from PSD
//! key to the voxels the solid was built from and the space it was anchored
//! to, and an extruded layer's way back into extrude mode is that record plus
//! the PSD it wrote. Both are in the archive, and the keys are file stems
//! rather than anything about this install, so a re-opened project can still
//! take hold of a face and pull it. A test pins that.
//!
//! **`meta.json` does not travel.** A project's id is a fact about the store
//! it lives in — it is a directory name — and carrying one across would be a
//! second source of truth for where a project lives. The fields worth keeping
//! are in the manifest, and an import writes a fresh `meta.json` around them.

use crate::project::{now_ms, Genre, ProjectMeta, Projection};
use crate::store;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use zip::write::SimpleFileOptions;

/// The manifest, at the root of every archive.
const MANIFEST: &str = "idlewild.json";

/// What this build writes, and the highest it knows how to read.
///
/// A file from a later build is refused by name rather than half-read: an
/// archive that silently dropped whatever it did not understand would look
/// like a project that had lost work.
const FORMAT: u32 = 1;

/// Directories carried whole, and files carried by name.
///
/// One list, read in both directions: an export puts nothing else in, and an
/// import takes nothing else out. That second half is the guard — a `.idlewild`
/// is an untrusted zip, and this is what stops one writing where it likes.
const CARRIED_DIRS: [&str; 3] = ["psd/", "assets/", "game/"];
const CARRIED_FILES: [&str; 2] = ["doc.json", "thumbnail.png"];

/// Ceilings on what an import will unpack, so a hostile or broken file cannot
/// fill the disk. A project of a few hundred PSDs is nowhere near either.
const MAX_ENTRIES: usize = 20_000;
const MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
pub struct Manifest {
    pub format: u32,
    /// Which build wrote it. Never read for a decision — the format number is
    /// what decides — but the first thing anyone asks of a file that will not
    /// open.
    pub app: String,
    #[serde(rename = "exportedAt")]
    pub exported_at: u64,
    pub project: ArchivedProject,
}

/// A project's own fields, minus the id.
#[derive(Debug, Serialize, Deserialize)]
pub struct ArchivedProject {
    pub name: String,
    pub projection: Projection,
    #[serde(default)]
    pub genre: Genre,
    #[serde(rename = "gridSize")]
    pub grid_size: u32,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
    #[serde(rename = "layerCount", default)]
    pub layer_count: u32,
}

/// Write a project to `dest` as a `.idlewild` file.
///
/// Streamed to the path rather than handed back as bytes: a project carries
/// its source PSDs, and base64 across the IPC boundary would be the archive
/// again half as big on top of itself.
pub fn export(project_id: &str, dest: &Path) -> Result<(), String> {
    let meta = store::read_meta(project_id)?;
    // The document is the thing being exported, so the file derived from it
    // goes out level with it rather than a save behind.
    let _ = store::sync_game_config(project_id);

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let file = File::create(dest).map_err(|e| format!("Cannot write {dest:?}: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let manifest = Manifest {
        format: FORMAT,
        app: format!("Idlewild {}", env!("CARGO_PKG_VERSION")),
        exported_at: now_ms(),
        project: ArchivedProject {
            name: meta.name.clone(),
            projection: meta.projection,
            genre: meta.genre,
            grid_size: meta.grid_size,
            created_at: meta.created_at,
            layer_count: meta.layer_count,
        },
    };
    zip.start_file(MANIFEST, options).map_err(|e| e.to_string())?;
    zip.write_all(
        serde_json::to_string_pretty(&manifest)
            .map_err(|e| e.to_string())?
            .as_bytes(),
    )
    .map_err(|e| e.to_string())?;

    let root = store::project_dir(project_id)?;
    for rel in walk(&root)? {
        if !carried(&rel) {
            continue;
        }
        let bytes = std::fs::read(root.join(&rel)).map_err(|e| e.to_string())?;
        zip.start_file(&rel, options).map_err(|e| e.to_string())?;
        zip.write_all(&bytes).map_err(|e| e.to_string())?;
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

/// Read a `.idlewild` file into a new project, and return it.
///
/// A fresh id every time, so importing the same file twice gives two
/// projects rather than one overwriting the other. `updatedAt` is now — the
/// project was last written to disk by this import, and the home screen sorts
/// by it, so an import you just made should be the one at the top.
pub fn import(src: &Path) -> Result<ProjectMeta, String> {
    let file = File::open(src).map_err(|e| format!("Cannot read {src:?}: {e}"))?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|e| format!("This is not a readable .idlewild file: {e}"))?;

    let manifest = read_manifest(&mut zip)?;
    if manifest.format > FORMAT {
        return Err(format!(
            "This project was exported by a newer Idlewild (format {}, this build reads {FORMAT})",
            manifest.format
        ));
    }
    if zip.len() > MAX_ENTRIES {
        return Err(format!("This archive holds {} files, which is more than Idlewild will unpack", zip.len()));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let root = store::project_dir(&id)?;
    // Anything that goes wrong from here leaves a half-written directory, and
    // a half-written project in the list is worse than a failed import.
    match unpack(&mut zip, &root).and_then(|_| finish(&id, &manifest)) {
        Ok(meta) => Ok(meta),
        Err(err) => {
            let _ = std::fs::remove_dir_all(&root);
            Err(err)
        }
    }
}

fn read_manifest<R: Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
) -> Result<Manifest, String> {
    let mut entry = zip
        .by_name(MANIFEST)
        .map_err(|_| "This file has no idlewild.json — it is not an Idlewild project".to_string())?;
    let mut text = String::new();
    entry
        .read_to_string(&mut text)
        .map_err(|e| format!("Cannot read this archive's manifest: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("This archive's manifest is not readable: {e}"))
}

fn unpack<R: Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
    root: &Path,
) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let mut written: u64 = 0;

    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        // `enclosed_name` is the zip crate's own refusal of absolute paths and
        // `..`; `carried` is ours, and narrows it to the five things an
        // archive is allowed to be made of.
        let Some(name) = entry.enclosed_name() else {
            continue;
        };
        let rel = name.to_string_lossy().replace('\\', "/");
        if !carried(&rel) {
            continue;
        }

        written = written.saturating_add(entry.size());
        if written > MAX_BYTES {
            return Err("This archive unpacks to more than Idlewild will write".into());
        }

        let path = root.join(&rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = File::create(&path).map_err(|e| format!("Cannot write {rel}: {e}"))?;
        std::io::copy(&mut entry, &mut out).map_err(|e| format!("Cannot write {rel}: {e}"))?;
    }
    Ok(())
}

/// Give the unpacked directory the things an archive does not carry: its own
/// `meta.json`, a `game/` tree if it arrived without one, and a config level
/// with the document it came in with.
fn finish(id: &str, manifest: &Manifest) -> Result<ProjectMeta, String> {
    let project = &manifest.project;
    let mut meta = ProjectMeta::new(
        id.to_string(),
        project.name.clone(),
        project.projection,
        project.genre,
        project.grid_size,
    );
    meta.created_at = project.created_at;
    meta.updated_at = now_ms();
    meta.layer_count = project.layer_count;
    store::write_meta(&meta)?;

    if !store::game_dir(id)?.join("index.html").exists() {
        crate::templates::scaffold_game(
            &store::game_dir(id)?,
            &project.name,
            project.projection,
            project.genre,
            project.grid_size,
        )?;
    }
    // Not fatal: a document this build cannot parse still opens as a project,
    // and the editor will say so far more usefully than an import would.
    let _ = store::sync_game_config(id);
    Ok(meta)
}

/// Whether a path inside the project directory belongs in an archive — and,
/// read the other way, whether one out of an archive belongs on disk.
fn carried(rel: &str) -> bool {
    CARRIED_FILES.contains(&rel) || CARRIED_DIRS.iter().any(|dir| rel.starts_with(dir))
}

/// Every file under `root`, as paths relative to it with `/` separators.
fn walk(root: &Path) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(current) = stack.pop() {
        let entries = match std::fs::read_dir(&current) {
            Ok(entries) => entries,
            // A project with no `psd/` yet is not an error; it is a project
            // with nothing imported into it.
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            out.push(
                path.strip_prefix(root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/"),
            );
        }
    }
    out.sort();
    Ok(out)
}
