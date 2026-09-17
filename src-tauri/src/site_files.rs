//! The staged site, as a list of files with hashes — and the manifest that
//! lets the next publish know what the last one left.
//!
//! Shared by `compare`, which reads it to draw the two panes, and by
//! `deploy_ssh`, which reads it to decide what to send. One description of
//! "what is in this site", so the list somebody ticked and the list that goes
//! over the wire cannot drift apart.
//!
//! **Hashed, not timed.** The staging directory is written fresh for every
//! publish, so every file's modified time is *now* and says nothing at all. A
//! size alone would call an edited scene file unchanged often enough to matter.
//! Which hash depends on who is being compared against — see `scan_with`.

use std::collections::BTreeMap;
use std::path::Path;

/// One file of the staged site.
pub struct Entry {
    /// Relative to the site root, with forward slashes.
    pub rel: String,
    /// Whatever the far end can be compared with: SHA-256 for a server, a git
    /// blob id for GitHub. Hex, either way.
    pub hash: String,
    pub size: u64,
}

/// Every file under the staged site, hashed for a server's manifest.
pub fn scan(site: &Path) -> Result<Vec<Entry>, String> {
    scan_with(site, sha256_hex)
}

/// The same, hashed however the caller needs.
///
/// GitHub's tree listing carries git blob ids, so the local side has to be
/// hashed the same way for "unchanged" to mean anything — see
/// `compare::blob_id`. The walk is identical either way, and having one walk
/// is the point: two would be two chances to disagree about what a site is.
pub fn scan_with(site: &Path, hash: fn(&[u8]) -> String) -> Result<Vec<Entry>, String> {
    let mut out = Vec::new();
    let mut stack = vec![site.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let rel = path
                .strip_prefix(site)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read {rel}: {e}"))?;
            out.push(Entry {
                rel,
                hash: hash(&bytes),
                size: bytes.len() as u64,
            });
        }
    }
    out.sort_by(|a, b| a.rel.cmp(&b.rel));
    Ok(out)
}

/// A manifest's text, as a map of path to hash.
///
/// A line that is not two fields is skipped rather than failing the parse: the
/// worst a mangled manifest can do is make a publish send more than it had to,
/// and refusing to publish because of a file whose only job is to be an
/// optimisation would be the wrong way round.
pub fn parse_manifest(text: &str) -> BTreeMap<String, String> {
    text.lines()
        .filter_map(|line| line.split_once(' '))
        .map(|(hash, rel)| (rel.to_string(), hash.to_string()))
        .collect()
}

/// A manifest, as it goes back to the far end.
pub fn render_manifest(entries: &BTreeMap<String, String>) -> String {
    entries
        .iter()
        .map(|(rel, hash)| format!("{hash} {rel}"))
        .collect::<Vec<_>>()
        .join("\n")
}

/// What the far end will hold after this publish, given what it held before.
///
/// **Not simply the whole site.** A publish can send a subset — that is the
/// point of the two panes — so the manifest has to describe what is actually
/// over there: what was there, plus what this run sent, minus what it removed.
/// Writing the full site's hashes after a partial upload would tell the next
/// publish that files it never sent are already there, which is the one way a
/// manifest can cause a wrong site rather than a slow one.
pub fn next_manifest(
    previous: &BTreeMap<String, String>,
    sent: &[&Entry],
    removed: &[String],
) -> BTreeMap<String, String> {
    let mut out = previous.clone();
    for entry in sent {
        out.insert(entry.rel.clone(), entry.hash.clone());
    }
    for path in removed {
        out.remove(path);
    }
    out
}

/// Which of the site's files the far end does not already have.
///
/// A file the manifest has never heard of is changed, and so is one whose hash
/// differs. Both are "send it", and the distinction between them is not worth
/// a branch — what matters is that neither is silently skipped.
pub fn changed<'a>(local: &'a [Entry], remote: &BTreeMap<String, String>) -> Vec<&'a Entry> {
    local
        .iter()
        .filter(|entry| remote.get(&entry.rel) != Some(&entry.hash))
        .collect()
}

/// The entries a selection names, in the site's own order.
///
/// `None` means every file that differs, which is what Publish does when
/// nobody has touched the list. A named path the site does not have is
/// ignored rather than refused: the list came from a picker, and the only way
/// to ask for a missing one is to have rebuilt the site since it was drawn.
pub fn selected<'a>(
    local: &'a [Entry],
    remote: &BTreeMap<String, String>,
    chosen: Option<&[String]>,
) -> Vec<&'a Entry> {
    match chosen {
        None => changed(local, remote),
        Some(paths) => {
            let wanted: std::collections::BTreeSet<&str> =
                paths.iter().map(String::as_str).collect();
            local
                .iter()
                .filter(|entry| wanted.contains(entry.rel.as_str()))
                .collect()
        }
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    use russh::keys::ssh_key::sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
