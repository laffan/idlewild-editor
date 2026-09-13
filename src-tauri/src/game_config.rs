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
        json!([{ "id": "scene-main", "name": "Main", "layers": [] }]),
        json!("scene-main"),
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
            .map(|scene| scene.to_config(colliders))
            .collect::<Vec<_>>()),
        json!(active),
    ))
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
struct Scene {
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
    fn to_config(&self, colliders: &HashMap<String, Collider>) -> Value {
        json!({
            "id": self.id,
            "name": self.name,
            "startPointId": self.start_point_id,
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
            "fills": self.fills.iter().map(Fill::to_config).collect::<Vec<_>>(),
            "placements": placements,
            "points": self.points.iter().map(MapPoint::to_config).collect::<Vec<_>>(),
            "zones": self.zones.iter().map(Zone::to_config).collect::<Vec<_>>(),
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
