//! Tauri command surface. Every frontend call lands here; the modules below
//! hold the actual work.

mod archive;
mod clipboard;
mod file_server;
mod game_config;
mod game_files;
mod project;
mod psd_layers;
mod psd_marks;
mod psd_paint;
mod psd_pipeline;
mod psd_rebuild;
mod psd_write;
mod publish;
mod store;
mod templates;

#[cfg(test)]
mod tests;

use project::{GameOptions, Genre, ImportResult, OutputFile, ProjectMeta, Projection};
use psd_pipeline::ProcessOptions;
use psd_write::AnchorMarks;
use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

/// The port the asset server bound to, so the frontend can build P2P base URLs.
struct ServerPort(u16);

#[tauri::command]
fn get_server_port(state: tauri::State<'_, ServerPort>) -> u16 {
    state.0
}

/// Which platform the shell is running on, so the frontend can pick between
/// handing a file to a desktop editor and handing it to a share sheet.
#[tauri::command]
fn platform() -> &'static str {
    std::env::consts::OS
}

/// What the system pasteboard is holding.
///
/// Not `async`, so Tauri runs it on the main thread: `UIPasteboard` requires
/// that and `NSPasteboard` is happier for it. See clipboard.rs for why the
/// webview's own clipboard cannot answer this.
#[tauri::command]
fn read_clipboard() -> Result<clipboard::ClipboardRead, String> {
    clipboard::read()
}

