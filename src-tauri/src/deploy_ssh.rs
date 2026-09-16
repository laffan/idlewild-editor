//! Publishing to a server: the site, over our own SSH connection.
//!
//! This was one `rsync` run. It is SFTP now, and the reason is the iPad.
//!
//! ## Why not rsync
//!
//! iOS does not let a third-party app create a child process, so the `rsync`
//! binary cannot be run there — that part of the original note was right. What
//! was wrong was the conclusion. Every iOS app that does this kind of work
//! links the functionality instead of spawning the tool: Working Copy is
//! libgit2, a-Shell's commands are dylibs in its own bundle. `deploy_github`
//! now does exactly that, because libgit2 exists.
//!
//! **rsync is the one tool here with no library form.** `librsync` and
//! `fast_rsync` are the delta *algorithm* — the rolling checksum — not the
//! protocol. The Rust wire-protocol crates, `arrsync` and `rsyn`, implement
//! the listing and downloading half against `rsyncd`; nothing implements the
//! sending client. And rsync's protocol is defined by rsync's source rather
//! than by a specification, so writing the sender is a project rather than a
//! dependency.
//!
//! SFTP over an SSH connection we make ourselves is the same job with the same
//! outcome, on every platform, with no binary: raw sockets are unrestricted on
//! iOS — App Transport Security governs `NSURLSession` and WebKit, not
//! sockets, which is how every SSH client on the App Store works.
//!
//! ## What is lost, and what is put back
//!
//! rsync's delta transfer. A changed file is sent whole rather than as a diff
//! against what is already there. What is *not* lost is skipping the files
//! that have not changed, which is most of the practical benefit: a publish
//! leaves a `MANIFEST` beside the site listing every file's SHA-256, reads it
//! back next time, and sends only what differs. That is our manifest rather
//! than rsync's rolling checksum, and it is honest about being so — a site
//! whose manifest is missing or unreadable is simply sent in full.
//!
//! ## The host key
//!
//! With our own client we own the check that `ssh` would have done, and
//! getting it wrong is a real vulnerability rather than an inconvenience:
//! accepting any key at all means a publish can be handed to whoever answers
//! on that address. So it is **trust on first use**, with no terminal to ask
//! at — the first connection records the fingerprint it saw, and every
//! connection after it insists on the same one. A mismatch stops the publish
//! and names both fingerprints; getting past it takes a deliberate *Forget*,
//! because the difference between a rebuilt server and somebody in the middle
//! is not something this app can work out.

use crate::deploy::{tail, Report};
use crate::project::PublishTarget;
use crate::publish_targets::Server;
use russh::client;
use russh::keys::{HashAlg, PrivateKeyWithHashAlg};
use russh_sftp::client::SftpSession;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::{Arc, Mutex};

/// The file a publish leaves beside the site so the next one can be
/// incremental. Named in capitals and without a dot so it is visible in a
/// listing: a hidden file nobody knows about, in a directory somebody else's
/// web server is serving, is worse manners than an obvious one.
const MANIFEST: &str = "IDLEWILD-MANIFEST";

