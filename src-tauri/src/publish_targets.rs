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
//! **rsync authenticates over ssh, and this stores no password.** The identity
//! is a key — the agent's, or a file named here — and `BatchMode=yes` means a
//! server that wants a password is refused rather than waited on. Storing an
//! ssh password would mean either `sshpass` or writing one to disk, and
//! `ssh-copy-id` is the answer everyone already has.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// One server this install can rsync to.
///
/// A list rather than one, because a host is not an identity: a staging box
/// and a live one are two destinations under the same login, and a project
/// names which of them it means.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
    /// A private key file, or none to let ssh use the agent and its defaults.
    #[serde(default)]
    pub identity_file: Option<String>,
}

impl Server {
    /// `user@host`, or just the host when no user was given — which is ssh's
    /// own rule: no user means the one you are logged in as.
    pub fn address(&self) -> String {
        if self.user.is_empty() {
            self.host.clone()
        } else {
            format!("{}@{}", self.user, self.host)
        }
    }

    pub fn name(&self) -> &str {
        if self.label.is_empty() {
            &self.host
        } else {
            &self.label
        }
    }
}

/// The GitHub account this install publishes as.
///
/// One, not a list: a token is a login, and "so the user only needs to log in
/// once" is the whole point. Which repository is a project's business.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Github {
    pub login: String,
    /// A personal access token with `repo` scope. Never sent to the frontend.
    pub token: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub servers: Vec<Server>,
    #[serde(default)]
    pub github: Option<Github>,
}

/// What the frontend is told: everything except the secret.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub servers: Vec<Server>,
    /// The account's name, when one is signed in.
    pub github: Option<String>,
    /// Whether this platform can run a publish at all — see `deploy::can_run`.
    pub can_deploy: bool,
    /// Why not, when it cannot. Empty when it can.
    pub reason: String,
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
    std::fs::read_to_string(path)
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
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
    let (can_deploy, reason) = crate::deploy::can_run();
    SettingsView {
        servers: settings.servers,
        github: settings.github.map(|account| account.login),
        can_deploy,
        reason,
    }
}

/// Add a server, or change one. Answers with its id.
///
/// The id is made here rather than taken from the frontend: it is what a
/// project's target names, and a caller that could choose it could point two
/// projects at each other's servers by typing the same string twice.
#[tauri::command]
pub fn save_publish_server(
    id: Option<String>,
    label: String,
    host: String,
    user: String,
    port: Option<u16>,
    identity_file: Option<String>,
) -> Result<String, String> {
    let host = host.trim().to_string();
    if host.is_empty() {
        return Err("A server needs a host".into());
    }
    // rsync reads a leading dash as an option, wherever it appears, and these
    // two reach its argv — see `deploy_rsync`, which refuses them again.
    if host.starts_with('-') || user.starts_with('-') {
        return Err("A host or user cannot start with a dash".into());
    }

    let mut settings = read();
    let id = id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let server = Server {
        id: id.clone(),
        label: label.trim().to_string(),
        host,
        user: user.trim().to_string(),
        port,
        identity_file: identity_file.filter(|path| !path.trim().is_empty()),
    };
    match settings.servers.iter_mut().find(|s| s.id == id) {
        Some(existing) => *existing = server,
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
/// scoped to the repositories being published to is both narrower and
/// something the person can revoke from a page they already know.
#[tauri::command]
pub fn save_github_login(login: String, token: String) -> Result<(), String> {
    let login = login.trim().to_string();
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("A token is needed to publish to GitHub".into());
    }
    let mut settings = read();
    settings.github = Some(Github { login, token });
    write(&settings)
}

#[tauri::command]
pub fn clear_github_login() -> Result<(), String> {
    let mut settings = read();
    settings.github = None;
    write(&settings)
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
