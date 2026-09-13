//! Image -> PSD conversion, using the write half of the psd fork.
//!
//! Everything that enters the editor becomes a PSD before it becomes a game
//! object. That is what makes the psd-to-phaser integration uniform: an
//! imported PNG, a pasted screenshot and a selection of drawn strokes all
//! arrive at psd-to-json as the same kind of input.
//!
//! Layers are named with psd-to-json's pipe convention (`S | name`) so the
//! pipeline classifies them as sprites rather than ignoring them.

use crate::psd_layers::{self, Item};
use crate::psd_marks;
use image::GenericImageView;
use psd::{GroupBuilder, LayerBuilder, Psd, PsdBuilder};
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
    /// Empty room to leave around the artwork and the footprint, in the
    /// file's own pixels. It grows the canvas and moves nothing: what it
    /// buys is somewhere to paint past the edge of what is already there.
    #[serde(default)]
    pub margin: Option<MarkPoint>,
    /// Whether the artwork goes *above* the two marks in the stack.
    ///
    /// Not a mark, and here anyway: it rides the same struct from the same
    /// builders, and it is the same kind of fact — something the editor knows
    /// about this conversion that Rust cannot work out for itself.
    ///
    /// The default is false, which is marks over artwork: they stay visible
    /// while somebody paints underneath them, which is what an import or a
    /// converted fill wants. A sketch asks for the other way round, because
    /// its artwork is the one row in the file anybody would rename and the
    /// marks are read-only rows the editor owns — a list that buried it under
    /// both of them read backwards. Nothing is hidden by the swap: a sketch is
    /// a few percent ink on a clear ground.
    #[serde(default)]
    pub art_on_top: bool,
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
    let mut art = Some(
        LayerBuilder::new(format!("S | {name}"))
            .rgba(width, height, rgba)
            .at(layout.art_left, layout.art_top),
    );

    // `add_layer` stacks bottom-up, so what goes in first is underneath.
    // Artwork first — marks over it, staying visible while somebody paints
    // underneath — unless the conversion asked for the other way round; see
    // `art_on_top`.
    if !marks.art_on_top {
        builder.add_layer(art.take().expect("the artwork is put in once"));
    }
    for layer in psd_marks::layers(&layout, marks) {
        builder.add_layer(layer);
    }
    if let Some(on_top) = art.take() {
        builder.add_layer(on_top);
    }
    builder
        .to_bytes()
        .map_err(|e| format!("Failed to write PSD: {e:?}"))
}

/// One raster layer of a generated group, as the editor sends it.
///
/// The name is the exported one — `shape-mtx2vyzs` — and the pipe prefix is
/// added here, because what the pipeline makes of a layer is this side's
/// business and what to call it is the editor's.
pub struct Part {
    pub name: String,
    pub rgba: Vec<u8>,
}

/// A PSD whose artwork is a *group* of raster layers, plus the marks.
///
/// An extrusion is not one picture. It is a silhouette, the shading that
/// makes it read as a solid, and the lines between its spaces — three things
/// somebody opening the file will want to take separately: recolour the
/// shape, drop the lines, repaint the shading by hand. Writing them as one
/// flattened sprite threw that away before anyone saw the file.
///
/// Every part is written at the **same size and the same offset**, which is
/// not an accident. psd-to-phaser places a group as a Phaser Group, and
/// resizing one scales each child about its own origin — so children with
/// different origins drift apart as it is scaled. Identical geometry makes
/// that operation exact instead: the same scale about the same origin.
pub fn psd_from_parts_marked(
    name: &str,
    width: u32,
    height: u32,
    parts: &[Part],
    marks: &AnchorMarks,
) -> Result<Vec<u8>, String> {
    let layout = psd_marks::layout(width, height, marks);
    let mut builder = PsdBuilder::new(layout.canvas_width, layout.canvas_height);
    // Nothing to carry over: this is the file being written for the first
    // time, and everything in it starts lit.
    builder.add_group(parts_group(name, width, height, parts, &layout, None)?);
    for layer in psd_marks::layers(&layout, marks) {
        builder.add_layer(layer);
    }
    builder
        .to_bytes()
        .map_err(|e| format!("Failed to write PSD: {e:?}"))
}

