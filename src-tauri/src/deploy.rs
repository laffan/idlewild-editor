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
//! ## Both shell out, and that is a choice with a cost
//!
//! rsync and git are run as programs. rsync has no library worth the name, and
//! a GitHub publish through the REST API would mean an HTTP client, a TLS
//! stack, and a reimplementation of blobs, trees, commits and refs — for a
//! result `git` already gets right. The cost is that **publishing is a desktop
//! capability**: iPadOS gives an app no way to run either binary, so `can_run`
//! answers false there and the sheet says so rather than offering a button that
//! cannot work. The zip exports remain the iPad's route, which is what they
//! have always been. See *Known gaps* in the technical README.
//!
//! ## What a publish must never do
//!
//! - **Leak the token.** It reaches git through the environment and a
//!   credential helper, never through argv and never inside a URL — git prints
//!   a URL back at you in half its error messages. `redact` is the belt to that
//!   braces: nothing returned from here has been near the secret without it.
//! - **Be a shell.** Every argument is a separate element of `Command`'s argv,
//!   so nothing a person typed into a hostname box is ever parsed by a shell.
//!   rsync's remote path is the one thing that *is* expanded by a shell — the
//!   remote one — and `--protect-args` is what stops that.
//! - **Hang.** `BatchMode=yes` for ssh and `GIT_TERMINAL_PROMPT=0` for git:
//!   a credential that does not work must fail, not sit at a prompt nobody can
//!   see behind a modal sheet.

use crate::project::{ProjectMeta, TargetKind};
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

/// Whether this platform can publish at all, and why not when it cannot.
pub fn can_run() -> (bool, String) {
    if cfg!(any(target_os = "ios", target_os = "android")) {
        return (
            false,
            "Publishing over rsync or to GitHub runs the rsync and git programs, \
             which this platform does not let an app do. Export a zip instead."
                .to_string(),
        );
    }
    (true, String::new())
}

/// Publish a project to wherever it is pointed.
///
/// `dry_run` rehearses: rsync says what it would send without sending it, and
/// a GitHub publish checks the repository and the branch are reachable with the
/// token stored, without committing anything. It is the same command because
/// the useful question — "is this set up right?" — is one somebody asks with
/// their finger already on Publish.
///
/// **`(async)` is load-bearing.** A synchronous Tauri command runs on the
/// **main thread**, which is the accident the PSD pipeline had to be dug out
/// of — see `psd_pipeline::exclusive`. This one stages tens of megabytes and
/// then waits on a network transfer that can take a minute, so without it the
/// window would stop drawing for the whole of a publish and any progress shown
/// would be a still picture.
#[tauri::command(async)]
pub fn publish_to_target(id: String, dry_run: bool) -> Result<Report, String> {
    let (ok, reason) = can_run();
    if !ok {
        return Err(reason);
    }

    let meta = crate::store::read_meta(&id)?;
    if !meta.publish.is_set() {
        return Err("This project has no publish target yet".into());
    }

    match meta.publish.kind {
        TargetKind::None => Err("This project has no publish target yet".into()),
        TargetKind::Rsync => {
            let settings = publish_targets::read();
            let server = settings
                .servers
                .iter()
                .find(|server| server.id == meta.publish.server)
                .ok_or_else(|| {
                    // The server was deleted out from under the project, which
                    // is the one way a saved target can stop naming anything.
                    "That server is not set up on this device any more. Pick \
                     another in Publish → Where this publishes."
                        .to_string()
                })?;
            with_site(&meta, |site, _work| {
                crate::deploy_rsync::push(server, &meta.publish, site, dry_run)
            })
        }
        TargetKind::Github => {
            let settings = publish_targets::read();
            let account = settings
                .github
                .ok_or_else(|| "Sign in to GitHub first, in Publish.".to_string())?;
            // A GitHub rehearsal is one question over the network, so it does
            // not stage the site at all. rsync's is the other way round — it
            // compares file lists — which is why only one of them short-cuts.
            if dry_run {
                return crate::deploy_github::check(&account, &meta.publish);
            }
            with_site(&meta, |site, work| {
                crate::deploy_github::push(&account, &meta.publish, site, &meta.name, work)
            })
        }
    }
}

