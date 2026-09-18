//! Several placed PSDs, written back out as one.
//!
//! Merging is the opposite of the round trip this editor is otherwise built
//! on. Everything else here turns one thing into one file — an image, a
//! sketch, a fill, a solid pulled off the grid — and the pipeline places what
//! comes back. This takes files that are already standing on the grid, in the
//! arrangement somebody put them in, and writes **that arrangement** into a
//! single document: a wood becomes `wood.psd` rather than nine files somebody
//! has to keep lined up by hand.
//!
//! ## What has to survive it
//!
//! **Where each one stands, relative to the others.** The editor knows that —
//! it is what the placements say — so it does the arithmetic and sends each
//! source's box in the merged file's own pixels. Nothing here works anything
//! out about grids or projections, which is the same division of labour the
//! marks already keep: the editor owns the world, this side owns the file.
//!
//! **Which one is in front.** The sources arrive back-first, and
//! `PsdBuilder::add_*` stacks bottom-up, so they go in in the order they are
//! given. On an isometric object layer the drawn order is screen Y rather than
//! the document's, and the editor sorts them that way before sending — the
//! merged file has one stack, and it had better be the one that was on screen.
//!
//! **The composition inside each file.** A source with a wall and a roof in it
//! is two layers in a particular arrangement, and merging is not flattening:
//! every layer comes across as a layer, at its own offset inside the source,
//! scaled by whatever that placement was scaled by. A group stays a group.
//!
//! ## What does not
//!
//! **The sources' own marks.** `P | anchor` and `Z | grid-…` are the editor's
//! rows, and each says where *that* file hangs from the grid — nine of them in
//! one document would be nine answers to a question with one. The merged file
//! writes its own pair, for the footprint the merged artwork covers. They are
//! never sent: a placement is made for the artwork layers alone, so a mark is
//! not something this can be asked to merge.
//!
//! **A file that cannot be read back.** Masks and clipping are refused for the
//! reason every other rewrite in this editor refuses them: the fork cannot
//! express either, so what came out would have quietly lost work.

use crate::psd_layers::{crop, items, unrebuildable_because, Item};
use crate::psd_marks;
use crate::psd_write::AnchorMarks;
use image::{imageops::FilterType, RgbaImage};
use psd::{GroupBuilder, LayerBuilder, Psd, PsdBuilder, PsdLayer};
use serde::Deserialize;
use std::collections::HashMap;

/// One placed thing going into the merge, as the editor describes it.
///
/// `key` and `path` name what to take: the PSD, and the top-level layer or
/// group of it that this placement stands for. The box is where it goes on the
/// merged canvas, in that canvas's own pixels — already scaled, so a placement
/// somebody resized on the grid arrives here at the size it actually looked.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergePart {
    pub key: String,
    /// The top-level layer or group inside that file, by name — which is what
    /// psd-to-json called it and therefore what the placement carries.
    #[serde(default)]
    pub path: String,
    pub left: f32,
    pub top: f32,
    pub width: f32,
    pub height: f32,
}

