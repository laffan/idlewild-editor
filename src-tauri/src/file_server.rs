//! A local HTTP server over the project store, ported from Phaser Bench.
//!
//! psd-to-phaser builds its asset URLs by concatenating onto the base path it
//! is handed, and it lazy-loads sprites and tiles long after the initial load.
//! Tauri's asset protocol percent-encodes the whole path into one opaque
//! segment, so concatenation breaks; a plain HTTP origin keeps P2P working
//! unmodified. Requests are `/<project-id>/<path within the project>`.
//!
//! It also serves the project's `game/` tree *as an export*, which is what
//! play mode runs in a frame over the canvas. Two paths exist only in an
//! export's layout and are answered here rather than duplicated on every
//! project's disk: `game/js/lib/<runtime>` is Phaser and psd-to-phaser, both
//! vendored into this binary, and `game/assets/…` is the processed PSD output,
//! which sits *beside* `game/` in the store and *inside* it in a zip. With
//! those two shims the same `index.html` runs in both places, so what plays
//! and what publishes cannot drift.

use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::Arc;
use std::time::Duration;

/// The port the store is being served on, which is not fixed for the life of
/// the app — see `serve_forever`.
///
/// Shared rather than copied out once, so `get_server_port` answers with where
/// the server is *now*. A base URL the frontend built earlier is a string it
/// is holding; asking again is how a page opened after a rebuild gets the
/// right one.
#[derive(Clone)]
pub struct Port(Arc<AtomicU16>);

impl Port {
    pub fn get(&self) -> u16 {
        self.0.load(Ordering::Relaxed)
    }

    fn set(&self, port: u16) {
        self.0.store(port, Ordering::Relaxed);
    }
}

/// Where the asset server is answering, so the frontend can build P2P base
/// URLs. Asked for rather than handed out once, because the answer can
/// change — see `serve_forever`.
#[tauri::command]
pub fn get_server_port(port: tauri::State<'_, Port>) -> u16 {
    port.get()
}

/// How long to wait between attempts to get a listener back.
const REBIND_PAUSE: Duration = Duration::from_millis(250);

/// How many of those attempts hold out for the port we already had.
///
/// Ten seconds. Nothing else is likely to have taken a loopback port the
/// kernel handed us while the app was asleep, and keeping it is what makes a
/// rebuild invisible: every base URL the frontend is holding goes on working,
/// where a new port would need every one of them to be rebuilt. Past that,
/// any free port beats no server at all.
const HOLD_THE_PORT_FOR: u32 = 40;

/// Bind a loopback port and serve the store on it for the life of the app.
///
/// Port **0** rather than a port chosen in advance: the kernel hands back one
/// that is free at the moment it is bound, where picking first and binding
/// second leaves a gap for something else to take it — and asking a picker
/// meant that on a machine where a UDP bind is refused, the app could not
/// start at all over a TCP port that was perfectly free.
///
/// `notify` puts a line in the editor's console. It is only used when the
/// listener has had to be rebuilt, which is a thing worth saying out loud.
pub fn start(
    notify: impl Fn(&str) + Send + 'static,
) -> Result<(Port, Receiver<()>), String> {
    let server = bind(0).map_err(|e| format!("Cannot start the asset server: {e}"))?;
    let port = Port(Arc::new(AtomicU16::new(
        port_of(&server).ok_or("The asset server bound something that is not an IP port")?,
    )));

    let (ready_tx, ready_rx) = std::sync::mpsc::channel();
    let held = port.clone();
    std::thread::spawn(move || {
        let _ = ready_tx.send(());
        serve_forever(server, held, notify);
    });

    Ok((port, ready_rx))
}