/// A file the OS handed over by path, as bytes the frontend can measure.
///
/// A drop onto the canvas arrives as a path where the shell intercepts the
/// drag before the webview sees it, and as a `File` where it does not. The
/// marks an import writes describe where the artwork sits, so its size has to
/// be known *before* the import — which means the bytes have to be in the
/// frontend either way. Restricted to what the pipeline can import, so this
/// is a route for dropped artwork rather than a general file reader.
#[tauri::command]
fn read_dropped_file(source_path: String) -> Result<DroppedFile, String> {
    let path = psd_write::source_path(&source_path);
    if !clipboard::importable_path(&path) {
        return Err(format!(
            "{} is not an image this app can import",
            path.display()
        ));
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    use base64::Engine;
    Ok(DroppedFile {
        name: path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("image")
            .to_string(),
        data_base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DroppedFile {
    name: String,
    data_base64: String,
}

// ── projects ────────────────────────────────────────────────────────────────

#[tauri::command]
fn list_projects() -> Result<Vec<ProjectMeta>, String> {
    store::list_projects()
}

/// `genre` is optional so a caller that predates the choice still works; it
/// means top down, which is what every project made before it was. `options`
/// is optional for the same reason, and means the defaults — no pixel
/// snapping, zoom 1, and a character controller, which is what every project
/// scaffolded before New Game asked.
#[tauri::command]
fn create_project(
    name: String,
    projection: String,
    grid_size: u32,
    genre: Option<String>,
    options: Option<GameOptions>,
) -> Result<ProjectMeta, String> {
    let projection = match projection.as_str() {
        "isometric" => Projection::Isometric,
        "orthogonal" => Projection::Orthogonal,
        "blank" => Projection::Blank,
        other => return Err(format!("Unknown template: {other}")),
    };
    let genre = match genre.as_deref() {
        None | Some("topdown") => Genre::Topdown,
        Some("platformer") => Genre::Platformer,
        Some(other) => return Err(format!("Unknown style: {other}")),
    };
    // Gravity has no direction on a diamond grid seen from above, and there
    // is no scaffold that could honestly be written for the pair.
    if projection == Projection::Isometric && genre == Genre::Platformer {
        return Err("An isometric project cannot be a platformer".into());
    }
    store::create_project(
        &name,
        projection,
        genre,
        grid_size,
        options.unwrap_or_default(),
    )
}

/// Change how a project renders: pixel art, whole-pixel drawing, the zoom a
/// scene opens at. What Project Options writes.
///
/// The scaffold's own choice — whether a character controller was written — is
/// not here: a project's `game/` tree is its own copy, and unticking a box
/// would not take a character out of code that already has one.
#[tauri::command]
fn set_project_options(
    id: String,
    pixel_art: bool,
    round_pixels: bool,
    default_zoom: f64,
) -> Result<ProjectMeta, String> {
    store::set_project_options(&id, pixel_art, round_pixels, default_zoom)
}

#[tauri::command]
fn rename_project(id: String, name: String) -> Result<ProjectMeta, String> {
    store::rename_project(&id, &name)
}

#[tauri::command]
fn delete_project(id: String) -> Result<(), String> {
    store::delete_project(&id)
}

#[tauri::command]
fn duplicate_project(id: String) -> Result<ProjectMeta, String> {
    store::duplicate_project(&id)
}

#[tauri::command]
fn read_project_meta(id: String) -> Result<ProjectMeta, String> {
    store::read_meta(&id)
}

/// Read the document — and, on the way, bring the generated config level
/// with it.
///
/// Opening a project is the one moment the whole document is in hand and
/// nothing is about to change it. Every save keeps
/// `game/js/game.config.json` in step from then on, but a project made before
/// that was true has an empty one on disk, and Play runs the project's own
/// code against that file. Syncing here is what stops such a project opening
/// to a canvas full of work and playing an empty world.
#[tauri::command]
fn read_document(id: String) -> Result<String, String> {
    let doc = store::read_doc(&id)?;
    let _ = store::sync_game_config(&id);
    Ok(doc)
}

#[tauri::command]
fn write_document(id: String, doc: String) -> Result<(), String> {
    store::write_doc(&id, &doc)
}

#[tauri::command]
fn read_thumbnail(id: String) -> Result<Option<String>, String> {
    store::read_thumbnail(&id)
}

/// The editor renders its own thumbnail from the live canvas and posts the
/// PNG back here as base64.
#[tauri::command]
fn write_thumbnail(id: String, png_base64: String) -> Result<(), String> {
    use base64::Engine;
    let data = png_base64
        .split_once(",")
        .map(|(_, rest)| rest)
        .unwrap_or(&png_base64);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|e| format!("Bad thumbnail data: {e}"))?;
    store::write_thumbnail(&id, &bytes)
}

// ── PSD pipeline ────────────────────────────────────────────────────────────

/// Stream psd-to-json's progress to the frontend terminal.
fn logger(app: &tauri::AppHandle) -> impl Fn(&str) + '_ {
    move |line: &str| {
        let _ = app.emit("psd-log-line", line.to_string());
    }
}

#[tauri::command]
fn import_image(
    app: tauri::AppHandle,
    id: String,
    source_path: String,
    name: Option<String>,
    marks: Option<AnchorMarks>,
) -> Result<ImportResult, String> {
    psd_pipeline::import_and_process(
        &id,
        &psd_write::source_path(&source_path),
        name.as_deref(),
        marks.as_ref(),
        logger(&app),
    )
}

/// Import from bytes the frontend already holds — a clipboard paste, a photo
/// picked on iPad, or a rasterised selection of drawn strokes.
#[tauri::command]
fn import_image_bytes(
    app: tauri::AppHandle,
    id: String,
    name: String,
    data_base64: String,
    marks: Option<AnchorMarks>,
) -> Result<ImportResult, String> {
    use base64::Engine;
    let payload = data_base64
        .split_once(",")
        .map(|(_, rest)| rest)
        .unwrap_or(&data_base64);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| format!("Bad image data: {e}"))?;

    let key = psd_write::sanitise_stem(&name);
    let psd_bytes = psd_write::psd_from_image_bytes_marked(&key, &bytes, marks.as_ref())?;
    let dest = store::psd_dir(&id)?.join(format!("{key}.psd"));
    std::fs::write(&dest, psd_bytes).map_err(|e| e.to_string())?;

    let manifest = psd_pipeline::process(&id, &key, &ProcessOptions::default(), logger(&app))?;
    // Measured from the PSD that was written rather than by decoding the
    // input again: the input may already *be* a PSD, which the image decoder
    // cannot read — and the file on disk is the thing being described.
    let (width, height) = psd_pipeline::psd_dimensions(&dest)?;
    Ok(ImportResult {
        key,
        width,
        height,
        manifest,
    })
}

/// Build a PSD directly from an RGBA buffer — the path drawn strokes take.
#[tauri::command]
fn create_psd_from_rgba(
    app: tauri::AppHandle,
    id: String,
    name: String,
    width: u32,
    height: u32,
    rgba_base64: String,
    marks: Option<AnchorMarks>,
) -> Result<ImportResult, String> {
    use base64::Engine;
    let rgba = base64::engine::general_purpose::STANDARD
        .decode(&rgba_base64)
        .map_err(|e| format!("Bad pixel data: {e}"))?;

    let key = psd_write::sanitise_stem(&name);
    let psd_bytes = psd_write::psd_from_rgba_marked(&key, width, height, rgba, marks.as_ref())?;
    let dest = store::psd_dir(&id)?.join(format!("{key}.psd"));
    std::fs::write(&dest, psd_bytes).map_err(|e| e.to_string())?;

    // The file's own size rather than the buffer's, as every import path
    // already reports: `psd_marks::layout` grows the canvas to hold the grid
    // footprint beside the artwork, and a conversion's margin again around
    // both, so the raster handed in stopped describing the file the moment
    // marks existed.
    let (width, height) = psd_pipeline::psd_dimensions(&dest)?;
    let manifest = psd_pipeline::process(&id, &key, &ProcessOptions::default(), logger(&app))?;
    Ok(ImportResult {
        key,
        width,
        height,
        manifest,
    })
}

/// One raster layer of a generated group, as it crosses the bridge.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartPayload {
    name: String,
    rgba_base64: String,
}