pub async fn push(
    server: &Server,
    target: &PublishTarget,
    site: &Path,
    dry_run: bool,
) -> Result<Report, String> {
    let directory = clean_directory(&target.directory)?;
    let key = server.private_key()?;
    let local = scan(site)?;

    let first_visit = server.host_key.is_empty();
    let trust = Trust::new(server);
    let seen = trust.seen.clone();
    let config = Arc::new(client::Config::default());
    let connected = client::connect(
        config,
        (server.host.as_str(), server.port_or_default()),
        trust,
    )
    .await;

    // Whatever the handler saw, even when the connection then failed — which
    // is the case that matters, because refusing the host key *is* a failure
    // and the reason for it has to be said in full rather than as whatever
    // russh calls a rejected key exchange.
    let fingerprint = seen.lock().ok().and_then(|s| s.clone());
    let mut session = match connected {
        Ok(session) => session,
        Err(e) => {
            if let Some(seen) = &fingerprint {
                if !first_visit && seen != &server.host_key {
                    return Err(host_key_changed(server, seen));
                }
            }
            return Err(format!("Cannot reach {}: {e}", server.host));
        }
    };

    // Recorded once the connection stands. A server that then refuses the key
    // has still proved which server it is, so this is not undone by what
    // follows: being asked to accept the same new host key twice is being
    // asked twice.
    if first_visit {
        if let Some(seen) = &fingerprint {
            crate::publish_targets::learn_host_key(&server.id, seen)?;
        }
    }

    // No default. ssh's own rule — the user you are logged in as — has no
    // meaning on a device with no shell, and the plausible stand-in is `root`,
    // which is the wrong thing to try against somebody's server without being
    // asked to.
    if server.user.is_empty() {
        return Err(format!(
            "Name the user to log in to {} as, on its row in Servers and accounts.",
            server.host
        ));
    }
    let user = server.user.as_str();
    let auth = session
        .authenticate_publickey(user, PrivateKeyWithHashAlg::new(Arc::new(key), None))
        .await
        .map_err(|e| format!("{} refused the connection: {e}", server.host))?;
    if !auth.success() {
        return Err(format!(
            "{} would not accept the ssh key for {user}. Add its public half to \
             that account's authorized_keys — `ssh-copy-id` is the usual way.",
            server.host
        ));
    }

    let channel = session
        .channel_open_session()
        .await
        .map_err(|e| format!("Cannot open a channel to {}: {e}", server.host))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("{} would not start SFTP: {e}", server.host))?;
    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| format!("SFTP would not start on {}: {e}", server.host))?;

    let remote = read_manifest(&sftp, &directory).await;
    let sending = changed(&local, &remote);
    let extra = if target.prune {
        surplus(&sftp, &directory, &local).await?
    } else {
        Vec::new()
    };

    if dry_run {
        return Ok(rehearsal(server, &directory, &local, &sending, &extra, target.prune));
    }

    make_dirs(&sftp, &directory, &sending).await;
    for entry in &sending {
        let path = format!("{directory}/{}", entry.rel);
        let bytes = std::fs::read(site.join(&entry.rel))
            .map_err(|e| format!("Cannot read {}: {e}", entry.rel))?;
        // `write` goes through the file's own `AsyncWrite`, which chunks to the
        // negotiated packet size — a 10 MB spritesheet is not one SFTP packet.
        sftp.write(&path, &bytes)
            .await
            .map_err(|e| format!("Cannot write {path}: {e}"))?;
    }
    // Counted rather than assumed: a file that would not delete — a permission,
    // a directory where a file was expected — must not be reported as removed.
    // It is not a reason to fail the publish either; the site itself is up.
    let mut removed = 0usize;
    for path in &extra {
        if sftp.remove_file(path).await.is_ok() {
            removed += 1;
        }
    }
    let manifest = local
        .iter()
        .map(|entry| format!("{} {}", entry.hash, entry.rel))
        .collect::<Vec<_>>()
        .join("\n");
    sftp.write(&format!("{directory}/{MANIFEST}"), manifest.as_bytes())
        .await
        .map_err(|e| format!("Cannot write the manifest: {e}"))?;

    let _ = sftp.close().await;

    // A first connection says which host key it accepted. There is no
    // terminal to have asked at, so the next best thing is telling somebody
    // afterwards what was trusted, in a form they can compare against what the
    // server says about itself.
    let learned = match (first_visit, &fingerprint) {
        (true, Some(seen)) => format!("\nFirst connection to {}. Host key {seen}", server.host),
        _ => String::new(),
    };

    Ok(Report {
        summary: format!("Published to {directory} on {}", server.name()),
        log: format!(
            "{}{learned}",
            tail(
                &format!(
                    "{} {} sent, {} unchanged{}\n{}",
                    sending.len(),
                    if sending.len() == 1 { "file" } else { "files" },
                    local.len() - sending.len(),
                    if removed == 0 {
                        String::new()
                    } else {
                        format!(", {removed} removed")
                    },
                    sending
                        .iter()
                        .map(|entry| entry.rel.as_str())
                        .collect::<Vec<_>>()
                        .join("\n")
                ),
                40,
            )
        ),
        dry_run: false,
    })
}

