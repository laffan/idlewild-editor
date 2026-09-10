//! Image -> PSD conversion, using the write half of the psd fork.
//!
//! Everything that enters the editor becomes a PSD before it becomes a game
//! object. That is what makes the psd-to-phaser integration uniform: an
//! imported PNG, a pasted screenshot and a selection of drawn strokes all
//! arrive at psd-to-json as the same kind of input.
//!
//! Layers are named with psd-to-json's pipe convention (`S | name`) so the
//! pipeline classifies them as sprites rather than ignoring them.

use crate::psd_marks;
use image::GenericImageView;
use psd::{LayerBuilder, PsdBuilder};
use serde::Deserialize;
use std::path::Path;

/// A point in the editor's world pixels, relative to the anchor.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct MarkPoint {
    pub x: f32,
    pub y: f32,
}

/// One division between two grid spaces, anchor-relative.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct MarkLine {
    pub a: MarkPoint,
    pub b: MarkPoint,
}

/// Where an import was dropped on the grid, sent from the editor because the
/// editor is what owns the projection. Absent when there was no grid
/// selection behind the import — a pasted screenshot, a rasterised sketch —
/// and the PSD then carries no marks.
#[derive(Debug, Clone, Deserialize)]
pub struct AnchorMarks {
    /// The grid selection's outline, anchor-relative. A diamond under an
    /// isometric template, a rectangle under an orthogonal one.
    pub outline: Vec<MarkPoint>,
    /// The divisions between the spaces it covers, in the same frame. Empty
    /// for a single space, which has nothing to divide.
    #[serde(default)]
    pub lines: Vec<MarkLine>,
    /// Where the artwork's top-left goes relative to the anchor. Omitted by
    /// an image import, which has no opinion and gets centred; sent by a
    /// conversion of something already on the grid — a fill, say — which
    /// knows exactly which pixels belong over which spaces.
    #[serde(default)]
    pub art: Option<MarkPoint>,
    /// How many grid spaces it covers, which names the zone layer.
    #[serde(default)]
    pub cols: u32,
    #[serde(default)]
    pub rows: u32,
}

/// A PSD built from raw RGBA8 pixels, plus the orienting marks when there is
/// a grid selection behind it. See `psd_marks` for what they are and why
/// they are invisible to the game.
pub fn psd_from_rgba_marked(
    name: &str,
    width: u32,
    height: u32,
    rgba: Vec<u8>,
    marks: Option<&AnchorMarks>,
) -> Result<Vec<u8>, String> {
    let expected = (width as usize) * (height as usize) * 4;
    if rgba.len() != expected {
        return Err(format!(
            "RGBA buffer is {} bytes, expected {expected} for {width}x{height}",
            rgba.len()
        ));
    }

    let Some(marks) = marks else {
        let mut builder = PsdBuilder::new(width, height);
        builder.add_layer(LayerBuilder::new(format!("S | {name}")).rgba(width, height, rgba));
        return builder
            .to_bytes()
            .map_err(|e| format!("Failed to write PSD: {e:?}"));
    };

    let layout = psd_marks::layout(width, height, marks);
    let mut builder = PsdBuilder::new(layout.canvas_width, layout.canvas_height);
    // Artwork first so the marks sit above it and stay visible while editing.
    builder.add_layer(
        LayerBuilder::new(format!("S | {name}"))
            .rgba(width, height, rgba)
            .at(layout.art_left, layout.art_top),
    );
    for layer in psd_marks::layers(&layout, marks) {
        builder.add_layer(layer);
    }
    builder
        .to_bytes()
        .map_err(|e| format!("Failed to write PSD: {e:?}"))
}

/// Turn whatever a file picker handed back into a path that can be opened.
///
/// On macOS the dialog plugin returns a filesystem path and this is the
/// identity. On iPadOS it returns an `NSURL`, which crosses the bridge as its
/// absolute string — `file:///private/var/…/sketch.psd` — and a `Path` built
/// from that names no file: re-importing an edited PSD failed with "No such
/// file or directory" the moment the Files browser started opening, which is
/// the bug this exists for.
///
/// The URL form is also percent-encoded, so a file anyone actually named
/// arrives as `my%20sketch.psd`. Decoding is confined to that branch: a plain
/// path is taken verbatim, because a `%` in a filename on disk is a `%`.
pub fn source_path(raw: &str) -> std::path::PathBuf {
    let Some(rest) = raw.strip_prefix("file://") else {
        return std::path::PathBuf::from(raw);
    };
    // What follows the scheme is an authority then the path. Both `file:///p`
    // (empty authority) and `file://localhost/p` name `/p`.
    let path = match rest.strip_prefix('/') {
        Some(_) => rest,
        None => match rest.find('/') {
            Some(at) => &rest[at..],
            None => return std::path::PathBuf::from(raw),
        },
    };
    std::path::PathBuf::from(percent_decode(path))
}

