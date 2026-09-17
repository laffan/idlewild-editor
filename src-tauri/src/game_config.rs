//! `game.config.json` — the document, as the project's own code reads it.
//!
//! The scaffold writes an empty one so a fresh project runs before anything
//! has been drawn, and every save rewrites it from the live document — see
//! `store::sync_game_config`. That is what makes the file the code modal
//! opens describe the canvas beside it, and what lets play mode run the
//! project's own program against what has actually been built.
//!
//! An export writes the same thing into the zip. Every path goes through here
//! so there is one definition of the file's shape rather than several that
//! drift.
//!
//! The config is a *projection* of the document, not a second copy of it: it
//! carries what `WorldScene.js` reads and nothing else. Since scenes, `layers`
//! means *the open scene's* layers — which is what that field has always meant
//! in practice and what every project's own copy of the scene file reads — and
//! `scenes` carries all of them beside it for code that wants to place
//! somewhere else. So the document stays
//! opaque to Rust except for these fields, and every one of them is optional
//! — a document written by a build that did not have zones, or instances, or
//! rectangle fills still exports.

use crate::project::ProjectMeta;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

/// Where the generated config lives inside `game/`, and inside a zip.
///
/// One constant because three places need the same path: the scaffold that
/// writes the first one, the save that keeps it in step with the document,
/// and the export that leaves the on-disk copy out of the archive and writes
/// its own.
pub const CONFIG_REL: &str = "js/game.config.json";

/// How far the character may walk, in cells.
///
/// It is measured from the content, because a project whose content sits
/// outside it would come out with its far side unreachable. The ceiling is
/// what stops a document with one placement a mile from the origin — or a
/// hand-edited coordinate — from handing a search a world it has to walk
/// across before it can answer. The span holds the content with room to
/// spare, within these two bounds.
///
/// It used to bound the drawn lattice as well, which is why it is clamped
/// rather than simply grown: the scenes stroked `(2n+1)²` cell outlines. They
/// draw no grid now — that is the editor's scaffolding, not the game's — so
/// this is the walkable bound and nothing else.
const MIN_SPAN: i64 = 24;
const MAX_SPAN: i64 = 128;
/// Cells of clear space left around the content.
const SPAN_MARGIN: i64 = 4;

/// The config a fresh project scaffolds with: the shape of the space, and
/// nothing in it.
pub fn empty(meta: &ProjectMeta) -> Value {
    config(
        meta,
        MIN_SPAN,
        json!({ "cx": 0, "cy": 0 }),
        json!([]),
        json!([]),
        json!([{
            "id": "scene-main",
            "name": crate::templates::FIRST_SCENE,
            "file": crate::templates::FIRST_SCENE,
            "spawn": { "cx": 0, "cy": 0 },
            "layers": []
        }]),
        json!("scene-main"),
        meta.options.character,
    )
}

/// The config an export ships: the same fields, filled in from `doc.json`.
///
/// A document that cannot be parsed is not a reason to fail the export — the
/// zip is still a runnable game, just an empty one — but it is worth saying
/// so, which is why this returns the reason rather than swallowing it.
pub fn from_document(meta: &ProjectMeta, doc_json: &str) -> Result<Value, String> {
    let doc: Document = serde_json::from_str(doc_json)
        .map_err(|e| format!("Cannot read this project's document: {e}"))?;
    let scenes = doc.scenes();

    // Every scene's keys, not just the open one's. The scene the editor is
    // looking at is the one the game places, but a project that switches
    // scenes in its own code needs the textures for the one it switches to —
    // and loading them is cheap beside finding out at the switch that they
    // are not there.
    let mut keys: Vec<String> = Vec::new();
    for scene in &scenes {
        for layer in &scene.layers {
            for placement in &layer.placements {
                if !keys.contains(&placement.psd_key) {
                    keys.push(placement.psd_key.clone());
                }
            }
        }
    }

    let span = span_for(&scenes, meta.grid_size);
    let active = doc
        .active_scene_id
        .clone()
        .filter(|id| scenes.iter().any(|s| s.id.as_deref() == Some(id.as_str())))
        .or_else(|| scenes.first().and_then(|s| s.id.clone()))
        .unwrap_or_default();

    let open = scenes
        .iter()
        .find(|s| s.id.as_deref() == Some(active.as_str()))
        .or_else(|| scenes.first());

    // What each placed PSD blocks is document-level, like the PSDs
    // themselves, so every scene is told the same map.
    let colliders = &doc.colliders;

    // Where the character starts: the open scene's start point, or the origin
    // for a scene that has not named one. The origin is what `spawn` has
    // always been and what every scaffolded `spawnCharacter` still falls back
    // to, so a project with no points reads exactly as it did.
    let spawn = open
        .and_then(|scene| scene.start_cell())
        .unwrap_or(Cell { cx: 0.0, cy: 0.0 });

    Ok(config(
        meta,
        span,
        json!(spawn),
        json!(keys),
        json!(open
            .map(|s| s
                .layers
                .iter()
                .map(|layer| layer.to_config(colliders))
                .collect::<Vec<_>>())
            .unwrap_or_default()),
        json!(scenes
            .iter()
            .zip(scene_file_names(&scenes))
            .map(|(scene, file)| scene.to_config(&file, colliders))
            .collect::<Vec<_>>()),
        json!(active),
        meta.options.character,
    ))
}

