//! Who you are, for publishing — the half a project does not own.
//!
//! Publishing somewhere real needs two things that change at different rates.
//! A **login** belongs to the person and is entered once: the server you have
//! an ssh key on, the GitHub account your token is for. A **target** belongs to
//! a project and is entered per project: which directory on that server, which
//! repository and branch. This module holds the first; `project::PublishTarget`
//! is the second, stored in `meta.json` beside the render options.
//!
//! That split is the whole ask — log in once, then point each project
//! somewhere — and getting it wrong in the other direction is what makes
//! publishing feel like a password prompt.
//!
//! ## What is kept, and what is not
//!
//! ```text
//! com.idlewild.editor/
//!   publish.json        servers, and the GitHub login and its token
//! ```
//!
//! A file with `0600` on it, beside the project store. That is a real
//! trade-off and it is the honest one to state: this is not the system
//! keychain. Reaching Keychain and the iOS equivalent through Tauri means a
//! dependency and a platform pair, and until that is here a token lives in a
//! file only this user can read, in the directory that already holds every
//! project's source. Anything that can read it can already read those.
//!
//! **The token never crosses the IPC boundary.** `settings` answers with the
//! login name and nothing else — `has_token` is what the sheet shows — because
//! a secret handed to a webview is a secret in a webview's memory, and nothing
//! in the frontend needs it: the deploys run here.
//!
//! **The server half authenticates with an ssh key, and the key itself is
//! kept here.** Not a path to it. That is a deliberate change from pointing at
//! `~/.ssh/id_ed25519`, and it is what makes the iPad work: there is no
//! `~/.ssh` there to point into, and a file picked out of Files hands back a
//! security-scoped URL that is not readable again on the next launch. So a key
//! is *imported* — read once, checked that it parses, and stored — and
//! `key_source` remembers where it came from only so the row can say so.
//!
//! The same caveat as the token applies, and more sharply, because an ssh key
//! opens more doors than a scoped PAT: it is a file only this user can read, in
//! the directory that already holds every project's source. An encrypted key's
//! passphrase is stored beside it, which is the part worth thinking about
//! twice — it is the difference between "somebody who has this file has a key"
//! and "somebody who has this file has a usable key". It is optional, and a key
//! with no passphrase is the common case on a machine that is already
//! encrypted at rest.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// One server this install can rsync to.
///
/// A list rather than one, because a host is not an identity: a staging box
/// and a live one are two destinations under the same login, and a project
/// names which of them it means.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    /// Made here, not by the frontend — a project's target names one of these.
    pub id: String,
    /// What it is called in the picker. The host, if nobody typed anything.
    #[serde(default)]
    pub label: String,
    pub host: String,
    #[serde(default)]
    pub user: String,
    /// The ssh port, when it is not 22.
    #[serde(default)]
    pub port: Option<u16>,
    /// Where the key was imported from, so the row can say. Never read again.
    #[serde(default)]
    pub key_source: String,
    /// The private key itself, in its original PEM. Never leaves Rust.
    #[serde(default)]
    pub key: String,
    /// The passphrase, for a key that has one. Never leaves Rust.
    #[serde(default)]
    pub passphrase: String,
    /// The server's host key fingerprint, learned on the first connection.
    ///
    /// Trust on first use, which is what `ssh` itself does with an unknown
    /// host — except that there is no terminal here to ask, so the first
    /// connection records what it saw and every one after it insists on the
    /// same answer. Empty until then. Not a secret: it is shown on the row,
    /// because comparing it against what the server says it is is the only way
    /// anybody can check the first connection was not already the wrong one.
    #[serde(default)]
    pub host_key: String,
}

impl Server {
    pub fn name(&self) -> &str {
        if self.label.is_empty() {
            &self.host
        } else {
            &self.label
        }
    }

    /// The port to dial, which is 22 unless somebody said otherwise.
    pub fn port_or_default(&self) -> u16 {
        self.port.unwrap_or(22)
    }