/// Serve, and get a listener back whenever the one we have goes.
///
/// The editor reads the project store over HTTP and by no other route, so a
/// listener that has gone is a project where every image is an empty
/// selection box. It does go, on an iPad: the system closes an app's sockets
/// while it is suspended, and tiny_http answers a failed `accept` by pushing
/// the error into its queue and ending its accept thread — which ends
/// `incoming_requests` here. The app itself is untouched, so the pipeline goes
/// on writing `data.json` files nobody can fetch, the port the frontend was
/// told about goes on being reported, and every project opened afterwards is
/// dead too. Nothing short of relaunching brought it back.
///
/// So the loop below outlives any one listener. It asks for the same port
/// first, because a rebuild that keeps the port is a rebuild nothing else has
/// to know about.
fn serve_forever(
    first: tiny_http::Server,
    port: Port,
    notify: impl Fn(&str) + Send + 'static,
) {
    let mut listening = first;
    loop {
        for request in listening.incoming_requests() {
            let _ = respond(request);
        }
        let was = port.get();
        listening = reclaim(&port, HOLD_THE_PORT_FOR, &notify);
        let now = port.get();
        if now == was {
            notify("The asset server stopped listening and was restarted");
        } else {
            notify(&format!(
                "The asset server stopped listening and was restarted on port {now} \
                 — reopen the project to load its images",
            ));
        }
    }
}

/// A listener again: the port we had if it comes back, any free port if it
/// does not.
///
/// Never gives up. There is no useful editor without this, and the case it
/// exists for — an app coming back from being suspended — resolves the moment
/// the process is running again.
pub(crate) fn reclaim(port: &Port, hold: u32, notify: &dyn Fn(&str)) -> tiny_http::Server {
    let mut tries: u32 = 0;
    loop {
        let wanted = if tries < hold { port.get() } else { 0 };
        match bind(wanted) {
            Ok(server) => {
                if let Some(bound) = port_of(&server) {
                    port.set(bound);
                    return server;
                }
            }
            Err(e) if tries == hold => {
                notify(&format!("The asset server cannot bind a port — {e}"));
            }
            Err(_) => {}
        }
        tries = tries.saturating_add(1);
        std::thread::sleep(REBIND_PAUSE);
    }
}

fn bind(port: u16) -> Result<tiny_http::Server, Box<dyn std::error::Error + Send + Sync>> {
    tiny_http::Server::http(("127.0.0.1", port))
}

pub(crate) fn port_of(server: &tiny_http::Server) -> Option<u16> {
    Some(server.server_addr().to_ip()?.port())
}

/// The script `?idlewild=console` asks to have injected — see
/// `templates/play/console-bridge.js`.
const CONSOLE_BRIDGE: &str = include_str!("../templates/play/console-bridge.js");

/// The query that asks for the console bridge. Spelled out at the request
/// rather than assumed, so a published page and a played one differ by a URL
/// and nothing else.
const CONSOLE_QUERY: &str = "idlewild=console";

fn respond(request: tiny_http::Request) -> std::io::Result<()> {
    let url = request.url().to_string();
    let (raw, query) = url.split_once('?').unwrap_or((url.as_str(), ""));
    let decoded = percent_decode(raw.trim_start_matches('/'));

    // The root answers for itself, so the editor can tell "the asset server
    // is not there" apart from "that one file is not there". A page that
    // cannot reach this at all is a project whose every image is a selection
    // box with nothing in it, and that is worth naming as one line at boot
    // rather than leaving to be deduced from a load failure per PSD.
    if decoded.is_empty() {
        return request.respond(reply(200, "idlewild asset server", "text/plain"));
    }

    // A runtime a game loads lives in this binary, not in the project.
    if let Some(source) = vendored_runtime(&decoded) {
        return request.respond(reply(200, source, "text/javascript; charset=utf-8"));
    }

    let Some(path) = resolve(&store_path(&decoded)) else {
        return request.respond(reply(404, "Not found", "text/plain"));
    };

    let Ok(bytes) = std::fs::read(&path) else {
        return request.respond(reply(404, "Not found", "text/plain"));
    };

    let mime = mime_for(&path);
    let asked = query.split('&').any(|part| part == CONSOLE_QUERY);
    let bytes = if asked && mime.starts_with("text/html") {
        inject(&bytes, CONSOLE_BRIDGE)
    } else {
        bytes
    };

    let mut response = tiny_http::Response::from_data(bytes);
    for (name, value) in common_headers(mime) {
        response.add_header(header(name, value));
    }
    request.respond(response)
}

