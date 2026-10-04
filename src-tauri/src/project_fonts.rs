//! A project's own typefaces: font files dropped on the sidebar, kept in
//! `<project>/fonts/` and offered by the Text tool beside the device's.
//!
//! The editor's text is temporary — it converts to pixels — so a font only
//! has to exist where the words are typed. A system face is on one machine
//! and not the next, though, and a project opened on an iPad that lacks the
//! face it was set in is a project whose notes reflow. A font kept *in* the
//! project goes wherever the project goes: it is in every `.idlewild` (see
//! `archive::CARRIED_DIRS`), and the frontend loads it from here with the
//! `FontFace` API on open — no network, so the offline rule holds.
//!
//! The family a file is offered under is its name without the extension, the
//! way printfold names them: `Recoleta-Bold.otf` is `Recoleta-Bold`.

use std::path::{Path, PathBuf};

use base64::Engine;
use serde::Serialize;

use crate::store;

/// What a font file may be.
const EXTENSIONS: [&str; 4] = ["ttf", "otf", "woff", "woff2"];

/// The biggest font file taken. A CJK face with every weight is tens of
/// megabytes; past this it is not a typeface somebody means to label with.
const MAX_BYTES: usize = 40 * 1024 * 1024;

/// One font, as the frontend lists it.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ProjectFont {
    /// The family it is offered under.
    pub family: String,
    /// Its file inside `fonts/`.
    pub file: String,
}

fn fonts_dir(id: &str) -> Result<PathBuf, String> {
    Ok(store::project_dir(id)?.join("fonts"))
}

/// Whether a name is a font file this takes, by its extension.
pub fn is_font_name(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// A file name safe inside `fonts/`: the stem kept readable — letters,
/// digits, spaces, `-` and `_` — everything else an underscore, and the
/// extension lower-cased. None for something that is not a font.
pub fn safe_font_name(name: &str) -> Option<String> {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name);
    if !is_font_name(base) {
        return None;
    }
    let path = Path::new(base);
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    let stem: String = path
        .file_stem()?
        .to_str()?
        .trim()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == ' ' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(80)
        .collect();
    let stem = stem.trim().trim_start_matches('.').to_string();
    if stem.is_empty() {
        return None;
    }
    Some(format!("{stem}.{ext}"))
}

fn font_of(file: &str) -> ProjectFont {
    let family = Path::new(file)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(file)
        .to_string();
    ProjectFont {
        family,
        file: file.to_string(),
    }
}

/// Every font the project has, by family.
pub fn list(id: &str) -> Result<Vec<ProjectFont>, String> {
    let dir = fonts_dir(id)?;
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    let mut fonts: Vec<ProjectFont> = entries
        .flatten()
        .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
        .filter(|name| safe_font_name(name).as_deref() == Some(name.as_str()))
        .map(|name| font_of(&name))
        .collect();
    fonts.sort_by(|a, b| a.family.to_lowercase().cmp(&b.family.to_lowercase()));
    Ok(fonts)
}

/// Keep a font in the project, replacing one of the same name.
pub fn save(id: &str, name: &str, bytes: &[u8]) -> Result<ProjectFont, String> {
    let file = safe_font_name(name)
        .ok_or_else(|| format!("{name} is not a font file (TTF, OTF, WOFF or WOFF2)"))?;
    if bytes.len() > MAX_BYTES {
        return Err(format!("{name} is bigger than a font this keeps"));
    }
    if bytes.len() < 12 {
        return Err(format!("{name} is too small to be a font"));
    }
    let dir = fonts_dir(id)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(&file), bytes).map_err(|e| format!("Cannot keep {name}: {e}"))?;
    Ok(font_of(&file))
}

/// A font's bytes, by its file name.
pub fn read(id: &str, file: &str) -> Result<Vec<u8>, String> {
    if safe_font_name(file).as_deref() != Some(file) {
        return Err(format!("No font called {file}"));
    }
    std::fs::read(fonts_dir(id)?.join(file)).map_err(|e| format!("Cannot read {file}: {e}"))
}

/// Take a font out of the project.
pub fn remove(id: &str, file: &str) -> Result<(), String> {
    if safe_font_name(file).as_deref() != Some(file) {
        return Err(format!("No font called {file}"));
    }
    std::fs::remove_file(fonts_dir(id)?.join(file)).map_err(|e| format!("Cannot remove {file}: {e}"))
}

#[tauri::command]
pub fn list_project_fonts(id: String) -> Result<Vec<ProjectFont>, String> {
    list(&id)
}

/// A font from the webview — a `File` dropped on the sidebar or picked.
#[tauri::command]
pub fn save_project_font(id: String, name: String, data_base64: String) -> Result<ProjectFont, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("Cannot read {name}: {e}"))?;
    save(&id, &name, &bytes)
}

/// A font dropped on macOS, where the shell hands over a path rather than a
/// file. Restricted to font files, so this is not a general file reader.
#[tauri::command]
pub fn save_dropped_font(id: String, source_path: String) -> Result<ProjectFont, String> {
    let path = crate::psd_write::source_path(&source_path);
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();
    if !is_font_name(&name) {
        return Err(format!("{name} is not a font file"));
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read {name}: {e}"))?;
    save(&id, &name, &bytes)
}

#[tauri::command]
pub fn read_project_font(id: String, file: String) -> Result<String, String> {
    Ok(base64::engine::general_purpose::STANDARD.encode(read(&id, &file)?))
}

#[tauri::command]
pub fn delete_project_font(id: String, file: String) -> Result<(), String> {
    remove(&id, &file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_font_name_is_kept_readable_and_safe() {
        assert_eq!(safe_font_name("Recoleta-Bold.OTF").as_deref(), Some("Recoleta-Bold.otf"));
        assert_eq!(safe_font_name("My Font.woff2").as_deref(), Some("My Font.woff2"));
        assert_eq!(safe_font_name("../../etc/evil.ttf").as_deref(), Some("evil.ttf"));
        assert_eq!(safe_font_name("a:b?.ttf").as_deref(), Some("a_b_.ttf"));
        assert_eq!(safe_font_name("picture.png"), None);
        assert_eq!(safe_font_name(".ttf"), None);
        assert_eq!(font_of("Recoleta-Bold.otf").family, "Recoleta-Bold");
    }
}
