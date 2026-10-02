//! Where a print project's exports land, and the two ways out of the app.
//!
//! `ExportForPrint({ folder, name })` names its files, so a piece that prints
//! twenty-four frames of an animation gets twenty-four files with names it
//! chose. They are written inside the project — `exports/<folder>/<name>.pdf`
//! — and nowhere else: the project's code runs in a web page, and a page that
//! could write to any path on the disk would be the one thing a sandboxed
//! editor must not hand it. Getting them out is the person's decision, through
//! the platform's own save dialog: one file at a time, or every file a run
//! wrote as one zip.

use crate::store;
use std::io::Write;
use std::path::PathBuf;

/// The folder inside a project that exports are written to.
pub const EXPORTS_DIR: &str = "exports";

/// Where one export goes: its path inside the project, and on the disk.
///
/// `out` is the folder and name `print.js` sent, without an extension. Each
/// segment is reduced to letters, digits, `-` and `_` — the same rule a PSD's
/// key follows — so nothing a page sends can climb out of `exports/` or name a
/// file the platform will refuse. An empty one is `page`.
pub fn export_path(id: &str, out: Option<&str>, ext: &str) -> Result<(String, PathBuf), String> {
    let segments: Vec<String> = out
        .unwrap_or("")
        .split('/')
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "." && *s != "..")
        .map(crate::psd_write::sanitise_stem)
        .collect();
    let rel_stem = if segments.is_empty() {
        "page".to_string()
    } else {
        segments.join("/")
    };
    let rel = format!("{EXPORTS_DIR}/{rel_stem}.{ext}");
    let path = store::project_dir(id)?.join(store::safe_relative(&rel)?);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok((rel, path))
}

/// One export's file, from a path the editor was handed by an export.
fn exported(id: &str, rel: &str) -> Result<PathBuf, String> {
    if !rel.starts_with(&format!("{EXPORTS_DIR}/")) {
        return Err(format!("Not an export: {rel}"));
    }
    let path = store::project_dir(id)?.join(store::safe_relative(rel)?);
    if !path.is_file() {
        return Err(format!("{rel} is not there any more"));
    }
    Ok(path)
}

/// Copy one export to where the save dialog said.
#[tauri::command]
pub fn save_print_file(id: String, rel: String, path: String) -> Result<(), String> {
    let from = exported(&id, &rel)?;
    let dest = crate::psd_write::source_path(&path);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::copy(&from, &dest)
        .map(|_| ())
        .map_err(|e| format!("Cannot save {rel}: {e}"))
}

/// Several exports as one zip, laid out as they are under `exports/` — what
/// Save all hands over after a run that printed more than one file.
#[tauri::command]
pub fn save_print_files(id: String, rels: Vec<String>, path: String) -> Result<(), String> {
    let dest = crate::psd_write::source_path(&path);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let file = std::fs::File::create(&dest).map_err(|e| format!("Cannot write {dest:?}: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    // Stored rather than deflated: a PDF's images and a PSD's channels are
    // compressed already, and squeezing them again is time for nothing.
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    let mut seen: Vec<&str> = Vec::new();
    for rel in &rels {
        if seen.contains(&rel.as_str()) {
            continue;
        }
        seen.push(rel);
        let from = exported(&id, rel)?;
        let name = rel.trim_start_matches(&format!("{EXPORTS_DIR}/"));
        zip.start_file(name, options).map_err(|e| e.to_string())?;
        let bytes = std::fs::read(&from).map_err(|e| format!("Cannot read {rel}: {e}"))?;
        zip.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_cannot_name_a_path_outside_exports() {
        let meta = store::create_project(
            "Paths",
            crate::project::Projection::Blank,
            crate::project::Scaffold::P2p,
            64,
            crate::project::GameOptions::default(),
        )
        .unwrap();
        let id = meta.id.clone();
        let result = std::panic::catch_unwind(|| {
            let (rel, _) = export_path(&id, Some("frames/frame 01"), "pdf").unwrap();
            assert_eq!(rel, "exports/frames/frame_01.pdf");
            let (rel, _) = export_path(&id, Some("../../etc/passwd"), "pdf").unwrap();
            assert_eq!(rel, "exports/etc/passwd.pdf");
            let (rel, _) = export_path(&id, None, "psd").unwrap();
            assert_eq!(rel, "exports/page.psd");
            assert!(exported(&id, "game/index.html").is_err());
            assert!(exported(&id, "exports/../meta.json").is_err());
        });
        let _ = store::delete_project(&id);
        if let Err(panic) = result {
            std::panic::resume_unwind(panic);
        }
    }
}
