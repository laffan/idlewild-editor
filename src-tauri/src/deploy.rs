//! Publishing somewhere real: the site written to a directory, and the two
//! ways it leaves from there.
//!
//! The zip exports hand you a file. These hand the site to a place that serves
//! it — a directory on a server over rsync, or a branch of a GitHub repository.
//! Both are the *same site*: `publish::site_entries` is the one description of
//! what a published project is made of, and everything here starts by writing
//! that list into a staging directory. A site that was right in a zip and wrong
//! on a server would be a difference nobody finds until it is live.
//!
//! ## Neither of them runs a program, and that is the whole iPad story
//!
//! The first version of this ran `rsync` and `git`. That made publishing a
//! desktop capability, because iOS does not let a third-party app create a
//! child process: `fork`, `exec` and `posix_spawn` are denied by the sandbox
//! and `Foundation.Process` is not in the SDK. All of that is true and
//! permanent — and none of it is a constraint on *publishing*, which was the
//! mistake. Every iOS app that does this work links the functionality instead
//! of spawning the tool: Working Copy is libgit2 through objective-git,
//! a-Shell's commands are dylibs in its own bundle loaded by `ios_system`, iSH
//! emulates a machine. Link the library, do not spawn the binary.
//!
//! So:
//!
//! - **GitHub is libgit2**, vendored and compiled for whatever target Cargo is
//!   pointed at, using SecureTransport on Apple platforms. Same code on a Mac
//!   and an iPad. See `deploy_github`.
//! - **The server half is SFTP over our own SSH connection**, in Rust, because
//!   rsync is the one tool here with no library form — the delta algorithm is
//!   published as a library, the sending half of the wire protocol is not. See
//!   `deploy_ssh` for that argument in full and for what is lost.
//!
//! There is no `can_run` any more. Both platforms can.
//!
//! ## What a publish must never do
//!
//! - **Leak a secret.** Neither credential is ever in a URL or a command line,
//!   because there is no command line. `redact` stays as the belt to those
//!   braces: libgit2 quotes the remote in some of its messages.
//! - **Trust whatever answers.** Owning the SSH client means owning the host
//!   key check that `ssh` would have done, and `Ok(true)` there is a
//!   man-in-the-middle bug. `deploy_ssh::Trust` is trust-on-first-use.
//! - **Hang.** Nothing here can reach a password prompt: the ssh key is
//!   supplied from the settings and libgit2 gets its credentials from a
//!   callback, so a credential that does not work fails rather than waiting.

use crate::project::TargetKind;
use crate::publish_targets;
use std::path::{Path, PathBuf};

/// What a publish did, or would have done.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    /// One line for the console and the sheet.
    pub summary: String,
    /// What the program said, redacted. The detail somebody needs when a
    /// publish does not land where they expected it to.
    pub log: String,
    /// Whether this was a rehearsal.
    pub dry_run: bool,
}

/// Publish a project to wherever it is pointed.
///
/// **What is already published, beside what this project would publish.**
///
/// The two panes of the Publish sheet, and the reason publishing is something
/// you can do to one file. A publish used to replace everything at the target
/// path — the right default and the wrong only option, because it means a file
/// somebody put there by hand disappears without ever having been shown to
/// them. This is what gets shown first.
///
/// Both halves stage the site, because "what would this publish" is not a
/// question the store can answer: a published site is `game/` and `assets/`
/// and two vendored runtimes and a generated config, assembled.
#[tauri::command]
pub async fn compare_target(id: String) -> Result<crate::compare::Comparison, String> {
    let meta = crate::store::read_meta(&id)?;
    if !meta.publish.is_set() {
        return Err("This project has no publish target yet".into());
    }

    match meta.publish.kind {
        TargetKind::None => Err("This project has no publish target yet".into()),
        TargetKind::Github => {
            let settings = publish_targets::read();
            let account = publish_targets::account_for(&settings, &meta.publish.account)?;
            let target = meta.publish.clone();
            let project = meta.id.clone();
            blocking(move || {
                let root = staging_dir(&project)?;
                let site = root.join("site");
                let result = stage(&project, &site)
                    .and_then(|_| crate::compare::against_github(&target, &site, &account));
                let _ = std::fs::remove_dir_all(&root);
                result
            })
            .await
        }
        TargetKind::Rsync => {
            let settings = publish_targets::read();
            let server = server_for(&settings, &meta.publish.server)?;
            let directory = crate::deploy_ssh::clean_directory(&meta.publish.directory)?;
            let root = staging_dir(&meta.id)?;
            let site = root.join("site");
            let result = match stage(&meta.id, &site) {
                Ok(()) => {
                    let session = crate::deploy_ssh::Session::open(&server).await;
                    match session {
                        Ok(session) => {
                            let listing = session.listing(&directory).await;
                            let manifest = session.manifest(&directory).await;
                            session.close().await;
                            crate::compare::against_server(
                                &meta.publish,
                                &site,
                                &listing,
                                &manifest,
                            )
                        }
                        Err(e) => Err(e),
                    }
                }
                Err(e) => Err(e),
            };
            let _ = std::fs::remove_dir_all(&root);
            result
        }
    }
}

