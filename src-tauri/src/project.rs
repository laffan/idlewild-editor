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
}

impl ProjectMeta {
    pub fn new(
        id: String,
        name: String,
        projection: Projection,
        genre: Genre,
        grid_size: u32,
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
