//! Pixels over the bridge as bytes, not as base64 inside JSON.
//!
//! Every conversion in this editor hands Rust a raster: a sketch, a fill, a
//! line of text, an extrusion's parts, ink for PSD Edit mode, a pasted file.
//! These commands used to take it as a base64 string in a JSON argument, and
//! on a print project that stopped being a detail. A 300 DPI sketch over most
//! of a letter page is 27 MB of RGBA; encoding it took **943 ms** in V8 on a
//! desktop, and serialising the 36 MB string into the JSON body another 193,
//! all on the thread that draws the editor — then Rust parsed the JSON and
//! decoded the base64 again. At 600 DPI the encode alone was 3.6 s.
//!
//! Tauri 2 takes an `ArrayBuffer` as a raw request body instead, and on every
//! platform this editor ships to — macOS and iPadOS — that body arrives here
//! as the bytes that were sent. So each of these commands takes one packed
//! body (`lib/ipc-bytes.ts` builds it):
//!
//! ```text
//! u32, little-endian   length of the JSON that follows
//! JSON                 the command's arguments, with every buffer replaced
//!                      by {"$bytes": n}, plus "$lengths": [len0, len1, …]
//! bytes                buffer 0, then buffer 1, … back to back
//! ```
//!
//! Copying the raster into that body is the only cost left on the frontend:
//! 17 ms for the same 27 MB. Android would deliver the body as JSON — Tauri
//! documents raw bodies as unsupported there — and is refused by name rather
//! than misread; this editor does not build for it.

use crate::project::ImportResult;
use crate::psd_pipeline::{self, ProcessOptions};
use crate::psd_write::{self, AnchorMarks};
use crate::{logger, store};
use serde::de::DeserializeOwned;
use serde::Deserialize;

/// The arguments of a packed body, and the buffers they point into.
pub struct Packed<T> {
    pub args: T,
    buffers: Vec<Option<Vec<u8>>>,
}

/// Where in the body one buffer is: `{"$bytes": n}` in the JSON.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Bytes {
    #[serde(rename = "$bytes")]
    index: usize,
}

impl<T> Packed<T> {
    /// Take a buffer out by its reference. Each one is handed out once, so a
    /// body cannot name the same pixels for two things and have both written.
    pub fn take(&mut self, bytes: Bytes) -> Result<Vec<u8>, String> {
        self.buffers
            .get_mut(bytes.index)
            .and_then(Option::take)
            .ok_or_else(|| format!("No buffer {} in this request", bytes.index))
    }
}

/// The arguments and buffers of a command's request.
pub fn unpack<T: DeserializeOwned>(request: &tauri::ipc::Request<'_>) -> Result<Packed<T>, String> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(body) => unpack_bytes(body),
        tauri::ipc::InvokeBody::Json(_) => Err(
            "This command takes its pixels as a raw body, which this platform did not send"
                .to_string(),
        ),
    }
}

#[derive(Deserialize)]
struct Lengths {
    #[serde(rename = "$lengths")]
    lengths: Vec<usize>,
}

/// The same, from the body itself. Separate so it can be tested without a
/// running app.
pub fn unpack_bytes<T: DeserializeOwned>(body: &[u8]) -> Result<Packed<T>, String> {
    let short = || "The request body is cut short".to_string();
    let head: [u8; 4] = body.get(..4).ok_or_else(short)?.try_into().unwrap();
    let json_end = 4usize
        .checked_add(u32::from_le_bytes(head) as usize)
        .ok_or_else(short)?;
    let json = body.get(4..json_end).ok_or_else(short)?;
    let lengths: Lengths =
        serde_json::from_slice(json).map_err(|e| format!("Bad request arguments: {e}"))?;
    let args: T =
        serde_json::from_slice(json).map_err(|e| format!("Bad request arguments: {e}"))?;

    let mut at = json_end;
    let mut buffers = Vec::with_capacity(lengths.lengths.len());
    for length in lengths.lengths {
        let end = at.checked_add(length).ok_or_else(short)?;
        buffers.push(Some(body.get(at..end).ok_or_else(short)?.to_vec()));
        at = end;
    }
    if at != body.len() {
        return Err("The request body has bytes nobody asked for".to_string());
    }
    Ok(Packed { args, buffers })
}