/// Build the merged PSD's bytes.
///
/// `read` hands back the bytes of one source by key, so the caller owns where
/// files live and this owns what is done with them — which is also what makes
/// the whole of this testable without a project on disk.
///
/// `emit_log` is the same channel `psd_pipeline` narrates itself on, and it is
/// here for the same reason: a merge of nine files is seconds of work inside
/// one `invoke`, and a sheet that says *Reading the files…* for all of it
/// cannot be told from one that has hung. Each source named as it is opened,
/// and each part as it is laid out, is both the progress and — if it stops —
/// the diagnosis.
pub fn merge(
    width: u32,
    height: u32,
    parts: &[MergePart],
    marks: &AnchorMarks,
    read: &dyn Fn(&str) -> Result<Vec<u8>, String>,
    emit_log: &dyn Fn(&str),
) -> Result<Vec<u8>, String> {
    if parts.len() < 2 {
        return Err("A merge needs two or more placed PSDs".to_string());
    }

    let layout = psd_marks::layout(width, height, marks);
    let mut builder = PsdBuilder::new(layout.canvas_width, layout.canvas_height);
    // The editor's own marks, under everything, as every file it writes has
    // them — see `psd_marks`.
    for layer in psd_marks::layers(&layout, marks) {
        builder.add_layer(layer);
    }

    // Sources are cached because four placements of one file is the ordinary
    // case for a tileset, and parsing a PSD four times to read four layers out
    // of it is three parses nobody asked for.
    let mut cache: HashMap<String, Psd> = HashMap::new();
    let mut names = NameRun::default();

    for (at, part) in parts.iter().enumerate() {
        if !cache.contains_key(&part.key) {
            emit_log(&format!("Reading psd/{}.psd", part.key));
            let bytes = read(&part.key)?;
            let doc = Psd::from_bytes(&bytes)
                .map_err(|e| format!("Cannot read {}.psd: {e}", part.key))?;
            if let Some(reason) = unrebuildable_because(&doc) {
                return Err(format!("{}.psd cannot be merged: {reason}", part.key));
            }
            cache.insert(part.key.clone(), doc);
        }
        let doc = &cache[&part.key];
        // Counted rather than merely named: the number is what says a long
        // wait is moving rather than stuck, and a merge is the one thing here
        // whose length is up to the person who started it.
        emit_log(&format!(
            "Laying out {} ({} of {})",
            part.path,
            at + 1,
            parts.len()
        ));
        match built(doc, part, &mut names)? {
            Some(Built::Layer(layer)) => {
                builder.add_layer(layer);
            }
            Some(Built::Group(group)) => {
                builder.add_group(group);
            }
            // Something with no pixels left in it — an empty layer somebody
            // kept. Nothing to draw, and refusing the whole merge over it
            // would be the worse answer.
            None => {}
        }
    }

    emit_log("Packing the merged PSD");
    builder
        .to_bytes()
        .map_err(|e| format!("Failed to write the merged PSD: {e:?}"))
}

enum Built {
    Layer(LayerBuilder),
    Group(GroupBuilder),
}

/// One source placement, as a layer or a group of the merged file.
fn built(doc: &Psd, part: &MergePart, names: &mut NameRun) -> Result<Option<Built>, String> {
    let Some(source) = pick(doc, &part.path) else {
        return Err(format!(
            "{}.psd has no layer called \"{}\" to merge",
            part.key, part.path
        ));
    };

    // Everything inside this source moves and scales together, against the box
    // it occupies in its own file — which is what keeps a wall under its roof.
    let Some(from) = box_of(doc, source) else {
        return Ok(None);
    };
    let to = Box2 {
        left: part.left,
        top: part.top,
        width: part.width.max(1.0),
        height: part.height.max(1.0),
    };
    Ok(emit(doc, source, &from, &to, &part.key, names))
}

/// One item of a source, and everything under it, into the merged file.
///
/// `source` is the PSD's key, which every name it writes carries — see
/// `merged_name`. One `NameRun` for the whole merged file rather than one per
/// group, because a texture key is the layer's name wherever in the stack it
/// sits.
fn emit(
    doc: &Psd,
    item: Item,
    from: &Box2,
    to: &Box2,
    source: &str,
    names: &mut NameRun,
) -> Option<Built> {
    match item {
        Item::Layer(index) => {
            let layer = doc.layer_by_idx(index);
            let name = names.take(layer.name(), source);
            let built = raster(doc, layer, from, to, name)?;
            Some(Built::Layer(
                built
                    .opacity(layer.opacity())
                    .visible(layer.visible())
                    .blend_mode(layer.blend_mode()),
            ))
        }
        Item::Group(id) => {
            let group = doc.groups().get(&id)?;
            let mut out = GroupBuilder::new(names.take(group.name(), source))
                .opacity(group.opacity())
                .visible(group.visible())
                .blend_mode(group.blend_mode());
            // `items` reads top-first and `add_*` stacks bottom-up.
            for child in items(doc, Some(id)).into_iter().rev() {
                match emit(doc, child, from, to, source, names) {
                    Some(Built::Layer(layer)) => out = out.add_layer(layer),
                    Some(Built::Group(inner)) => out = out.add_group(inner),
                    None => {}
                }
            }
            Some(Built::Group(out))
        }
    }
}

