//! Publishing to a server: the site, over our own SSH connection.
//!
//! This was one `rsync` run. It is SFTP now, and the reason is the iPad — see
//! `deploy.rs` for that argument in full, and *Known gaps* for what it costs.
//! The short version: iOS does not let an app run another program, every iOS
//! app that does this work links the functionality instead, and rsync is the
//! one tool here with no library form to link. The delta algorithm is
//! published as a library; the sending half of the wire protocol is not, and
//! the protocol is defined by rsync's source rather than by a specification.
//!
//! What replaces the delta transfer is a manifest: SHA-256 per file, left
//! beside the site, read back next time, and only what differs is sent. That
//! is skipping unchanged *files* rather than diffing inside them, which for a
//! static site is most of the benefit. See `site_files`.
//!
//! ## One connection, two things done over it
//!
//! `Session::open` is the whole of getting to a server — host key, key
//! authentication, an SFTP channel — and both callers use it: `compare`, which
//! lists what is there so the Publish sheet can draw its left pane, and
//! `push`, which sends what was ticked. Opening it twice for those two would
//! be two host key checks and two authentications for one thing a person
//! pressed once.
//!
//! ## The host key
//!
//! With our own client we own the check that `ssh` would have done, and
//! getting it wrong is a real vulnerability rather than an inconvenience:
//! accepting any key at all means a publish can be handed to whoever answers
//! on that address. So it is **trust on first use**, with no terminal to ask
//! at — the first connection records the fingerprint it saw, and every
//! connection after insists on the same one. A mismatch stops the publish and
//! names both; getting past it takes a deliberate *Forget*, because the
//! difference between a rebuilt server and somebody in the middle is not
//! something this app can work out.

use crate::deploy::{tail, Report};
use crate::project::PublishTarget;
use crate::publish_targets::Server;
use crate::site_files::{self, Entry};
use russh::client;
use russh::keys::{HashAlg, PrivateKeyWithHashAlg};
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use tokio::io::AsyncWriteExt;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::{Arc, Mutex};

/// The file a publish leaves beside the site so the next one can be
/// incremental. Named in capitals and without a dot so it is visible in a
/// listing: a hidden file nobody knows about, in a directory somebody else's
/// web server is serving, is worse manners than an obvious one.
pub const MANIFEST: &str = "IDLEWILD-MANIFEST";

/// A connection to a server, with SFTP already running on it.
pub struct Session {
    sftp: SftpSession,
    /// The fingerprint this connection saw, for the report to name on a first
    /// visit.
    pub fingerprint: Option<String>,
    /// Whether this was the first visit, and so the one that recorded it.
    pub first_visit: bool,
}

impl Session {
    /// Reach a server: host key, key authentication, SFTP.
    ///
    /// `say` is told each step as it is reached. Publishing is four things
    /// that can each fail for a different reason — reaching the host, agreeing
    /// the host key, the key being accepted, SFTP starting — and a failure
    /// with none of them named is a failure somebody has to guess at. It is
    /// the difference between "it did not work" and "authenticated fine, SFTP
    /// would not start", which are different problems with different fixes.
    pub async fn open(server: &Server, say: &(dyn Fn(&str) + Send + Sync)) -> Result<Session, String> {
        let key = server.private_key()?;
        // No default user. ssh's own rule — the account you are logged in as —
        // has no meaning on a device with no shell, and the plausible stand-in
        // is `root`, which is the wrong thing to try against somebody's server
        // without being asked to.
        if server.user.is_empty() {
            return Err(format!(
                "Name the user to log in to {} as, on its row in Publish → Logins.",
                server.host
            ));
        }

        say(&format!(
            "Connecting to {}:{} as {}",
            server.host,
            server.port_or_default(),
            server.user
        ));
        let first_visit = server.host_key.is_empty();
        let trust = Trust::new(server);
        let seen = trust.seen.clone();
        let connected = client::connect(
            Arc::new(client::Config::default()),
            (server.host.as_str(), server.port_or_default()),
            trust,
        )
        .await;

        // Whatever the handler saw, even when the connection then failed —
        // which is the case that matters, because refusing the host key *is* a
        // failure and the reason for it has to be said in full rather than as
        // whatever russh calls a rejected key exchange.
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

        // Recorded once the connection stands. A server that then refuses the
        // key has still proved which server it is, so this is not undone by
        // what follows: being asked to accept the same new host key twice is
        // being asked twice.
        if let Some(seen) = &fingerprint {
            say(&format!(
                "Host key {seen}{}",
                if first_visit { " — first visit, recorded" } else { "" }
            ));
            if first_visit {
                crate::publish_targets::learn_host_key(&server.id, seen)?;
            }
        }

        let auth = session
            .authenticate_publickey(
                server.user.as_str(),
                PrivateKeyWithHashAlg::new(Arc::new(key), None),
            )
            .await
            .map_err(|e| format!("{} refused the connection: {e}", server.host))?;
        if !auth.success() {
            return Err(format!(
                "{} would not accept the ssh key for {}. Add its public half to \
                 that account's authorized_keys — `ssh-copy-id` is the usual way.",
                server.host, server.user
            ));
        }

        say("Key accepted");
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
        say("SFTP ready");

        Ok(Session {
            sftp,
            fingerprint,
            first_visit,
        })
    }

