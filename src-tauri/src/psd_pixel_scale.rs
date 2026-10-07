//! Pixel Art Rescale: a PSD processed bigger than it is, nearest neighbour.
//!
//! Pixel art is drawn small and wants to be shown big without going soft. A
//! 64-pixel sprite on a high-resolution web page, or on a 300 DPI sheet, is
//! either tiny or — scaled up by whoever draws it — blurred. So a PSD can be
//! given a whole-number factor, kept in `ProjectMeta::pixel_scale`, and every
//! time the pipeline runs over it the file is first copied that many times
//! bigger, every pixel a hard-edged block, and the copy is what psd-to-json
//! parses. The sprites in `assets/` (and `print/`) are the big ones; the PSD
//! in `psd/` is never touched, so editing it — in Photoshop, or in PSD Edit
//! mode — is still editing pixel art.
//!
//! Being applied inside `process_held` is what makes it stick: every path
//! that re-parses a file — an edit coming home, a layer renamed, a stack
//! reordered — goes through there, so none of them has to know.

use std::path::{Path, PathBuf};

use crate::project::ProjectMeta;
use crate::psd_pipeline::{process_held, safe_key, ProcessOptions};
use crate::store;

/// The largest factor offered. Sixteen times a 64-pixel sprite is a
/// thousand pixels, and a bigger file than that is not what this is for.
pub const MAX_FACTOR: u32 = 16;

/// The widest file the copy may become — what a PSD can hold on a side.
const MAX_SIDE: u64 = 30_000;

/// A file's factor, or 1 for one left at its own size.
pub fn factor_of(meta: &ProjectMeta, key: &str) -> u32 {
    meta.pixel_scale
        .get(key)
        .copied()
        .filter(|f| (2..=MAX_FACTOR).contains(f))
        .unwrap_or(1)
}

/// Where the bigger copy of a file is written while it is parsed. Named as
/// the file is, because psd-to-json names its output after the file.
fn copy_path(project_id: &str, key: &str) -> Result<PathBuf, String> {
    Ok(store::project_dir(project_id)?
        .join(".pixel")
        .join(format!("{}.psd", safe_key(key)?)))
}

/// The bytes made `factor` times bigger, refusing a file that would come
/// out larger than a PSD can be.
pub fn enlarged(bytes: &[u8], factor: u32) -> Result<Vec<u8>, String> {
    let doc = psd::Psd::from_bytes(bytes).map_err(|e| format!("Cannot read the PSD: {e}"))?;
    let side = u64::from(doc.width().max(doc.height())) * u64::from(factor);
    if side > MAX_SIDE {
        return Err(format!(
            "At {factor}× this file would be {side} pixels across — more than a PSD can hold"
        ));
    }
    crate::psd_downsample::upscale_nearest(bytes, factor).map(|(big, _)| big)
}

/// Write the bigger copy of `bytes` beside the project and say where it is.
pub fn write_copy(project_id: &str, key: &str, bytes: &[u8], factor: u32) -> Result<PathBuf, String> {
    let big = enlarged(bytes, factor)?;
    let path = copy_path(project_id, key)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, big).map_err(|e| format!("Cannot write the rescaled copy: {e}"))?;
    Ok(path)
}

/// Take the copy away once it has been parsed.
pub fn remove_copy(path: &Path) {
    let _ = std::fs::remove_file(path);
}

/// Set a file's factor — 1 (or 0) for its own size — and process it again.
/// Hands back the new manifest.
pub fn set(project_id: &str, key: &str, factor: u32, emit_log: impl Fn(&str)) -> Result<String, String> {
    let key = safe_key(key)?;
    let factor = if factor <= 1 { 1 } else { factor };
    if factor > MAX_FACTOR {
        return Err(format!("Pixel art upscale goes up to {MAX_FACTOR}×"));
    }
    let _job = crate::psd_pipeline::exclusive();
    let mut meta = store::read_meta(project_id)?;
    let before = factor_of(&meta, key);
    if factor == 1 {
        meta.pixel_scale.remove(key);
    } else {
        meta.pixel_scale.insert(key.to_string(), factor);
    }
    store::write_meta(&meta)?;
    let processed = process_held(project_id, key, &ProcessOptions::default(), &emit_log);
    if processed.is_err() {
        // A factor that cannot be processed is put back, so the file still
        // has assets made the way the meta says they were.
        if before == 1 {
            meta.pixel_scale.remove(key);
        } else {
            meta.pixel_scale.insert(key.to_string(), before);
        }
        let _ = store::write_meta(&meta);
        let _ = process_held(project_id, key, &ProcessOptions::default(), &emit_log);
    }
    processed
}

