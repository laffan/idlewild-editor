//! The psd-to-json half of the pipeline, ported from Phaser Bench's
//! `psd_processing.rs` and re-pointed at per-project directories.
//!
//! Processing runs against `<project>/psd/<key>.psd` and writes into
//! `<project>/assets/<key>/`, which is exactly the folder shape
//! `P2P.load(scene, key, 'assets/<key>')` expects.

use crate::project::{ImportResult, OutputFile};
use crate::psd_write::AnchorMarks;
use crate::psd_layers;
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

/// One PSD job at a time, whichever thread asked for it.
///
/// These used to be serialised by accident: every Tauri command in this app
/// was synchronous, and a synchronous command runs on the **main thread** —
/// which is also why the whole app froze for the several seconds a rebuild
/// and a parse take, and why a spinner would have sat perfectly still through
/// it. The PSD commands are `#[tauri::command(async)]` now, so they run on
/// the runtime's pool and the window keeps drawing; what that costs is the
/// accident, so the guarantee is written down here instead.
///
/// Coarse on purpose. A job is seconds of CPU over one file, a person drives
/// one at a time, and the failure it rules out — two rebuilds of the same
/// document interleaving, so the second writes over what the first read —
/// loses somebody's layer silently. Every entry point below takes it, and
/// each of them calls `process_held` rather than `process` so it is taken
/// once per job rather than twice per job and deadlocking on the second.
static PIPELINE: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub(crate) fn exclusive() -> std::sync::MutexGuard<'static, ()> {
    // A panic in a job says nothing about the *next* job's file, and refusing
    // to run another one ever again is a worse answer than carrying on.
    PIPELINE.lock().unwrap_or_else(|held| held.into_inner())
}

/// Run psd-to-json over one PSD in a project, streaming progress to `emit_log`
/// so the editor's terminal can show it as it happens.
pub fn process(
    project_id: &str,
    key: &str,
    options: &ProcessOptions,
    emit_log: impl Fn(&str),
) -> Result<String, String> {
    let _job = exclusive();
    process_held(project_id, key, options, emit_log)
}