fn decode_parts(parts: Vec<PartPayload>) -> Result<Vec<psd_write::Part>, String> {
    use base64::Engine;
    parts
        .into_iter()
        .map(|part| {
            base64::engine::general_purpose::STANDARD
                .decode(&part.rgba_base64)
                .map(|rgba| psd_write::Part {
                    name: part.name,
                    rgba,
                })
                .map_err(|e| format!("Bad pixel data: {e}"))
        })
        .collect()
}

/// A PSD whose artwork is a group of raster layers rather than one sprite.
///
/// What an extrusion writes: a silhouette, its shading and the lines between
/// its spaces, as three layers somebody can take apart. Parts arrive top-first,
/// as Photoshop's panel lists them.
#[tauri::command]
fn create_psd_group_from_rgba(
    app: tauri::AppHandle,
    id: String,
    name: String,
    width: u32,
    height: u32,
    parts: Vec<PartPayload>,
    marks: AnchorMarks,
) -> Result<ImportResult, String> {
    let key = psd_write::sanitise_stem(&name);
    let parts = decode_parts(parts)?;
    let psd_bytes = psd_write::psd_from_parts_marked(&key, width, height, &parts, &marks)?;
    let dest = store::psd_dir(&id)?.join(format!("{key}.psd"));
    std::fs::write(&dest, psd_bytes).map_err(|e| e.to_string())?;

    // The canvas, not the parts: an extrusion asks for a grid space of clear
    // room around what it draws, so the file is a margin bigger on every side.
    let (width, height) = psd_pipeline::psd_dimensions(&dest)?;
    let manifest = psd_pipeline::process(&id, &key, &ProcessOptions::default(), logger(&app))?;
    Ok(ImportResult {
        key,
        width,
        height,
        manifest,
    })
}

/// Rewrite the group this editor generated in a PSD it already wrote, keeping
/// every other layer in the file.
///
/// What `create_psd_group_from_rgba` cannot do. That one writes the file from
/// nothing, which is right for an import and wrong for a second Apply: a layer
/// painted over the greybox in Photoshop would not be preserved, it would
/// simply not be there any more. See `psd_write::rewrite_parts_marked`.
#[tauri::command]
fn rewrite_psd_group_from_rgba(
    app: tauri::AppHandle,
    id: String,
    key: String,
    width: u32,
    height: u32,
    parts: Vec<PartPayload>,
    marks: AnchorMarks,
) -> Result<ImportResult, String> {
    let parts = decode_parts(parts)?;
    let path = psd_pipeline::psd_path(&id, &key)?;
    let existing =
        std::fs::read(&path).map_err(|e| format!("Cannot read {key}.psd: {e}"))?;
    let rebuilt =
        psd_write::rewrite_parts_marked(&existing, &key, width, height, &parts, &marks)?;
    std::fs::write(&path, rebuilt).map_err(|e| format!("Cannot save {key}.psd: {e}"))?;

    // And here too: carrying a shape further out grows the canvas again.
    let (width, height) = psd_pipeline::psd_dimensions(&path)?;
    let manifest = psd_pipeline::process(&id, &key, &ProcessOptions::default(), logger(&app))?;
    Ok(ImportResult {
        key,
        width,
        height,
        manifest,
    })
}

#[tauri::command]
fn reprocess_psd(
    app: tauri::AppHandle,
    id: String,
    key: String,
    options: Option<ProcessOptions>,
) -> Result<String, String> {
    let options = options.unwrap_or_default();
    psd_pipeline::process(&id, &key, &options, logger(&app))
}