    /// Every file under a directory, with its size, relative to it.
    ///
    /// The manifest is left out: it is this app's bookkeeping rather than part
    /// of the site, and a pane offering to remove it would be offering to make
    /// the next publish send everything.
    pub async fn listing(&self, directory: &str) -> Vec<(String, u64)> {
        let mut out = Vec::new();
        let mut stack = vec![String::new()];
        while let Some(prefix) = stack.pop() {
            let here = if prefix.is_empty() {
                directory.to_string()
            } else {
                format!("{directory}/{prefix}")
            };
            let Ok(entries) = self.sftp.read_dir(&here).await else {
                continue;
            };
            for entry in entries {
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
                } else if rel != MANIFEST {
                    out.push((rel, entry.metadata().size.unwrap_or(0)));
                }
            }
        }
        out.sort();
        out
    }

    /// The manifest the last publish left, or nothing.
    ///
    /// Nothing is not an error: a directory nobody has published to, a manifest
    /// somebody deleted, or a site first put there by hand all mean the same
    /// thing — nothing can be proved unchanged — and failing a publish over a
    /// missing convenience would be the wrong trade.
    pub async fn manifest(&self, directory: &str) -> BTreeMap<String, String> {
        match self.sftp.read(format!("{directory}/{MANIFEST}")).await {
            Ok(bytes) => site_files::parse_manifest(&String::from_utf8_lossy(&bytes)),
            Err(_) => BTreeMap::new(),
        }
    }

    /// Write a file, creating it if it is not there and truncating it if it is.
    ///
    /// **Not `SftpSession::write`.** That helper opens with `OpenFlags::WRITE`
    /// alone, which is "open the file for writing" and not "make me this
    /// file" — so every file that did not already exist failed with
    /// `SSH_FX_NO_SUCH_FILE`, and the message a person saw was *No such file*
    /// about the file they were trying to create. Which is to say the server
    /// publish never worked for a new site, and read as a permissions problem
    /// every time. `create` is the flag set that means what this wants:
    /// `CREATE | TRUNCATE | WRITE`.
    ///
    /// The truncate matters on its own, too: without it, rewriting a file with
    /// a shorter one would leave the tail of the old one on the end.
    pub async fn put(&self, path: &str, bytes: &[u8]) -> Result<(), String> {
        let mut file = self
            .sftp
            .open_with_flags(path, PUT_FLAGS)
            .await
            .map_err(|e| format!("Cannot create {path}: {}", explain(&e)))?;
        // `write_all` goes through the file's own `AsyncWrite`, which chunks to
        // the negotiated packet size — a 10 MB spritesheet is not one packet.
        file.write_all(bytes)
            .await
            .map_err(|e| format!("Cannot write {path}: {e}"))?;
        file.shutdown()
            .await
            .map_err(|e| format!("Cannot close {path}: {e}"))
    }

    /// Whether the directory a publish is aimed at is there, said plainly.
    ///
    /// Checked before anything is written, because the failure it replaces is
    /// the worst kind: SFTP answers `SSH_FX_NO_SUCH_FILE` for a write into a
    /// directory that does not exist, so the error named the *file* and read
    /// as though the file were the problem. Naming the directory once, up
    /// front, is the difference between a minute and an afternoon.
    ///
    /// It is not created. Making a directory somewhere in a stranger's
    /// document root is not something to do because a field had a typo in it,
    /// and the message says how to make it instead.
    pub async fn require(&self, directory: &str) -> Result<(), String> {
        match self.sftp.metadata(directory.to_string()).await {
            Ok(meta) if meta.is_dir() => Ok(()),
            Ok(_) => Err(format!("{directory} is a file, not a directory")),
            Err(_) => Err(format!(
                "{directory} does not exist on the server, or this login cannot \
                 see it. Publishing writes into a directory; it does not create \
                 one. Make it first — `mkdir -p {directory}` — and check the \
                 login owns it."
            )),
        }
    }

    pub async fn close(self) {
        let _ = self.sftp.close().await;
    }
}

/// How a file is opened to be written.
///
/// A named constant so the bug it fixes has somewhere to be asserted. All
/// three flags are load-bearing: `WRITE` alone — which is what
/// `SftpSession::write` uses — means "open this file for writing" and fails
/// with `SSH_FX_NO_SUCH_FILE` when there is no such file, so every new file
/// failed and the message named the file rather than the flag. `TRUNCATE`
/// matters on its own: without it, rewriting a file with a shorter one leaves
/// the tail of the old one on the end.
pub(crate) const PUT_FLAGS: OpenFlags = OpenFlags::CREATE
    .union(OpenFlags::TRUNCATE)
    .union(OpenFlags::WRITE);

