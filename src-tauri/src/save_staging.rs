//! Where a file is built before the save dialog sees it, on iOS.
//!
//! **The bug this exists to fix.** Exporting a zip or a `.idlewild` worked on
//! macOS and wrote a 0-byte file on an iPad. Every exit was written the same
//! way — ask the save dialog where, then write there — and on iOS that is the
//! wrong order, because iOS has no save dialog. It has an *export* picker, and
//! the difference is the whole bug.
//!
//! `UIDocumentPickerViewController(url:in:.exportToService)` answers "copy
//! **this file** to somewhere the person picks". There is no API on iOS that
//! answers "give me a path I may write to later" — that is what a sandbox is.
//! So tauri-plugin-dialog's `saveFileDialog` fakes one: it creates an *empty*
//! file at `<app Documents>/<fileName>`, hands that to the export picker, and
//! returns the URL the copy landed at, "so the app dev can write to it later".
//!
//! Except an app may not write to it later. The URL the picker hands back
//! names a file in another process's container — iCloud Drive's, a file
//! provider's, another app's On My iPad folder — and reaching it needs a
//! security-scoped resource the app was never handed. `std::fs::write` there
//! fails, and the file the person finds in Files is the empty placeholder the
//! picker already copied. Hence 0 bytes, on every exit, on one platform.
//!
//! **The fix is to build the file where the picker is already going to look.**
//! The plugin only writes its placeholder `if !fileManager.fileExists` — so a
//! file already sitting at `<Documents>/<fileName>` is left alone and exported
//! as it stands. Nothing is written outside the sandbox at any point, iOS does
//! the copy itself with rights this app does not have, and the destination
//! never has to be readable or writable by us at all.
//!
//! That inverts the order of the two steps on iOS, and only on iOS:
//!
//! ```text
//! macOS   ask where  →  build the file there
//! iPadOS  build the file here  →  ask where  →  iOS copies it
//! ```
//!
//! `save-as.ts` is the seam that holds both orders, so no exit has to know
//! which platform it is on. See *Leaving with a file, and the order iOS needs*
//! in `Docs/exports.md`.
//!
//! **Where `<Documents>` is, from Rust.** The plugin asks Foundation for
//! `.documentDirectory` in `.userDomainMask`, which on iOS is `$HOME/Documents`
//! with `$HOME` the app's container. `dirs::document_dir()` compiles to
//! `home_dir().map(|h| h.join("Documents"))` on any Apple target — `dirs` gates
//! its `mac` module on `any(target_os = "macos", target_os = "ios")` — and its
//! `home_dir()` reads `$HOME`, which is the container the OS set. The same
//! directory, by the same rule, from the other side. The store is under
//! `dirs::data_dir()` (`$HOME/Library/Application Support`), so nothing staged
//! here can collide with a project.

use serde::Serialize;

/// Where this platform wants an export built, or nothing when the save dialog
/// already names a destination the app may write to.
///
/// `None` on macOS and on every desktop target: the dialog there is a *save*
/// dialog, it hands back a path inside the sandbox it just widened for us, and
/// building anywhere else first would be a copy for its own sake.
///
/// Android gets `None` too, and deliberately. Its half of the plugin resolves a
/// `content://` URI through `SAF`, which the app *is* granted write access to,
/// so the ordinary order is correct there. This is an iOS-shaped problem.
#[tauri::command]
pub fn save_staging(file_name: String) -> Result<Option<String>, String> {
    if !cfg!(target_os = "ios") {
        return Ok(None);
    }
    let path = staging_path(&file_name)?;
    // A crash between building and exporting leaves the last one behind, and
    // it would be exported in place of this one — the same silent wrong file
    // the 0-byte bug was. Clear it rather than trusting it.
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Cannot clear the last export at {}: {e}", path.display()))?;
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot open {}: {e}", parent.display()))?;
    }
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// What an export turned out to be, once it has been built and handed over.
#[derive(Debug, Serialize)]
pub struct StagedSave {
    /// How big the file that left actually is. The number the console prints,
    /// and the one that says "0 bytes" out loud if this ever breaks again
    /// rather than leaving it to be discovered in Files.
    pub bytes: u64,
    /// Empty when there is nothing to say. A sentence when there is — an
    /// export the picker did not take, a staged file that went missing.
    pub note: String,
}

/// Measure the staged file, then clear it.
///
/// Called whether the picker was used or backed out of: a cancelled export
/// has still built a file, and a project zip left in `Documents` until the
/// next one would be tens of megabytes of nothing.
///
/// Measuring *before* deleting is the only visibility there is on this
/// platform. The destination is in another process's container and cannot be
/// stat'd from here, so what the console can honestly report is the size of
/// the file iOS was asked to copy — which is the size that arrives, because
/// the copy is iOS's own and it either happens or the picker reports failure.
#[tauri::command]
pub fn save_staged_done(path: String) -> Result<StagedSave, String> {
    let path = crate::psd_write::source_path(&path);
    let bytes = match std::fs::metadata(&path) {
        Ok(meta) => meta.len(),
        Err(_) => {
            return Ok(StagedSave {
                bytes: 0,
                note: format!("Nothing was built at {} — the export is empty", path.display()),
            })
        }
    };
    let note = if bytes == 0 {
        format!("{} was built empty", path.display())
    } else {
        String::new()
    };
    let _ = std::fs::remove_file(&path);
    Ok(StagedSave { bytes, note })
}

/// `<Documents>/<file_name>`, refusing anything that is not a bare name.
///
/// `file_name` reaches here from the frontend, and the frontend builds it from
/// a project's name. It is sanitised there; it is checked here, because a
/// separator or a `..` in it would put the staged file somewhere the picker
/// will not look and somewhere this app has no business writing — and the
/// symptom would be the 0-byte export all over again.
pub fn staging_path(file_name: &str) -> Result<std::path::PathBuf, String> {
    if file_name.is_empty()
        || file_name == "."
        || file_name == ".."
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name.contains('\0')
    {
        return Err(format!("{file_name:?} is not a file name"));
    }
    let dir = dirs::document_dir().ok_or("Cannot determine the documents directory")?;
    Ok(dir.join(file_name))
}