/// One layer's pixels, moved and scaled from the source's box into the merged
/// one.
///
/// The scale is the **source box's**, not this layer's: every layer of one
/// placed file is scaled by the same factor about the same origin, which is
/// the rule an extrusion's parts keep and for the same reason — a per-layer
/// scale about a per-layer origin lets a composition drift apart.
///
/// None when there is nothing to write: a layer with no rectangle, or one
/// whose pixels will not read back as an image.
fn raster(
    doc: &Psd,
    layer: &PsdLayer,
    from: &Box2,
    to: &Box2,
    name: String,
) -> Option<LayerBuilder> {
    let (left, top, width, height, pixels) = crop(layer, doc.width(), doc.height());
    if width == 0 || height == 0 {
        return None;
    }
    let sx = to.width / from.width.max(1.0);
    let sy = to.height / from.height.max(1.0);

    let at_x = to.left + (left as f32 - from.left) * sx;
    let at_y = to.top + (top as f32 - from.top) * sy;
    let out_w = ((width as f32) * sx).round().max(1.0) as u32;
    let out_h = ((height as f32) * sy).round().max(1.0) as u32;

    let rgba = if out_w == width && out_h == height {
        // The ordinary case: a placement nobody resized, at the resolution it
        // was imported with. Not one pixel is resampled.
        pixels
    } else {
        let image = RgbaImage::from_raw(width, height, pixels)?;
        image::imageops::resize(&image, out_w, out_h, FilterType::Lanczos3).into_raw()
    };

    Some(
        LayerBuilder::new(name)
            .rgba(out_w, out_h, rgba)
            .at(at_x.round() as i32, at_y.round() as i32),
    )
}

/// A box in one file's own pixels.
struct Box2 {
    left: f32,
    top: f32,
    width: f32,
    height: f32,
}

/// Where an item sits in its own file, which is what the merged box replaces.
///
/// A group's box is worked out from every layer under it rather than read off
/// the group, because a PSD group's own rectangle is not reliably the union of
/// its contents — and the union is what psd-to-json reports, so it is what the
/// placement on the grid was measured against.
fn box_of(doc: &Psd, item: Item) -> Option<Box2> {
    let (mut l, mut t, mut r, mut b) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    let mut any = false;
    for index in leaves(doc, item) {
        let layer = doc.layer_by_idx(index);
        if layer.width() == 0 || layer.height() == 0 {
            continue;
        }
        any = true;
        l = l.min(layer.layer_left() as f32);
        t = t.min(layer.layer_top() as f32);
        r = r.max((layer.layer_left() + layer.width() as i32) as f32);
        b = b.max((layer.layer_top() + layer.height() as i32) as f32);
    }
    any.then(|| Box2 {
        left: l,
        top: t,
        width: (r - l).max(1.0),
        height: (b - t).max(1.0),
    })
}

/// Every layer under an item, at any depth. The item itself, when it is one.
fn leaves(doc: &Psd, item: Item) -> Vec<usize> {
    match item {
        Item::Layer(index) => vec![index],
        Item::Group(id) => items(doc, Some(id))
            .into_iter()
            .flat_map(|child| leaves(doc, child))
            .collect(),
    }
}

/// A layer name read as psd-to-json's pipe convention.
///
/// `S | hero | animation` is three things: what the pipeline should *make* of
/// the layer, what the layer is called, and whatever else that kind wants.
/// Every part is optional except the middle one — a layer somebody named
/// `sketch` with no pipes in it is a name and nothing else.
struct Named<'a> {
    kind: Option<&'a str>,
    name: &'a str,
    attrs: Option<&'a str>,
}

/// The one letter psd-to-json reads as a category. See README's naming table.
const KINDS: [&str; 5] = ["S", "T", "G", "P", "Z"];

/// Split a raw Photoshop layer name into its three parts.
///
/// **This is the whole of why merging did not work.** A placement's
/// `layerPath` is what the *manifest* calls the layer, and psd-to-json strips
/// the prefix on the way through: the group `G | extrude-mu70cjz3` in the file
/// is `extrude-mu70cjz3` in the manifest, and therefore in the document. So a
/// lookup against raw PSD names by equality never matched anything this editor
/// had written, and every merge failed naming a layer that was right there.
fn parse_name(raw: &str) -> Named<'_> {
    let parts: Vec<&str> = raw.split('|').map(str::trim).collect();
    if parts.len() >= 2 && KINDS.contains(&parts[0]) {
        return Named {
            kind: Some(parts[0]),
            name: parts[1],
            // Rejoined rather than taken as one more part: nothing in the
            // convention says a kind has only one attribute, and putting a
            // stray `|` back the way it was found is cheaper than a rule.
            attrs: (parts.len() > 2).then(|| parts[2]),
        };
    }
    Named {
        kind: None,
        name: raw.trim(),
        attrs: None,
    }
}