/// What a publish would do, said in the same shape rsync's `--dry-run` said it.
fn rehearsal(
    server: &Server,
    directory: &str,
    local: &[Entry],
    changed: &[&Entry],
    extra: &[String],
    prune: bool,
) -> Report {
    let mut lines: Vec<String> = changed
        .iter()
        .map(|entry| format!("send  {}", entry.rel))
        .collect();
    lines.extend(extra.iter().map(|path| format!("remove {path}")));
    if lines.is_empty() {
        lines.push("Nothing to send — the far end already matches.".into());
    }
    if !prune {
        lines.push("Tidy up is off, so nothing at the far end is removed.".into());
    }
    Report {
        summary: format!(
            "Would publish {} of {} files to {directory} on {}",
            changed.len(),
            local.len(),
            server.name()
        ),
        log: tail(&lines.join("\n"), 40),
        dry_run: true,
    }
}

// ── the local side ──────────────────────────────────────────────────────────

/// One file of the staged site: where it goes, and what is in it.
pub struct Entry {
    pub rel: String,
    /// SHA-256, hex. What the manifest carries and what "changed" means.
    pub hash: String,
}

/// Every file under the staged site, hashed.
///
/// Hashed rather than compared by size and time: the staging directory is
/// written fresh for every publish, so every file's modified time is *now* and
/// says nothing at all. A size alone would call an edited scene file unchanged
/// often enough to matter.
pub fn scan(site: &Path) -> Result<Vec<Entry>, String> {
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
            out.push(Entry { rel, hash: hex(&sha256(&bytes)) });
        }
    }
    out.sort_by(|a, b| a.rel.cmp(&b.rel));
    Ok(out)
}

// ── the remote side ─────────────────────────────────────────────────────────

/// The manifest the last publish left, or nothing.
///
/// Nothing is not an error: a directory nobody has published to, a manifest
/// somebody deleted, or a site first put there by hand all mean the same
/// thing — send everything — and failing a publish over a missing convenience
/// would be the wrong trade.
async fn read_manifest(sftp: &SftpSession, directory: &str) -> BTreeMap<String, String> {
    let Ok(bytes) = sftp.read(format!("{directory}/{MANIFEST}")).await else {
        return BTreeMap::new();
    };
    parse_manifest(&String::from_utf8_lossy(&bytes))
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

/// Which of the site's files the far end does not already have.
///
/// A file the manifest has never heard of is changed, and so is one whose hash
/// differs. Both are "send it", and the distinction between them is not worth
/// a branch — what matters is that neither is silently skipped.
pub fn changed<'a>(
    local: &'a [Entry],
    remote: &BTreeMap<String, String>,
) -> Vec<&'a Entry> {
    local
        .iter()
        .filter(|entry| remote.get(&entry.rel) != Some(&entry.hash))
        .collect()
}

/// What is at the far end that the site no longer has.
///
/// Walked over SFTP rather than trusted from the manifest: a file the manifest
/// never knew about is exactly the kind of thing *Tidy up* is for, and a prune
/// that only removed what it had put there would leave the last hand-uploaded
/// copy of the site sitting underneath this one for good.
async fn surplus(
    sftp: &SftpSession,
    directory: &str,
    local: &[Entry],
) -> Result<Vec<String>, String> {
    let keep: BTreeSet<&str> = local.iter().map(|entry| entry.rel.as_str()).collect();
    let mut out = Vec::new();
    let mut stack = vec![String::new()];
    while let Some(prefix) = stack.pop() {
        let here = if prefix.is_empty() {
            directory.to_string()
        } else {
            format!("{directory}/{prefix}")
        };
        let Ok(listing) = sftp.read_dir(&here).await else {
            continue;
        };
        for entry in listing {
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let rel = if prefix.is_empty() {
                name.clone()
            } else {
                format!("{prefix}/{name}")
            };
            if entry.file_type().is_dir() {
                stack.push(rel);
            } else if rel != MANIFEST && !keep.contains(rel.as_str()) {
                out.push(format!("{directory}/{rel}"));
            }
        }
    }
    out.sort();
    Ok(out)
}