/// Publish a project to wherever it is pointed.
///
/// `chosen` is the right pane's ticks — the files to send — and `remove` is
/// the left pane's: what is at the far end and is to stop being there.
/// `chosen` as `None` means everything that differs, which is what Publish
/// does before anybody has touched the list.
///
/// `dry_run` rehearses: both halves say what they would do and neither does
/// any of it. It is the same command because the useful question — "is this
/// set up right?" — is one somebody asks with their finger already on Publish.
///
/// **An `async fn`, and that is load-bearing.** A synchronous Tauri command
/// runs on the **main thread** — the accident the PSD pipeline had to be dug
/// out of, see `psd_pipeline::exclusive` — and this one stages tens of
/// megabytes and then waits on a network transfer. The SSH half is async and
/// is awaited; libgit2 is blocking and goes to `spawn_blocking`, so neither
/// one parks a runtime thread on a socket.
#[tauri::command]
pub async fn publish_to_target(
    id: String,
    dry_run: bool,
    chosen: Option<Vec<String>>,
    remove: Option<Vec<String>>,
) -> Result<Report, String> {
    let meta = crate::store::read_meta(&id)?;
    if !meta.publish.is_set() {
        return Err("This project has no publish target yet".into());
    }
    let remove = remove.unwrap_or_default();

    match meta.publish.kind {
        TargetKind::None => Err("This project has no publish target yet".into()),
        TargetKind::Rsync => {
            let settings = publish_targets::read();
            let server = server_for(&settings, &meta.publish.server)?;
            // Staged here rather than in a helper the two share: one of these
            // is async and the other is not, and a closure that had to be both
            // was more machinery than the four lines it saved.
            let root = staging_dir(&meta.id)?;
            let site = root.join("site");
            let result = match stage(&meta.id, &site) {
                Ok(()) => match crate::deploy_ssh::Session::open(&server).await {
                    Ok(session) => {
                        let report = crate::deploy_ssh::push(
                            &session,
                            &server,
                            &meta.publish,
                            &site,
                            chosen.as_deref(),
                            &remove,
                            dry_run,
                        )
                        .await;
                        session.close().await;
                        report
                    }
                    Err(e) => Err(e),
                },
                Err(e) => Err(e),
            };
            let _ = std::fs::remove_dir_all(&root);
            result
        }
        TargetKind::Github => {
            let settings = publish_targets::read();
            let account = publish_targets::account_for(&settings, &meta.publish.account)?;
            let target = meta.publish.clone();
            // A GitHub rehearsal is one question over the network, so it does
            // not stage the site at all. The server half is the other way
            // round — it compares file lists — which is why only one of them
            // short-cuts.
            if dry_run {
                return blocking(move || crate::deploy_github::check(&account, &target)).await;
            }
            let name = meta.name.clone();
            let project = meta.id.clone();
            blocking(move || {
                let root = staging_dir(&project)?;
                let site = root.join("site");
                // A second directory beside it, because a GitHub push clones
                // the branch it is about to commit onto.
                let work = root.join("repo");
                let result = stage(&project, &site).and_then(|_| {
                    crate::deploy_github::push(
                        &account,
                        &target,
                        &site,
                        &name,
                        &work,
                        chosen.as_deref(),
                        &remove,
                    )
                });
                let _ = std::fs::remove_dir_all(&root);
                result
            })
            .await
        }
    }
}