/// Rewrite an export-shaped request onto where the store actually keeps it.
///
/// Only one path needs it: a game asks for `assets/…` relative to its own
/// `index.html`, which inside `game/` resolves to `<id>/game/assets/…`, and
/// the processed output is at `<id>/assets/…`. A project that really does
/// have a file under `game/assets/` is not reachable through this, which is
/// the trade: that directory is the export's name for the pipeline's output.
fn store_path(decoded: &str) -> String {
    let Some((id, rest)) = decoded.split_once('/') else {
        return decoded.to_string();
    };
    match rest.strip_prefix("game/assets/") {
        Some(asset) => format!("{id}/assets/{asset}"),
        None => decoded.to_string(),
    }
}

/// The runtime behind `game/js/lib/<name>`, if that is what was asked for.
///
/// An export carries its own copy of both; a project in the store does not,
/// because they are 1.5 MB that would be identical in every project and are
/// already in this binary for the exporter to write.
///
/// Both layouts answer. The scaffold keeps them in `js/lib/` now, beside the
/// code that uses them, and a project made before that still asks for `lib/`
/// — its `game/` tree is its own copy, and nothing rewrites a page someone
/// may have edited. Only these two exact names, in either place.
fn vendored_runtime(decoded: &str) -> Option<&'static str> {
    let (_id, rest) = decoded.split_once('/')?;
    let name = rest.strip_prefix("game/").and_then(|rest| {
        rest.strip_prefix(crate::templates::RUNTIME_DIR)
            .or_else(|| rest.strip_prefix(crate::templates::LEGACY_RUNTIME_DIR))
    })?;
    match name {
        "phaser.min.js" => Some(crate::templates::PHASER),
        "psd-to-phaser.umd.js" => Some(crate::templates::P2P_UMD),
        _ => None,
    }
}

/// Put a script at the top of a page's `<head>`.
///
/// Before everything else on purpose: the bridge wraps `console` and listens
/// for uncaught errors, and a boot failure in the very first module is
/// exactly the thing it exists to report. A document with no `<head>` gets it
/// in front of whatever it does start with.
fn inject(page: &[u8], script: &str) -> Vec<u8> {
    let text = String::from_utf8_lossy(page).into_owned();
    let tag = format!("<script>\n{script}\n</script>");
    match text.find("<head>") {
        Some(at) => {
            let cut = at + "<head>".len();
            format!("{}{tag}{}", &text[..cut], &text[cut..]).into_bytes()
        }
        None => format!("{tag}{text}").into_bytes(),
    }
}

/// What every answer carries, whatever its status.
///
/// The CORS header is on the failures as well as the successes on purpose:
/// the page is served from another origin, and without it a `fetch` of a
/// missing file rejects as an opaque network error rather than reporting the
/// 404 — which is the difference between "the server said no" and "there is
/// no server", the two things a diagnosis has to tell apart.
fn common_headers(mime: &str) -> [(&'static str, &str); 3] {
    [
        ("Content-Type", mime),
        // Assets are rewritten in place on every re-import, so nothing may cache.
        ("Cache-Control", "no-store"),
        ("Access-Control-Allow-Origin", "*"),
    ]
}

/// Map a request path onto a file inside the project store, refusing anything
/// that tries to climb out of it.
fn resolve(request_path: &str) -> Option<PathBuf> {
    if request_path.is_empty() {
        return None;
    }
    let root = crate::store::projects_dir().ok()?;

    let mut candidate = root.clone();
    for part in Path::new(request_path).components() {
        match part {
            Component::Normal(segment) => candidate.push(segment),
            // `..`, absolute roots and prefixes are how a traversal starts.
            _ => return None,
        }
    }

    let resolved = candidate.canonicalize().ok()?;
    let root = root.canonicalize().ok()?;
    if !resolved.starts_with(&root) || !resolved.is_file() {
        return None;
    }
    Some(resolved)
}

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

fn header(name: &str, value: &str) -> tiny_http::Header {
    tiny_http::Header::from_bytes(name.as_bytes(), value.as_bytes())
        .expect("static header is well formed")
}

fn reply(
    status: u16,
    body: &str,
    mime: &str,
) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let mut response = tiny_http::Response::from_string(body).with_status_code(status);
    for (name, value) in common_headers(mime) {
        response.add_header(header(name, value));
    }
    response
}

/// Enough percent-decoding for the paths we generate — keys are sanitised to
/// alphanumerics, so spaces and non-ASCII only arrive from a manifest.
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(value) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(value);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