/// The generated group: the extrusion's artwork, parts and all.
///
/// `was` is the file being rewritten, when there is one. A second Apply
/// regenerates these layers from the solid and a fresh `LayerBuilder` starts
/// lit, so without it turning the lines of a block-out off and then pulling
/// the shape again would quietly switch them back on. Everything else about
/// a part is regenerated on purpose; its eye is the user's.
fn parts_group(
    key: &str,
    width: u32,
    height: u32,
    parts: &[Part],
    layout: &psd_marks::Layout,
    was: Option<&Psd>,
) -> Result<GroupBuilder, String> {
    if parts.is_empty() {
        return Err("A generated group needs at least one layer".to_string());
    }
    let lit = |name: &str| was.map_or(true, |doc| shown_in(doc, name));
    let expected = (width as usize) * (height as usize) * 4;
    let mut group = GroupBuilder::new(format!("G | {key}")).visible(lit(&format!("G | {key}")));
    // The parts arrive top-first, as Photoshop's panel lists them, and
    // `add_layer` stacks bottom-up.
    for part in parts.iter().rev() {
        if part.rgba.len() != expected {
            return Err(format!(
                "\"{}\" is {} bytes, expected {expected} for {width}x{height}",
                part.name,
                part.rgba.len()
            ));
        }
        let named = format!("S | {}", part.name);
        group = group.add_layer(
            LayerBuilder::new(&named)
                .rgba(width, height, part.rgba.clone())
                .at(layout.art_left, layout.art_top)
                .visible(lit(&named)),
        );
    }
    Ok(group)
}

/// Whether a layer or group of this name is currently turned on in a file.
///
/// By name, because that is the only handle a regenerated layer has on the
/// one it replaces — the same way the marks and an extrusion's parts are
/// found on every re-parse. A name that is not in the file is new, and new
/// layers are lit.
fn shown_in(doc: &Psd, name: &str) -> bool {
    if let Some(layer) = doc.layers().iter().find(|l| l.name() == name) {
        return layer.visible();
    }
    doc.groups()
        .values()
        .find(|group| group.name() == name)
        .map_or(true, |group| group.visible())
}

/// Rewrite the layers this editor generates, leaving every other layer alone.
///
/// The difference between this and calling `psd_from_parts_marked` again is
/// the whole point of it. That writes a *new* file — the generated group and
/// both marks — so a layer someone added in Photoshop after the first Apply
/// is not preserved, it is simply not there any more. This rebuilds the file
/// the editor already wrote: the group's contents and both marks come back
/// regenerated, each in the place it held in the stack, and everything else
/// is carried across as it was, nesting included.
///
/// **The anchor is what everything else hangs from.** A shape pulled further
/// out grows the canvas, which moves every canvas coordinate in the file —
/// but not relative to the anchor mark, which is the fixed point the whole
/// marks design is built on. So the preserved layers move by the distance the
/// anchor moved, and a wall someone painted over the greybox stays on the
/// greybox.
///
/// A file written before extrusions were groups has its artwork as a lone
/// top-level sprite named after the key. That layer is one of ours, so it is
/// dropped and the group takes its place — which migrates the file the first
/// time it is carried on.
///
/// Refused for a file carrying masks or clipping, for the reason
/// `psd_layers` refuses a rename of one: the fork cannot express them, so a
/// rebuild would come back having quietly lost work. Groups it *can* express,
/// which is what makes this possible at all.
pub fn rewrite_parts_marked(
    existing: &[u8],
    key: &str,
    width: u32,
    height: u32,
    parts: &[Part],
    marks: &AnchorMarks,
) -> Result<Vec<u8>, String> {
    let doc = Psd::from_bytes(existing).map_err(|e| format!("Cannot parse the PSD: {e}"))?;
    if let Some(reason) = psd_layers::unrebuildable_because(&doc) {
        return Err(reason);
    }

    let layout = psd_marks::layout(width, height, marks);
    // How far the anchor moved, which is how far everything hanging from it
    // moves with it. No anchor in the old file means nothing to measure
    // against, and leaving the other layers where they are is the only
    // honest answer.
    let (dx, dy) = match anchor_centre(&doc) {
        Some((x, y)) => (layout.anchor_x - x, layout.anchor_y - y),
        None => (0, 0),
    };
    let rebuild = Rebuild {
        doc: &doc,
        dx,
        dy,
        old_w: doc.width(),
        old_h: doc.height(),
        key,
    };

    let mut group = Some(parts_group(key, width, height, parts, &layout, Some(&doc))?);
    let mut anchor = Some(psd_marks::anchor_layer(&layout));
    let mut zone = psd_marks::zone_layer(&layout, marks);

    let mut builder = PsdBuilder::new(layout.canvas_width, layout.canvas_height);
    // A file with no artwork of ours is not one we wrote. Put the group at the
    // bottom, where a generated file has it, rather than over work that was
    // there first.
    if !rebuild.items(None).iter().any(|item| rebuild.is_ours(item)) {
        if let Some(built) = group.take() {
            builder.add_group(built);
        }
    }

    // Top-first as the panel reads, and `add_*` stacks bottom-up.
    for item in rebuild.items(None).into_iter().rev() {
        match item {
            Item::Group(id) if rebuild.is_ours(&Item::Group(id)) => {
                if let Some(built) = group.take() {
                    builder.add_group(built);
                }
            }
            Item::Group(id) => {
                builder.add_group(rebuild.group(id));
            }
            Item::Layer(idx) => {
                let layer = doc.layer_by_idx(idx);
                if is_named(layer.name(), "anchor") {
                    if let Some(built) = anchor.take() {
                        builder.add_layer(built);
                    }
                } else if is_grid(layer.name()) {
                    if let Some(built) = zone.take() {
                        builder.add_layer(built);
                    }
                } else if is_named(layer.name(), key) {
                    // The lone sprite an older extrusion wrote. The group
                    // stands where it stood.
                    if let Some(built) = group.take() {
                        builder.add_group(built);
                    }
                } else if let Some(built) = rebuild.layer(idx) {
                    builder.add_layer(built);
                }
            }
        }
    }

    // Anything the old file did not have goes on top, where a generated file
    // puts its marks.
    if let Some(built) = zone.take() {
        builder.add_layer(built);
    }
    if let Some(built) = anchor.take() {
        builder.add_layer(built);
    }

    builder
        .to_bytes()
        .map_err(|e| format!("Failed to write PSD: {e:?}"))
}

