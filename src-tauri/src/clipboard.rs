//! Reading the system pasteboard, because the webview will not.
//!
//! `navigator.clipboard.read()` is served by WebKit, and WebKit hands a page
//! only a *web-safe* subset of what the pasteboard holds: plain text, HTML,
//! a URL list, PNG, and web custom formats. A PSD copied out of Files is
//! `com.adobe.photoshop-image`, which is on none of those lists, so the read
//! comes back with nothing in it and the editor reported an empty clipboard
//! over a pasteboard that was holding exactly what the user meant to paste.
//! The DOM's own `paste` event would carry the file, but on iPadOS WKWebView
//! only delivers one when the caret is in an editable element, and this
//! editor's canvas is never that — so ⌘V is not a way round it either.
//!
//! The pasteboard itself has no such subset. `UIPasteboard` on iOS and
//! `NSPasteboard` on macOS list every type they are holding and hand over the
//! bytes for any of them, which is what this module does and all it does.
//!
//! It runs on the main thread because these commands are declared without
//! `async`, which is what Tauri runs there — UIKit requires it, and AppKit
//! prefers it.

use serde::Serialize;

/// One read of the pasteboard.
///
/// `types` is reported whether or not anything usable was found: "nothing on
/// the clipboard" and "a clipboard holding something this cannot read" are
/// different answers, and the second one is only useful if it can name what
/// was actually there.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardRead {
    pub types: Vec<String>,
    pub file: Option<ClipboardFile>,
}

/// What came off the pasteboard, under a name the import pipeline can use.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFile {
    /// A filename with an extension — the real one where the pasteboard knew
    /// it, `image.<ext>` where it only had bytes. The frontend reads the stem
    /// off this to name the PSD.
    pub name: String,
    /// The pasteboard type the bytes came from, for the log.
    pub uti: String,
    pub data_base64: String,
}

/// The types worth asking for, best first.
///
/// A PSD leads because it is the richest thing the pipeline takes: it goes
/// into the project as its author built it, layer stack and all, where a PNG
/// of the same artwork arrives flattened. The rest are the raster formats the
/// `image` crate decodes; anything it cannot decode is not worth carrying
/// across the bridge to be refused on the other side.
const WANTED: &[(&str, &str)] = &[
    ("com.adobe.photoshop-image", "psd"),
    ("public.png", "png"),
    ("public.jpeg", "jpg"),
    ("public.tiff", "tif"),
    ("com.compuserve.gif", "gif"),
];

/// The pasteboard type a copied *file* arrives as, on both platforms.
const FILE_URL: &str = "public.file-url";

/// Extensions the import pipeline can take from a file on disk.
const IMPORTABLE: &[&str] = &["psd", "png", "jpg", "jpeg", "tif", "tiff", "gif"];

/// The type to ask for first, given everything the pasteboard is offering.
pub fn preferred_type(types: &[String]) -> Option<&'static str> {
    WANTED
        .iter()
        .map(|(uti, _)| *uti)
        .find(|uti| types.iter().any(|t| t == uti))
}

/// The extension a known pasteboard type should be saved under.
pub fn extension_for(uti: &str) -> Option<&'static str> {
    WANTED
        .iter()
        .find(|(known, _)| *known == uti)
        .map(|(_, ext)| *ext)
}

/// The extension a buffer's own signature says it is.
///
/// The fallback for a pasteboard that describes its contents in terms this
/// does not know — a `dyn.a…` type invented by whichever app did the copying,
/// or a UTI newer than this list. The bytes are the same bytes either way,
/// and four of the five formats above announce themselves in their first
/// eight.
pub fn sniff(bytes: &[u8]) -> Option<&'static str> {
    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    if bytes.starts_with(b"8BPS") {
        return Some("psd");
    }
    if bytes.starts_with(PNG) {
        return Some("png");
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("jpg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("gif");
    }
    if bytes.starts_with(b"II\x2a\x00") || bytes.starts_with(b"MM\x00\x2a") {
        return Some("tif");
    }
    None
}

/// Whether a path off the pasteboard names something the pipeline can import.
pub fn importable_path(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .is_some_and(|e| IMPORTABLE.iter().any(|known| *known == e))
}

/// The name to give bytes that arrived without one.
///
/// `image.<ext>` on purpose: the frontend turns exactly that into a
/// `pasted-<base36>` key, which is what keeps a project from filling up with
/// files called `image`, `image-2`, `image-3`.
fn anonymous_name(ext: &str) -> String {
    format!("image.{ext}")
}

/// Read the pasteboard.
///
/// Three passes, in the order that gets the best answer: a copied file first,
/// because it is the only route that knows the artwork's real name; then the
/// types this understands by name; then whatever is left, decided by its own
/// signature. Each pass stops at the first thing it can use.
pub fn read() -> Result<ClipboardRead, String> {
    let types = platform::types()?;

    if types.iter().any(|t| t == FILE_URL) {
        if let Some(file) = read_file_url() {
            return Ok(ClipboardRead {
                types,
                file: Some(file),
            });
        }
    }

    if let Some(uti) = preferred_type(&types) {
        if let Some(bytes) = platform::data(uti) {
            let ext = extension_for(uti).unwrap_or("png");
            return Ok(ClipboardRead {
                file: Some(encode(anonymous_name(ext), uti, &bytes)),
                types,
            });
        }
    }

    for uti in &types {
        if uti == FILE_URL || extension_for(uti).is_some() {
            continue;
        }
        let Some(bytes) = platform::data(uti) else {
            continue;
        };
        if let Some(ext) = sniff(&bytes) {
            return Ok(ClipboardRead {
                file: Some(encode(anonymous_name(ext), uti, &bytes)),
                types,
            });
        }
    }

    Ok(ClipboardRead { types, file: None })
}

