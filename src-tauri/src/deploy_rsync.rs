//! Publishing over rsync: the site, pushed to a directory on a server.
//!
//! One `rsync` run over the staged site — see `deploy.rs` for why it is a
//! program rather than a library, and for what a publish must never do.
//!
//! ## The flags, and why each one is there
//!
//! ```text
//! -r -l -t          recurse, keep symlinks as symlinks, keep modified times
//! -z                compress in flight
//! --protect-args    the remote shell does not get to re-split the path
//! --delete          only when the target asks for it
//! --dry-run         a rehearsal
//! -e ssh …          BatchMode, and the port and key the server was set up with
//! ```
//!
//! **`-a` is deliberately not used.** Archive mode carries permissions,
//! ownership and groups, and a published site does not want any of them: the
//! files were written into a staging directory by this app a second ago, so
//! their modes say something about this machine's umask and nothing about what
//! a web server should serve. Pushing them makes a document root's permissions
//! a function of whichever device published last.
//!
//! **`--delete` is a switch on the target, off by default.** Deleting what is
//! at the far end and not here is exactly right for a directory that holds
//! nothing but this site, and is how somebody loses a `.well-known` or a
//! neighbouring app. The sheet says which it is doing.
//!
//! **`BatchMode=yes` matters more than it looks.** Without it a server that
//! wants a password gets one prompt, on a stdin that is not attached to
//! anything, and the publish hangs behind a modal sheet with a spinner on it.
//! With it, the same server fails in a second with a message naming the key.

use crate::deploy::{run, tail, Report};
use crate::project::PublishTarget;
use crate::publish_targets::Server;
use std::path::Path;

pub fn push(
    server: &Server,
    target: &PublishTarget,
    site: &Path,
    dry_run: bool,
) -> Result<Report, String> {
    let directory = clean_directory(&target.directory)?;
    // Checked again here rather than trusted from the settings sheet: rsync
    // reads a leading dash as an option wherever it appears in its argv, and
    // this is the function that builds that argv.
    if server.host.starts_with('-') || server.user.starts_with('-') {
        return Err("A host or user cannot start with a dash".into());
    }

    let mut args: Vec<String> = vec![
        "-rltz".into(),
        // The remote path is expanded by the *remote* shell, which is the one
        // shell this app cannot keep a string away from. This is how rsync
        // says "send it protected" — without it a directory with a space in it
        // becomes two arguments and the site lands in neither.
        "--protect-args".into(),
        "-e".into(),
        ssh_command(server),
    ];
    if target.prune {
        args.push("--delete".into());
    }
    if dry_run {
        // `-i` as well, so the rehearsal says what it *would* do per file
        // rather than listing names with no verb against them.
        args.push("--dry-run".into());
        args.push("-i".into());
    } else {
        args.push("-v".into());
    }

    // The trailing slash is the whole difference between "put the site in that
    // directory" and "put a directory called `site` in that directory", and it
    // is the mistake everybody makes with rsync exactly once.
    args.push(format!("{}/", site.display()));
    args.push(format!("{}:{directory}/", server.address()));

    let output = run("rsync", &args, &[], None)?;
    let where_to = format!("{} on {}", directory, server.name());
    Ok(Report {
        summary: if dry_run {
            format!("Would publish to {where_to}")
        } else {
            format!("Published to {where_to}")
        },
        log: tail(&output, 40),
        dry_run,
    })
}

/// How rsync is told to reach the server.
///
/// One string because that is what `-e` takes, and the pieces in it are a
/// port and a path this app put there — neither is ever a shell's to read,
/// since rsync passes this to `execvp` after splitting on spaces. A key file
/// with a space in its name is the one thing that would not survive that, and
/// it is why the picker writes the path rather than a person typing it.
pub(crate) fn ssh_command(server: &Server) -> String {
    let mut parts = vec![
        "ssh".to_string(),
        // No password prompt on a stdin nobody can see. A server that wants
        // one fails with a message instead of hanging behind a sheet.
        "-o".to_string(),
        "BatchMode=yes".to_string(),
    ];
    if let Some(port) = server.port {
        parts.push("-p".to_string());
        parts.push(port.to_string());
    }
    if let Some(identity) = &server.identity_file {
        parts.push("-i".to_string());
        parts.push(identity.clone());
    }
    parts.join(" ")
}

/// The remote directory, without the trailing slash rsync's own argument adds
/// and without the leading dash that would make it an option.
///
/// An empty directory is refused rather than defaulted: rsync would read
/// `host:` as the login's home, and publishing a site over the top of
/// somebody's home directory is not a thing to do because a field was blank.
pub(crate) fn clean_directory(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Name the directory on the server this project publishes into".into());
    }
    if trimmed.starts_with('-') {
        return Err("A directory cannot start with a dash".into());
    }
    Ok(trimmed.to_string())
}
