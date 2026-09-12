//! Project data model. Mirrors src/lib/types.ts.
//!
//! A project is a directory, not a row in a blob. Phaser Bench keeps every
//! sketch and every asset base64-encoded inside one `workspace.json`; that
//! does not survive PSD-heavy projects, so Idlewild gives each project its
//! own directory and writes the document beside its assets.

use serde::{Deserialize, Serialize};

/// The shape of the space a project is built in.
///
/// Isometric and orthogonal are lattices. Blank is not: its cells are single
/// world pixels, so nothing snaps and a selection is exactly the rectangle
/// that was dragged. The frontend's `Grid` is where that lives; here it is a
/// label carried into the document and the scaffolded game's config.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Projection {
    Isometric,
    Orthogonal,
    Blank,
}

impl Projection {
    pub fn as_str(&self) -> &'static str {
        match self {
            Projection::Isometric => "isometric",
            Projection::Orthogonal => "orthogonal",
            Projection::Blank => "blank",
        }
    }
}

/// What kind of game the project scaffolds.
///
/// `Default` is what makes this safe to add to a struct already on disk:
/// every `meta.json` written before the choice existed deserialises as top
/// down, which is what those projects have always been.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Genre {
    #[default]
    Topdown,
    Platformer,
}

impl Genre {
    pub fn as_str(&self) -> &'static str {
        match self {
            Genre::Topdown => "topdown",
            Genre::Platformer => "platformer",
        }
    }
}

/// How a project is rendered, and what its scaffold put in it.
///
/// Three of the four are settings the editor and the game both read, and the
/// editor can change them afterwards — Project Options has them. The fourth,
/// `character`, is a fact about what New Game wrote: a project's `game/` tree
/// is its own copy, so unticking the box later would not take a character out
/// of code that already has one. It is kept because the scaffold has to be
/// reproducible — a managed block's Reset asks for this file as it was first
/// written, and the answer depends on whether a character was in it.
///
/// Every field has a default, and the defaults are what every project written
/// before these existed has always been: no pixel snapping, zoom 1, and a
/// character, because the scaffold always wrote one.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GameOptions {
    /// Nearest-neighbour textures rather than bilinear ones — what keeps a
    /// 16px sprite blocky instead of blurring it as it is scaled up.
    #[serde(default)]
    pub pixel_art: bool,
    /// Draw on whole pixels, so a camera at a fractional scroll does not
    /// smear a sprite across two of them.
    #[serde(default)]
    pub round_pixels: bool,
    /// The zoom a scene opens at, in the editor and in the game.
    #[serde(default = "one")]
    pub default_zoom: f64,
    /// Whether New Game scaffolded a character controller.
    #[serde(default = "yes")]
    pub character: bool,
}

impl Default for GameOptions {
    fn default() -> Self {
        GameOptions {
            pixel_art: false,
            round_pixels: false,
            default_zoom: 1.0,
            character: true,
        }
    }
}

impl GameOptions {
    /// The zoom, with a hand-edited nonsense value brought back into range.
    ///
    /// It reaches a camera and a `setZoom(0)` is a blank screen, so a zero, a
    /// negative or a NaN is not something to pass on.
    pub fn zoom(&self) -> f64 {
        if self.default_zoom.is_finite() && self.default_zoom > 0.0 {
            self.default_zoom.clamp(0.05, 16.0)
        } else {
            1.0
        }
    }
}

fn one() -> f64 {
    1.0
}

fn yes() -> bool {
    true
}

/// The home screen's list entry. Persisted as `meta.json` in the project dir.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMeta {
    pub id: String,
    pub name: String,
    pub projection: Projection,
    #[serde(default)]
    pub genre: Genre,
    #[serde(rename = "gridSize")]
    pub grid_size: u32,
    #[serde(rename = "createdAt")]
    pub created_at: u64,
    #[serde(rename = "updatedAt")]
    pub updated_at: u64,
    #[serde(rename = "layerCount", default)]
    pub layer_count: u32,
    /// Absent on every `meta.json` written before the options existed, which
    /// reads as the defaults — see `GameOptions`.
    #[serde(default)]
    pub options: GameOptions,
}

impl ProjectMeta {
    pub fn new(
        id: String,
        name: String,
        projection: Projection,
        genre: Genre,
        grid_size: u32,
        options: GameOptions,
    ) -> Self {
        let now = now_ms();
        ProjectMeta {
            id,
            name,
            projection,
            genre,
            grid_size,
            created_at: now,
            updated_at: now,
            layer_count: 0,
            options,
        }
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// A file inside a project's editable `game/` tree, as the code modal sees it.
#[derive(Debug, Clone, Serialize)]
pub struct GameFile {
    pub path: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
}

/// One entry produced by a PSD processing run.
#[derive(Debug, Clone, Serialize)]
pub struct OutputFile {
    #[serde(rename = "absolutePath")]
    pub absolute_path: String,
    #[serde(rename = "relativePath")]
    pub relative_path: String,
    pub filename: String,
    #[serde(rename = "isJson")]
    pub is_json: bool,
}

/// Result of importing an image: the PSD it became, and its parsed manifest.
#[derive(Debug, Clone, Serialize)]
pub struct ImportResult {
    /// The key the PSD is registered under — its file stem.
    pub key: String,
    pub width: u32,
    pub height: u32,
    /// The `data.json` manifest, as a JSON string.
    pub manifest: String,
}
