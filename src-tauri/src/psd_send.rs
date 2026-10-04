//! What goes into a PSD with it when it leaves: the two boxes on the Open PSD
//! / Share PSD control, kept per file in `ProjectMeta::psd_send`.
//!
//! **Include palette** is the app-wide *Attach palette to PSDs* made per
//! file: absent means "whatever the app-wide switch says", which is how every
//! PSD behaved before, and ticked or unticked is that file's own answer.
//! **Include context** writes the canvas around the file into it — see
//! `psd_context.rs` — and is off until it is ticked.
//!
//! The editor does the work when the file is sent; this only remembers.

use serde::{Deserialize, Serialize};

use crate::psd_pipeline::safe_key;
use crate::store;

/// One file's two answers.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PsdSend {
    /// None follows the app-wide *Attach palette to PSDs*.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub palette: Option<bool>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub context: bool,
}

impl PsdSend {
    fn is_default(&self) -> bool {
        self.palette.is_none() && !self.context
    }
}

/// Change one file's answers; only what is named changes. Hands back the meta.
pub fn set(
    id: &str,
    key: &str,
    palette: Option<bool>,
    context: Option<bool>,
) -> Result<crate::project::ProjectMeta, String> {
    let key = safe_key(key)?;
    let mut meta = store::read_meta(id)?;
    let mut entry = meta.psd_send.get(key).cloned().unwrap_or_default();
    if palette.is_some() {
        entry.palette = palette;
    }
    if let Some(context) = context {
        entry.context = context;
    }
    if entry.is_default() {
        meta.psd_send.remove(key);
    } else {
        meta.psd_send.insert(key.to_string(), entry);
    }
    store::write_meta(&meta)?;
    Ok(meta)
}

/// A file renamed or copied takes its answers with it.
pub fn carry(project_id: &str, from: &str, to: &str, moved: bool) {
    let Ok(mut meta) = store::read_meta(project_id) else { return };
    let Some(entry) = meta.psd_send.get(from).cloned() else { return };
    if moved {
        meta.psd_send.remove(from);
    }
    meta.psd_send.insert(to.to_string(), entry);
    let _ = store::write_meta(&meta);
}

#[tauri::command]
pub fn set_psd_send(
    id: String,
    key: String,
    palette: Option<bool>,
    context: Option<bool>,
) -> Result<crate::project::ProjectMeta, String> {
    set(&id, &key, palette, context)
}
