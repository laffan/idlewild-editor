//! The system pasteboard, in both directions, because the webview will not.
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
//!
//! ## Writing, which is ⌘C
//!
//! Pasting a PSD worked from the day the read above did; copying one did not,
//! so the gesture only ever went one way and a file could be carried *into* a
//! project and never out of one. What ⌘C puts on the pasteboard is a
//! **`public.file-url` naming the PSD where it lies in the store** — which is
//! the route `read_file_url` already takes first, and the only one that knows
//! the artwork's real name, so a `tower.psd` copied in one project arrives in
//! the next as `tower` rather than as `pasted-m2k9f1`.
//!
//! On macOS the PSD's bytes go on beside it, under the same
//! `com.adobe.photoshop-image` the read prefers, so a copy out of Idlewild
//! pastes into Photoshop as a document rather than as a file reference. On
//! iPadOS it is the URL alone: `setData:forPasteboardType:` sets one
//! representation on the pasteboard's first item and the documented way to
//! offer several is `setItems:`, so writing two there means either building an
//! `NSDictionary` of them or risking the second call replacing the first. The
//! URL is the half that matters, because the paste this is for is Idlewild's
//! own — and *Share PSD* is already the way a file reaches another app there.

use std::path::Path;

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

/// The pasteboard type a PSD's own bytes go on, which is what the read above
/// prefers over a flattened preview beside it.
const PSD_UTI: &str = "com.adobe.photoshop-image";

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

/// Put a file on the pasteboard, as the file it is.
///
/// One `public.file-url` everywhere, and the bytes beside it on macOS — see
/// the note at the top of this file for why the two platforms differ. The URL
/// names the file *in the store* rather than a copy of it, so a paste reads
/// whatever the file says at the moment it is pasted: a PSD edited between the
/// ⌘C and the ⌘V arrives edited, which is the answer a stale snapshot could
/// not give.
pub fn write_file(path: &Path) -> Result<(), String> {
    let url = file_url(path);
    platform::begin_write(&[FILE_URL, PSD_UTI])?;
    platform::write(FILE_URL, url.as_bytes())?;
    // Read only where the bytes are going somewhere. On iPadOS they are not,
    // and a fifty-megabyte PSD read to be thrown away is the one cost worth
    // avoiding on the device this editor is mostly used on.
    if cfg!(target_os = "macos") {
        let bytes = std::fs::read(path).map_err(|e| format!("Cannot read {path:?}: {e}"))?;
        platform::write(PSD_UTI, &bytes)?;
    }
    Ok(())
}

/// A path as a `file://` URL, which is what a pasteboard means by a file.
///
/// The inverse of `psd_write::source_path`, and here rather than beside it
/// because this is the only thing that needs it: a path handed *back* by a
/// picker is already a URL, and the app's own store is the one place a URL has
/// to be built. Everything outside the unreserved set is escaped, `/` apart,
/// so an app data directory called `Application Support` survives the trip.
pub fn file_url(path: &Path) -> String {
    let mut out = String::from("file://");
    for byte in path.to_string_lossy().as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'/' => {
                out.push(*byte as char);
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
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
    use objc2_foundation::{NSArray, NSData, NSString};

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

    /// Empty the pasteboard and say what is about to go on it.
    ///
    /// Both halves are required rather than tidy: `setData:forType:` writes
    /// only a type that has been declared, and a write that did not clear
    /// first would leave whatever was there before offering itself alongside.
    pub fn begin_write(utis: &[&str]) -> Result<(), String> {
        let pasteboard = NSPasteboard::generalPasteboard();
        let _ = pasteboard.clearContents();
        // Inferred rather than annotated: `objc2` itself is not a dependency
        // of this crate, only the two framework crates that re-export what
        // they need from it, so `Retained` has no path to name here.
        let declared: Vec<_> = utis.iter().map(|uti| NSString::from_str(uti)).collect();
        let list = NSArray::from_retained_slice(&declared);
        // Safe: no owner is passed, so nothing is asked to provide a type
        // lazily and the pasteboard never calls back into this process.
        let _ = unsafe { pasteboard.declareTypes_owner(&list, None) };
        Ok(())
    }

    pub fn write(uti: &str, bytes: &[u8]) -> Result<(), String> {
        let pasteboard = NSPasteboard::generalPasteboard();
        let data = NSData::with_bytes(bytes);
        let uti_string = NSString::from_str(uti);
        if pasteboard.setData_forType(Some(&data), &uti_string) {
            return Ok(());
        }
        Err(format!("The pasteboard would not take {uti}"))
    }
}

#[cfg(target_os = "ios")]
mod platform {
    use objc2_foundation::{NSData, NSString};
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

    /// Nothing to declare: `setData:forPasteboardType:` replaces what the
    /// pasteboard is holding by itself, and there is no owner to register.
    pub fn begin_write(_utis: &[&str]) -> Result<(), String> {
        Ok(())
    }

    pub fn write(uti: &str, bytes: &[u8]) -> Result<(), String> {
        let pasteboard = UIPasteboard::generalPasteboard();
        let data = NSData::with_bytes(bytes);
        let uti_string = NSString::from_str(uti);
        pasteboard.setData_forPasteboardType(&data, &uti_string);
        Ok(())
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

    pub fn begin_write(_utis: &[&str]) -> Result<(), String> {
        Err(format!(
            "Writing the system clipboard is not supported on {}",
            std::env::consts::OS
        ))
    }

    pub fn write(_uti: &str, _bytes: &[u8]) -> Result<(), String> {
        Err(format!(
            "Writing the system clipboard is not supported on {}",
            std::env::consts::OS
        ))
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
    fn a_copied_file_goes_on_as_a_url_the_read_half_can_take_back() {
        // What ⌘C writes and ⌘V reads are the two ends of one string, and the
        // decoder is `psd_write::source_path` — so the test is the round trip
        // rather than the spelling of the escape.
        let path = std::path::Path::new("/Users/me/Library/Application Support/Idlewild/t.psd");
        let url = file_url(path);
        assert_eq!(
            url,
            "file:///Users/me/Library/Application%20Support/Idlewild/t.psd",
        );
        assert_eq!(crate::psd_write::source_path(&url), path);
    }

    #[test]
    fn a_project_name_with_anything_in_it_still_round_trips() {
        for raw in [
            "/tmp/plain.psd",
            "/tmp/a b/c%d.psd",
            "/tmp/naïve/ünïcode.psd",
            "/tmp/one#two?three.psd",
        ] {
            let path = std::path::Path::new(raw);
            assert_eq!(crate::psd_write::source_path(&file_url(path)), path, "{raw}");
        }
    }

    #[test]
    fn only_files_the_pipeline_can_read_are_taken_off_a_url() {
        assert!(importable_path(std::path::Path::new("/tmp/tower.psd")));
        assert!(importable_path(std::path::Path::new("/tmp/TOWER.PSD")));
        assert!(!importable_path(std::path::Path::new("/tmp/notes.txt")));
        assert!(!importable_path(std::path::Path::new("/tmp/tower")));
    }
}