/// Copy a PSD to a key of its own and process it.
///
/// This is what breaks a reference. Two placements of the same key share one
/// file, so editing it edits both; giving one of them its own copy is what
/// lets it be changed alone. The bytes are copied rather than re-derived, so
/// the copy starts identical — anchor mark and all.
#[tauri::command]
fn duplicate_psd(app: tauri::AppHandle, id: String, key: String) -> Result<ImportResult, String> {
    psd_pipeline::duplicate_and_process(&id, &key, logger(&app))
}

/// Replace `<project>/psd/<key>.psd` with the file the user picked and run it
/// through psd-to-json again, keeping the key so existing placements survive.
#[tauri::command]
fn reimport_psd(
    app: tauri::AppHandle,
    id: String,
    key: String,
    source_path: String,
) -> Result<ImportResult, String> {
    psd_pipeline::reimport_and_process(
        &id,
        &key,
        &psd_write::source_path(&source_path),
        logger(&app),
    )
}

/// Rename `<key>.psd` to `<name>.psd` and run the pipeline over it again.
///
/// `name` is whatever the inspector's title field was left holding, so it is
/// put through the same sanitiser an import uses and the key that actually
/// resulted comes back — the caller repoints its placements at that, not at
/// what was typed.
#[tauri::command]
fn rename_psd(
    app: tauri::AppHandle,
    id: String,
    key: String,
    name: String,
) -> Result<ImportResult, String> {
    let to = psd_write::sanitise_stem(&name);
    psd_pipeline::rename_and_process(&id, &key, &to, logger(&app))
}

/// Hand a project's PSD to whatever the OS opens PSDs with — Photoshop or
/// Affinity on macOS, the document provider on iPadOS.
///
/// This runs through the plugin's Rust API rather than the frontend one so
/// the webview never needs a filesystem scope covering the whole store: the
/// only path it can ask for is one built from a project id and a PSD key it
/// already owns.
#[tauri::command]
fn open_psd(app: tauri::AppHandle, id: String, key: String) -> Result<(), String> {
    let path = psd_pipeline::psd_path(&id, &key)?;
    if !path.exists() {
        return Err(format!("No PSD named {key} in this project"));
    }
    app.opener()
        .open_path(path.display().to_string(), None::<&str>)
        .map_err(|e| format!("Cannot open {key}.psd: {e}"))
}

/// A project's PSD as base64, for the iPadOS share sheet — which shares a
/// `File` the webview holds rather than a path it can reach.
#[tauri::command]
fn read_psd_bytes(id: String, key: String) -> Result<String, String> {
    let path = psd_pipeline::psd_path(&id, &key)?;
    let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read {key}.psd: {e}"))?;
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

/// A PSD's real layer stack, for the inspector's layer editor.
#[tauri::command]
fn read_psd_layers(id: String, key: String) -> Result<psd_layers::PsdLayerList, String> {
    psd_layers::read(&id, &key)
}

/// Rewrite that stack in the order and under the names the user gave it,
/// then run the file back through psd-to-json. Returns the fresh manifest.
#[tauri::command]
fn write_psd_layers(
    app: tauri::AppHandle,
    id: String,
    key: String,
    layers: Vec<psd_layers::LayerEdit>,
) -> Result<String, String> {
    psd_layers::write(&id, &key, &layers, logger(&app))
}

/// Put an empty sprite layer on the top of a PSD's stack.
///
/// Returns the fresh manifest, as every write that touches the file does:
/// the layer arrives with a single transparent pixel in it, which is nothing
/// to draw but is a real row to rename, reorder or draw into.
#[tauri::command]
fn add_psd_layer(app: tauri::AppHandle, id: String, key: String) -> Result<String, String> {
    psd_layers::add(&id, &key, logger(&app))
}

/// Lay ink into one layer of a PSD — what pen mode applies.
///
/// `index` and `name` together name the row, and both are checked: a paint
/// against an index the file has since renumbered would put a drawing in the
/// wrong layer, and nothing about the result would say so.
#[tauri::command]
fn paint_psd_layer(
    app: tauri::AppHandle,
    id: String,
    key: String,
    index: usize,
    name: String,
    paint: psd_paint::Paint,
) -> Result<String, String> {
    psd_layers::paint(&id, &key, index, &name, paint, logger(&app))
}

#[tauri::command]
fn read_psd_manifest(id: String, key: String) -> Result<String, String> {
    psd_pipeline::read_manifest(&id, &key)
}

#[tauri::command]
fn is_psd_processed(id: String, key: String) -> bool {
    psd_pipeline::is_processed(&id, &key)
}

#[tauri::command]
fn list_psd_outputs(id: String, key: String) -> Result<Vec<OutputFile>, String> {
    psd_pipeline::list_output_files(&id, &key)
}

#[tauri::command]
fn psd_thumbnail(path: String, max_size: u32) -> Result<String, String> {
    psd_pipeline::thumbnail(&path, max_size)
}

#[tauri::command]
fn psd_preview(id: String, key: String) -> Result<String, String> {
    psd_write::preview_data_url(&psd_pipeline::psd_path(&id, &key)?)
}

/// Serve a processed asset back to the editor as a data URL. The editor runs
/// Phaser in the app's own webview, so it loads textures this way rather than
/// through a local HTTP server.
#[tauri::command]
fn read_asset_data_url(id: String, relative: String) -> Result<String, String> {
    let path = store::assets_dir(&id)?.join(store::safe_relative(&relative)?);
    let bytes = std::fs::read(&path).map_err(|e| format!("Cannot read {relative}: {e}"))?;
    let mime = match path.extension().and_then(|e| e.to_str()) {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("json") => "application/json",
        _ => "application/octet-stream",
    };
    use base64::Engine;
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    ))
}

