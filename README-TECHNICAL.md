# Idlewild — Technical Documentation

Extension of [README.md](README.md).

---

## Hard rules

- **No source file may exceed 700 lines.** Carried over from phaser-bench and
  hush. `npm run check:lines` enforces it over `src/`, `src-tauri/src/` and
  `scripts/`.
- **Document objects are immutable once stored.** Every mutation replaces the
  object rather than writing through it. Hush's drawing engine diffs strokes
  by identity, so an in-place write would make its sync shim miss the change.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                       Tauri window                            │
│                                                               │
│  ┌─────────┐  ┌─────────────────────────────┐  ┌───────────┐  │
│  │ Layers  │  │      Phaser 4 canvas        │  │ Inspector │  │
│  │ panel   │  │   ┌─────────────────────┐   │  │           │  │
│  │         │  │   │  drawing layer      │   │  │           │  │
│  │         │  │   │  (2D canvases,      │   │  │           │  │
│  │         │  │   │   camera slaved)    │   │  │           │  │
│  │         │  │   └─────────────────────┘   │  │           │  │
│  └─────────┘  │   grid · fills · zones ·    │  └───────────┘  │
│               │   psd-to-phaser placements  │                 │
│               └─────────────────────────────┘                 │
│  ┌─────────────────────── console drawer ──────────────────┐  │
└──┴─────────────────────────┬───────────────────────────────┴──┘
                             │ Tauri IPC (invoke) + events
┌────────────────────────────▼──────────────────────────────────┐
│                        Rust backend                            │
│  store.rs        per-project directories on disk               │
│  psd_write.rs    image / RGBA → PSD  (psd fork, write half)    │
│  psd_pipeline.rs PSD → game assets   (psd-to-json-rust)        │
│  templates.rs    isometric / orthogonal project scaffolds      │
│  publish.rs      zip export, both runtimes included            │
│  file_server.rs  tiny_http over the project store              │
└───────────────────────────────────────────────────────────────┘
```

### Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | Tauri 2 | iPad and macOS from one codebase, as in phaser-bench and hush |
| Frontend | TypeScript, no framework | Same vanilla module style as both sources; typecheck is the main local check |
| Engine | Phaser 4 + WebGL | psd-to-phaser `main` requires it — layer masks are built on Phaser 4's Filter system |
| Editor | CodeMirror 6 | Ported from phaser-bench |
| PSD read/write | `psd` (fork) | Read for parsing, write for turning images and sketches into PSDs |
| PSD → assets | `psd-to-json` (Rust) | In-process, no system binaries — the iPad constraint |
| Runtime | `psd-to-phaser` | The plugin everything is built around |

---

## Why the editor runs Phaser in-window

Phaser Bench runs its game in an iframe and forwards `console.*` over
`postMessage`, because the game there is the user's program and needs
isolation and hard reloads. Idlewild's canvas *is* the editor — selection,
hit-testing and the inspector all need direct object access — so Phaser runs
in the app's own webview and the console bridge collapses into a plain wrap of
`console` (`src/lib/log.ts`).

Play mode is a mode of the same scene, not a reboot: the spec says play mode
*adds a character to the game*, and treating it as a separate boot would throw
away the camera and the loaded PSDs for nothing.

## Why there is still an HTTP server

psd-to-phaser builds asset URLs by concatenating onto the base path it is
handed, and lazy-loads sprites and tiles long after the initial load. Tauri's
asset protocol percent-encodes a path into one opaque segment, so
concatenation breaks. `file_server.rs` serves the project store over
`127.0.0.1`, and P2P works unmodified against
`http://127.0.0.1:<port>/<project-id>/assets/<key>`.

Requests are resolved with `canonicalize()` and checked against the store
root, so a `..` cannot climb out.

---

## Data model

### On disk

```
<app data>/com.idlewild.editor/projects/<id>/
  meta.json        ProjectMeta — what the home screen lists
  doc.json         GameDoc — layers, fills, placements, zones, strokes
  thumbnail.png    written by the editor from the live canvas
  psd/             source PSDs, imported or converted
  assets/<key>/    psd-to-json output: data.json + sprites/tiles
  game/            the runnable project the code modal edits and Publish zips
```

Phaser Bench keeps every sketch and asset base64-encoded inside a single
`workspace.json`. That does not survive PSD-heavy projects, so each project
gets a directory and the document is written beside its assets.

### In memory

