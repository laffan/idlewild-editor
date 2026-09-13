//! **Export Assets**: some of a project's PSDs, on their own.
//!
//! Publish has always had two exits and neither of them is this one. *Export
//! site* is a runnable game and *Export project* is the whole project as a
//! `.idlewild`; both are all-or-nothing, and both hand back something that is
//! only useful to a program. What was missing is the artwork: the sprite sheets
//! a tileset was sliced into, so they can go into another engine, and the source
//! PSDs, so a file drawn on an iPad can be opened on a desktop.
//!
//! So this takes a **list of keys** and says, per key, whether to write the
//! processed output, the source file, or both. The shapes inside the archive are
//! the store's own — `psd/<key>.psd` and `assets/<key>/…` — because that is the
//! layout every other part of this app already describes, and a second one
//! invented for the zip would be a second thing to learn.
//!
//! A key the project has not got is skipped rather than failed on. The list
//! comes from a picker built from `list`, so the only way to ask for a missing
//! one is to have deleted it between opening the sheet and pressing the button —
//! and losing the other nine files to that is not a trade worth making. What
//! *is* an error is an archive with nothing in it, which would otherwise be a
//! zip somebody has to open to discover was empty.

use crate::{psd_pipeline, store};
use std::io::Write;
use std::path::Path;
use zip::write::SimpleFileOptions;

/// **Export Assets**: the command the menu item reaches.
///
/// Written straight to the path the save dialog gave, like the two exports
/// beside it. The dialog hands back a `file://` URL on iPadOS rather than a
/// path, which is what `source_path` is for.
#[tauri::command]
pub fn export_assets_zip(
    id: String,
    path: String,
    keys: Vec<String>,
    assets: bool,
    psds: bool,
) -> Result<(), String> {
    write_zip(
        &id,
        &keys,
        Wanted { assets, psds },
        &crate::psd_write::source_path(&path),
    )
}

/// Every PSD in a project, for the picker Export Assets opens with.
#[tauri::command]
pub fn list_project_psds(id: String) -> Result<Vec<PsdSummary>, String> {
    list(&id)
}

/// One of a project's PSDs, as the picker lists it.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PsdSummary {
    /// The key, which is the filename without `.psd`.
    pub key: String,
    /// Size of the source file, for the "what am I about to export" line.
    pub bytes: u64,
    /// Whether the pipeline has run over it, so there is anything generated to
    /// export. A file written but never processed has none.
    #[serde(rename = "hasAssets")]
    pub has_assets: bool,
}

/// Every PSD in a project's `psd/`, by key, alphabetically.
///
/// Read off the directory rather than out of the document, and deliberately: a
/// file whose placement has been deleted is still a file somebody drew, and the
/// point of this export is to get artwork out. The document's own list would
/// quietly refuse to hand back the one thing that cannot be recovered any other
/// way.
pub fn list(project_id: &str) -> Result<Vec<PsdSummary>, String> {
    let dir = store::psd_dir(project_id)?;
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
    {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("psd") {
            continue;
        }
        let Some(key) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        out.push(PsdSummary {
            key: key.to_string(),
            bytes: entry.metadata().map(|m| m.len()).unwrap_or(0),
            has_assets: psd_pipeline::is_processed(project_id, key),
        });
    }
    out.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(out)
}

/// What to put in the archive.
#[derive(Debug, Clone, Copy)]
pub struct Wanted {
    /// The pipeline's output: `data.json` and the sprites and tiles beside it.
    pub assets: bool,
    /// The source `.psd` itself.
    pub psds: bool,
}

/// Build the zip and write it where the user asked for it.
///
/// In memory first, like `publish::write_zip` and for the same reason: the
/// archive writer wants a seekable sink, and the bytes go to disk from here
/// rather than back across the IPC boundary as base64.
pub fn write_zip(
    project_id: &str,
    keys: &[String],
    wanted: Wanted,
    dest: &Path,
) -> Result<(), String> {
    let bytes = build_zip(project_id, keys, wanted)?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(dest, bytes).map_err(|e| format!("Cannot write {dest:?}: {e}"))
}

pub fn build_zip(project_id: &str, keys: &[String], wanted: Wanted) -> Result<Vec<u8>, String> {
    if keys.is_empty() {
        return Err("Nothing selected to export".into());
    }
    if !wanted.assets && !wanted.psds {
        return Err("Choose the generated assets, the source PSDs, or both".into());
    }

    let meta = store::read_meta(project_id)?;
    let root = crate::publish::sanitise_name(&meta.name);
    let mut buf = Vec::new();
    let mut written = 0usize;
    {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        for key in keys {
            // A bad key is the picker's problem, not the archive's — and an
            // invalid one cannot reach a path from here either way.
            let Ok(source) = psd_pipeline::psd_path(project_id, key) else {
                continue;
            };
            if wanted.psds && source.is_file() {
                let bytes =
                    std::fs::read(&source).map_err(|e| format!("Cannot read {key}.psd: {e}"))?;
                zip.start_file(format!("{root}/psd/{key}.psd"), options)
                    .map_err(|e| e.to_string())?;
                zip.write_all(&bytes).map_err(|e| e.to_string())?;
                written += 1;
            }
            if wanted.assets {
                let Ok(dir) = psd_pipeline::output_dir(project_id, key) else {
                    continue;
                };
                if dir.is_dir() {
                    written += add_dir(&mut zip, &dir, &format!("{root}/assets/{key}/"), options)?;
                }
            }
        }

        if written == 0 {
            return Err(
                "None of those PSDs have anything to export — the files may have \
                 been renamed or deleted since this sheet was opened."
                    .into(),
            );
        }

        zip.finish().map_err(|e| e.to_string())?;
    }
    Ok(buf)
}

/// Copy a directory into the archive, and say how many files that was.
fn add_dir<W: Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    dir: &Path,
    prefix: &str,
    options: SimpleFileOptions,
) -> Result<usize, String> {
    let mut written = 0;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(current) = stack.pop() {
        for entry in std::fs::read_dir(&current)
            .map_err(|e| e.to_string())?
            .flatten()
        {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let rel = path
                .strip_prefix(dir)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
            zip.start_file(format!("{prefix}{rel}"), options)
                .map_err(|e| e.to_string())?;
            zip.write_all(&bytes).map_err(|e| e.to_string())?;
            written += 1;
        }
    }
    Ok(written)
}
