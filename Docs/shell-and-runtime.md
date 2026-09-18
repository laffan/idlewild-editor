# The shell and the runtime

Where Phaser runs, why there are two answers to that, and the two boundaries
the app is built across: the Tauri IPC surface and a local HTTP server nothing
else could stand in for.

Part of [Idlewild's technical documentation](../README-TECHNICAL.md).

---

## Why the editor runs Phaser in-window, and the game does not

Idlewild's canvas *is* the editor — selection, hit-testing and the inspector
all need direct object access — so the editor's Phaser runs in the app's own
webview rather than behind a bridge.

The **game** is the other case, and it is Phaser Bench's: the program being
played is the user's, it wants isolation and a hard reload, and its console is
something to forward rather than something to share. So Play loads the
project's `game/` tree into a frame over the canvas, from the asset server, the
way a published export loads it — see [What Play runs](exported-game.md#what-play-runs).

Play used to be a mode of the editor's scene: a character added to the canvas,
driven by `game/play-controller.ts` and `game/play-platformer.ts`. That reading
of "play mode *adds a character to the game*" had two costs that took a while
to come due. The project's own scene file — what the code modal opens
— never ran at all, so a `console.log` saved into it went nowhere and there was
no way to tell whether any edit to it had worked. And the same game existed
twice, once in TypeScript for the editor and once in JavaScript for the export,
kept in step by hand. Both are gone with those files.

---

## One game at a time, and why that is load-bearing

`Phaser.Game.destroy` does not destroy anything. It sets `pendingDestroy` and
the work happens on the next step of the game loop — so a caller that returns
straight away has left a game running, and the next project opened overlaps
it.

That overlap is not cosmetic, because of what a plugin key is. `PluginCache`
is a module-level singleton shared by every game on the page, and
`PluginManager.install` refuses a key it already holds: it warns *Plugin key in
use* to the browser console and returns null, the new game never gets its
`PsdToPhaser`, and `addToScene` therefore never sets `scene.P2P`. Only the old
game's `runDestroy` calls `destroyCustomPlugins` and frees the key.

Leave a project and open another quickly enough and every import in the second
one fails with *psd-to-phaser is not registered on this scene* — a project in
which nothing can be imported, with nothing on screen to say why, and which
comes right if you make a third one. So `GameHandle.destroy` waits for the
`DESTROY` event before it resolves and `teardown` awaits it, which in practice
is one frame. The wait is bounded: a shell that cannot leave a project is
worse than one that leaves a frame early. And `bootGame` says so outright if
the plugin did not install after all, because thirty failed imports is a poor
way to learn it.

---

## Why there is still an HTTP server

psd-to-phaser builds asset URLs by concatenating onto the base path it is
handed, and lazy-loads sprites and tiles long after the initial load. Tauri's
asset protocol percent-encodes a path into one opaque segment, so
concatenation breaks. `file_server.rs` serves the project store over
`127.0.0.1`, and P2P works unmodified against
`http://127.0.0.1:<port>/<project-id>/assets/<key>`.

Requests are resolved with `canonicalize()` and checked against the store
root, so a `..` cannot climb out. The port is **bound**, not picked: the
listener asks for port 0 and reads back what the kernel gave it, where
choosing a free port and then binding it leaves a gap for something else to
take it first.

### The iPad needs to be told this is allowed

App Transport Security refuses plain HTTP from web content, and
`NSAllowsArbitraryLoadsInWebContent` is NO unless the Info.plist says
otherwise — it is the key that governs WKWebView's own traffic rather than
the app's. There is no ATS on macOS, so this is invisible there and fatal on
an iPad: every PSD imports, parses and writes its `data.json`, and then every
placement is an empty selection box because the one request that would have
fetched the manifest never left the webview. `scripts/patch-ios-plist.mjs`
adds the exception, scoped to web content rather than to the whole app, since
the only plain-HTTP traffic here is the webview reading loopback.

That script runs from `beforeBuildCommand`, so `tauri ios build` applies it
and `tauri ios dev` does not. Run it by hand once after `tauri ios init` if
you only ever run dev; the generated plist is kept between builds.

### Saying so when it does not work

A local server that cannot be reached is invisible in the worst way: the
import succeeds, the pipeline logs its progress, and the only sign is one
load failure per PSD that reads like a problem with the PSD. So two things
say otherwise.

The server answers its own root with a line naming itself, and the editor
asks it once at boot — `checkAssetServer` — which puts either *Asset server
ready at …* or the reason it is not in the console before anything is
imported. And when a manifest does fail to load, `psd-loader.ts` re-requests
the same URL with `fetch` and reports what came back: an HTTP status, a body
that is not JSON, or no answer at all. Phaser's `loaderror` cannot tell those
three apart, and they want three different fixes.

The CORS header is on every answer including the 404s, which is what makes
that second request able to report a status at all: without it a cross-origin
`fetch` of a missing file rejects as an opaque network error, which looks
exactly like a server that is not there.

### The listener outlives itself

On an iPad it *is* sometimes not there. iOS closes an app's sockets while it
is suspended, so the listener bound at launch is gone by the time somebody
comes back to what they were drawing. tiny_http answers the failed `accept`
by pushing the error into its queue and ending its accept thread, which ends
`incoming_requests`, which used to end the one thread serving the store —
for good.

Nothing else noticed. The app was fine, so the pipeline went on parsing PSDs
and writing `data.json` files that could not be fetched, `get_server_port`
went on reporting the port it had been given at boot, and every project
opened afterwards was dead too. From inside the editor it read as the editor
eating artwork: a rename, a re-import, a new layer, a pen stroke, a sketch
conversion — each one wrote correctly and then showed nothing, and the ink a
conversion consumed was gone with it. A session's console has the whole shape
of it: *Asset server ready at http://127.0.0.1:51477/…* at the top, and an
hour of app-switching later, *The asset server at http://127.0.0.1:51477/…
is not answering this page*, same port.

So `serve_forever` outlives any one listener: when `incoming_requests` ends,
it binds again and carries on. It asks for **the same port** for the first
ten seconds, because a rebuild that keeps the port is one nothing else has to
know about — every base URL the frontend is holding is a string with that
port in it. Only if the port has genuinely been taken does it accept another,
and then `Port` is the shared handle that makes `get_server_port` answer with
where the server is *now*, so the next project opened builds a base that
works. Either way the console says the listener was rebuilt.

The other half is refusing to pretend. `PsdPlacements.place` checks that the
plugin really has the file before it places anything from it: a parsed
manifest says the layers are placeable, not that the assets arrived, and a
conversion that consumes something to make the call — a sketch, which takes
the ink away — is counting on the difference.

---

## IPC surface

Registered in `src-tauri/src/lib.rs`, wrapped with types in `src/lib/ipc.ts`.

| Group | Commands |
|---|---|
| Projects | `list_projects`, `create_project`, `rename_project`, `delete_project`, `duplicate_project`, `read_project_meta` |
| Document | `read_document`, `write_document`, `read_thumbnail`, `write_thumbnail` |
| Game tree | `list_game_files`, `read_game_file`, `write_game_file`, `create_game_file`, `create_game_dir`, `move_game_path`, `copy_game_path`, `delete_game_path` |
| PSD | `import_image`, `import_image_bytes`, `create_psd_from_rgba`, `merge_psds`, `reprocess_psd`, `reimport_psd`, `duplicate_psd`, `rename_psd`, `open_psd`, `read_psd_bytes`, `read_psd_manifest`, `read_psd_layers`, `write_psd_layers`, `add_psd_layer`, `paint_psd_layer`, `is_psd_processed`, `list_psd_outputs`, `psd_thumbnail`, `psd_preview`, `read_asset_data_url` |
| Clipboard | `read_clipboard`, `copy_psd_to_clipboard` |
| Publish | `publish_zip`, `save_bytes` |
| Import Assets | `free_psd_key`, `import_psd_from_project` |
| Server | `get_server_port`, `platform` |

`import_image`, `import_image_bytes` and `create_psd_from_rgba` take an
optional `marks` describing the grid selection behind them, as an
anchor-relative polygon plus the divisions inside it.
The editor computes it because the editor owns the projection; Rust only ever
sees a polygon. See **The marks an import writes** below.

`psd-log-line` is emitted as an event during processing so the console drawer
can stream psd-to-json's layer tree as it appears.

`create_project` takes the genre as an optional string, and refuses the one
pair that has no scaffold — isometric and platformer. Everything else about
both axes is a label carried into `meta.json`, `doc.json` and the scaffolded
`game.config.json`.

### Renaming a PSD

The key names three things at once: the file's stem, the directory
psd-to-json writes into, and what psd-to-phaser registers the file under. So
`rename_psd` is three moves rather than one — rename the file, drop the old
output directory, run the pipeline again under the new name. Renaming
`assets/<key>/` instead would be the cheaper-looking mistake: the manifest and
the sprites beneath it are written with the key in them, and moving the folder
leaves a directory whose contents disagree with its name.

**The layer inside follows the file, when it was named after it.** Every PSD
this editor makes — a converted image, a rasterised sketch, a generated one —
has a single sprite layer named for its key by construction, `S | hero`.
Renaming only the file left that layer holding the old name, which the layers
panel then showed in its grey detail column: the new name on the left and a
stale one on the right, for no reason a user could work out. So
`rename_layers_named_after` rewrites the second pipe segment of any layer
whose name matches the old key, and `renamePsd` repoints those placements'
`layerPath` with it.

Only a layer that was named after the file moves. A stack someone built in
Photoshop has names of their own choosing and nothing here has any business
touching them, and a file that cannot be rewritten at all — groups, masks,
clipping — is left exactly as it is, where the grey column showing a real
layer path is the honest answer. Renaming *those* is what the PSD layer list
right underneath is for.

On the frontend, `WorldScene.renamePsd` evicts the caches under the *old* key,
rewrites `psdKey` (and `layerPath`, where it matched) on every placement
holding it, then loads and places the new one.
