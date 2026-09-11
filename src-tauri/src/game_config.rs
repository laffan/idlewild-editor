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

use crate::project::{Genre, ProjectMeta, Projection};
use serde::Deserialize;
use serde_json::{json, Value};

/// Where the generated config lives inside `game/`, and inside a zip.
///
/// One constant because three places need the same path: the scaffold that
/// writes the first one, the save that keeps it in step with the document,
/// and the export that leaves the on-disk copy out of the archive and writes
/// its own.
pub const CONFIG_REL: &str = "js/game.config.json";

/// How far out the grid is drawn and the character may walk, in cells.
///
/// The scenes draw `(2n+1)²` cell outlines, so this cannot simply grow to fit
/// a large project — but a project whose content sits outside it would come
/// out with its far side unreachable, which is worse. The span holds the
/// content with room to spare, within these two bounds.
const MIN_SPAN: i64 = 24;
const MAX_SPAN: i64 = 128;
/// Cells of clear space left around the content.
const SPAN_MARGIN: i64 = 4;

/// The config a fresh project scaffolds with: the shape of the space, and
/// nothing in it.
pub fn empty(projection: Projection, genre: Genre, grid_size: u32) -> Value {
    config(
        projection,
        genre,
        grid_size,
        MIN_SPAN,
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

    Ok(config(
        meta.projection,
        meta.genre,
        meta.grid_size,
        span,
        json!(keys),
        json!(open.map(|s| s.layers.iter().map(Layer::to_config).collect::<Vec<_>>())
            .unwrap_or_default()),
        json!(scenes.iter().map(Scene::to_config).collect::<Vec<_>>()),
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
    projection: Projection,
    genre: Genre,
    grid_size: u32,
    span: i64,
    psd_keys: Value,
    layers: Value,
    scenes: Value,
    active_scene: Value,
) -> Value {
    json!({
        "projection": projection.as_str(),
        "genre": genre.as_str(),
        "grid": grid_size,
        "gridSpan": span,
        "spawn": { "cx": 0, "cy": 0 },
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
        }]
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
struct Scene {
    #[serde(default)]
    id: Option<String>,
    #[serde(default = "unnamed")]
    name: String,
    #[serde(default)]
    layers: Vec<Layer>,
}

impl Scene {
    fn to_config(&self) -> Value {
        json!({
            "id": self.id,
            "name": self.name,
            "layers": self.layers.iter().map(Layer::to_config).collect::<Vec<_>>(),
        })
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
    #[serde(default)]
    zones: Vec<Zone>,
}

impl Layer {
    /// A hidden layer keeps its place in the list, because the list is what
    /// gives every layer its depth — dropping one here would move everything
    /// behind it forward.
    fn to_config(&self) -> Value {
        json!({
            "visible": self.visible,
            "fills": self.fills.iter().map(Fill::to_config).collect::<Vec<_>>(),
            "placements": self
                .placements
                .iter()
                .map(Placement::to_config)
                .collect::<Vec<_>>(),
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
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Placement {
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
}

impl Placement {
    fn to_config(&self) -> Value {
        json!({
            "psdKey": self.psd_key,
            "layerPath": self.layer_path,
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height,
            "naturalWidth": self.natural_width,
            "naturalHeight": self.natural_height,
        })
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
