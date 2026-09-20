//! The published site, as a tree — what Code mode's file column shows.
//!
//! The column used to list `game/`, which is the tree you edit, and that is
//! not the same list as the one that leaves: a publish sends `game/` *and*
//! `assets/`, plus the two runtime libraries and a README neither of which
//! exists on disk at all. The processed artwork is most of a project's weight
//! and the whole reason the PSD pipeline is there, and it was the one part of
//! an export nothing in the app would show you. So the column shows the site.
//!
//! **Shown is not the same as editable**, which is why each row says which it
//! is. `assets/` is psd-to-json's output and is rewritten from the PSD every
//! time the file is re-parsed; the runtime libraries are vendored into this
//! binary — see `file_server.rs`, which serves them from there — and the
//! README is written at the moment of the publish. Renaming or deleting any
//! of them would either be undone by the next import or refused outright, so
//! the modal offers neither, and the flag is worked out from the one fact
//! that decides it: whether the file is in `game/`, the tree the modal owns.
//!
//! `site_entries` is the same function a zip and an rsync are built from —
//! see `publish.rs` — so the column cannot drift from what is actually sent.
//! It names files only; the folders between them are derived here, because a
//! column of rows has to have something to fold.

use crate::publish;
use crate::store;
use serde::Serialize;
use std::collections::BTreeSet;

/// One row of the code modal's file column.
#[derive(Debug, Clone, Serialize)]
pub struct SiteFile {
    /// Relative to the site root, with forward slashes — the path a browser
    /// asks for, and for a file in `game/` the path the modal edits it by.
    pub path: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
    /// Whether the modal may open, rename, move or delete it: `game/`'s own.
    pub editable: bool,
}

#[tauri::command]
pub fn list_site_files(id: String) -> Result<Vec<SiteFile>, String> {
    site_files(&id)
}

/// Every path a publish would send, with the folders between them.
pub fn site_files(id: &str) -> Result<Vec<SiteFile>, String> {
    let (_root, entries) = publish::site_entries(id)?;
    let game = store::game_dir(id)?;

    let mut folders: BTreeSet<String> = BTreeSet::new();
    let mut out: Vec<SiteFile> = Vec::new();

    for entry in &entries {
        for parent in parents(&entry.rel) {
            folders.insert(parent);
        }
        out.push(SiteFile {
            // On disk under `game/` is the whole of the test, and it answers
            // correctly for the three kinds that are not: `assets/` lives
            // beside `game/` rather than inside it, and the runtime libraries
            // and the README have no file anywhere until a publish writes one.
            editable: game.join(&entry.rel).is_file(),
            path: entry.rel.clone(),
            is_dir: false,
        });
    }

    // A folder somebody made and has not put a file in yet has no entry to be
    // derived from, and dropping it from the column would make New Folder
    // look as though it had done nothing.
    for file in store::list_game_files(id)? {
        if file.is_dir {
            folders.insert(file.path);
        }
    }

    for path in folders {
        out.push(SiteFile {
            editable: game.join(&path).is_dir(),
            path,
            is_dir: true,
        });
    }

    // One sorted list, parents before their children: `/` sorts below every
    // character a name may start with, so a plain path compare nests the tree
    // on its own. The same order `store::list_game_files` hands back, which is
    // what the column has always drawn.
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

/// Every folder above a path, outermost first.
fn parents(rel: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut prefix = String::new();
    let parts: Vec<&str> = rel.split('/').collect();
    for part in &parts[..parts.len().saturating_sub(1)] {
        if !prefix.is_empty() {
            prefix.push('/');
        }
        prefix.push_str(part);
        out.push(prefix.clone());
    }
    out
}