/// Carrying an existing file's layers across into a new one.
struct Rebuild<'a> {
    doc: &'a Psd,
    dx: i32,
    dy: i32,
    old_w: u32,
    old_h: u32,
    key: &'a str,
}

impl Rebuild<'_> {
    /// What sits directly at one level, top-first as the panel reads.
    fn items(&self, parent: Option<u32>) -> Vec<Item> {
        psd_layers::items(self.doc, parent)
    }

    /// Whether this is the group the editor generates for this key.
    fn is_ours(&self, item: &Item) -> bool {
        match item {
            Item::Group(id) => self
                .doc
                .groups()
                .get(id)
                .is_some_and(|g| is_named(g.name(), self.key)),
            Item::Layer(idx) => is_named(self.doc.layer_by_idx(*idx).name(), self.key),
        }
    }

    /// One group carried across whole, contents and nesting included.
    fn group(&self, id: u32) -> GroupBuilder {
        let source = self.doc.groups().get(&id);
        let name = source.map(|g| g.name().to_string()).unwrap_or_default();
        let mut built = GroupBuilder::new(name);
        if let Some(group) = source {
            built = built
                .opacity(group.opacity())
                .visible(group.visible())
                .blend_mode(group.blend_mode());
        }
        for item in self.items(Some(id)).into_iter().rev() {
            match item {
                Item::Group(child) => built = built.add_group(self.group(child)),
                Item::Layer(idx) => {
                    if let Some(layer) = self.layer(idx) {
                        built = built.add_layer(layer);
                    }
                }
            }
        }
        built
    }

    /// One layer carried across, moved by however far the anchor moved.
    ///
    /// A layer with no rectangle at all is the only one dropped: everything
    /// that has one keeps it, off the canvas edge included, because a
    /// rectangle clamped to the canvas is a mark whose centre has moved —
    /// see `psd_layers::crop`.
    fn layer(&self, idx: usize) -> Option<LayerBuilder> {
        let layer = self.doc.layer_by_idx(idx);
        let (left, top, w, h, pixels) = psd_layers::crop(layer, self.old_w, self.old_h);
        if w == 0 || h == 0 {
            return None;
        }
        Some(
            LayerBuilder::new(layer.name())
                .rgba(w, h, pixels)
                .at(left + self.dx, top + self.dy)
                .opacity(layer.opacity())
                .visible(layer.visible())
                .blend_mode(layer.blend_mode()),
        )
    }
}

/// The anchor mark's centre in canvas coordinates, which is what psd-to-json
/// reports for a point and what the editor reads a placement's position from.
fn anchor_centre(doc: &Psd) -> Option<(i32, i32)> {
    let layer = doc.layers().iter().find(|l| is_named(l.name(), "anchor"))?;
    Some((
        layer.layer_left() + layer.width() as i32 / 2,
        layer.layer_top() + layer.height() as i32 / 2,
    ))
}

fn is_named(layer_name: &str, exported: &str) -> bool {
    psd_layers::exported_name(layer_name)
        .is_some_and(|n| n.eq_ignore_ascii_case(exported))
}

/// The footprint, whose name carries its size once it covers more than one
/// space — `Z | grid-4x2`.
fn is_grid(layer_name: &str) -> bool {
    psd_layers::exported_name(layer_name).is_some_and(|n| {
        let n = n.to_ascii_lowercase();
        n == "grid" || n.starts_with("grid-")
    })
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