// ── export & publish ────────────────────────────────────────────────────────

/// Zip the project and return it as base64 for the frontend to save or share.
/// **Export site**: a zip you can serve.
///
/// Written straight to the path the save dialog gave, like the project
/// export beside it — an archive carrying every processed asset has no
/// business crossing the IPC boundary as base64 first.
#[tauri::command]
fn publish_site(id: String, path: String) -> Result<(), String> {
    publish::write_zip(&id, &psd_write::source_path(&path))
}

/// **Export project**: the project itself, as a `.idlewild` file — source
/// PSDs included, so it can be opened somewhere else and carried on with.
#[tauri::command]
fn export_project(id: String, path: String) -> Result<(), String> {
    archive::export(&id, &psd_write::source_path(&path))
}

/// Read a `.idlewild` file back in, as a new project.
#[tauri::command]
fn import_project(path: String) -> Result<ProjectMeta, String> {
    archive::import(&psd_write::source_path(&path))
}

/// Write bytes the frontend produced to a path the user picked.
///
/// The path comes from a save dialog, which on iPadOS hands back a `file://`
/// URL rather than a path — the same thing that broke re-import, and the
/// reason `source_path` is applied here too.
#[tauri::command]
fn save_bytes(path: String, data_base64: String) -> Result<(), String> {
    use base64::Engine;
    let payload = data_base64
        .split_once(",")
        .map(|(_, rest)| rest)
        .unwrap_or(&data_base64);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| format!("Bad payload: {e}"))?;
    let dest = psd_write::source_path(&path);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&dest, bytes).map_err(|e| format!("Cannot write {}: {e}", dest.display()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                let _ = app.handle().plugin(tauri_plugin_deep_link::init());
            }
            // Block until the listener thread is up: the frontend asks for the
            // port during boot, and a port that is not yet accepting would
            // fail the first PSD load.
            let (port, ready) = file_server::start()
                .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            let _ = ready.recv();
            app.manage(ServerPort(port));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_server_port,
            platform,
            list_projects,
            create_project,
            set_project_options,
            rename_project,
            delete_project,
            duplicate_project,
            read_project_meta,
            read_document,
            write_document,
            read_thumbnail,
            write_thumbnail,
            game_files::list_game_files,
            game_files::read_game_file,
            game_files::read_game_template,
            game_files::write_game_file,
            game_files::create_game_file,
            game_files::create_game_dir,
            game_files::move_game_path,
            game_files::copy_game_path,
            game_files::delete_game_path,
            import_image,
            import_image_bytes,
            read_clipboard,
            read_dropped_file,
            create_psd_from_rgba,
            create_psd_group_from_rgba,
            rewrite_psd_group_from_rgba,
            reprocess_psd,
            reimport_psd,
            duplicate_psd,
            rename_psd,
            open_psd,
            read_psd_bytes,
            read_psd_layers,
            write_psd_layers,
            add_psd_layer,
            paint_psd_layer,
            read_psd_manifest,
            is_psd_processed,
            list_psd_outputs,
            psd_thumbnail,
            psd_preview,
            read_asset_data_url,
            publish_site,
            export_project,
            import_project,
            save_bytes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Idlewild");
}