`src/lib/types.ts` is the shared shape; `src-tauri/src/project.rs` mirrors it.

- **Layers are top-first**, matching Hush. Phaser depth counts upward, so
  layer *N* of *M* renders at depth `(M − N) × 1000`. Isometric placements add
  their world Y so nearer objects draw in front.
- **Cells are integers**, never pixels. `src/lib/grid.ts` owns the projection:
  isometric tiles are 2:1 diamonds addressed by centre, orthogonal tiles are
  squares addressed by top-left corner. Everything downstream — selection,
  fills, A*, export bounds — is written once against `Grid`.
- **The grid is never stored.** It is recomputed from the camera over exactly
  the cells the viewport can see. There is no world bound to hit.

### Autosave

`DocStore` debounces writes 800 ms and flushes on navigation. Camera moves set
state without marking the document content-dirty, so a pan-only session does
not queue a save storm — the same distinction Hush draws between repaint-only
and content notify keys.

---

## Gesture routing

All pointer input over the canvas goes through one arbiter,
`src/game/camera-rig.ts`, which hands out high-level events. The spec's
contract:

| Input | Result |
|---|---|
| One finger down on the current selection | Drag it, snapped to the grid |
| One finger, moved | Pan |
| Two fingers | Zoom about the midpoint; the remaining finger keeps panning on release |
| Hold ~320 ms, still | Begin a grid selection |
| Tap | Pick the image under the finger, else the fill, else clear |
| Ctrl/⌘ + wheel | Zoom (WebKit reports a trackpad pinch this way) |

There is one arbiter because the drawing layer will want raw input for its own
tools: `setSuspended(true)` hands input over without tearing down camera
state.

Only the *current selection* is draggable. A pointer-down anywhere else still
pans, which keeps the camera reachable everywhere and makes a drag always
something the user picked first. A drag writes to the document on every
pointer move, so the scene brackets it with `onDragStateChange` and the panels
hold their re-renders — otherwise the inspector would rebuild its colour
picker, and the layer panel its name inputs, every frame.

---

## IPC surface

Registered in `src-tauri/src/lib.rs`, wrapped with types in `src/lib/ipc.ts`.

| Group | Commands |
|---|---|
| Projects | `list_projects`, `create_project`, `rename_project`, `delete_project`, `duplicate_project`, `read_project_meta` |
| Document | `read_document`, `write_document`, `read_thumbnail`, `write_thumbnail` |
| Game tree | `list_game_files`, `read_game_file`, `write_game_file` |
| PSD | `import_image`, `import_image_bytes`, `create_psd_from_rgba`, `reprocess_psd`, `read_psd_manifest`, `is_psd_processed`, `list_psd_outputs`, `psd_thumbnail`, `psd_preview`, `read_asset_data_url` |
| Publish | `publish_zip`, `save_bytes` |
| Server | `get_server_port` |

`psd-log-line` is emitted as an event during processing so the console drawer
can stream psd-to-json's layer tree as it appears.

---

## The PSD pipeline

Every image becomes a PSD before it becomes a game object.

```
Files / Photos / clipboard / drawn strokes
        │
        ├── bytes ──► psd_write::psd_from_image_bytes
        └── RGBA  ──► psd_write::psd_from_rgba
                            │  PsdBuilder + LayerBuilder, layer named "S | <key>"
                            ▼
                  <project>/psd/<key>.psd
                            │
                            ▼  psd_to_json::process_all_psds
                  <project>/assets/<key>/data.json + sprites/
                            │
                            ▼  P2P.load.load(scene, key, `${base}/assets/${key}`)
                     placed by P2P.place(scene, key, layerPath)
```

The `S | ` prefix is load-bearing: psd-to-json classifies by the pipe
convention and silently ignores layers without it, so a converted image
without the prefix would process to nothing.

`P2P.load` is a module object, not a function — the call is `P2P.load.load(…)`.
The README on `psd-to-phaser` shows `P2P.load(…)`; the shipped typings
disagree, and the typings are what the vendored build actually exposes.

**There is no `root` path.** `place(scene, key, path)` resolves `path` by
walking the manifest's `layers` by name (`shared/findLayer.ts`), so it must be
given a real one. Asking for `"root"` finds nothing, logs *No layer found with
path: root*, and returns an empty group — a selection box with no image in it.
`src/lib/manifest.ts` reads the manifest and anchors one placement per
top-level layer, each keeping its offset inside the PSD canvas. Documents
written by earlier builds are repointed on open.

