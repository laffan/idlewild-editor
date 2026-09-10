//! The psd-to-json half of the pipeline, ported from Phaser Bench's
//! `psd_processing.rs` and re-pointed at per-project directories.
//!
//! Processing runs against `<project>/psd/<key>.psd` and writes into
//! `<project>/assets/<key>/`, which is exactly the folder shape
//! `P2P.load(scene, key, 'assets/<key>')` expects.

use crate::project::{ImportResult, OutputFile};
use crate::psd_write::AnchorMarks;
use crate::store;
use serde::Deserialize;
use std::path::{Path, PathBuf};

/// Processing knobs. Import and re-import both run with the defaults; the
/// struct is the seam for surfacing them once there is a UI for it.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct ProcessOptions {
    #[serde(rename = "tileSliceSize")]
    pub tile_slice_size: Option<u32>,
    #[serde(rename = "tileScaledVersions")]
    pub tile_scaled_versions: Option<Vec<u32>>,
    #[serde(rename = "pngQualityLow")]
    pub png_quality_low: Option<u8>,
    #[serde(rename = "pngQualityHigh")]
    pub png_quality_high: Option<u8>,
    #[serde(rename = "jpgQuality")]
    pub jpg_quality: Option<u8>,
    #[serde(rename = "ignoreLayers")]
    pub ignore_layers: Option<Vec<String>>,
    #[serde(rename = "metadataOnly")]
    pub metadata_only: Option<bool>,
}

/// Reject anything that would not survive being a file name.
///
/// Keys are produced by `psd_write::sanitise_stem` on import, but they reach
/// these functions from the document — a JSON file on disk — and now also
/// name a path the system is asked to open, so they are checked again here
/// rather than trusted the second time around.
pub fn safe_key(key: &str) -> Result<&str, String> {
    let ok = !key.is_empty()
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(key)
    } else {
        Err(format!("Invalid PSD key: {key}"))
    }
}

pub fn psd_path(project_id: &str, key: &str) -> Result<PathBuf, String> {
    Ok(store::psd_dir(project_id)?.join(format!("{}.psd", safe_key(key)?)))
}

pub fn output_dir(project_id: &str, key: &str) -> Result<PathBuf, String> {
    Ok(store::assets_dir(project_id)?.join(safe_key(key)?))
}

pub fn manifest_path(project_id: &str, key: &str) -> Result<PathBuf, String> {
    Ok(output_dir(project_id, key)?.join("data.json"))
}

pub fn is_processed(project_id: &str, key: &str) -> bool {
    manifest_path(project_id, key)
        .map(|p| p.exists())
        .unwrap_or(false)
}

pub fn read_manifest(project_id: &str, key: &str) -> Result<String, String> {
    std::fs::read_to_string(manifest_path(project_id, key)?)
        .map_err(|e| format!("Cannot read manifest for {key}: {e}"))
}

/// Run psd-to-json over one PSD in a project, streaming progress to `emit_log`
/// so the editor's terminal can show it as it happens.
pub fn process(
    project_id: &str,
    key: &str,
    options: &ProcessOptions,
    emit_log: impl Fn(&str),
) -> Result<String, String> {
    let source = psd_path(project_id, key)?;
    if !source.exists() {
        return Err(format!("No PSD named {key} in this project"));
    }

    // Clear the previous run so stale sprites never outlive a re-import.
    let out = output_dir(project_id, key)?;
    if out.exists() {
        let _ = std::fs::remove_dir_all(&out);
    }
    let assets_root = store::assets_dir(project_id)?;

    emit_log(&format!("Parsing psd/{key}.psd"));

    let config = psd_to_json::Config {
        output_dir: assets_root.display().to_string(),
        psd_files: vec![source.display().to_string()],
        tile_slice_size: options.tile_slice_size.unwrap_or(512),
        tile_scaled_versions: options.tile_scaled_versions.clone().unwrap_or_default(),
        generate_on_save: false,
        png_quality_range: psd_to_json::config::PngQualityRange {
            low: options.png_quality_low.unwrap_or(45),
            high: options.png_quality_high.unwrap_or(65),
        },
        jpg_quality: options.jpg_quality.unwrap_or(85),
        ignore_layers: options.ignore_layers.clone().unwrap_or_default(),
        metadata_only: options.metadata_only.unwrap_or(false),
    };

    let base = Path::new("/");
    let data = psd_to_json::process_all_psds(&config, base)
        .map_err(|e| format!("psd-to-json failed: {e}"))?;

    for psd_data in data.values() {
        if let Some(object) = psd_data.as_object() {
            emit_log(&psd_to_json::format_layer_tree(object));
        }
    }

    psd_to_json::write_json_output(&data, &config, base)
        .map_err(|e| format!("Cannot write manifest: {e}"))?;

    emit_log(&format!("Wrote assets/{key}/data.json"));
    read_manifest(project_id, key)
}