/// The same, for a caller already holding the lock.
pub(crate) fn process_held(
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
        // A hidden layer is still the project's: it is exported, it is in the
        // manifest marked `visible: false`, and the editor and the game both
        // place it and leave it turned off. Skipping would put the file and
        // the document out of step — a layer the inspector still lists, with
        // no asset behind it — which is the one thing this editor must not do
        // with somebody's artwork. See `psd_layers::write`.
        hidden_layers: psd_to_json::config::HiddenLayers::Include,
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

/// Rewrite the group this editor generated inside a PSD it already wrote,
/// keeping every other layer in the file, and run the pipeline over the
/// result — what a second extrude Apply does.
///
/// Here rather than in the command beside it because of the lock: this is the
/// one whole job that reads a file, rebuilds it and writes it back, and the
/// read and the write have to be inside the same one or a rebuild racing it
/// writes over what this read. Its siblings are all in this file for the same
/// reason.
pub fn rewrite_group_and_process(
    project_id: &str,
    key: &str,
    width: u32,
    height: u32,
    parts: &[crate::psd_write::Part],
    marks: &AnchorMarks,
    emit_log: impl Fn(&str),
) -> Result<ImportResult, String> {
    let _job = exclusive();
    let path = psd_path(project_id, key)?;
    let existing = std::fs::read(&path).map_err(|e| format!("Cannot read {key}.psd: {e}"))?;
    let rebuilt =
        crate::psd_write::rewrite_parts_marked(&existing, key, width, height, parts, marks)?;
    std::fs::write(&path, rebuilt).map_err(|e| format!("Cannot save {key}.psd: {e}"))?;

    // The file's own size: carrying a shape further out grows the canvas.
    let (width, height) = psd_dimensions(&path)?;
    let manifest = process_held(project_id, key, &ProcessOptions::default(), emit_log)?;
    Ok(ImportResult {
        key: key.to_string(),
        width,
        height,
        manifest,
    })
}

/// Import an image or PSD from an OS path, convert if needed, and process it.
pub fn import_and_process(
    project_id: &str,
    source: &Path,
    stem_override: Option<&str>,
    marks: Option<&AnchorMarks>,
    emit_log: impl Fn(&str),
) -> Result<ImportResult, String> {
    let _job = exclusive();
    let psd_dir = store::psd_dir(project_id)?;
    let dest = crate::psd_write::import_file_as_psd(source, &psd_dir, stem_override, marks)?;
    let key = dest
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("Cannot determine the imported key")?
        .to_string();

    let (width, height) = psd_dimensions(&dest)?;
    let manifest = process_held(project_id, &key, &ProcessOptions::default(), emit_log)?;

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
    let _job = exclusive();
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
    let manifest = process_held(project_id, key, &ProcessOptions::default(), emit_log)?;

    Ok(ImportResult {
        key: key.to_string(),
        width,
        height,
        manifest,
    })
}

/// Rename a PSD, and everything named after it, to a new key.
///
/// The key is the file's stem, and it is also the directory psd-to-json
/// writes into and the name psd-to-phaser registers the file under. So a
/// rename is three moves rather than one: the file, then the old output
/// directory out of the way, then a fresh run of the pipeline under the new
/// name. Re-running rather than renaming `assets/<key>/` is the cheaper
/// mistake to avoid — the manifest and the sprites beneath it are written
/// with the key in them, and moving the folder would leave a directory whose
/// contents disagree with its name.
///
/// The layer *inside* the file keeps whatever it was called. A placement
/// points at its layer by name, and renaming the file is not a claim about
/// what is in it — so every placement on the old key survives the move by
/// having its key rewritten and nothing else.
pub fn rename_and_process(
    project_id: &str,
    key: &str,
    to: &str,
    emit_log: impl Fn(&str),
) -> Result<ImportResult, String> {
    let _job = exclusive();
    let key = safe_key(key)?;
    let to = safe_key(to)?;
    if key == to {
        return Err("That is already its name".into());
    }

    let source = psd_path(project_id, key)?;
    if !source.exists() {
        return Err(format!("No PSD named {key} in this project"));
    }
    let dest = psd_path(project_id, to)?;
    if dest.exists() {
        return Err(format!("This project already has a {to}.psd"));
    }

    std::fs::rename(&source, &dest).map_err(|e| format!("Cannot rename {key}.psd: {e}"))?;
    let old_output = output_dir(project_id, key)?;
    if old_output.exists() {
        let _ = std::fs::remove_dir_all(&old_output);
    }

    let (width, height) = psd_dimensions(&dest)?;
    let mut manifest = process_held(project_id, to, &ProcessOptions::default(), &emit_log)?;

    // A converted image, a rasterised sketch and a generated PSD all name
    // their one sprite layer after the key. Renaming the file leaves that
    // layer holding the old name, which the layers panel then shows in its
    // detail column beside the new one — so the layer follows the file, and
    // the manifest is taken from the rewrite rather than from the parse
    // above. Only a layer that was named after the file moves; a stack
    // someone built in Photoshop keeps its own names, and a file this cannot
    // rewrite at all is left alone.
    if psd_layers::rename_layers_named_after(project_id, to, key, to, &emit_log)? {
        manifest = read_manifest(project_id, to)?;
    }

    Ok(ImportResult {
        key: to.to_string(),
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
    let _job = exclusive();
    let key = safe_key(key)?;
    let source = psd_path(project_id, key)?;
    if !source.exists() {
        return Err(format!("No PSD named {key} in this project"));
    }

    let copy = next_free_key(project_id, key)?;
    std::fs::copy(&source, psd_path(project_id, &copy)?)
        .map_err(|e| format!("Cannot copy {key}.psd: {e}"))?;

    let (width, height) = psd_dimensions(&source)?;
    let manifest = process_held(project_id, &copy, &ProcessOptions::default(), emit_log)?;
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

/// A PSD's canvas size, read back from the file that was just written.
pub fn psd_dimensions(path: &Path) -> Result<(u32, u32), String> {
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
