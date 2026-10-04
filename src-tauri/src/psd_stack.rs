//! The command surface over a PSD's own layer stack.
//!
//! Five thin wrappers, the way `game_files.rs` is nine: the rules are next
//! door — `psd_layers.rs` reads and rebuilds the stack, `psd_extract.rs`
//! takes layers out of it — and what is here is the shape they cross the
//! bridge in. Split from `lib.rs` for the 700-line rule, and along a real
//! seam: these are the only commands whose subject is the *inside* of a file
//! rather than a file, a project or a site.
//!
//! Every one that writes takes the app handle, because a write to a PSD
//! re-parses it and psd-to-json narrates itself a stage at a time — see
//! `logger`, and `editor/psd-progress.ts` for what those lines are for.

use crate::logger;
use crate::{psd_extract, psd_layers, psd_paint};

/// A PSD's real layer stack, for the inspector's layer editor.
#[tauri::command]
pub fn read_psd_layers(id: String, key: String) -> Result<psd_layers::PsdLayerList, String> {
    psd_layers::read(&id, &key)
}

/// Rewrite that stack in the order and under the names the user gave it,
/// then run the file back through psd-to-json. Returns the fresh manifest.
#[tauri::command(async)]
pub fn write_psd_layers(
    app: tauri::AppHandle,
    id: String,
    key: String,
    layers: Vec<psd_layers::LayerEdit>,
) -> Result<String, String> {
    psd_layers::write(&id, &key, &layers, logger(&app))
}

/// Take named layers out of a PSD and re-parse what is left.
///
/// The second half of **Extract**: the first is a merge, which writes the
/// layers out as a file of their own, and this is what stops the artwork
/// being in the project twice. See `psd_extract.rs`.
#[tauri::command(async)]
pub fn drop_psd_layers(
    app: tauri::AppHandle,
    id: String,
    key: String,
    paths: Vec<String>,
) -> Result<psd_extract::Extraction, String> {
    psd_extract::drop_layers(&id, &key, &paths, logger(&app))
}

/// Put an empty sprite layer on the top of a PSD's stack.
///
/// Returns the fresh manifest, as every write that touches the file does:
/// the layer arrives with a single transparent pixel in it, which is nothing
/// to draw but is a real row to rename, reorder or draw into.
/// Give a PSD a `P | anchor` at `x, y` in its own pixels — the button on the
/// "No anchor" warning. Hands back the new manifest.
#[tauri::command(async)]
pub fn add_psd_anchor(
    app: tauri::AppHandle,
    id: String,
    key: String,
    x: i32,
    y: i32,
) -> Result<String, String> {
    crate::psd_anchor::add_anchor(&id, &key, x, y, logger(&app))
}

#[tauri::command(async)]
pub fn add_psd_layer(app: tauri::AppHandle, id: String, key: String) -> Result<String, String> {
    psd_layers::add(&id, &key, logger(&app))
}

/// Lay ink into one layer of a PSD — what PSD Edit mode applies.
///
/// `index` and `name` together name the row, and both are checked: a paint
/// against an index the file has since renumbered would put a drawing in the
/// wrong layer, and nothing about the result would say so.
///
/// The pixels arrive as raw bytes beside the arguments — see `ipc_bytes.rs`.
#[tauri::command(async)]
pub fn paint_psd_layer(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    let mut packed = crate::ipc_bytes::unpack::<PaintArgs>(&request)?;
    let rgba = packed.take(packed.args.paint.rgba)?;
    let erase = match packed.args.paint.erase {
        Some(erase) => Some(packed.take(erase)?),
        None => None,
    };
    let PaintArgs {
        id,
        key,
        index,
        name,
        paint,
    } = packed.args;
    let paint = psd_paint::Paint {
        x: paint.rect.x,
        y: paint.rect.y,
        width: paint.rect.width,
        height: paint.rect.height,
        rgba,
        erase,
    };
    psd_layers::paint(&id, &key, index, &name, paint, logger(&app))
}

#[derive(serde::Deserialize)]
struct PaintArgs {
    id: String,
    key: String,
    index: usize,
    name: String,
    paint: PaintWire,
}

#[derive(serde::Deserialize)]
struct PaintWire {
    #[serde(flatten)]
    rect: psd_paint::PaintBox,
    rgba: crate::ipc_bytes::Bytes,
    #[serde(default)]
    erase: Option<crate::ipc_bytes::Bytes>,
}