/// What each scene's file is called, in document order.
///
/// A name in the sidebar is free text — "Title Screen", "cave 2", "" — and a
/// file name, a class name and a Phaser key are none of those things. So the
/// name is reduced to letters and digits with each word capitalised, which is
/// what a Phaser scene class is normally called anyway.
///
/// Two scenes may share a name; two files may not. A collision takes a
/// counter, and the scene earlier in the document keeps the bare name — so
/// renaming the *second* of two Caves is the only thing that moves.
///
/// `Index` is reserved because `js/scenes/index.js` is the generated list
/// beside them, and a scene called Index would be written over it.
pub fn scene_file_names(scenes: &[Scene]) -> Vec<String> {
    let mut taken: HashSet<String> = HashSet::new();
    taken.insert("Index".into());
    let mut out = Vec::with_capacity(scenes.len());
    for scene in scenes {
        let base = scene_file_name(&scene.name);
        let mut name = base.clone();
        let mut n = 2;
        while !taken.insert(name.clone()) {
            name = format!("{base}{n}");
            n += 1;
        }
        out.push(name);
    }
    out
}

/// One scene name, as a class name.
///
/// Anything that is not a letter or a digit is a word break. A name that
/// reduces to nothing is `Scene`, and one that would start with a digit is
/// prefixed, because neither is a legal identifier.
pub fn scene_file_name(name: &str) -> String {
    let mut out = String::new();
    let mut upper = true;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            if upper {
                out.extend(ch.to_uppercase());
            } else {
                out.push(ch);
            }
            upper = false;
        } else {
            upper = true;
        }
    }
    if out.is_empty() {
        return "Scene".into();
    }
    if out.starts_with(|c: char| c.is_ascii_digit()) {
        return format!("Scene{out}");
    }
    out
}

/// The file, in the order it reads.
///
/// `layers` is the **open scene's** layers, at the top level because it is
/// what every project's own `WorldScene.js` reads and has always read — a
/// project scaffolded before scenes existed keeps its own copy of that file,
/// and moving the field would have broken it. `scenes` carries all of them
/// beside it, for code that wants to place somewhere else, and `activeScene`
/// says which one `layers` mirrors.
#[allow(clippy::too_many_arguments)]
fn config(
    meta: &ProjectMeta,
    span: i64,
    spawn: Value,
    psd_keys: Value,
    layers: Value,
    scenes: Value,
    active_scene: Value,
    character: bool,
) -> Value {
    json!({
        "projection": meta.projection.as_str(),
        "genre": meta.genre.as_str(),
        "grid": meta.grid_size,
        "gridSpan": span,
        // The rendering options, as the project's own code reads them:
        // `main.js` hands the first two to Phaser and the scene gives the
        // other two to its camera. They ride in the generated file rather
        // than being written into the scaffold as literals, so a toggle in
        // Project Options reaches a game whose code nobody has touched.
        "pixelArt": meta.options.pixel_art,
        "roundPixels": meta.options.round_pixels,
        "zoom": meta.options.zoom(),
        // Whether the project wants the character controller. It used to be
        // resolved when the files were written — `// idlewild:if character`,
        // a choice made once — so Project Options could only report it. Read
        // here by `shared/character.js`, which answers no and leaves the
        // scene to run without one, it is a switch like the rest of them.
        "character": character,
        // The page around the game: size, placement, margin, corners and what
        // is behind it. `main.js` writes these onto the document as custom
        // properties and `styles.css` reads them, so a stylesheet somebody has
        // edited keeps whatever they wrote — see `Presentation`. Clamped here
        // rather than trusted, because a `meta.json` is a file on a disk.
        "presentation": meta.presentation.sane(),
        "spawn": spawn,
        "psdKeys": psd_keys,
        "layers": layers,
        "scenes": scenes,
        "activeScene": active_scene,
        "psdPipeline": "psd-to-json@tauri"
    })
}