/// Write the site into a staging directory, run something over it, then take
/// the directory away again.
///
/// Staged rather than pushed from the store directly, because a published site
/// is not a directory that exists anywhere: it is `game/` and `assets/` and two
/// vendored runtimes and a generated config, assembled. rsync and git both want
/// a tree to look at, so one is built for them.
///
/// The staging directory is removed whether the push worked or not — a failed
/// publish leaving a second copy of every asset in the app's data directory is
/// how a device runs out of room.
fn with_site<F>(meta: &ProjectMeta, run: F) -> Result<Report, String>
where
    F: FnOnce(&Path, &Path) -> Result<Report, String>,
{
    let root = staging_dir(&meta.id)?;
    let site = root.join("site");
    // A second directory beside it, for the one publish that needs somewhere
    // to work: a GitHub push clones the branch it is about to commit onto.
    // rsync is handed nothing and ignores it.
    let work = root.join("repo");
    let result = stage(&meta.id, &site).and_then(|_| run(&site, &work));
    let _ = std::fs::remove_dir_all(&root);
    result
}

/// A directory of this project's own, emptied first.
///
/// Under the app's data directory rather than the system temp: the site is
/// tens of megabytes of sprite sheets, and it is written beside the store it
/// was read from, on the same filesystem, where the platform will not clear it
/// out from under a transfer in progress.
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
/// The zip's root directory is deliberately dropped: an archive unpacks into a
/// directory named after the project, and a server's document root or a
/// repository's branch is already the place the site goes. Publishing into
/// `public_html/nine-roads/` when the target said `public_html/` would be this
/// code naming a directory somebody else owns.
pub fn stage(project_id: &str, dest: &Path) -> Result<(), String> {
    let (_root, entries) = crate::publish::site_entries(project_id)?;
    for entry in entries {
        // Every `rel` is built here from a directory walk of the store, never
        // from anything a person typed — but it is joined to a path, so it is
        // checked like every other relative path in this app.
        let path = dest.join(crate::store::safe_relative(&entry.rel)?);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        // Copied rather than read and written, where there is a file to copy
        // from: a processed project is tens of megabytes of sprite sheets, and
        // there is no reason for any of them to be a `Vec<u8>` on the way.
        match &entry.source {
            crate::publish::SiteSource::Disk(from) => {
                std::fs::copy(from, &path)
                    .map(|_| ())
                    .map_err(|e| format!("Cannot copy {} to {}: {e}", from.display(), path.display()))
            }
            crate::publish::SiteSource::Generated(bytes) => std::fs::write(&path, bytes)
                .map_err(|e| format!("Cannot write {}: {e}", path.display())),
        }?;
    }
    Ok(())
}

// ── running a program, and saying what it said ──────────────────────────────

/// Run a program and hand back what it printed, whichever stream it used.
///
/// Both streams, because rsync says what it transferred on stdout and why it
/// could not on stderr, and a publish that failed with an empty message is a
/// publish nobody can fix.
pub fn run(
    program: &str,
    args: &[String],
    env: &[(&str, String)],
    cwd: Option<&Path>,
) -> Result<String, String> {
    let mut command = std::process::Command::new(program);
    command.args(args);
    for (key, value) in env {
        command.env(key, value);
    }
    if let Some(dir) = cwd {
        command.current_dir(dir);
    }

    let output = command.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            format!("`{program}` is not installed, or is not on this app's PATH")
        } else {
            format!("Could not run {program}: {e}")
        }
    })?;

    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if output.status.success() {
        Ok(text)
    } else {
        Err(text)
    }
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