/// Decode `%XX` escapes, leaving anything that is not one alone.
///
/// Bytes rather than chars, because a percent escape encodes a byte and a
/// multi-byte character arrives as several of them. A sequence that does not
/// decode to UTF-8 is handed back as it came: a name this cannot read is
/// better passed to the filesystem unchanged than replaced with question
/// marks.
fn percent_decode(raw: &str) -> String {
    if !raw.contains('%') {
        return raw.to_string();
    }
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Some(byte) = hex_pair(bytes[i + 1], bytes[i + 2]) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| raw.to_string())
}

fn hex_pair(high: u8, low: u8) -> Option<u8> {
    let digit = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    };
    Some(digit(high)? * 16 + digit(low)?)
}

/// A PSD's file signature. Four bytes, and the only thing that distinguishes
/// bytes to be wrapped from bytes that are already a document.
const PSD_SIGNATURE: &[u8; 4] = b"8BPS";

/// Whether a buffer is already a Photoshop document.
pub fn is_psd(bytes: &[u8]) -> bool {
    bytes.starts_with(PSD_SIGNATURE)
}

/// Decode any image the `image` crate reads (PNG, JPEG) and wrap it in a PSD.
///
/// Bytes that are *already* a PSD are taken as they are. An import from a
/// path decides that by the file's extension; bytes off a clipboard have no
/// name to read, so the signature is what says so — and handing a PSD to the
/// image decoder only ever produced "failed to decode image" for a file that
/// was perfectly good. Marks are dropped in that case for the same reason
/// they are for a `.psd` on disk: the file arrives as its author built it,
/// and adding ours would mean rewriting someone else's layer stack.
pub fn psd_from_image_bytes_marked(
    name: &str,
    bytes: &[u8],
    marks: Option<&AnchorMarks>,
) -> Result<Vec<u8>, String> {
    if is_psd(bytes) {
        psd::Psd::from_bytes(bytes).map_err(|e| format!("Not a readable PSD: {e}"))?;
        return Ok(bytes.to_vec());
    }
    let img = image::load_from_memory(bytes)
        .map_err(|e| format!("Failed to decode image: {e}"))?;
    let (width, height) = img.dimensions();
    psd_from_rgba_marked(name, width, height, img.to_rgba8().into_raw(), marks)
}

/// Import a file from the OS. A PSD is taken as-is; anything else is decoded
/// and converted. Returns the destination path inside the project's `psd/`.
pub fn import_file_as_psd(
    source: &Path,
    psd_dir: &Path,
    stem_override: Option<&str>,
    marks: Option<&AnchorMarks>,
) -> Result<std::path::PathBuf, String> {
    let stem = stem_override
        .map(str::to_string)
        .or_else(|| {
            source
                .file_stem()
                .and_then(|s| s.to_str())
                .map(sanitise_stem)
        })
        .ok_or("Cannot determine a name for the imported file")?;

    let ext = source
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let dest = psd_dir.join(format!("{stem}.psd"));
    let bytes = std::fs::read(source).map_err(|e| format!("Cannot read import: {e}"))?;

    if ext == "psd" {
        // Parse before accepting it, so a bad file fails at import rather
        // than halfway through the pipeline. A PSD arrives as its author
        // built it, marks and all — adding ours would mean re-writing
        // someone else's layer stack to say something it may already say.
        psd::Psd::from_bytes(&bytes).map_err(|e| format!("Not a readable PSD: {e}"))?;
        std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    } else {
        let psd_bytes = psd_from_image_bytes_marked(&stem, &bytes, marks)?;
        std::fs::write(&dest, psd_bytes).map_err(|e| e.to_string())?;
    }
    Ok(dest)
}

/// PSD keys become directory names and psd-to-phaser lookup keys, so keep
/// them to characters that survive both.
pub fn sanitise_stem(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('_');
    if trimmed.is_empty() {
        "image".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Composite a PSD to a PNG data URL, for the inspector's preview.
pub fn preview_data_url(psd_path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(psd_path).map_err(|e| format!("Cannot read PSD: {e}"))?;
    let doc = psd::Psd::from_bytes(&bytes).map_err(|e| format!("Cannot parse PSD: {e}"))?;
    let rgba = doc
        .flatten_layers_rgba(&|(_, _layer)| true)
        .map_err(|e| format!("Cannot composite PSD: {e}"))?;
    let img = image::RgbaImage::from_raw(doc.width(), doc.height(), rgba)
        .ok_or("Composite did not match the PSD's dimensions")?;
    png_data_url(&image::DynamicImage::ImageRgba8(img))
}

pub fn png_data_url(img: &image::DynamicImage) -> Result<String, String> {
    let mut buf = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
        .map_err(|e| format!("Cannot encode PNG: {e}"))?;
    use base64::Engine;
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&buf)
    ))
}