/// Which top-level item of a file a placement stands for.
///
/// By name, which is the only handle a placement has on it — and by the
/// *manifest's* name, which is the middle of the three parts above. An unknown
/// name is an error rather than a guess: the editor sends what the manifest
/// said, so a miss means the file has changed under the document, and merging
/// the wrong artwork puts it somewhere it cannot be told from the right
/// artwork.
fn pick(doc: &Psd, path: &str) -> Option<Item> {
    // A placement's path is a top-level name and so has no slash in it. A
    // Photoshop layer may itself be *called* something with a slash, so the
    // whole string is tried first and its last segment only after.
    let want = path.trim();
    if want.is_empty() {
        return None;
    }
    // Read the same way the file's own names are, so a caller that happens to
    // hold the raw spelling — `S | wall` rather than `wall` — is answered too.
    // Nothing sends that today; being total over both costs a line.
    let want = parse_name(want).name;
    named(doc, want).or_else(|| {
        let tail = want.rsplit('/').next().unwrap_or(want);
        (tail != want).then(|| named(doc, tail)).flatten()
    })
}

/// The top-level layer or group whose *name part* is this.
fn named(doc: &Psd, want: &str) -> Option<Item> {
    items(doc, None)
        .into_iter()
        .find(|item| parse_name(&raw_name(doc, *item)).name == want)
}

/// One item's raw name, as Photoshop holds it.
fn raw_name(doc: &Psd, item: Item) -> String {
    match item {
        Item::Layer(index) => doc.layer_by_idx(index).name().to_string(),
        Item::Group(id) => doc
            .groups()
            .get(&id)
            .map(|group| group.name().to_string())
            .unwrap_or_default(),
    }
}

/// What a layer is called once it is in the merged file.
///
/// `[kind] | [name]-[source psd] | [attrs]`, which does two things at once.
/// It **says where each part came from** — `S | wall-hut` is the hut's wall,
/// in a document that is no longer either — and it makes the name unique by
/// construction, which matters more than it reads: psd-to-phaser keys a
/// texture on the layer's own name, so two files that each call a layer
/// `layer 1` would otherwise be one key for two pictures. That is the same
/// collision the editor already closes for separate files by scoping a texture
/// to the file it came from; inside a merged document there is no file left to
/// scope to, so the name carries it instead.
///
/// Applied at **every depth**, not only to the top-level item, because two
/// merged groups can each hold their own `S | x` and the key is the name
/// wherever it sits in the stack.
fn merged_name(raw: &str, source: &str) -> String {
    let parsed = parse_name(raw);
    let body = format!("{}-{source}", parsed.name);
    match (parsed.kind, parsed.attrs) {
        (Some(kind), Some(attrs)) => format!("{kind} | {body} | {attrs}"),
        (Some(kind), None) => format!("{kind} | {body}"),
        (None, Some(attrs)) => format!("{body} | {attrs}"),
        (None, None) => body,
    }
}

/// Names already used in the merged file, as a last resort.
///
/// `merged_name` makes a collision nearly impossible — two names collide only
/// if one file holds the same layer name twice, which Photoshop allows — so
/// this is the floor rather than the usual path, and a second `S | wall-hut`
/// becomes `S | wall-hut-2`.
#[derive(Default)]
struct NameRun {
    taken: Vec<String>,
}

impl NameRun {
    fn take(&mut self, raw: &str, source: &str) -> String {
        let name = merged_name(raw, source);
        if !self.taken.iter().any(|held| held == &name) {
            self.taken.push(name.clone());
            return name;
        }
        for n in 2..1000 {
            let tried = merged_name(raw, &format!("{source}-{n}"));
            if !self.taken.iter().any(|held| held == &tried) {
                self.taken.push(tried.clone());
                return tried;
            }
        }
        name
    }
}