/// Import an image or PSD from an OS path, convert if needed, and process it.
pub fn import_and_process(
    project_id: &str,
    source: &Path,
    stem_override: Option<&str>,
    marks: Option<&AnchorMarks>,
    emit_log: impl Fn(&str),
) -> Result<ImportResult, String> {
    let psd_dir = store::psd_dir(project_id)?;
    let dest = crate::psd_write::import_file_as_psd(source, &psd_dir, stem_override, marks)?;
    let key = dest
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("Cannot determine the imported key")?
        .to_string();

    let (width, height) = psd_dimensions(&dest)?;
    let manifest = process(project_id, &key, &ProcessOptions::default(), emit_log)?;

    Ok(ImportResult {
        key,
        width,
        height,
        manifest,
    })
}

/// Replace the PSD behind an existing key, then run the pipeline over it.
///
/// The key does not change, so every placement already pointing at it keeps
/// pointing at it — that is what makes this a re-import rather than a second
/// import that happens to look similar. `process` clears the previous output
/// directory first, so nothing from the old file outlives the new one.
pub fn reimport_and_process(
    project_id: &str,
    key: &str,
    source: &Path,
    emit_log: impl Fn(&str),
) -> Result<ImportResult, String> {
    let key = safe_key(key)?;
    if !psd_path(project_id, key)?.exists() {
        return Err(format!("No PSD named {key} in this project"));
    }

    let psd_dir = store::psd_dir(project_id)?;
    // Forcing the stem to the existing key is what overwrites `<key>.psd`
    // instead of adding a second file named after whatever was picked.
    // No marks on a re-import: the file coming back is the one the artist
    // has been working in, and it already carries whatever the first import
    // put there — or whatever they moved it to, which is the point.
    let dest = crate::psd_write::import_file_as_psd(source, &psd_dir, Some(key), None)?;
    let (width, height) = psd_dimensions(&dest)?;
    let manifest = process(project_id, key, &ProcessOptions::default(), emit_log)?;

    Ok(ImportResult {
        key: key.to_string(),
        width,
        height,
        manifest,
    })
}

/// Copy a PSD to the next free key beside it and process that.
///
/// The new key is the old one plus `-copy`, then `-copy-2` and so on — a
/// name someone reading the project directory can follow back to what it
/// came from.
pub fn duplicate_and_process(
    project_id: &str,
    key: &str,
    emit_log: impl Fn(&str),
) -> Result<ImportResult, String> {
    let key = safe_key(key)?;
    let source = psd_path(project_id, key)?;
    if !source.exists() {
        return Err(format!("No PSD named {key} in this project"));
    }

    let copy = next_free_key(project_id, key)?;
    std::fs::copy(&source, psd_path(project_id, &copy)?)
        .map_err(|e| format!("Cannot copy {key}.psd: {e}"))?;

    let (width, height) = psd_dimensions(&source)?;
    let manifest = process(project_id, &copy, &ProcessOptions::default(), emit_log)?;
    Ok(ImportResult {
        key: copy,
        width,
        height,
        manifest,
    })
}

fn next_free_key(project_id: &str, key: &str) -> Result<String, String> {
    let base = format!("{key}-copy");
    for n in 1..1000 {
        let candidate = if n == 1 {
            base.clone()
        } else {
            format!("{base}-{n}")
        };
        if !psd_path(project_id, &candidate)?.exists() {
            return Ok(candidate);
        }
    }
    Err(format!("Too many copies of {key}"))
}

fn psd_dimensions(path: &Path) -> Result<(u32, u32), String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Cannot read PSD: {e}"))?;
    let doc = psd::Psd::from_bytes(&bytes).map_err(|e| format!("Cannot parse PSD: {e}"))?;
    Ok((doc.width(), doc.height()))
}

pub fn list_output_files(project_id: &str, key: &str) -> Result<Vec<OutputFile>, String> {
    let dir = output_dir(project_id, key)?;
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut files = Vec::new();
    collect(&dir, &dir, &mut files);
    files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(files)
}

fn collect(root: &Path, dir: &Path, out: &mut Vec<OutputFile>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(root, &path, out);
            continue;
        }
        let relative_path = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let is_json = path.extension().and_then(|e| e.to_str()) == Some("json");
        out.push(OutputFile {
            absolute_path: path.display().to_string(),
            relative_path,
            filename: path
                .file_name()
                .and_then(|f| f.to_str())
                .unwrap_or_default()
                .to_string(),
            is_json,
        });
    }
}

/// A data URL for one output image, used by the inspector's thumbnails.
pub fn thumbnail(path: &str, max_size: u32) -> Result<String, String> {
    let img = image::open(path).map_err(|e| format!("Cannot open image: {e}"))?;
    crate::psd_write::png_data_url(&img.thumbnail(max_size, max_size))
}