/// How far the content reaches from the origin, in cells.
///
/// Two kinds of coordinate have to be reduced to the same unit. Fills on a
/// snapping grid are addressed in cells already; everything else — a
/// placement, a rectangle fill, a boundary's outline — is in world pixels,
/// and a world pixel is a cell divided by the grid size. Under a blank
/// projection a *document* cell is one pixel, which is why fill cells are
/// absent there and the world-pixel path is what measures the content.
fn span_for(scenes: &[Scene], grid_size: u32) -> i64 {
    let size = grid_size.max(1) as f64;
    let mut reach = 0f64;
    let mut cells = |cx: f64, cy: f64| reach = reach.max(cx.abs()).max(cy.abs());

    // Over every scene, because the span is also the bounds the character may
    // walk: a scene switch must not land it outside the world.
    for layer in scenes.iter().flat_map(|scene| &scene.layers) {
        for fill in &layer.fills {
            for cell in &fill.cells {
                cells(cell.cx, cell.cy);
            }
            if let Some(rect) = &fill.rect {
                cells(rect.x / size, rect.y / size);
                cells((rect.x + rect.width) / size, (rect.y + rect.height) / size);
            }
        }
        for placement in &layer.placements {
            cells(placement.x / size, placement.y / size);
            cells(
                (placement.x + placement.width) / size,
                (placement.y + placement.height) / size,
            );
        }
        for zone in &layer.zones {
            for point in &zone.points {
                cells(point.x / size, point.y / size);
            }
        }
        // A point is already in cells, and it counts: the span is also the
        // bounds the character may walk, and a start point outside it would
        // put the character outside the world on the first frame.
        for point in &layer.points {
            cells(point.cell.cx, point.cell.cy);
        }
    }
    // A NaN or an infinity in a hand-edited document must not become a span.
    let span = if reach.is_finite() { reach.ceil() as i64 } else { 0 };
    span.saturating_add(SPAN_MARGIN).clamp(MIN_SPAN, MAX_SPAN)
}

// ── the half of the document the exported scene reads ───────────────────────

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Document {
    #[serde(default)]
    scenes: Vec<Scene>,
    #[serde(default)]
    active_scene_id: Option<String>,
    /// Where layers lived before scenes. A document is migrated the first
    /// time the editor opens it, but this runs on the way *in* as well — so
    /// a project that has not been opened since still exports what is in it.
    #[serde(default)]
    layers: Vec<Layer>,
    /// What each placed PSD blocks, by key — see `lib/collider.ts`.
    #[serde(default)]
    colliders: HashMap<String, Collider>,
}

impl Document {
    /// The scenes this document has, or the one it implies.
    fn scenes(&self) -> Vec<Scene> {
        if !self.scenes.is_empty() {
            return self.scenes.clone();
        }
        vec![Scene {
            id: Some("scene-main".into()),
            name: "Main".into(),
            layers: self.layers.clone(),
            // A document written before scenes existed was written before
            // points existed too, so it has nowhere it starts.
            start_point_id: None,
        }]
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    #[serde(default)]
    id: Option<String>,
    #[serde(default = "unnamed")]
    name: String,
    #[serde(default)]
    layers: Vec<Layer>,
    /// The point play begins on, by id. One per scene, which is why it is
    /// stored here rather than as a flag on each point.
    #[serde(default)]
    start_point_id: Option<String>,
}

impl Scene {
    /// `file` is the scene's own file in `js/scenes/`, without the extension
    /// — which is also its class name and its Phaser key, so the code that
    /// places this scene can find it by the key it is running under. Worked
    /// out by the caller rather than here, because it has to be unique across
    /// the project and one scene cannot see the others.
    fn to_config(&self, file: &str, colliders: &HashMap<String, Collider>) -> Value {
        json!({
            "id": self.id,
            "name": self.name,
            "file": file,
            "startPointId": self.start_point_id,
            // Where play begins *in this scene*. It was one field at the top
            // of the config, which was the open scene's — right when one file
            // placed whichever scene was open, and wrong now that each scene
            // has a file of its own and places itself.
            "spawn": self.start_cell().unwrap_or(Cell { cx: 0.0, cy: 0.0 }),
            "layers": self
                .layers
                .iter()
                .map(|layer| layer.to_config(colliders))
                .collect::<Vec<_>>(),
        })
    }

