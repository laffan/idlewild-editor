//! **Import Assets**: artwork into a project, several files at a time.
//!
//! The inverse of `export_assets.rs`, and it exists for the same reason that
//! one does. Export Assets hands the artwork back — the PSDs somebody drew and
//! the sheets the pipeline sliced out of them — and until now there was no way
//! in for more than one file at a time: Add Image asks for a file, a paste
//! carries one, a drop lands one. A tileset drawn as nine PSDs in another
//! project was nine trips through a picker.
//!
//! Two things are here, and neither of them is an import of its own. The whole
//! point is that an imported asset goes through **exactly** the route every
//! other file takes — bytes to `import_file_as_psd`, psd-to-json over the
//! result, a placement anchored on a grid space — because a week later nobody
//! remembers which door a file came in by, and a second pipeline is a second
//! set of bugs.
//!
//! So what this adds is the two answers that route cannot give by itself.
//! `free_psd_key` is the naming rule for a **bulk** import, where a collision
//! is two files that happen to share a name rather than one file coming home;
//! and `import_psd_from_project` is the one path that reaches *another
//! project's* store, which the frontend cannot name because a project's
//! directory is this install's business.
//!
//! What a copy between projects does **not** carry is the document's record of
//! the file: an extruded PSD arrives as its artwork without the solid behind
//! it, and a collider someone edited by hand arrives as the default guessed
//! from the footprint. Both live in the other project's `doc.json`, which is
//! about a canvas rather than about a file — and the export that does carry
//! them is `.idlewild`, which brings the whole project rather than one PSD out
//! of it. Worth knowing before pulling a greybox across: the artwork is the
//! same and the way back into extrude mode is not.

use crate::project::ImportResult;
use crate::{psd_pipeline, store};

/// The key a bulk import should write under, given the name of what is coming.
///
/// Asked before the import rather than decided inside it, because the caller is
/// the one that knows this is a bulk import: the same command underneath is
/// what a *replacement* uses, and there writing over the key is the point. The
/// sanitiser is Rust's, so the frontend never has to hold a second copy of the
/// rule for what survives being a filename.
#[tauri::command]
pub fn free_psd_key(id: String, name: String) -> Result<String, String> {
    psd_pipeline::free_key(&id, &name)
}

/// Copy one of another project's PSDs into this one, and run the pipeline.
///
/// The bytes are copied within the store rather than carried through the
/// webview, which is what makes this cheap on the device it matters on: a
/// fifty-megabyte PSD would otherwise cross the bridge twice as base64 to end
/// up in a directory two levels from where it started.
///
/// A PSD already carries its own `P | anchor`, so nothing has to be marked on
/// the way: the file that lands is the file that left, and the placement made
/// from it stands on the space its mark names. That is the same reason a `.psd`
/// imported from Files is copied rather than rewritten.
#[tauri::command(async)]
pub fn import_psd_from_project(
    app: tauri::AppHandle,
    id: String,
    from_id: String,
    key: String,
) -> Result<ImportResult, String> {
    if from_id == id {
        // Not refused for tidiness: the frontend lists every project *but* this
        // one, so the only way to ask is to have got here another way — and the
        // answer to "copy this file over itself" is `duplicate_psd`, which has
        // a naming rule of its own.
        return Err("That file is already in this project".into());
    }
    let source = psd_pipeline::psd_path(&from_id, &key)?;
    if !source.is_file() {
        return Err(format!("No PSD named {key} in that project"));
    }
    // The destination project has to exist before anything is written into it,
    // and `psd_dir` creates directories — so a mistyped id would otherwise
    // scaffold half a project rather than failing.
    store::read_meta(&id)?;

    let stem = psd_pipeline::free_key(&id, &key)?;
    psd_pipeline::import_and_process(&id, &source, Some(&stem), None, crate::logger(&app))
}

#[cfg(test)]
mod tests {
    use crate::project::{GameOptions, Projection, Scaffold};
    use crate::tests::swatch;
    use crate::{psd_pipeline, psd_write, store};

    /// A project with one PSD in it, parsed, and the cleanup that goes with it.
    fn project(name: &str, key: &str) -> String {
        let meta = store::create_project(
            name,
            Projection::Orthogonal,
            Scaffold::Topdown,
            32,
            GameOptions::default(),
        )
        .expect("project should be created");
        let bytes =
            psd_write::psd_from_rgba_marked(key, 24, 16, swatch(24, 16, [7, 8, 9, 255]), None)
                .expect("PSD should be written");
        std::fs::write(
            store::psd_dir(&meta.id).expect("psd dir").join(format!("{key}.psd")),
            bytes,
        )
        .expect("PSD should save");
        meta.id
    }

    #[test]
    fn a_bulk_import_never_writes_over_a_file_already_there() {
        let id = project("Free keys", "tower");
        let result = std::panic::catch_unwind(|| {
            // Taken, so the next one steps rather than replacing it.
            assert_eq!(psd_pipeline::free_key(&id, "tower").unwrap(), "tower-2");
            // Free, so the name someone chose is the name they get.
            assert_eq!(psd_pipeline::free_key(&id, "roof").unwrap(), "roof");
            // And it is the *sanitised* name that is checked, so the rule for
            // what survives being a filename is not written twice.
            assert_eq!(
                psd_pipeline::free_key(&id, "back wall").unwrap(),
                "back_wall",
            );
            assert_eq!(psd_pipeline::free_key(&id, "../../etc/passwd").unwrap(), "etc_passwd");
        });
        store::delete_project(&id).ok();
        if let Err(payload) = result {
            std::panic::resume_unwind(payload);
        }
    }

    /// A PSD pulled out of another project arrives as the file it was, under a
    /// key of its own, with the pipeline run over it — which is the whole
    /// contract the frontend places against.
    #[test]
    fn a_psd_crosses_from_one_project_to_another() {
        let from = project("Source", "tower");
        let into = project("Target", "tower");

        let result = std::panic::catch_unwind(|| {
            let source = psd_pipeline::psd_path(&from, "tower").unwrap();
            // `tower` is taken in the target, so the copy steps to `tower-2`
            // rather than replacing the file already standing there.
            let stem = psd_pipeline::free_key(&into, "tower").unwrap();
            assert_eq!(stem, "tower-2");

            let landed =
                psd_pipeline::import_and_process(&into, &source, Some(&stem), None, |_| {})
                    .expect("the copy should import");
            assert_eq!(landed.key, "tower-2");
            assert_eq!((landed.width, landed.height), (24, 16));
            assert!(psd_pipeline::is_processed(&into, "tower-2"));

            // Byte-identical: a PSD is taken as its author built it, so the
            // artwork and whatever marks it carries cross unchanged.
            assert_eq!(
                std::fs::read(psd_pipeline::psd_path(&into, "tower-2").unwrap()).unwrap(),
                std::fs::read(&source).unwrap(),
            );
            // And the file it did not replace is still there.
            assert!(psd_pipeline::psd_path(&into, "tower").unwrap().is_file());
        });

        store::delete_project(&from).ok();
        store::delete_project(&into).ok();
        if let Err(payload) = result {
            std::panic::resume_unwind(payload);
        }
    }
}
