//! A local HTTP server over the project store, ported from Phaser Bench.
//!
//! psd-to-phaser builds its asset URLs by concatenating onto the base path it
//! is handed, and it lazy-loads sprites and tiles long after the initial load.
//! Tauri's asset protocol percent-encodes the whole path into one opaque
//! segment, so concatenation breaks; a plain HTTP origin keeps P2P working
//! unmodified. Requests are `/<project-id>/<path within the project>`.

use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::Receiver;

/// Bind a loopback port and serve the store on it until the process ends.
///
/// Port **0** rather than a port chosen in advance: the kernel hands back one
/// that is free at the moment it is bound, where picking first and binding
/// second leaves a gap for something else to take it — and asking a picker
/// meant that on a machine where a UDP bind is refused, the app could not
/// start at all over a TCP port that was perfectly free.
pub fn start() -> Result<(u16, Receiver<()>), String> {
    let server = tiny_http::Server::http(("127.0.0.1", 0))
        .map_err(|e| format!("Cannot start the asset server: {e}"))?;
    let port = server
        .server_addr()
        .to_ip()
        .ok_or("The asset server bound something that is not an IP port")?
        .port();

    let (ready_tx, ready_rx) = std::sync::mpsc::channel();

    std::thread::spawn(move || {
        let _ = ready_tx.send(());
        for request in server.incoming_requests() {
            let _ = respond(request);
        }
    });

    Ok((port, ready_rx))
}

fn respond(request: tiny_http::Request) -> std::io::Result<()> {
    let raw = request.url().split('?').next().unwrap_or("").to_string();
    let decoded = percent_decode(raw.trim_start_matches('/'));

    // The root answers for itself, so the editor can tell "the asset server
    // is not there" apart from "that one file is not there". A page that
    // cannot reach this at all is a project whose every image is a selection
    // box with nothing in it, and that is worth naming as one line at boot
    // rather than leaving to be deduced from a load failure per PSD.
    if decoded.is_empty() {
        return request.respond(reply(200, "idlewild asset server", "text/plain"));
    }

    let Some(path) = resolve(&decoded) else {
        return request.respond(reply(404, "Not found", "text/plain"));
    };

    let Ok(bytes) = std::fs::read(&path) else {
        return request.respond(reply(404, "Not found", "text/plain"));
    };

    let mime = mime_for(&path);
    let mut response = tiny_http::Response::from_data(bytes);
    for (name, value) in common_headers(mime) {
        response.add_header(header(name, value));
    }
    request.respond(response)
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
