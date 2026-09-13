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
use crate::project::{GameOptions, Genre, Projection};
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
    let (port, ready) = file_server::start(|_| {}).expect("the server should bind");
    ready.recv().expect("the listener thread should start");
    let port = port.get();

    let meta = store::create_project(
        "Server",
        Projection::Orthogonal,
        Genre::Topdown,
        32,
        GameOptions::default(),
    )
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

/// The project's `game/` tree, served as an export.
///
/// Play mode loads this in a frame over the canvas, so the same `index.html`
/// has to run here and out of a zip. Two paths are the whole difference and
/// both are answered by the server: the runtimes, which live in this binary
/// rather than in every project, and `assets/`, which sits beside `game/` on
/// disk and inside it in an archive. If either stopped answering, Play would
/// be a blank frame and the reason would be one line in a console.
#[test]
fn the_game_tree_is_served_the_way_an_export_is_laid_out() {
    let (port, ready) = file_server::start(|_| {}).expect("the server should bind");
    ready.recv().expect("the listener thread should start");
    let port = port.get();

    let meta = store::create_project(
        "Played",
        Projection::Orthogonal,
        Genre::Topdown,
        32,
        GameOptions::default(),
    )
    .expect("project should be created");

    let result = std::panic::catch_unwind(|| {
        let id = &meta.id;

        // The page itself, and the module it pulls in.
        let page = get(port, &format!("/{id}/game/index.html"));
        assert_eq!(page.status, 200, "body was {:?}", page.body);
        assert!(page.body.contains("js/main.js"), "body was {:?}", page.body);
        // Untouched unless the request asks otherwise: what plays and what
        // publishes are the same file.
        assert!(!page.body.contains("idlewild-game-console"));

        let scene = get(port, &format!("/{id}/game/js/scenes/WorldScene.js"));
        assert_eq!(scene.status, 200);
        assert_eq!(
            scene.header("Content-Type"),
            Some("text/javascript; charset=utf-8")
        );

        // The console bridge, and only for a request that asks for it.
        let played = get(port, &format!("/{id}/game/index.html?idlewild=console"));
        assert_eq!(played.status, 200);
        assert!(
            played.body.contains("idlewild-game-console"),
            "the bridge should be injected",
        );
        assert!(
            played.body.find("idlewild-game-console") < played.body.find("js/main.js"),
            "the bridge has to be in place before the first module runs",
        );
        assert!(played.body.contains("js/main.js"), "the page itself survives");

        // The runtimes an export carries, answered from this binary — at the
        // path the scaffold uses now, and at the one projects made before the
        // tree moved still ask for.
        for dir in ["js/lib", "lib"] {
            for name in ["phaser.min.js", "psd-to-phaser.umd.js"] {
                let runtime = get(port, &format!("/{id}/game/{dir}/{name}"));
                assert_eq!(runtime.status, 200, "{dir}/{name} should be served");
                assert!(!runtime.body.is_empty(), "{dir}/{name} came back empty");
            }
            assert_eq!(
                get(port, &format!("/{id}/game/{dir}/anything-else.js")).status,
                404,
                "only the two vendored runtimes are answered",
            );
        }

        // Processed assets, which the game asks for relative to itself.
        let manifest = r#"{"name":"hut","width":8,"height":8,"layers":[]}"#;
        let assets = store::assets_dir(id).expect("assets dir").join("hut");
        std::fs::create_dir_all(&assets).expect("asset dir should be created");
        std::fs::write(assets.join("data.json"), manifest).expect("manifest should save");

        let found = get(port, &format!("/{id}/game/assets/hut/data.json"));
        assert_eq!(found.status, 200, "body was {:?}", found.body);
        assert_eq!(found.body, manifest);

        // The shims are not a way around the store's boundary.
        assert_eq!(
            get(port, &format!("/{id}/game/assets/../../meta.json")).status,
            404,
        );
    });

    store::delete_project(&meta.id).ok();
    if let Err(payload) = result {
        std::panic::resume_unwind(payload);
    }
}

/// A listener that has gone is not the end of the asset server.
///
/// The failure this pins, from a session on an iPad: the console said
/// `Asset server ready at http://127.0.0.1:51477/…` at boot and, an hour and
/// several app-suspends later, `The asset server at http://127.0.0.1:51477/…
/// is not answering this page` — same port, and every project opened after
/// that was dead too. iOS closes an app's sockets while it is suspended;
/// tiny_http answers the failed `accept` by ending its accept thread, which
/// ended the serving loop, and nothing ever bound a port again. The pipeline
/// went on writing `data.json` files that could not be fetched, so every
/// import, re-import and pen stroke looked like it had eaten the artwork.
///
/// `reclaim` is what outlives a listener now. Asking it for a port that is
/// free hands the same port back, which is what makes a rebuild invisible:
/// the base URLs the frontend is already holding go on working.
#[test]
fn the_asset_server_takes_its_own_port_back() {
    let (port, ready) = file_server::start(|_| {}).expect("the server should bind");
    ready.recv().expect("the listener thread should start");
    let was = port.get();

    // The port is in use by the server that just bound it, so a rebuild that
    // insisted on it would never come back. Hold out for nothing and it takes
    // a free one instead, and says so through the handle everything asks.
    let taken = file_server::reclaim(&port, 0, &|_| {});
    assert_ne!(port.get(), was, "an occupied port is not worth waiting for");
    assert_eq!(
        port.get(),
        file_server::port_of(&taken).expect("a bound port"),
        "the handle should name the port that was actually bound",
    );

    // And with the port free, holding out for it gets it back — the case that
    // matters, because every base URL already handed out names it.
    let free = port.get();
    drop(taken);
    let back = file_server::reclaim(&port, 40, &|_| {});
    assert_eq!(port.get(), free, "the port we had should be the port we get");
    drop(back);
}
