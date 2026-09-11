//! The asset server, over a real socket.
//!
//! psd-to-phaser reaches the project store over HTTP and nothing else — a
//! manifest that does not arrive is a placement with no image in it, and the
//! editor cannot tell that apart from a PSD with nothing placeable in it. So
//! the mapping from URL to file is worth pinning where it can be run: the
//! request goes over a loopback socket to the real listener, and what comes
//! back is parsed as an HTTP response rather than inspected as a `PathBuf`.
//!
//! Split from `tests.rs` for the 700-line rule; it shares the store the rest
//! of the suite creates projects in.

use crate::file_server;
use crate::project::{Genre, Projection};
use crate::store;
use std::io::{Read, Write};
use std::net::TcpStream;

/// One GET, as a status line, the headers, and the body.
struct Answer {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

impl Answer {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

/// A request written by hand, because the point is what the *server* does
/// with a path rather than what a client library would make of it.
fn get(port: u16, path: &str) -> Answer {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("server should accept");
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("request should send");

    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).expect("response should arrive");
    let text = String::from_utf8_lossy(&raw).into_owned();
    let (head, body) = text.split_once("\r\n\r\n").unwrap_or((text.as_str(), ""));

    let mut lines = head.lines();
    let status = lines
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse().ok())
        .unwrap_or(0);
    let headers = lines
        .filter_map(|line| line.split_once(": "))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();

    Answer {
        status,
        headers,
        body: body.to_string(),
    }
}

#[test]
fn the_asset_server_serves_a_project_and_nothing_above_it() {
    let (port, ready) = file_server::start().expect("the server should bind");
    ready.recv().expect("the listener thread should start");

    let meta = store::create_project("Server", Projection::Orthogonal, Genre::Topdown, 32)
        .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let manifest = r#"{"name":"hut","width":8,"height":8,"layers":[]}"#;
        let assets = store::assets_dir(&meta.id).expect("assets dir").join("hut");
        std::fs::create_dir_all(&assets).expect("asset dir should be created");
        std::fs::write(assets.join("data.json"), manifest).expect("manifest should save");

        // The request psd-to-phaser makes, byte for byte: `${base}/assets/
        // ${key}/data.json`, where the base carries the project id.
        let found = get(port, &format!("/{}/assets/hut/data.json", meta.id));
        assert_eq!(found.status, 200, "body was {:?}", found.body);
        assert_eq!(found.body, manifest);
        assert_eq!(
            found.header("Content-Type"),
            Some("application/json; charset=utf-8")
        );
        // The page is served from a different origin — a custom scheme on a
        // device, a dev server on a desktop — so every answer needs this or
        // the webview refuses to read it.
        assert_eq!(found.header("Access-Control-Allow-Origin"), Some("*"));
        // Assets are rewritten in place on every re-import.
        assert_eq!(found.header("Cache-Control"), Some("no-store"));

        // The root answers, so the editor can tell "the server is not there"
        // apart from "that one file is not there" without guessing.
        let root = get(port, "/");
        assert_eq!(root.status, 200);
        assert!(root.body.contains("idlewild"), "body was {:?}", root.body);
        assert_eq!(root.header("Access-Control-Allow-Origin"), Some("*"));

        // A file that is not there is a 404 the page can *read*: without the
        // header a fetch rejects as a network error and says nothing at all.
        let missing = get(port, &format!("/{}/assets/hut/nothing.json", meta.id));
        assert_eq!(missing.status, 404);
        assert_eq!(missing.header("Access-Control-Allow-Origin"), Some("*"));

        // And nothing climbs out of the store.
        for escape in [
            "/../../../etc/passwd".to_string(),
            format!("/{}/../../../etc/passwd", meta.id),
            format!("/{}/%2e%2e/%2e%2e/meta.json", meta.id),
        ] {
            let refused = get(port, &escape);
            assert_eq!(refused.status, 404, "{escape} should not resolve");
        }

        // A directory is not a file, however real the path is.
        let dir = get(port, &format!("/{}/assets", meta.id));
        assert_eq!(dir.status, 404);
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}