/// A file copied in Finder or Files, if it is one this can read.
///
/// On macOS a copied file is *only* a URL — the bytes are not on the
/// pasteboard at all — so this is the whole route there. On iPadOS the data
/// is usually there as well, and the URL may point outside the sandbox; a
/// read that fails simply falls through to the passes below it.
fn read_file_url() -> Option<ClipboardFile> {
    let raw = platform::data(FILE_URL)?;
    let text = String::from_utf8(raw).ok()?;
    // Pasteboard strings arrive with whatever the writing app padded them
    // with, a trailing NUL included, and a path with one on the end names no
    // file at all.
    let url = text.trim_matches(|c: char| c.is_whitespace() || c == '\0');
    let path = crate::psd_write::source_path(url);
    if !importable_path(&path) {
        return None;
    }
    let bytes = std::fs::read(&path).ok()?;
    let name = path.file_name()?.to_str()?.to_string();
    Some(encode(name, FILE_URL, &bytes))
}

fn encode(name: String, uti: &str, bytes: &[u8]) -> ClipboardFile {
    use base64::Engine;
    ClipboardFile {
        name,
        uti: uti.to_string(),
        data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    }
}

// ── the pasteboard itself ───────────────────────────────────────────────────

#[cfg(target_os = "macos")]
mod platform {
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::NSString;

    pub fn types() -> Result<Vec<String>, String> {
        let pasteboard = NSPasteboard::generalPasteboard();
        let Some(types) = pasteboard.types() else {
            return Ok(Vec::new());
        };
        Ok(types.iter().map(|t| t.to_string()).collect())
    }

    pub fn data(uti: &str) -> Option<Vec<u8>> {
        let pasteboard = NSPasteboard::generalPasteboard();
        pasteboard
            .dataForType(&NSString::from_str(uti))
            .map(|data| data.to_vec())
    }
}

#[cfg(target_os = "ios")]
mod platform {
    use objc2_foundation::NSString;
    use objc2_ui_kit::UIPasteboard;

    pub fn types() -> Result<Vec<String>, String> {
        let pasteboard = UIPasteboard::generalPasteboard();
        // Listing the types does not count as reading the clipboard: the
        // system's paste prompt appears when the bytes are asked for, which
        // is why the passes above ask by name before they ask by signature.
        let types = unsafe { pasteboard.pasteboardTypes() };
        Ok(types.iter().map(|t| t.to_string()).collect())
    }

    pub fn data(uti: &str) -> Option<Vec<u8>> {
        let pasteboard = UIPasteboard::generalPasteboard();
        pasteboard
            .dataForPasteboardType(&NSString::from_str(uti))
            .map(|data| data.to_vec())
    }
}

/// Everywhere else — the dev harness's Linux and Windows — there is no
/// pasteboard this knows how to read, and the frontend falls back to the
/// webview's own clipboard rather than failing the paste.
#[cfg(not(any(target_os = "macos", target_os = "ios")))]
mod platform {
    pub fn types() -> Result<Vec<String>, String> {
        Err(format!(
            "Reading the system clipboard is not supported on {}",
            std::env::consts::OS
        ))
    }

    pub fn data(_uti: &str) -> Option<Vec<u8>> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn types(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn a_psd_wins_over_the_flattened_copy_beside_it() {
        // Copying a PSD out of an editor puts a preview on the pasteboard as
        // well, and taking the preview would silently flatten the file.
        let offered = types(&["public.png", "com.adobe.photoshop-image", "public.tiff"]);
        assert_eq!(preferred_type(&offered), Some("com.adobe.photoshop-image"));
    }

    #[test]
    fn a_screenshot_is_taken_as_the_png_it_is() {
        assert_eq!(preferred_type(&types(&["public.png"])), Some("public.png"));
        assert_eq!(extension_for("public.png"), Some("png"));
    }

    #[test]
    fn text_on_the_clipboard_is_not_an_image() {
        assert_eq!(
            preferred_type(&types(&["public.utf8-plain-text", "public.html"])),
            None,
        );
    }

    #[test]
    fn bytes_are_read_by_their_signature_when_the_type_means_nothing() {
        assert_eq!(sniff(b"8BPS\x00\x01rest"), Some("psd"));
        assert_eq!(sniff(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]), Some("png"));
        assert_eq!(sniff(&[0xff, 0xd8, 0xff, 0xe0]), Some("jpg"));
        assert_eq!(sniff(b"GIF89a...."), Some("gif"));
        assert_eq!(sniff(b"hello"), None);
        assert_eq!(sniff(b""), None);
    }

    #[test]
    fn only_files_the_pipeline_can_read_are_taken_off_a_url() {
        assert!(importable_path(std::path::Path::new("/tmp/tower.psd")));
        assert!(importable_path(std::path::Path::new("/tmp/TOWER.PSD")));
        assert!(!importable_path(std::path::Path::new("/tmp/notes.txt")));
        assert!(!importable_path(std::path::Path::new("/tmp/tower")));
    }
}
