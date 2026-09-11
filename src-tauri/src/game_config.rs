//! `game.config.json` — the document, as the exported game reads it.
//!
//! The scaffold writes an empty one so a fresh project runs before anything
//! has been drawn; an export writes the live document into it, and that is
//! what makes a published game show what the editor shows. Both go through
//! here so there is one definition of the file's shape rather than two that
//! drift.
//!
//! The config is a *projection* of the document, not a second copy of it: it
//! carries what `WorldScene.js` reads and nothing else. So the document stays
//! opaque to Rust except for these fields, and every one of them is optional
//! — a document written by a build that did not have zones, or instances, or
//! rectangle fills still exports.

use crate::project::{Genre, ProjectMeta, Projection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

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
    config(projection, genre, grid_size, MIN_SPAN, json!([]), json!([]))
}

/// The config an export ships: the same fields, filled in from `doc.json`.
///
/// A document that cannot be parsed is not a reason to fail the export — the
/// zip is still a runnable game, just an empty one — but it is worth saying
/// so, which is why this returns the reason rather than swallowing it.
pub fn from_document(meta: &ProjectMeta, doc_json: &str) -> Result<Value, String> {
    let doc: Document = serde_json::from_str(doc_json)
        .map_err(|e| format!("Cannot read this project's document: {e}"))?;

    let mut keys: Vec<String> = Vec::new();
    for layer in &doc.layers {
        for placement in &layer.placements {
            if !keys.contains(&placement.psd_key) {
                keys.push(placement.psd_key.clone());
            }
        }
    }

    let span = span_for(&doc, meta.grid_size);
    let layers: Vec<Value> = doc
        .layers
        .iter()
        .map(|layer| layer.to_config(&doc.colliders))
        .collect();

    Ok(config(
        meta.projection,
        meta.genre,
        meta.grid_size,
        span,
        json!(keys),
        json!(layers),
    ))
}

fn config(
    projection: Projection,
    genre: Genre,
    grid_size: u32,
    span: i64,
    psd_keys: Value,
    layers: Value,
) -> Value {
    json!({
        "projection": projection.as_str(),
        "genre": genre.as_str(),
        "grid": grid_size,
        "gridSpan": span,
        "spawn": { "cx": 0, "cy": 0 },
        "psdKeys": psd_keys,
        "layers": layers,
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
fn span_for(doc: &Document, grid_size: u32) -> i64 {
    let size = grid_size.max(1) as f64;
    let mut reach = 0f64;
    let mut cells = |cx: f64, cy: f64| reach = reach.max(cx.abs()).max(cy.abs());

    for layer in &doc.layers {
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
struct Document {
    #[serde(default)]
    layers: Vec<Layer>,
    /// What each placed PSD blocks, by key — see `lib/collider.ts`.
    #[serde(default)]
    colliders: HashMap<String, Collider>,
}

#[derive(Debug, Default, Deserialize)]
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
                let unit = if placement.instance.is_empty() {
                    placement.id.as_str()
                } else {
                    placement.instance.as_str()
                };
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
            "zones": self.zones.iter().map(Zone::to_config).collect::<Vec<_>>(),
        })
    }
}

#[derive(Debug, Default, Deserialize)]
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
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Placement {
    #[serde(default)]
    id: String,
    /// Which placed unit this belongs to. Empty on a document written before
    /// units existed, where a placement is a unit of one and its own id says
    /// so — the same fallback `game/instance.ts` makes.
    #[serde(default)]
    instance: String,
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

#[derive(Debug, Default, Deserialize)]
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