#[derive(Deserialize)]
struct ImageBytesArgs {
    id: String,
    name: String,
    data: Bytes,
    marks: Option<AnchorMarks>,
}

/// Import from bytes the frontend already holds — a clipboard paste, a photo
/// picked on iPad, a file dropped where the shell did not catch it.
#[tauri::command(async)]
pub fn import_image_bytes<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: tauri::ipc::Request<'_>,
) -> Result<ImportResult, String> {
    let mut packed = unpack::<ImageBytesArgs>(&request)?;
    let bytes = packed.take(packed.args.data)?;
    let ImageBytesArgs { id, name, marks, .. } = packed.args;

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

#[derive(Deserialize)]
struct RgbaArgs {
    id: String,
    name: String,
    width: u32,
    height: u32,
    rgba: Bytes,
    marks: Option<AnchorMarks>,
}

/// Build a PSD directly from an RGBA buffer — the path drawn strokes take.
#[tauri::command(async)]
pub fn create_psd_from_rgba<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: tauri::ipc::Request<'_>,
) -> Result<ImportResult, String> {
    let mut packed = unpack::<RgbaArgs>(&request)?;
    let rgba = packed.take(packed.args.rgba)?;
    let RgbaArgs {
        id,
        name,
        width,
        height,
        marks,
        ..
    } = packed.args;

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
#[derive(Deserialize)]
struct PartArgs {
    name: String,
    rgba: Bytes,
}

#[derive(Deserialize)]
struct PartsArgs {
    id: String,
    /// The name a new file is offered, or the key of the file being rewritten.
    #[serde(alias = "key")]
    name: String,
    width: u32,
    height: u32,
    parts: Vec<PartArgs>,
    marks: AnchorMarks,
}

fn parts(request: &tauri::ipc::Request<'_>) -> Result<(PartsArgs, Vec<psd_write::Part>), String> {
    let mut packed = unpack::<PartsArgs>(request)?;
    let refs: Vec<(String, Bytes)> = packed
        .args
        .parts
        .iter()
        .map(|part| (part.name.clone(), part.rgba))
        .collect();
    let mut parts = Vec::with_capacity(refs.len());
    for (name, rgba) in refs {
        parts.push(psd_write::Part {
            name,
            rgba: packed.take(rgba)?,
        });
    }
    Ok((packed.args, parts))
}

/// A PSD whose artwork is a group of raster layers rather than one sprite.
///
/// What an extrusion writes: a silhouette, its shading and the lines between
/// its spaces, as three layers somebody can take apart. Parts arrive top-first,
/// as Photoshop's panel lists them.
#[tauri::command(async)]
pub fn create_psd_group_from_rgba<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: tauri::ipc::Request<'_>,
) -> Result<ImportResult, String> {
    let (args, parts) = parts(&request)?;
    let id = args.id;
    let key = psd_write::sanitise_stem(&args.name);
    let psd_bytes =
        psd_write::psd_from_parts_marked(&key, args.width, args.height, &parts, &args.marks)?;
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
#[tauri::command(async)]
pub fn rewrite_psd_group_from_rgba<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: tauri::ipc::Request<'_>,
) -> Result<ImportResult, String> {
    let (args, parts) = parts(&request)?;
    psd_pipeline::rewrite_group_and_process(
        &args.id,
        &args.name,
        args.width,
        args.height,
        &parts,
        &args.marks,
        logger(&app),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What `lib/ipc-bytes.ts` writes, built by hand.
    fn body(json: &str, buffers: &[&[u8]]) -> Vec<u8> {
        let mut out = (json.len() as u32).to_le_bytes().to_vec();
        out.extend_from_slice(json.as_bytes());
        for buffer in buffers {
            out.extend_from_slice(buffer);
        }
        out
    }

    #[derive(Deserialize)]
    struct Two {
        label: String,
        first: Bytes,
        second: Option<Bytes>,
    }

    #[test]
    fn buffers_come_back_where_the_arguments_point() {
        let raw = body(
            r#"{"label":"ink","first":{"$bytes":1},"second":{"$bytes":0},"$lengths":[2,3]}"#,
            &[&[9, 8], &[1, 2, 3]],
        );
        let mut packed = unpack_bytes::<Two>(&raw).unwrap();
        assert_eq!(packed.args.label, "ink");
        assert_eq!(packed.take(packed.args.first).unwrap(), vec![1, 2, 3]);
        let second = packed.args.second.unwrap();
        assert_eq!(packed.take(second).unwrap(), vec![9, 8]);
        assert!(packed.take(second).is_err(), "a buffer is handed out once");
    }

    #[test]
    fn a_body_that_disagrees_with_its_lengths_is_refused() {
        let json = r#"{"label":"x","first":{"$bytes":0},"$lengths":[4]}"#;
        assert!(unpack_bytes::<Two>(&body(json, &[&[1, 2, 3]])).is_err());
        assert!(unpack_bytes::<Two>(&body(json, &[&[1, 2, 3, 4, 5]])).is_err());
        assert!(unpack_bytes::<Two>(&[1, 0]).is_err());
        assert!(unpack_bytes::<Two>(&body(json, &[&[1, 2, 3, 4]])).is_ok());
    }

    /// The whole trip, through Tauri's own dispatch: a packed body sent the
    /// way the webview sends it reaches the command, and a PSD comes out.
    #[test]
    fn a_raw_body_reaches_the_command() {
        use crate::project::{GameOptions, Projection, Scaffold};
        let meta = store::create_project(
            "Raw body",
            Projection::Blank,
            Scaffold::P2p,
            64,
            GameOptions::default(),
        )
        .expect("project should be created");
        let result = std::panic::catch_unwind(|| {
            let app = tauri::test::mock_builder()
                .invoke_handler(tauri::generate_handler![create_psd_from_rgba])
                .build(tauri::test::mock_context(tauri::test::noop_assets()))
                .expect("a mock app");
            let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
                .build()
                .expect("a mock webview");

            let rgba = crate::tests::swatch(8, 6, [200, 10, 20, 255]);
            let json = format!(
                r#"{{"id":"{}","name":"raw","width":8,"height":6,"rgba":{{"$bytes":0}},"$lengths":[{}]}}"#,
                meta.id,
                rgba.len()
            );
            let response = tauri::test::get_ipc_response(
                &webview,
                tauri::webview::InvokeRequest {
                    cmd: "create_psd_from_rgba".into(),
                    callback: tauri::ipc::CallbackFn(0),
                    error: tauri::ipc::CallbackFn(1),
                    url: "tauri://localhost".parse().unwrap(),
                    body: tauri::ipc::InvokeBody::Raw(body(&json, &[&rgba])),
                    headers: Default::default(),
                    invoke_key: tauri::test::INVOKE_KEY.to_string(),
                },
            )
            .expect("the command should succeed")
            .deserialize::<serde_json::Value>()
            .unwrap();
            assert_eq!(response["key"], "raw");
            assert_eq!((response["width"].as_u64(), response["height"].as_u64()), (Some(8), Some(6)));

            let written = std::fs::read(psd_pipeline::psd_path(&meta.id, "raw").unwrap()).unwrap();
            let doc = psd::Psd::from_bytes(&written).unwrap();
            assert_eq!(doc.layers()[0].rgba()[..4], [200, 10, 20, 255]);
        });
        let _ = store::delete_project(&meta.id);
        if let Err(panic) = result {
            std::panic::resume_unwind(panic);
        }
    }
}