    /// The key, parsed and decrypted, ready to authenticate with.
    ///
    /// Parsed at every connection rather than kept decoded: a private key held
    /// in memory for the life of the app is a private key in every crash
    /// report, and parsing one is microseconds.
    pub fn private_key(&self) -> Result<russh::keys::PrivateKey, String> {
        if self.key.is_empty() {
            return Err(format!(
                "{} has no ssh key. Import one in Publish → Logins.",
                self.name()
            ));
        }
        let passphrase = (!self.passphrase.is_empty()).then_some(self.passphrase.as_str());
        russh::keys::decode_secret_key(&self.key, passphrase).map_err(|e| {
            format!(
                "The ssh key for {} could not be read: {e}. An encrypted key \
                 needs its passphrase on the same row.",
                self.name()
            )
        })
    }
}

/// A server as the frontend sees it: everything except the key and its
/// passphrase.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerView {
    pub id: String,
    pub label: String,
    pub host: String,
    pub user: String,
    pub port: Option<u16>,
    pub key_source: String,
    /// Whether there is a key at all — the row says so, and a server without
    /// one cannot publish.
    pub has_key: bool,
    /// The host key fingerprint, or empty before the first connection.
    pub host_key: String,
}

impl From<&Server> for ServerView {
    fn from(server: &Server) -> Self {
        ServerView {
            id: server.id.clone(),
            label: server.label.clone(),
            host: server.host.clone(),
            user: server.user.clone(),
            port: server.port,
            key_source: server.key_source.clone(),
            has_key: !server.key.is_empty(),
            host_key: server.host_key.clone(),
        }
    }
}

/// One GitHub account this install can publish as.
///
/// A list rather than one, because the settings sheet is a list of *logins* —
/// servers and accounts together — and a personal account beside a work one is
/// the same kind of fact as a staging box beside a live one. A project's target
/// names which account it means, exactly as it names which server.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Github {
    /// Made here. A project's target names one of these.
    #[serde(default)]
    pub id: String,
    /// Read from GitHub rather than typed — see `save_github_login`.
    pub login: String,
    /// A personal access token. Never sent to the frontend.
    pub token: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub servers: Vec<Server>,
    #[serde(default)]
    pub accounts: Vec<Github>,
    /// The one account this file used to hold, before there could be several.
    ///
    /// Folded into `accounts` by `read` and written back as nothing. Kept only
    /// so that somebody who signed in under the previous shape is not quietly
    /// signed out by an update; it costs eight lines and the alternative is a
    /// bug report that reads "it forgot my token".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub github: Option<Github>,
}

/// One account, as the frontend sees it: who it is, never what it holds.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubView {
    pub id: String,
    pub login: String,
}

impl From<&Github> for GithubView {
    fn from(account: &Github) -> Self {
        GithubView {
            id: account.id.clone(),
            login: account.login.clone(),
        }
    }
}

/// What the frontend is told: everything except the secrets.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub servers: Vec<ServerView>,
    pub accounts: Vec<GithubView>,
}

fn settings_path() -> Result<PathBuf, String> {
    Ok(crate::store::app_data_dir()?.join("publish.json"))
}

/// Read the file, or the empty settings for an install that has never
/// published.
///
/// A file that will not parse reads as empty rather than failing: the only
/// thing in it is convenience, and refusing to open the sheet because of a
/// corrupt line would leave somebody with no way to type the details in again.
pub fn read() -> Settings {
    let Ok(path) = settings_path() else {
        return Settings::default();
    };
    let mut settings: Settings = std::fs::read_to_string(path)
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default();

    // The single account this file used to hold, brought forward. Written back
    // in the new shape by the next `write`, which every command does.
    if let Some(mut only) = settings.github.take() {
        if only.id.is_empty() {
            only.id = uuid::Uuid::new_v4().to_string();
        }
        if !settings.accounts.iter().any(|a| a.login == only.login) {
            settings.accounts.push(only);
        }
    }
    // An account from any shape that reached here without one.
    for account in &mut settings.accounts {
        if account.id.is_empty() {
            account.id = uuid::Uuid::new_v4().to_string();
        }
    }
    settings
}

