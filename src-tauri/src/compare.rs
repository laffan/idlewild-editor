//! What is already published, beside what this project would publish.
//!
//! The two panes of the Publish sheet. Left is the far end as it stands now;
//! right is the site this project builds, with each file marked against what
//! is over there. Nothing is sent by this module — it is the thing you read
//! before deciding what to send.
//!
//! ## Same shape, two hashes
//!
//! Both halves answer "is this file already there, unchanged?", and each uses
//! whatever the far end can be compared with:
//!
//! - **GitHub** hands back a **git blob id** per file in the tree, so the local
//!   side is hashed the same way (`git2::Oid::hash_object`, which is libgit2
//!   doing exactly what `git hash-object` does). That comparison is exact.
//! - **A server** has no such thing, so a publish leaves a manifest of SHA-256
//!   beside the site and this reads it back. A file on the server that the
//!   manifest has never heard of is reported **unknown** rather than unchanged:
//!   the honest answer is that it cannot be told, and calling it unchanged
//!   would quietly skip the one file somebody edited by hand.
//!
//! ## Why the far end is listed rather than assumed
//!
//! A publish used to replace everything at the target path. That is the right
//! default and the wrong only option: it means a file somebody put there by
//! hand is gone without ever having been shown to them. Listing it first is
//! what makes selecting possible, and selecting is what makes a publish
//! something you can do to one file.

use crate::project::PublishTarget;
use crate::publish_targets;
use serde::Serialize;

/// One file at the far end.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEntry {
    pub path: String,
    pub size: u64,
    /// Whether the site being published still has a file of this name. One
    /// that does not is what the left pane offers to remove.
    pub in_site: bool,
}

/// What a local file is, relative to what is already published.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    /// Not at the far end at all.
    New,
    /// There, and different.
    Changed,
    /// There, and the same. Nothing to do.
    Same,
    /// There, and there is no way to tell. Treated as changed by the default
    /// selection, because sending a file that did not need it costs a second
    /// and skipping one that did costs a wrong site.
    Unknown,
}

/// One file this project would publish.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEntry {
    pub path: String,
    pub size: u64,
    pub status: Status,
}

/// The two panes, and where they are about.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comparison {
    pub remote: Vec<RemoteEntry>,
    pub local: Vec<LocalEntry>,
    /// The destination, as a person reads it — the sheet's own heading.
    pub destination: String,
    /// Whether there is nothing at the far end yet: a branch that does not
    /// exist, a directory nobody has published into. Worth saying plainly,
    /// because an empty left pane otherwise looks like a failed listing.
    pub fresh: bool,
    /// Said when the far end could be reached but not compared — a repository
    /// too large for GitHub to list in one answer. Empty otherwise. The
    /// publish still works; it is the comparison that cannot be drawn.
    pub note: String,
}

/// Build the comparison for a project's target.
///
/// `site` is the staged site, already written. Staging is the caller's, because
/// the GitHub half runs inside `spawn_blocking` and the server half does not,
/// and a helper that had to be both was more machinery than it saved.
pub fn against_github(
    target: &PublishTarget,
    site: &std::path::Path,
    account: &publish_targets::Github,
) -> Result<Comparison, String> {
    let local = crate::site_files::scan_with(site, blob_id)?;
    let branch = target.branch_or_default();
    let (remote, note) = match crate::github_api::list_tree(
        &account.token,
        &target.owner,
        &target.repo,
        branch,
        &target.path,
    ) {
        Ok(files) => (files, String::new()),
        // Reachable but not listable. The publish is still possible, so this
        // is a note on an empty pane rather than a failure.
        Err(e) if e.contains("too large") => (Vec::new(), e),
        Err(e) => return Err(e),
    };

    let fresh = remote.is_empty() && note.is_empty();
    let by_path: std::collections::BTreeMap<&str, &crate::github_api::RemoteFile> =
        remote.iter().map(|file| (file.path.as_str(), file)).collect();

    Ok(Comparison {
        remote: remote
            .iter()
            .map(|file| RemoteEntry {
                path: file.path.clone(),
                size: file.size,
                in_site: local.iter().any(|entry| entry.rel == file.path),
            })
            .collect(),
        local: local
            .iter()
            .map(|entry| LocalEntry {
                path: entry.rel.clone(),
                size: entry.size,
                status: match by_path.get(entry.rel.as_str()) {
                    None => Status::New,
                    Some(file) if file.sha == entry.hash => Status::Same,
                    Some(_) => Status::Changed,
                },
            })
            .collect(),
        destination: target.describe(),
        fresh,
        note,
    })
}

/// The same, for a server: the far end's own listing, and its manifest.
pub fn against_server(
    target: &PublishTarget,
    site: &std::path::Path,
    listing: &[(String, u64)],
    manifest: &std::collections::BTreeMap<String, String>,
) -> Result<Comparison, String> {
    let local = crate::site_files::scan(site)?;
    let fresh = listing.is_empty();

    Ok(Comparison {
        remote: listing
            .iter()
            .map(|(path, size)| RemoteEntry {
                path: path.clone(),
                size: *size,
                in_site: local.iter().any(|entry| entry.rel == *path),
            })
            .collect(),
        local: local
            .iter()
            .map(|entry| {
                let there = listing.iter().any(|(path, _)| *path == entry.rel);
                LocalEntry {
                    path: entry.rel.clone(),
                    size: entry.size,
                    status: match (there, manifest.get(&entry.rel)) {
                        (false, _) => Status::New,
                        (true, Some(hash)) if *hash == entry.hash => Status::Same,
                        (true, Some(_)) => Status::Changed,
                        // There, and the manifest has never heard of it —
                        // somebody's own upload, or a publish from before the
                        // manifest existed. It cannot be told, and saying so
                        // is better than guessing either way.
                        (true, None) => Status::Unknown,
                    },
                }
            })
            .collect(),
        destination: target.describe(),
        fresh,
        note: String::new(),
    })
}

/// A file's git blob id, which is what GitHub's tree listing carries.
///
/// Through libgit2 rather than hand-rolled, so it is git's own answer by
/// construction: `blob <len>\0` then the bytes, hashed — and getting the
/// header wrong would make every file look changed for ever, which is the kind
/// of bug that looks like the comparison simply not working.
pub fn blob_id(bytes: &[u8]) -> String {
    git2::Oid::hash_object(git2::ObjectType::Blob, bytes)
        .map(|oid| oid.to_string())
        .unwrap_or_default()
}