/// The server a target names.
///
/// Deleted out from under the project is the one way a saved target can stop
/// naming anything, and it is worth a sentence rather than a missing row.
fn server_for(
    settings: &publish_targets::Settings,
    id: &str,
) -> Result<publish_targets::Server, String> {
    settings
        .servers
        .iter()
        .find(|server| server.id == id)
        .cloned()
        .ok_or_else(|| {
            "That server is not set up on this device any more. Pick another in \
             Publish."
                .to_string()
        })
}

/// Run blocking work off the runtime's own threads.
///
/// libgit2 is a C library and blocks; awaiting it on a runtime thread would
/// park that thread on a socket for the length of a clone. A panic inside
/// comes back as a failed publish rather than as a poisoned runtime.
async fn blocking<F, T>(work: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| format!("That did not finish: {e}"))?
}

/// A staging directory of this project's own, emptied first.
///
/// Under the app's data directory rather than the system temp: the site is
/// tens of megabytes of sprite sheets, and it is written beside the store it
/// was read from, on the same filesystem, where the platform will not clear it
/// out from under a transfer in progress.
///
/// Removed again whether the publish worked or not — a failed publish leaving
/// a second copy of every asset behind is how a device runs out of room.
pub fn staging_dir(project_id: &str) -> Result<PathBuf, String> {
    // Through `project_dir`, whose whole job is refusing an id that would
    // climb out of the store — this joins the same untrusted string.
    let _ = crate::store::project_dir(project_id)?;
    let root = crate::store::app_data_dir()?.join("staging").join(project_id);
    if root.exists() {
        std::fs::remove_dir_all(&root).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}

/// The published site, written into `dest`.
///
/// Staged rather than pushed from the store directly, because a published site
/// is not a directory that exists anywhere: it is `game/` and `assets/` and two
/// vendored runtimes and a generated config, assembled. Both deploys want a
/// tree to look at, so one is built for them.
///
/// The zip's root directory is deliberately dropped: an archive unpacks into a
/// directory named after the project, and a server's document root or a
/// repository's branch is already the place the site goes. Publishing into
/// `public_html/nine-roads/` when the target said `public_html/` would be this
/// code naming a directory somebody else owns.
pub fn stage(project_id: &str, dest: &Path) -> Result<(), String> {
    let (_root, entries) = crate::publish::site_entries(project_id)?;
    for entry in entries {
        // Every `rel` is built from a directory walk of the store, never from
        // anything a person typed — but it is joined to a path, so it is
        // checked like every other relative path in this app.
        let path = dest.join(crate::store::safe_relative(&entry.rel)?);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        // Copied rather than read and written, where there is a file to copy
        // from: a processed project is tens of megabytes of sprite sheets, and
        // there is no reason for any of them to be a `Vec<u8>` on the way.
        match &entry.source {
            crate::publish::SiteSource::Disk(from) => std::fs::copy(from, &path)
                .map(|_| ())
                .map_err(|e| {
                    format!("Cannot copy {} to {}: {e}", from.display(), path.display())
                }),
            crate::publish::SiteSource::Generated(bytes) => std::fs::write(&path, bytes)
                .map_err(|e| format!("Cannot write {}: {e}", path.display())),
        }?;
    }
    Ok(())
}

/// Take a secret out of anything about to be shown to somebody.
///
/// git writes the remote URL into a good half of its error messages and rsync
/// echoes its own argv on some failures. Nothing here is *supposed* to carry a
/// token — the credential reaches git through the environment — and this is the
/// check on that, because the one place a leak would land is a log line
/// somebody then pastes into an issue.
pub fn redact(text: &str, secret: &str) -> String {
    if secret.is_empty() {
        return text.to_string();
    }
    text.replace(secret, "••••••")
}

/// The last few lines of a program's output.
///
/// rsync lists every file it sent, and a sheet is not where anybody reads four
/// hundred of them. The end is the part that says how it went.
pub fn tail(text: &str, lines: usize) -> String {
    let all: Vec<&str> = text.lines().filter(|line| !line.trim().is_empty()).collect();
    let from = all.len().saturating_sub(lines);
    all[from..].join("\n")
}