/// `mkdir -p`, once per directory rather than once per file.
///
/// SFTP has no such thing: `create_dir` makes one level and fails if it is
/// already there. So the set of directories the changed files need is worked
/// out first — `js/shared` implies `js` — and each is made once. Sorted order
/// puts a parent before its children, because a path is a prefix of what is
/// under it.
///
/// Only the directories **below** the target. The target itself and everything
/// above it are somebody else's to make: a publish that tried to `mkdir /var`
/// would be a round trip that fails every time, on every publish, and the
/// write that follows says plainly enough if the target is really missing.
///
/// An error on each is ignored rather than the directory being checked for
/// first, because "does it exist" doubles the round trips to save nothing.
async fn make_dirs(sftp: &SftpSession, directory: &str, changed: &[&Entry]) {
    let mut needed: BTreeSet<&str> = BTreeSet::new();
    for entry in changed {
        let mut rest = entry.rel.as_str();
        while let Some((parent, _)) = rest.rsplit_once('/') {
            needed.insert(parent);
            rest = parent;
        }
    }
    for dir in needed {
        let _ = sftp.create_dir(format!("{directory}/{dir}")).await;
    }
}

// ── the host key ────────────────────────────────────────────────────────────

/// The client handler, whose one job is deciding whether this is the right
/// server.
///
/// `check_server_key` defaults to rejecting everything and russh says so; the
/// tempting thing to write is `Ok(true)`, which is every SSH client's
/// man-in-the-middle bug. This compares against what was recorded the first
/// time and reports what it saw so the caller can record it.
struct Trust {
    /// The fingerprint recorded for this server, or empty on a first visit.
    expected: String,
    /// What this connection actually saw, for the caller to store — and, when
    /// the connection is refused, to say what it was refused over.
    seen: Arc<Mutex<Option<String>>>,
}

impl Trust {
    fn new(server: &Server) -> Self {
        Trust {
            expected: server.host_key.clone(),
            seen: Arc::new(Mutex::new(None)),
        }
    }
}

impl client::Handler for Trust {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        // A certificate is a key signed by an authority, and checking one
        // properly means carrying the authority's key — which nothing in this
        // app has anywhere to come from. Fingerprinting the key inside it is
        // the same trust-on-first-use answer as for a bare key, and is what a
        // server presenting a certificate to a client that knows nothing about
        // the authority gets.
        let key = match server_public_key {
            russh::keys::PublicKeyOrCertificate::PublicKey { key, .. } => key.clone(),
            russh::keys::PublicKeyOrCertificate::Certificate(cert) => {
                match russh::keys::PublicKey::try_from(cert.public_key().clone()) {
                    Ok(key) => key,
                    Err(_) => return Ok(false),
                }
            }
        };
        let fingerprint = key.fingerprint(HashAlg::Sha256).to_string();
        if let Ok(mut slot) = self.seen.lock() {
            *slot = Some(fingerprint.clone());
        }
        Ok(trusts(&self.expected, &fingerprint))
    }
}

/// Whether a host key is the one this server is supposed to have.
///
/// An empty expectation is a first visit and is accepted — recorded by the
/// caller, which is the only place that can write to the settings file. Every
/// visit after it has to match exactly. Its own function because it is the one
/// decision in this file that a mistake in is a vulnerability rather than a
/// bug, and it should be readable without an SSH session around it.
pub fn trusts(expected: &str, seen: &str) -> bool {
    expected.is_empty() || expected == seen
}

/// The message a mismatch gets, which has to be the loud one.
pub fn host_key_changed(server: &Server, seen: &str) -> String {
    format!(
        "The host key for {} has changed.\n\nExpected {}\nGot      {}\n\nThat is \
         either a rebuilt server or somebody standing in the middle of the \
         connection, and this app cannot tell which. Nothing was published. If \
         you know the server was rebuilt, use Forget host key on its row and \
         publish again.",
        server.host,
        server.host_key,
        seen
    )
}

// ── odds and ends ───────────────────────────────────────────────────────────

/// The remote directory, with the trailing slash the paths add themselves.
///
/// An empty directory is refused rather than defaulted: it would mean the
/// login's home directory, and publishing a site over the top of somebody's
/// home directory because a field was blank is not a thing to do.
pub fn clean_directory(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Name the directory on the server this project publishes into".into());
    }
    if trimmed.contains("..") {
        return Err("A directory cannot contain ..".into());
    }
    Ok(trimmed.to_string())
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    use russh::keys::ssh_key::sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().into()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