    /// The space this scene starts play on, if it names a point that is
    /// really there. A designation left pointing at a deleted point is not a
    /// spawn at the origin quietly — it is no designation at all, and the
    /// caller falls back the same way a scene with none does.
    fn start_cell(&self) -> Option<Cell> {
        let id = self.start_point_id.as_deref()?;
        self.layers
            .iter()
            .flat_map(|layer| &layer.points)
            .find(|point| point.id == id)
            .map(|point| point.cell)
    }
}

fn unnamed() -> String {
    "Scene".into()
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Layer {
    #[serde(default = "yes")]
    visible: bool,
    #[serde(default)]
    fills: Vec<Fill>,
    #[serde(default)]
    placements: Vec<Placement>,
    /// Named places. Absent on every document written before the Point tool.
    #[serde(default)]
    points: Vec<MapPoint>,
    #[serde(default)]
    zones: Vec<Zone>,
    /// What this layer is for — "object", "pattern" or "background". Absent
    /// on every layer written before there was more than one kind, and absent
    /// means object, which is what a layer has always been.
    #[serde(default)]
    kind: Option<String>,
    /// A pattern layer's rule. The placements on such a layer are the palette
    /// it scatters rather than things standing anywhere, so the scene reads
    /// this and generates rather than placing them where they sit.
    #[serde(default)]
    pattern: Option<Value>,
    /// A background layer's backdrops: colours and gradients, camera-locked.
    #[serde(default)]
    backgrounds: Vec<Value>,
}

impl Layer {
    /// A hidden layer keeps its place in the list, because the list is what
    /// gives every layer its depth — dropping one here would move everything
    /// behind it forward.
    ///
    /// A collider rides on the *first* placement of each unit and on none of
    /// the others. A PSD with three layers is three placements of one thing
    /// standing on one patch of ground, and three copies of that patch would
    /// be three identical rectangles in the exported game's solid list.
    fn to_config(&self, colliders: &HashMap<String, Collider>) -> Value {
        let mut seen: HashSet<&str> = HashSet::new();
        let placements: Vec<Value> = self
            .placements
            .iter()
            .map(|placement| {
                let unit = placement
                    .instance
                    .as_deref()
                    .unwrap_or(placement.id.as_str());
                let collider = if seen.insert(unit) {
                    colliders.get(&placement.psd_key)
                } else {
                    None
                };
                placement.to_config(collider)
            })
            .collect();

        json!({
            "visible": self.visible,
            // Absent means object, and the config says so outright rather
            // than leaving every reader of it to know that.
            "kind": self.kind.clone().unwrap_or_else(|| "object".into()),
            "fills": self.fills.iter().map(Fill::to_config).collect::<Vec<_>>(),
            "placements": placements,
            "points": self.points.iter().map(MapPoint::to_config).collect::<Vec<_>>(),
            "zones": self.zones.iter().map(Zone::to_config).collect::<Vec<_>>(),
            // Carried through as the editor wrote them. Both are opaque to
            // Rust — a pattern is a rule the scene's own `pattern.js` runs,
            // and a backdrop is two colours and an angle — so passing them
            // through is the whole of what this file has to do with them.
            "pattern": self.pattern,
            "backgrounds": self.backgrounds,
        })
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fill {
    #[serde(default)]
    cells: Vec<Cell>,
    #[serde(default)]
    rect: Option<Rect>,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    walkable: bool,
}

impl Fill {
    fn to_config(&self) -> Value {
        json!({
            "cells": self.cells,
            "rect": self.rect,
            "color": self.color,
            "walkable": self.walkable,
        })
    }
}

/// A placement, with the size it is *displayed* at kept beside the size the
/// manifest exported — their ratio is the scale, exactly as the editor's own
/// renderer works it out. Sending the ratio instead would hide where it comes
/// from in a file whose whole job is to be readable.
///
/// `hidden` and `hiddenParts` are what the PSD says is turned off, carried so
/// that the game draws what the editor draws.
///
/// `order` and `instance` are what make a multi-layer PSD draw the right way
/// up. `order` is how high the layer sat in its file's stack, counting from
/// the back; `instance` is the unit the placements of one PSD share, so a
/// roof and the tower under it sort against the rest of the scene as one
/// thing. Both are optional because a document written before they existed
/// has neither, and the editor fills them in on open.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Placement {
    #[serde(default)]
    id: String,
    #[serde(default)]
    psd_key: String,
    #[serde(default)]
    layer_path: String,
    #[serde(default)]
    x: f64,
    #[serde(default)]
    y: f64,
    #[serde(default)]
    width: f64,
    #[serde(default)]
    height: f64,
    #[serde(default)]
    natural_width: Option<f64>,
    #[serde(default)]
    natural_height: Option<f64>,
    #[serde(default)]
    order: Option<i64>,
    /// Whether the PSD says this layer is turned off.
    ///
    /// The game places it either way — the asset is exported and the object
    /// is made, so the project's own code can turn it on — it simply starts
    /// invisible. `hidden_parts` names the layers *inside* a placed group
    /// that are off on their own, which a group placed whole cannot say any
    /// other way. See `src/lib/manifest.ts`.
    #[serde(default)]
    hidden: Option<bool>,
    #[serde(default)]
    hidden_parts: Option<Vec<String>>,
    /// Which placed unit this belongs to. Absent on a document written before
    /// units existed, where a placement is a unit of one and its own id says
    /// so — the same fallback `game/instance.ts` makes.
    #[serde(default)]
    instance: Option<String>,
    /// The space the artwork hangs from, which a collider is measured against.
    #[serde(default)]
    anchor: Cell,
}

impl Placement {
    /// The anchor and the collider travel together and unresolved, in the
    /// cell offsets the document stores.
    ///
    /// Adding them up needs the projection — an isometric anchor's world
    /// position is a diamond transform of two integers — and the projection
    /// lives in `grid.js`, which the exported game already carries. Resolving
    /// here would mean a second copy of that arithmetic in Rust, to be kept
    /// in step with the one the runtime uses.
    fn to_config(&self, collider: Option<&Collider>) -> Value {
        json!({
            "psdKey": self.psd_key,
            "layerPath": self.layer_path,
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height,
            "naturalWidth": self.natural_width,
            "naturalHeight": self.natural_height,
            "order": self.order,
            "hidden": self.hidden,
            "hiddenParts": self.hidden_parts,
            "instance": self.instance,
            "anchor": self.anchor,
            "collider": collider,
        })
    }
}

/// What a placed PSD blocks: grid spaces, as offsets from its anchor.
///
/// `rect` is the shape a project whose grid does not snap gets instead, in
/// the same units — a cell there is one world pixel. Both are carried through
/// verbatim; see `lib/collider.ts` for what they mean.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
struct Collider {
    #[serde(default)]
    cells: Vec<Cell>,
    #[serde(default)]
    rect: Option<Rect>,
    #[serde(default)]
    blocking: bool,
}

/// A named place: an id, a name and the space it stands on.
///
/// The cell travels unresolved, for the reason a placement's anchor does —
/// turning it into a position is a diamond transform of two integers, and
/// that arithmetic lives in `grid.js`, which the exported game already
/// carries. `cellCentre` is what the scenes call on it.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MapPoint {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    cell: Cell,
}

impl MapPoint {
    fn to_config(&self) -> Value {
        json!({ "id": self.id, "name": self.name, "cell": self.cell })
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Zone {
    #[serde(default)]
    points: Vec<Point>,
    #[serde(default)]
    blocking: bool,
}

impl Zone {
    fn to_config(&self) -> Value {
        json!({ "points": self.points, "blocking": self.blocking })
    }
}

#[derive(Debug, Clone, Copy, Default, Deserialize, serde::Serialize)]
struct Cell {
    cx: f64,
    cy: f64,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, serde::Serialize)]
struct Point {
    x: f64,
    y: f64,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, serde::Serialize)]
struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn yes() -> bool {
    true
}