/// An SFTP error, in words that say what to do.
///
/// The protocol's own vocabulary is four status codes, and two of them arrive
/// for reasons that have nothing to do with what they are called: *no such
/// file* is what a server says when the **directory** above a file is missing,
/// and *failure* is what it says for most permission problems.
fn explain(error: &russh_sftp::client::error::Error) -> String {
    let said = error.to_string();
    if said.contains("No such file") {
        return format!("{said} — the directory above it may not exist");
    }
    if said.contains("Permission denied") {
        return format!("{said} — this login cannot write there");
    }
    said
}

/// Send what was chosen, remove what was chosen, and leave the manifest saying
/// what is now there.
///
/// `chosen` is the right pane's ticks and `remove` is the left pane's; `None`
/// for the first means everything that differs, which is what Publish does
/// when nobody has touched the list.
pub async fn push(
    session: &Session,
    server: &Server,
    target: &PublishTarget,
    site: &Path,
    chosen: Option<&[String]>,
    remove: &[String],
    say: &(dyn Fn(&str) + Send + Sync),
) -> Result<Report, String> {
    let directory = clean_directory(&target.directory)?;
    // Before anything is written, and before the manifest is read: a missing
    // directory is the commonest way this fails and the one whose native error
    // message points at the wrong thing entirely.
    session.require(&directory).await?;

    let local = site_files::scan(site)?;
    let previous = session.manifest(&directory).await;
    let sending = site_files::selected(&local, &previous, chosen);
    say(&format!(
        "{} of {} files to send to {directory}",
        sending.len(),
        local.len()
    ));

    make_dirs(&session.sftp, &directory, &sending).await;
    let total = sending.len();
    for (index, entry) in sending.iter().enumerate() {
        let path = format!("{directory}/{}", entry.rel);
        let bytes = std::fs::read(site.join(&entry.rel))
            .map_err(|e| format!("Cannot read {}: {e}", entry.rel))?;
        say(&format!("{}/{total} {}", index + 1, entry.rel));
        session.put(&path, &bytes).await?;
    }

    // Counted rather than assumed: a file that would not delete — a permission,
    // a directory where a file was expected — must not be reported as removed.
    // It is not a reason to fail the publish either; the site itself is up.
    let mut removed = Vec::new();
    for rel in remove {
        match session.sftp.remove_file(format!("{directory}/{rel}")).await {
            Ok(()) => {
                say(&format!("removed {rel}"));
                removed.push(rel.clone());
            }
            Err(e) => say(&format!("could not remove {rel}: {e}")),
        }
    }

    let manifest = site_files::next_manifest(&previous, &sending, &removed);
    session
        .put(
            &format!("{directory}/{MANIFEST}"),
            site_files::render_manifest(&manifest).as_bytes(),
        )
        .await?;

    // A first connection says which host key it accepted. There is no terminal
    // to have asked at, so the next best thing is telling somebody afterwards
    // what was trusted, in a form they can compare against what the server says
    // about itself.
    let learned = match (session.first_visit, &session.fingerprint) {
        (true, Some(seen)) => format!("\nFirst connection to {}. Host key {seen}", server.host),
        _ => String::new(),
    };

    say("Done");
    Ok(Report {
        summary: format!("Published to {directory} on {}", server.name()),
        log: format!(
            "{}{learned}",
            tail(
                &format!(
                    "{} {} sent{}\n{}",
                    sending.len(),
                    if sending.len() == 1 { "file" } else { "files" },
                    if removed.is_empty() {
                        String::new()
                    } else {
                        format!(", {} removed", removed.len())
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
    })
}

/// `mkdir -p`, once per directory rather than once per file.
///
/// SFTP has no such thing: `create_dir` makes one level and fails if it is
/// already there. So the set of directories the sent files need is worked out
/// first — `js/shared` implies `js` — and each is made once. Sorted order puts
/// a parent before its children, because a path is a prefix of what is under
/// it.
///
/// Only the directories **below** the target. The target itself and everything
/// above it are somebody else's to make: a publish that tried to `mkdir /var`
/// would be a round trip that fails every time, on every publish, and the write
/// that follows says plainly enough if the target is really missing.
async fn make_dirs(sftp: &SftpSession, directory: &str, sending: &[&Entry]) {
    let mut needed: BTreeSet<&str> = BTreeSet::new();
    for entry in sending {
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
/// russh's `check_server_key` defaults to rejecting everything and says so; the
/// tempting thing to write is `Ok(true)`, which is every SSH client's
/// man-in-the-middle bug.
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
        // the same trust-on-first-use answer as for a bare key.
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
/// visit after has to match exactly. Its own function because it is the one
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
         you know the server was rebuilt, use Forget key on its row and publish \
         again.",
        server.host, server.host_key, seen
    )
}

/// The remote directory, without the trailing slash the paths add themselves.
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