/// Pixel Art Downsample: rewrite the PSD itself at `factor` (under one) of
/// its size, nearest neighbour, set its upscale to `upscale`, and process it.
/// Unlike the upscale this changes the file — it is for pixel art that was
/// drawn big, which the upscale can then show sharp at the size it was.
/// Refused on a file a rebuild would lose something from. Hands back the
/// new manifest.
///
/// `maintain` is the sheet's **Maintain canvas size**, and a file may have it
/// once. After the first, the file's pixels *are* the art's pixels, and the
/// upscale set beside them is what keeps it its size on the canvas. A second
/// pass throws away some of those real pixels, and its upscale replaces the
/// first rather than multiplying it — so the canvas can only keep the size by
/// stretching the placement by a factor the upscale did not account for,
/// which is a smooth resample of hard-edged pixels: fuzzy edges. Recorded in
/// `ProjectMeta::downsample_kept` and refused here, not only in the sheet.
pub fn downsample(
    project_id: &str,
    key: &str,
    factor: f64,
    upscale: u32,
    maintain: bool,
    emit_log: impl Fn(&str),
) -> Result<String, String> {
    let key = safe_key(key)?;
    if !factor.is_finite() || factor <= 0.01 || factor >= 1.0 {
        return Err("Downsample takes a size between 0.01 and 1".into());
    }
    if upscale > MAX_FACTOR {
        return Err(format!("Pixel art upscale goes up to {MAX_FACTOR}×"));
    }
    let _job = crate::psd_pipeline::exclusive();
    if maintain && store::read_meta(project_id)?.downsample_kept.contains(key) {
        return Err(format!(
            "{key}.psd has already been downsampled with Maintain canvas size, \
             which a PSD can only do once"
        ));
    }
    let path = crate::psd_pipeline::psd_path(project_id, key)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read {key}.psd: {e}"))?;
    let (small, lost) = crate::psd_downsample::shrink_nearest(&bytes, 1.0 / factor)?;
    if let Some(reason) = lost {
        return Err(format!("{key}.psd cannot be downsampled without losing something: {reason}"));
    }
    std::fs::write(&path, small).map_err(|e| format!("Cannot save {key}.psd: {e}"))?;
    emit_log(&format!("Downsampled psd/{key}.psd to {factor:.2} of its size"));
    let mut meta = store::read_meta(project_id)?;
    if upscale <= 1 {
        meta.pixel_scale.remove(key);
    } else {
        meta.pixel_scale.insert(key.to_string(), upscale);
    }
    if maintain {
        meta.downsample_kept.insert(key.to_string());
    }
    store::write_meta(&meta)?;
    process_held(project_id, key, &ProcessOptions::default(), &emit_log)
}

/// A file renamed or copied takes its factor with it, and whether it has
/// already been downsampled with Maintain canvas size — a copy is the same
/// pixels, so it has.
pub fn carry(project_id: &str, from: &str, to: &str, moved: bool) {
    let Ok(mut meta) = store::read_meta(project_id) else { return };
    let factor = meta.pixel_scale.get(from).copied();
    let kept = meta.downsample_kept.contains(from);
    if factor.is_none() && !kept {
        return;
    }
    if moved {
        meta.pixel_scale.remove(from);
        meta.downsample_kept.remove(from);
    }
    if let Some(factor) = factor {
        meta.pixel_scale.insert(to.to_string(), factor);
    }
    if kept {
        meta.downsample_kept.insert(to.to_string());
    }
    let _ = store::write_meta(&meta);
}

/// Pixel Art Downsample, from its sheet.
#[tauri::command(async)]
pub fn downsample_psd_pixels(
    app: tauri::AppHandle,
    id: String,
    key: String,
    factor: f64,
    upscale: u32,
    maintain: bool,
) -> Result<String, String> {
    downsample(&id, &key, factor, upscale, maintain, crate::logger(&app))
}

/// Pixel Art Rescale, from the inspector's PSD section.
#[tauri::command(async)]
pub fn set_psd_pixel_scale(
    app: tauri::AppHandle,
    id: String,
    key: String,
    factor: u32,
) -> Result<String, String> {
    set(&id, &key, factor, crate::logger(&app))
}