/// Write the file, readable and writable by this user and nobody else.
pub fn write(settings: &Settings) -> Result<(), String> {
    let path = settings_path()?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("Cannot write {}: {e}", path.display()))?;
    restrict(&path);
    Ok(())
}

/// `0600` on the file, where the platform has such a thing.
///
/// Best effort: a filesystem that cannot carry the bits is not a reason to
/// refuse to save, and the failure it would report is one nobody can act on.
#[cfg(unix)]
fn restrict(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict(_path: &std::path::Path) {}

// ── the command surface ─────────────────────────────────────────────────────

#[tauri::command]
pub fn read_publish_settings() -> SettingsView {
    let settings = read();
    SettingsView {
        servers: settings.servers.iter().map(ServerView::from).collect(),
        accounts: settings.accounts.iter().map(GithubView::from).collect(),
    }
}

/// The account a target names, or the only one there is.
///
/// A target written before there could be several names no account at all, and
/// on a device with exactly one that is not ambiguous — so it resolves rather
/// than failing. With two, it has to be said.
pub fn account_for(settings: &Settings, id: &str) -> Result<Github, String> {
    if let Some(found) = settings.accounts.iter().find(|a| a.id == id) {
        return Ok(found.clone());
    }
    if id.is_empty() && settings.accounts.len() == 1 {
        return Ok(settings.accounts[0].clone());
    }
    Err(if settings.accounts.is_empty() {
        "Sign in to GitHub first, in Publish.".to_string()
    } else {
        "That GitHub account is not signed in on this device any more. Pick \
         another in Publish."
            .to_string()
    })
}

/// Remember what a server's host key turned out to be.
///
/// Called once, after the first connection that saw one — see
/// `deploy_ssh::Trust`. A server that has since been deleted is not an error:
/// the publish it was learned during has already finished.
pub fn learn_host_key(id: &str, fingerprint: &str) -> Result<(), String> {
    let mut settings = read();
    let Some(server) = settings.servers.iter_mut().find(|s| s.id == id) else {
        return Ok(());
    };
    if server.host_key == fingerprint {
        return Ok(());
    }
    server.host_key = fingerprint.to_string();
    write(&settings)
}

/// Forget it again, which is the only way past a fingerprint that has changed.
///
/// Deliberately its own command rather than a checkbox on the publish that
/// failed: a changed host key is either a rebuilt server or somebody standing
/// in the middle of the connection, and the difference is not something this
/// app can work out. Making it a separate, deliberate act is the whole
/// protection.
#[tauri::command]
pub fn forget_host_key(id: String) -> Result<(), String> {
    let mut settings = read();
    if let Some(server) = settings.servers.iter_mut().find(|s| s.id == id) {
        server.host_key.clear();
    }
    write(&settings)
}

/// Add a server, or change one. Answers with its id.
///
/// The id is made here rather than taken from the frontend: it is what a
/// project's target names, and a caller that could choose it could point two
/// projects at each other's servers by typing the same string twice.
/// `key_file` is a path to read **now**, not a path to keep.
///
/// It is read here, checked that it parses as an ssh private key with the
/// passphrase given, and its text is stored. Passing `None` on an edit keeps
/// whatever key the server already had, so changing a label does not mean
/// finding the key file again.
#[tauri::command]
pub fn save_publish_server(
    id: Option<String>,
    label: String,
    host: String,
    user: String,
    port: Option<u16>,
    key_file: Option<String>,
    passphrase: Option<String>,
) -> Result<String, String> {
    let host = host.trim().to_string();
    if host.is_empty() {
        return Err("A server needs a host".into());
    }

    let mut settings = read();
    let id = id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let existing = settings.servers.iter().find(|s| s.id == id).cloned();
    let passphrase = passphrase
        .map(|p| p.trim().to_string())
        .or_else(|| existing.as_ref().map(|s| s.passphrase.clone()))
        .unwrap_or_default();

    // Keep the host key across an edit: a label change is not a reason to
    // start trusting whatever answers on that address next time.
    let mut server = Server {
        id: id.clone(),
        label: label.trim().to_string(),
        host,
        user: user.trim().to_string(),
        port,
        key_source: existing.as_ref().map(|s| s.key_source.clone()).unwrap_or_default(),
        key: existing.as_ref().map(|s| s.key.clone()).unwrap_or_default(),
        passphrase,
        host_key: existing.as_ref().map(|s| s.host_key.clone()).unwrap_or_default(),
    };

    if let Some(path) = key_file.filter(|p| !p.trim().is_empty()) {
        let path = crate::psd_write::source_path(&path);
        let text = std::fs::read_to_string(&path)
            .map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
        // Checked before it is stored, so "that is not a key" is said while
        // the file picker is still fresh in mind rather than at a publish.
        let pass = (!server.passphrase.is_empty()).then_some(server.passphrase.as_str());
        russh::keys::decode_secret_key(&text, pass).map_err(|e| {
            format!("{} is not an ssh private key this app can read: {e}", path.display())
        })?;
        server.key = text;
        server.key_source = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("imported key")
            .to_string();
    }

    match settings.servers.iter_mut().find(|s| s.id == id) {
        Some(slot) => *slot = server,
        None => settings.servers.push(server),
    }
    write(&settings)?;
    Ok(id)
}

/// Forget a server.
///
/// The projects pointing at it are left alone: their target still names an id
/// nothing matches, and `deploy` says so by name when one of them publishes.
/// Walking every project to blank a field would be this command reaching into
/// documents it has no business rewriting, and the failure it would prevent is
/// one sentence.
#[tauri::command]
pub fn delete_publish_server(id: String) -> Result<(), String> {
    let mut settings = read();
    settings.servers.retain(|server| server.id != id);
    write(&settings)
}

/// Sign in to GitHub — which here means keeping a personal access token.
///
/// A token rather than an OAuth flow: OAuth needs a redirect the app can
/// receive and a client secret it would have to ship, and a fine-grained PAT
/// is both narrower and something the person can revoke from a page they
/// already know.
///
/// **The username is not asked for.** The token is checked against GitHub
/// first and answers with whose it is, which is one fewer box to type into,
/// one fewer thing to get wrong, and — the real point — the difference between
/// finding out a token is bad now and finding out at the far end of a publish.
///
/// Signing in again with the same account replaces its token rather than
/// adding a second row, which is what "my token expired" should do.
#[tauri::command(async)]
pub fn save_github_login(token: String) -> Result<GithubView, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("A token is needed to publish to GitHub".into());
    }
    let login = crate::github_api::whoami(&token)?;

    let mut settings = read();
    let account = match settings.accounts.iter_mut().find(|a| a.login == login) {
        Some(existing) => {
            existing.token = token;
            existing.clone()
        }
        None => {
            let account = Github {
                id: uuid::Uuid::new_v4().to_string(),
                login,
                token,
            };
            settings.accounts.push(account.clone());
            account
        }
    };
    write(&settings)?;
    Ok(GithubView::from(&account))
}

/// Forget an account.
///
/// The projects pointing at it keep a target naming an id nothing matches, and
/// a publish from one of them says so by name — the same as for a server, and
/// for the same reason: walking every project to blank a field would be this
/// command rewriting documents it has no business in.
#[tauri::command]
pub fn delete_github_login(id: String) -> Result<(), String> {
    let mut settings = read();
    settings.accounts.retain(|account| account.id != id);
    write(&settings)
}

/// Every repository an account can see, for the picker.
#[tauri::command(async)]
pub fn list_github_repos(id: String) -> Result<Vec<crate::github_api::Repo>, String> {
    let settings = read();
    let account = account_for(&settings, &id)?;
    crate::github_api::list_repos(&account.token)
}

// ── a project's own destination ─────────────────────────────────────────────

#[tauri::command]
pub fn read_publish_target(id: String) -> Result<crate::project::PublishTarget, String> {
    Ok(crate::store::read_meta(&id)?.publish)
}

#[tauri::command]
pub fn save_publish_target(
    id: String,
    target: crate::project::PublishTarget,
) -> Result<crate::project::ProjectMeta, String> {
    crate::store::set_publish_target(&id, target)
}
