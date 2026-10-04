//! A font off the system pasteboard — Add font's **From clipboard**.
//!
//! Two shapes it arrives in. A font file copied in Finder or Files is a
//! `public.file-url` (macOS has only that; iPadOS usually has the bytes as
//! well), which names the file and so its family. Bytes alone — a font copied
//! out of an app that holds it as data — come under a font type, or under
//! anything at all with a font's signature at the front, and carry no name, so
//! the name is read out of the font's own `name` table where it can be.
//!
//! Through `clipboard::platform`, for the reason `clipboard.rs` gives: the
//! webview's clipboard sees only a web-safe subset of the pasteboard, and a
//! font is never in it.

use std::path::Path;

use base64::Engine;
use serde::Serialize;

use crate::clipboard::{platform, FILE_URL};
use crate::project_fonts::is_font_name;

/// The pasteboard types a font's bytes come under, and the extension each
/// means.
const FONT_TYPES: &[(&str, &str)] = &[
    ("public.truetype-ttf-font", "ttf"),
    ("public.opentype-font", "otf"),
    ("org.w3.woff2", "woff2"),
    ("org.w3.woff", "woff"),
    ("public.font", "ttf"),
];

/// A font read off the pasteboard: a file name to keep it under, and its bytes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFont {
    /// `<family>.<ext>` — the file's own name, or one read from the font.
    pub name: String,
    /// Whether the name came from the font rather than from a file — the
    /// editor offers to change a read one.
    pub guessed: bool,
    pub data_base64: String,
}

/// What a font's first bytes say it is.
pub fn sniff_font(bytes: &[u8]) -> Option<&'static str> {
    match bytes.get(..4)? {
        [0, 1, 0, 0] | b"true" | b"ttcf" => Some("ttf"),
        b"OTTO" => Some("otf"),
        b"wOFF" => Some("woff"),
        b"wOF2" => Some("woff2"),
        _ => None,
    }
}

fn u16_at(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_be_bytes(bytes.get(at..at + 2)?.try_into().ok()?))
}

fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

/// The font's full name (`Recoleta Bold`), or its family, out of its `name`
/// table. TrueType and OpenType only — a WOFF's tables are compressed, and it
/// is named by the editor instead.
pub fn font_name(bytes: &[u8]) -> Option<String> {
    // A collection: the first font in it.
    let base = if bytes.get(..4)? == b"ttcf" { u32_at(bytes, 12)? as usize } else { 0 };
    let tables = u16_at(bytes, base + 4)? as usize;
    let table = (0..tables).find_map(|i| {
        let record = base + 12 + i * 16;
        (bytes.get(record..record + 4)? == b"name").then(|| u32_at(bytes, record + 8))?
    })? as usize;
    let count = u16_at(bytes, table + 2)? as usize;
    let strings = table + u16_at(bytes, table + 4)? as usize;
    let mut best: Option<(u8, String)> = None;
    for i in 0..count {
        let record = table + 6 + i * 12;
        let platform = u16_at(bytes, record)?;
        let name_id = u16_at(bytes, record + 6)?;
        let length = u16_at(bytes, record + 8)? as usize;
        let offset = u16_at(bytes, record + 10)? as usize;
        let rank = match name_id {
            4 => 0,
            1 => 1,
            _ => continue,
        };
        let raw = bytes.get(strings + offset..strings + offset + length)?;
        let text = if platform == 3 || platform == 0 {
            let units: Vec<u16> = raw.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
            String::from_utf16_lossy(&units)
        } else {
            raw.iter().map(|&b| b as char).collect()
        };
        let text = text.trim().to_string();
        if !text.is_empty() && best.as_ref().is_none_or(|(r, _)| rank < *r) {
            best = Some((rank, text));
        }
    }
    best.map(|(_, name)| name)
}

fn encode(name: String, guessed: bool, bytes: &[u8]) -> ClipboardFont {
    ClipboardFont {
        name,
        guessed,
        data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    }
}

/// The font on the pasteboard, or None when there is not one.
pub fn read() -> Result<Option<ClipboardFont>, String> {
    let types = platform::types()?;

    if types.iter().any(|t| t == FILE_URL) {
        if let Some(raw) = platform::data(FILE_URL) {
            let text = String::from_utf8_lossy(&raw).to_string();
            let url = text.trim_matches(|c: char| c.is_whitespace() || c == '\0');
            let path = crate::psd_write::source_path(url);
            let name = Path::new(&path).file_name().and_then(|n| n.to_str()).unwrap_or_default();
            if is_font_name(name) {
                if let Ok(bytes) = std::fs::read(&path) {
                    return Ok(Some(encode(name.to_string(), false, &bytes)));
                }
            }
        }
    }

    let typed = FONT_TYPES
        .iter()
        .filter(|(uti, _)| types.iter().any(|t| t == uti))
        .map(|(uti, ext)| (*uti, *ext));
    let sniffed = types.iter().map(|t| (t.as_str(), ""));
    for (uti, ext) in typed.chain(sniffed) {
        let Some(bytes) = platform::data(uti) else { continue };
        let Some(found) = sniff_font(&bytes) else { continue };
        let ext = if ext.is_empty() { found } else { ext };
        let named = font_name(&bytes);
        let stem = named.clone().unwrap_or_else(|| "Pasted font".to_string());
        return Ok(Some(encode(format!("{stem}.{ext}"), true, &bytes)));
    }
    Ok(None)
}

/// Add font → From clipboard.
#[tauri::command]
pub fn read_clipboard_font() -> Result<Option<ClipboardFont>, String> {
    read()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A TrueType file with nothing but a `name` table holding one Windows
    /// full name, which is all `font_name` reads.
    fn tiny_font(full: &str) -> Vec<u8> {
        let utf16: Vec<u8> = full.encode_utf16().flat_map(|u| u.to_be_bytes()).collect();
        let mut out = vec![0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0];
        out.extend_from_slice(b"name");
        out.extend_from_slice(&[0, 0, 0, 0]);
        out.extend_from_slice(&28u32.to_be_bytes());
        out.extend_from_slice(&((18 + utf16.len()) as u32).to_be_bytes());
        // format, count, string offset
        out.extend_from_slice(&[0, 0, 0, 1, 0, 18]);
        // platform 3, encoding 1, language 0x409, name 4, length, offset 0
        out.extend_from_slice(&[0, 3, 0, 1, 4, 9, 0, 4]);
        out.extend_from_slice(&(utf16.len() as u16).to_be_bytes());
        out.extend_from_slice(&[0, 0]);
        out.extend_from_slice(&utf16);
        out
    }

    #[test]
    fn a_font_is_known_by_its_signature_and_named_from_its_table() {
        let font = tiny_font("Recoleta Bold");
        assert_eq!(sniff_font(&font), Some("ttf"));
        assert_eq!(sniff_font(b"wOF2...."), Some("woff2"));
        assert_eq!(sniff_font(b"\x89PNG"), None);
        assert_eq!(font_name(&font).as_deref(), Some("Recoleta Bold"));
        assert_eq!(font_name(b"wOFF"), None);
    }
}