**It needs a global `Phaser`.** Its sources use the ambient namespace in
value positions — `instanceof Phaser.GameObjects.Group`, `Phaser.Math.Clamp`,
`Phaser.Geom.Polygon` — without importing it, so those survive into the build
as bare global references. Under a `<script src="phaser.min.js">` that is
fine, because Phaser assigns itself to `window`; that is how the exported
games and Phaser Bench run it. The editor imports Phaser as an ES module, so
nothing sets the global and every placement dies on `Can't find variable:
Phaser`. `game/boot.ts` publishes it before the plugin is constructed.

**Wait on `psdLoadComplete`, not the loader.** P2P loads `data.json` first and
only queues sprites once it has parsed it, so Phaser's loader can complete a
whole pass before a single image has been requested. The plugin emits
`psdLoadComplete` on the scene when its textures are actually in; that event
carries no key, so loads are run one at a time.

---

## Drawing layer

Hush's notebook has its own renderer, camera, hit-testing, stroke model and
layer stack, so it is superimposed rather than merged: a stack of 2D canvases
above Phaser's, camera slaved to Phaser's.

`src/drawing/` holds the seam:

- `stroke-store.ts` — the slim replacement for Hush's `DrawingState`. Strokes
  live on game-document layers, so they persist and appear in layer counts.
- `rasterise.ts` — strokes → RGBA → PSD, the bridge the spec asks for: sketch,
  select, hand to another layer as a PSD or a boundary.
- `types.ts` — stroke styles and bounds.

Coming across from Hush: `engine/` (stroke, render, geometry, atlas, erase,
selection, gestures, layers, brushes), `re-anchor`, `region-select`,
`sync-shim`, `stroke-paint`. Not coming across: shelf, pocket, splits, proof
pages, flowchart, markdown, text and image shapes, handwriting recognition.

---

## Testing

`cargo test --lib` covers the load-bearing path: RGBA → PSD → psd-to-json →
manifest → zip, plus the path-traversal guards and the project scaffold. It
runs against the real store and cleans up after itself, including on failure.

The frontend's check is `tsc --noEmit` plus `vite build`. There is no
headless harness for the Phaser scene yet; the canvas needs a device.

---

## Selection

Hit-testing reads the **document**, not the rendered Phaser objects
(`pickPlacement` in `game/doc-renderer.ts`). A placement whose texture failed
to load still has bounds, and has to stay selectable so it can be inspected or
removed — otherwise a broken import is also an unfixable one.

Order follows the draw order: layers are top-first and, within a layer, a
later placement draws over an earlier one, so the front-most candidate is the
earliest layer's final placement. Locked and hidden layers are inert to the
pointer, the same rule Hush applies to its own pick paths.

The same items are listed under each layer in the left panel
(`editor/layer-items.ts`), and selecting one there is equivalent to picking it
on the canvas — which is how you reach something off-screen, underneath
something else, or not rendering. Selecting on the canvas expands the owning
layer so the two views stay in step.

## Console

`lib/log.ts` wraps `console.*` and interprets format directives rather than
joining raw arguments. Phaser's boot banner is a `%c`-styled string with two
CSS arguments; joined naively it dumps a base64 `background-image` across the
drawer on every launch. `%c` runs become styled spans, and the style is
filtered down to colour and weight — a banner has no business setting padding
or loading images inside the log.

Output uses Fira Code (bundled, not fetched — the editor works offline) and
opts back into text selection, which the shell suppresses globally so a drag
on chrome never highlights it.

## Known gaps

- Pattern fills store their PSD key and render as a tint; the texture is not
  yet sampled into the fill.
- Two PSDs with a same-named layer collide in Phaser's texture cache: P2P
  keys textures on the layer name unless loaded via `loadMultiple`.
- Strokes are listed under a layer as a count rather than individually; they
  get their own selection model with the drawing engine port.
- The code modal edits and saves the project's real files but does not yet
  drive the canvas, and has none of phaser-bench's Phaser-aware completions.
- Placed images and fills drag with grid snapping, and images resize from the
  inspector's numeric fields; the on-canvas resize handles are drawn but not
  yet draggable.
- Play mode's character is a placeholder rectangle, not a sprite from the
  template.
- Neither the Tauri build nor the iPad target has been exercised in CI; both
  need a machine with the platform SDKs.
