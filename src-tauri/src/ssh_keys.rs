//! Finding the ssh keys already on this device.
//!
//! The key picker was a file dialog, and on macOS that is a trap: keys live in
//! `~/.ssh`, a directory beginning with a dot, and the open panel hides those.
//! There is a keystroke for it — ⇧⌘. — and it is not something anybody should
//! have to know to publish a website.
//!
//! So the keys are offered rather than hunted for. This lists what is in
//! `~/.ssh`, the picker shows them as rows, and the file dialog stays as the
//! way to reach a key kept somewhere else — opening *inside* `~/.ssh` when
//! there is one, so even that route starts in the right place.
//!
//! On a device with no `~/.ssh` — an iPad — this answers with nothing and the
//! file dialog is the only route, which is what it already was there.
//!
//! **Nothing here reads a key's contents.** It reads file *names* and the first
//! line of a candidate to tell a private key from a public one. Importing is
//! `publish_targets::save_publish_server`, which is the one place that opens
//! one, checks it parses, and stores it.

use serde::Serialize;

/// One private key found on this device.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKey {
    /// The full path, which is what an import is given.
    pub path: String,
    /// `id_ed25519` — what the row says.
    pub name: String,
    /// Whether a matching `.pub` sits beside it. Not required, and worth
    /// saying: a key without one is usually still a key, and a *file* without
    /// one is more likely to be something else.
    pub has_public: bool,
}

/// Where ssh keeps keys, if this platform has such a place.
pub fn ssh_dir() -> Option<std::path::PathBuf> {
    let dir = dirs::home_dir()?.join(".ssh");
    dir.is_dir().then_some(dir)
}

/// The private keys in `~/.ssh`, by name.
///
/// Everything ssh keeps in that directory that is *not* a key is excluded by
/// name — `config`, `known_hosts`, `authorized_keys` and the `.pub` halves —
/// and what survives that is checked for a PEM header, because the directory
/// is a person's and may hold anything.
#[tauri::command]
pub fn list_ssh_keys() -> Vec<SshKey> {
    let Some(dir) = ssh_dir() else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name.ends_with(".pub") || SKIP.contains(&name) || name.starts_with('.') {
            continue;
        }
        if !looks_like_a_key(&path) {
            continue;
        }
        out.push(SshKey {
            path: path.to_string_lossy().to_string(),
            name: name.to_string(),
            has_public: path.with_extension("pub").exists()
                || dir.join(format!("{name}.pub")).exists(),
        });
    }
    // `id_ed25519` before `id_rsa` before anything else is not worth encoding;
    // by name is predictable, which is what a list of six things needs.
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// What ssh keeps in that directory that is not a key.
const SKIP: [&str; 4] = ["config", "known_hosts", "known_hosts2", "authorized_keys"];

/// Whether a file starts the way a private key does.
///
/// The first line only. A key is a few kilobytes and this runs over every file
/// in a directory, and the header is the whole of the evidence: OpenSSH's own
/// format, and the PKCS#1 and PKCS#8 forms a key may have been converted to.
fn looks_like_a_key(path: &std::path::Path) -> bool {
    use std::io::{BufRead, BufReader};
    let Ok(file) = std::fs::File::open(path) else {
        return false;
    };
    let mut first = String::new();
    if BufReader::new(file).read_line(&mut first).is_err() {
        return false;
    }
    first.starts_with("-----BEGIN") && first.contains("PRIVATE KEY")
}
