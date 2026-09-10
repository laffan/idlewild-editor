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
│  ┌──────────────────────── header ─────────────────────────┐  │
│  └─────────────────────────────────────────────────────────┘  │
│  ┌─────────┐  ┌─────────────────────────────┐  ┌───────────┐  │
│  │ Layers  │  │      Phaser 4 canvas        │  │ Inspector │  │
│  │ panel   │  │   ┌─────────────────────┐   │  │           │  │
│  │         │  │   │  drawing stage      │   │  │           │  │
│  │         │  │   │  (baked ink, one    │   │  │           │  │
│  │         │  │   │   CSS transform)    │   │  │           │  │
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
│  templates.rs    per-genre scaffolds, per-projection grid      │
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
- **A project has two axes**, and they answer different questions.
  `projection` is the shape of the space; `genre` is the program that comes
  out of it. See the two sections below.

### The three templates, and why blank is not a fourth code path

Blank is the orthogonal mapping with a cell of **one world pixel**. That is
the whole implementation of "nothing snaps": a marquee dragged across it
covers exactly the pixels it was dragged across, an image dropped on it lands
where it was dropped, and every projection-aware call site above `Grid` keeps
working unchanged — a blank project is still addressed in integer cells, they
are simply one pixel wide. `Grid.snaps` is what anything that needs to *say*
so reads: the grid renderer draws nothing, the readouts count px rather than
spaces, and an import's footprint marks one space of its own size rather than
shipping six hundred one-pixel division lines into a PSD.

`size` survives as the project's nominal unit even where nothing rounds to
it — play mode's character is measured in it, and so is the lattice its
navigation walks. That is what the New Game sheet's grid scale still means on
a blank canvas, and what the line under the control says.

The one place the substitution does not work is a **fill**. A fill stores the
spaces it covers, and a 420 × 260 rectangle on a pixel lattice covers 109,200
of them — a document that means "this box", written as a hundred thousand
records. So `FillPatch` carries either `cells` *or* a `rect`, and
`fillShape()` in `lib/grid.ts` is the one function that turns both into the
outlines and bounds every consumer wants: the canvas, the selection overlay,
the PNG export, the conversion to a PSD, and the platformer's ground.

`cellCentre()` is the other thing a one-pixel cell made worth naming.
`cellToWorld` returns each shape's natural anchor — a diamond's centre, but a
square's *top-left corner* — and anything asking "is this cell inside that
shape" has to test a point that is unambiguously in the cell. A corner is
shared with three neighbours, so play mode's navigation was blocking a cell
either side of every wall until this existed.

### Two genres, one document

`genre` decides the scene a project scaffolds and the play mode the editor
runs, and nothing else. Both read the same document: a fill marked
not-walkable and a boundary marked blocking are what a top-down character
routes *around* and what a side-on character stands *on* — a floor plan or a
cross-section, the same geometry either way.

Isometric and platformer is the one pair not offered. Gravity has no
direction on a diamond grid seen from above, so the New Game sheet greys the
option out and `create_project` refuses it rather than scaffolding something
that cannot work.

Both fields are optional on disk (`#[serde(default)]` on the Rust side,
`genre?:` on the TypeScript one) so every project written before the choice
existed still loads, as top down — which is what it has always been.

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
| Tap | Pick the image under the finger, else the boundary, else the fill, else clear |
| Ctrl/⌘ + wheel | Zoom (WebKit reports a trackpad pinch this way) |

There is one arbiter at a time. A drawing tool calls `setSuspended(true)`,
which hands input over without tearing down camera state, and the drawing
layer runs its own two-finger pan and pinch back into `panScreen` / `zoomAt`
— so the two layers never both read the same gesture, and the camera works
identically under either.

Boundaries sit between images and fills for a reason. A boundary is a thing
someone made and a fill is the ground it was made over, so it comes first of
those two — but a boundary is usually drawn *around* the images inside it and
would otherwise swallow every tap meant for one of them. It is hit-tested
against its polygon rather than its bounding box (`pickZone`), because
selecting an L-shaped wall by the empty corner of its box is not selecting
the wall.

A selected boundary drags like a placed image: the cell delta is projected
back into world space with `cellToWorld`, which is linear and has no offset
term in either projection — which is what makes it usable on a *difference*
as well as on a position. The outline keeps its shape and whatever sub-cell
offset it had, and moves a whole space at a time.

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
| Game tree | `list_game_files`, `read_game_file`, `write_game_file`, `create_game_file`, `create_game_dir`, `move_game_path`, `copy_game_path`, `delete_game_path` |
| PSD | `import_image`, `import_image_bytes`, `create_psd_from_rgba`, `reprocess_psd`, `reimport_psd`, `duplicate_psd`, `rename_psd`, `open_psd`, `read_psd_bytes`, `read_psd_manifest`, `read_psd_layers`, `write_psd_layers`, `is_psd_processed`, `list_psd_outputs`, `psd_thumbnail`, `psd_preview`, `read_asset_data_url` |
| Publish | `publish_zip`, `save_bytes` |
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

The layer *inside* the file keeps whatever it was called, which is why a
rename does not disturb a single placement: a placement points at its layer by
name, and renaming the file is not a claim about what is in it. The inspector
therefore shows a `hero.psd` whose layer path is still `pasted-m2k9f1` until
someone renames that too — which is what the PSD layer list right underneath
is for, and it handles the manifest rename map properly. On the frontend,
`WorldScene.renamePsd` evicts the caches under the *old* key, rewrites
`psdKey` on every placement holding it, then loads and places the new one.

## Editing a PSD, and getting it back

A PSD lives inside the project's own store, so there was nothing for a
re-parse to find that was not already parsed. The round trip is two commands
instead.

`open_psd` goes out through the opener plugin's *Rust* API rather than the
frontend one, so the webview never needs a filesystem scope over the store —
the only path it can ask for is one built from a project id and a PSD key it
already holds.

The way *back* differs by platform, and `platform` is what decides. On
desktop the editor opens the file where it lies in the store and saves over
it, so the file on disk is already the edited one and `reprocess_psd` is the
whole of it — asking the user to go and find a file that never moved would
be busywork. On iPadOS an app cannot hand another app its document and get
the edits back, so the file goes out through the share sheet
(`navigator.share` with the bytes from `read_psd_bytes`, or a copy saved
through the document picker where the sheet refuses files) and has to be
picked to come home: `reimport_psd` writes it over
`<project>/psd/<key>.psd` — the stem is forced to the existing key, which is
what makes it an overwrite rather than a second import — and re-runs
psd-to-json, which clears the old `assets/<key>/` first.

**Which picker, and why it has to be said.** Re-import asks *where the file
came back from* — Files, the photo library, or the clipboard — rather than
guessing. Left to itself the dialog plugin picks between the Files browser and
the photo library by looking at the filters: a set that is nothing but image
and video types gets the photo library, and a PSD *is* an image type. Every
filter this app has is one, so "Import from Files" and "Re-import" both opened
Photos, which is not where a PSD is. `pickerMode: "document"` and
`pickerMode: "image"` are what make both reachable. The clipboard route needs
no new command: importing bytes under a key that already exists overwrites
that key's PSD and re-runs the pipeline, which is precisely a replacement —
and a clipboard image never carries layers to lose.

Three caches then hold the *old* PSD and all three have to go, or the reload
quietly shows the previous artwork: psd-to-phaser's parsed manifest, Phaser's
JSON cache entry for `data.json`, and every texture the plugin built. The
plugin exposes no `removeData`, so its entry is overwritten with nothing —
`loadPsd`'s `getData` check is what reads it back. `game/psd-loader.ts` holds
all of this. The asset server already answers `Cache-Control: no-store`, so
the browser is not the fourth cache.

### The texture keys, and why getting them wrong hangs the editor

**A texture is keyed on the layer's own name, not the PSD's.** The plugin's
sprite loader is `scene.load.image(layer.name, url)`, so a PSD keyed `tower`
holding `S | roof` produces a texture called `roof` and nothing called
`tower_roof`. This file used to sweep for `<psdKey>_*` on eviction, which
worked for exactly one reason: an image the editor converts names its only
layer after the key, so `roof === tower` and the sweep caught it by accident.

Add a second layer in Photoshop and it stops working, in a way that looks
nothing like a stale-cache bug. Phaser's loader **silently drops** a file
whose key already exists — `LoaderPlugin.addFile` consults `keyExists` and
simply does not queue it, with no event and no error. The plugin counts its
own assets in and waits for a `filecomplete` that will never fire, so its
total is never reached and `psdLoadComplete` is never emitted. The editor
then sat on `loadPsd`'s fifteen-second timeout and placed a PSD whose
textures had all been evicted and never replaced: every image on that file
disappeared.

So the names are read out of the plugin's own parsed data before it is
cleared, rather than derived from a convention, and three shapes are removed
per name — `name`, `name_mask`, and `name_tile_<col>_<row>`.

The same fact from the other end is why `evictPsd` takes the project's other
PSD keys. Two files with a same-named layer share one texture, which the
plugin can only fix by loading them through `loadMultiple`; until then, a
name another loaded PSD is still using is left alone. A stale texture on the
file being reloaded is a smaller lie than a blank one on a file nobody
touched — and `loadPsd` no longer hangs when it meets one, because the loader
going idle settles the wait as a second, weaker signal, and any sprite left
without a texture is named in the console.

Placements survive the swap: each keeps its position and its size *relative
to* what the manifest exported, so a deliberately shrunk image stays shrunk
against new artwork. A placement whose layer is gone from the new file is
removed — there is nothing left to draw, and a placement that can never
render is worse than an honest gap.

---

## Editing a PSD's layer stack without leaving

Two things about a PSD layer reach the game, and the inspector edits both:
order is draw order, and the name carries the pipe convention, so renaming
`S | tower` to `T | tower` is what turns a sprite into a tileset. Neither is
worth a round trip out to Photoshop and back.

`src-tauri/src/psd_layers.rs` reads the stack and rewrites it;
`src/editor/psd-layers.ts` is the list.

**A rename is a full rebuild.** The `psd` fork has no way to edit a layer
record in place — it writes a file by rebuilding it from RGBA — so a rewrite
preserves only what `LayerBuilder` can express: pixels, position, name,
opacity, visibility, blend mode. Groups, layer masks and clipping masks are
none of those, and a file using them would come back flattened, having
quietly lost work someone did in Photoshop. `read` reports such a file
`writable: false` with a sentence saying which layer and why, and the list
is shown read-only. Every PSD this editor generates is flat, which is the
case the feature is mostly for.

Three details in that rebuild are silent when wrong, and each cost a test:

- `layer.rgba()` returns the layer composited onto the **whole canvas**, not
  its own rect. `crop` reads a window out of it, and anything hanging off
  the canvas edge was never in the buffer to begin with.
- `layer_right()` and `layer_bottom()` are **inclusive** in this crate
  (`width() == right - left + 1`), so a 32×32 layer measured from them comes
  out 31×31. Sizes come from `width()`/`height()`, and every edge below
  those is exclusive.
- `is_clipping_mask()` is named for the wrong half. Its backing field is
  `clipping_base` and the parser sets it from `byte == 0`, which the PSD
  spec defines as *base* — meaning **not** clipped. A layer clipped to the
  one below therefore reports `false`, which is why the guard reads
  `if !layer.is_clipping_mask()`. Our own flat PSDs were being called
  unwritable until this was read properly.

`layers()` reads top-first and `add_layer` stacks bottom-up, so the edited
order goes back in reversed; the round trip is pinned by a test.

**Edits are held until Apply.** A write rebuilds the file and runs the whole
psd-to-json pipeline over it, which is far too much to hang off a keypress.
Reordering is the layer panel's drag, followed on `window` for the same
reason (see *Reordering layers*), and the Apply row appears only once
something has actually moved or been retyped.

**Renames travel with the manifest.** A placement points at its layer by the
name psd-to-json exported, which is the *second* pipe segment — `S | tower`
is exported as `tower`. Change that segment and the path moves under the
placement's feet, and `reconcilePlacements` would read a layer that had gone
and remove the placement, for a change of one character. So the editor hands
`reloadPsd` a map of the paths that moved, old to new, and reconciliation
resolves through it before looking the layer up. Retyping only the *prefix*
produces no entry, because the exported name did not change.

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

### A footprint is the spaces covered, not the range around them

An import into a marquee marks that marquee: the user dragged out a shape and
that shape is the footprint. A *conversion* — a sketch or a fill becoming a
PSD — is different, and the difference is invisible until the template is
isometric.

A box in world space is a diamond in cell space, so the axis-aligned cell
*range* enclosing an isometric box holds a great many spaces the box never
touches, and the range's own world bounds are far larger than the box that
produced it. `psd_marks::layout` grows the canvas to hold the footprint, so
marking the range put a 132 × 136 sketch into an 832 × 416 file — six times
the area, and a PSD whose canvas bears no relation to the size the inspector
reports for the placement.

`cellsUnderBox` answers the question that was actually being asked: which
spaces does this box overlap? It is a separating-axis test against each
candidate cell's outline, which for a diamond is four axes. `marksForCells`
then outlines the box around *those* spaces and draws each of them as
divisions, so an irregular set stays irregular and the canvas is only as big
as the ink and the spaces under it. The same helper serves both conversions;
only an import still marks a range, because for an import the range is the
truth.

### The marks an import writes

A converted image gets two more layers, which is `src-tauri/src/psd_marks.rs`:

```
S | <key>    the artwork, centred on the anchor
P | anchor   a red dot on the grid space it is anchored to
Z | grid     the outline of the grid selection it was dropped into
```

Neither mark reaches the game. psd-to-json exports pixels only for sprites
and tilesets — a point becomes the centre of its layer, a zone its bounds —
so both are visible to whoever opens the PSD to work on the artwork and
invisible in the running game. That is what makes them safe to draw *over*
it. `placeableLayers` drops both for the same reason from the other end:
placing a point yields an empty group nobody asked for.

The point is the useful half, because it is recorded in **canvas
coordinates**. `placedPosition` puts it on the grid space's world point and
steps out to each layer from there, so what stays fixed across a re-import is
the mark, not the canvas. An artist can grow the canvas, move the artwork
inside it, or redraw the file, and the artwork comes back lined up as long as
the dot stayed on the spot that should sit on that space. Moving the dot is
therefore the interface: put it at the artwork's bottom-left and the thing
stands on its tile instead of floating centred over it.

The zone is the orienting half, and it shows the spaces rather than only the
region: an outline alone says how much room the artwork has, while the
divisions say where each space in it begins, which is what you line a
multi-space sprite up against. Both are drawn from the polygon and segments
the editor sends rather than from a rectangle and a step, so an isometric
selection is the diamond it really is and its divisions run along the
diamond's own diagonals; the outline wins where the two meet. The canvas is
the union of the artwork and that footprint, so a tall sprite dropped on one
tile keeps its own size and simply has the tile marked underneath it. The
dot's diameter is even on purpose — psd-to-json reports a point as its
layer's centre, and an odd one lands half a pixel off.

`AnchorMarks.art` says where the artwork's top-left goes relative to the
anchor. An image import omits it and gets centred, because it has no opinion
about where on a grid space it belongs. Anything converted from what is
already *on* the grid does have one, and sends it, so the PSD lands back
exactly over what it replaced.

Both conversions send marks, for the same reason an import does: whoever
opens the file to paint over the block-out needs the grid under it. A fill
marks the spaces it actually covers rather than a box around them — a fill is
usually an irregular shape, and an outline enclosing spaces it never touched
would say something untrue. A sketch marks the spaces its ink sits over,
which `cellRangeForBox` reads off all four corners of the bounding box:
a world-space box is a diamond in cell space under an isometric template, and
its widest cell extents are not the two corners a rectangle would suggest.

A `.psd` imported as a `.psd` is left exactly as its author built it. Adding
marks would mean rewriting someone else's layer stack to say something it may
already say, and a re-import never re-marks for the same reason: the file
coming back is the one being worked in.

### Why an import lands at half size

Everything anyone draws on a retina machine comes out at 2×: a screenshot, a
Photoshop export at the default resolution, a photo. Placed at one world
pixel per image pixel, all of it arrives twice the size it was meant to be.
So `IMPORT_SCALE` is 0.5 (`editor/import-anchor.ts`) and `naturalWidth` keeps
the pixels the file really has, which is what the inspector's width and
height are measured against and what a re-import reconciles through. It is a
default, not a conversion — nothing about the file changes, and a genuinely
1× asset is two taps from full size.

The three *conversions* — a fill, a sketch, an image already on the grid —
have the opposite problem. They draw their own pixels, and at world scale
they would come out at 1× and sit in the same project at half the resolution
of everything imported beside them, which shows the moment anyone opens both
to paint over them. So they rasterise at `EXPORT_SCALE` (`1 / IMPORT_SCALE`)
and place at `IMPORT_SCALE`: the world geometry is exactly where it was, and
the file has twice the pixels.

The marks have to go up with them. They are anchor-relative *world* pixels,
and Rust lays the artwork out against them in the file's own pixel space, so
a conversion that drew at 2× and marked at 1× would get a grid footprint half
the size of the artwork standing on it. `scaleMarks` takes the outline, the
divisions and the art offset up together; `cols` and `rows` are counts of
spaces and stay as they are. `EXPORT_SCALE * IMPORT_SCALE === 1` is the whole
invariant, and there is a test that says so.

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

Hush's notebook has its own renderer, camera, hit-testing and stroke model,
and none of them are Phaser's — so it is superimposed rather than merged: a
stage of 2D canvases above Phaser's, its camera slaved to Phaser's. What
crosses between them is narrow: a viewport in, camera gestures and a stroke
selection out.

| From `hush/src/notebook/drawing/` | Here |
|---|---|
| `engine/stroke-geometry.js` | `geometry.ts` — streamline, stamp angle, the slice walk, the lasso's point-in-polygon |
| `engine/stroke-atlas.js` | `atlas.ts` — brush atlases and the tint cache, with Hush's own `brush-N.png` masks |
| `engine/stroke-render.js` | `render.ts` — the per-stamp loop |
| `engine/stroke.js`, `engine/selection.js` | `tools.ts` — draw, slice-erase and lasso sessions |
| `drawing-layer*.ts`, `re-anchor.ts` | `surface.ts`, `drawing-layer.ts` |
| `stroke-paint.ts` | `rasterise.ts` — strokes → RGBA → PSD |

Not coming across, because none of it is drawing: the shelf, the pocket,
splits, proof pages, flowcharts, markdown, text and image shapes, brush slots
and their flyouts, theme-tracking colour sentinels, the highlight bake target
and its second canvas pair, and ML Kit handwriting recognition. `DrawingState`
is replaced by `StrokeStore`, which keeps only what the engine needs and
writes through to the game document, so strokes persist with the project and
appear in the layer panel's counts. Hush's load-bearing invariant comes with
it: strokes are immutable once stored.

### Why the ink is baked, not repainted

The canvases are **not** viewport-sized and repainted as the camera moves.
WebKit rasterises Canvas2D on the CPU and uploads the dirty region of a
*visible* canvas at a fixed rate, so re-presenting a screenful of ink every
pan frame costs tens of milliseconds however cheap the drawing itself is —
the cost model behind half of Hush's engine deltas. Instead the ink is baked
once into a canvas covering rather more world than fits on screen, and a pan
or a zoom is one `transform` on the wrapper: a compositor operation that
touches no pixels.

The backing cannot cover an infinite canvas, so it follows the camera.
`Surface.sync` re-anchors when the viewport drifts within 7 % of an edge, or
when the zoom has moved more than 1.4× from the one the ink was baked at and
presenting it would visibly stretch. The pixel budget is fixed — viewport ×
1.6 × DPR, capped at 4096 a side — and the *world* size is what varies with
zoom, which is what keeps the ink at screen resolution however far in the
user has gone without the backing growing without bound when they go out.

Hush's blit-forward re-anchor (its delta #25) — slide the baked pixels by the
same delta and repaint only the newly exposed strips — is the next increment.
This one re-bakes what is visible.

### Fingers never draw

A pen or a mouse runs the active tool; touch pans and pinches, and is
forwarded to the game camera so the two layers move together. That is Hush's
iPad rule, and it is the whole reason the Pencil feels like a pencil there:
you can rest a hand, pan with it, and keep drawing without switching tools.
Pointer routing is all-or-nothing — a drawing tool suspends the camera rig
and the surface takes pointer events; select and pan leave both alone — so
there is exactly one arbiter at a time.

Pressure is read the way Hush reads it: a pen reporting a real value is
scaled up a little, because few people press through the digitiser's full
range, and anything reporting the 0.5 default is left there rather than made
to look like a light touch. `getCoalescedEvents` is drained on every move,
which is the difference between a curve and a polyline on a 120 Hz Pencil
against a 60 Hz frame.

### References

An option-drag copies the fill or placement under the pointer and drags the
copy, so the original stays put and the thing under the finger is the new one.

A copied *placement* keeps its `psdKey`. Both then read the same file, which
is what makes it a reference rather than a duplicate: the copy costs one
`place()` call and no disk at all, because the textures are already in. What
it costs instead is that editing the PSD edits both, so the inspector says so
above everything else — that is the consequence, not a detail.

`Remove Reference` copies the PSD to a key of its own (`<key>-copy`) and
repoints only the selected placement. Whichever of the two you were looking
at is the one that becomes independent; everything else still reading the
original is left alone, which is the point of doing it per placement rather
than per key.

### Managing the game tree

`code/file-tree.ts` owns the code modal's file column. Its five operations —
create, rename, duplicate, delete, move — all go through `store.rs`, which
refuses a path that would climb out of `game/`, refuses a destination that
already exists, and refuses to move a folder inside itself. The modal has no
undo, so silently overwriting is the one mistake it must never make.

Dragging is pointer events, like the layer panel's, and for the same reason:
`dragstart` never fires for touch. Unlike the layer panel it does *not*
rearrange the DOM as it goes — a tree has one legal drop per row (into that
folder, or into the folder holding that file) rather than a position in a
list, so the destination row is highlighted instead.

Rename, new file and delete ask through the app's own sheets rather than
`window.prompt` and `window.confirm`. Every other input in the app is a
sheet, and a WKWebView only shows a JS prompt if the host has wired up the
panel delegate — not something to discover on an iPad. The per-row menu is
hover-revealed on a pointer device and always visible under
`@media (hover: none)`, or it would be unreachable on the platform this is
mainly for.

### Two exits, and both consume the sketch

The spec asks for exactly two ways out of the drawing layer, and both are
actions on a lasso selection rather than tools of their own — which is why
there is no Boundary tool in the rail.

- **Convert to PSD** rasterises through the engine's own stamping (so the
  export carries the brush texture and the pressure taper), builds a PSD from
  the pixels, and places it anchored on the cell under the middle of the
  sketch, so the image lands where the ink was.
- **Convert to boundary** concatenates the selected strokes oldest-first,
  simplifies the path against the grid (Ramer–Douglas–Peucker at a twentieth
  of a tile), and stores it as a blocking zone — a psd-to-phaser zone with no
  PSD behind it, which is what play mode's navigation grid reads.

Both consume the strokes. The PSD and the zone are the same shape in a better
form, and leaving the ink behind means every sketch you convert is drawn
twice, in the same place, at the same size.

### One correction to the port

Hush's slice walk falls back to the *far* end of a segment when a
crossing lands exactly on a recorded sample (`enterT = 1` entering the
eraser disc, `exitT = 0` leaving it). Both are the wrong end: they keep one
sample of ink inside the disc. `geometry.ts` uses `0` and `1` respectively,
and `__tests__/geometry.test.ts` pins the cut to the disc's edge.

---

## Testing

`cargo test --lib` covers the load-bearing path: RGBA → PSD → psd-to-json →
manifest → zip, plus the path-traversal guards and the project scaffold. It
runs against the real store and cleans up after itself, including on failure.

`vitest` covers the pure halves — the grid projection, fill geometry,
picking, resize geometry, colour, the log's `%c` parsing, the manifest
reader, the platformer's body step, and the drawing layer's ported maths.
The last two earn their place: a slice that cuts in the wrong spot or a lasso
that misses is a tool that does not work, and a body that catches on the seam
between two floor tiles is a game that does not work. Neither shows up in a
typecheck, and the platformer's regression tests exist because both bugs were
real — a body resting flush on its floor re-overlapped it by a rounding error
on the next frame and was fired out of the side of the ground.

The frontend's check is `tsc --noEmit` plus `vite build`.

`npm run harness` serves the editor shell in a plain browser: `harness/` is
the app's own entry with the Tauri modules aliased to stubs, so the layout,
the panels and the sheets can be opened, driven and screenshotted without a
Mac or an iPad. It boots a fixture document with three layers, one placement
and one boundary, and reads `window.__platform`, `window.__pick` and
`window.__manifest` so the platform split and the re-import path can be
exercised from a script. Its query string picks the fixture's template and
style — `?template=blank&style=platformer&grid=32` — and `?safe=44` writes
stand-in values over the safe-area tokens, which is the only way to look at
the iPad's insets from a desktop browser. Drawing is drivable there too: CDP's
`Input.dispatchMouseEvent` takes a `pointerType: "pen"` and a `force`, which
is enough to lay a pressure-varying stroke, slice it, lasso it and read the
ink back off the canvas. What it cannot stand in for is the pipeline: there
is no asset server behind it, so placements log a load failure and draw
nothing. The Phaser scene itself still wants a device.

---

**`place()` returns a Group, and a Group is not a display container.** Its
children live on the scene's own display list, and `Group.destroy()` defaults
to `destroyChildren = false` — so destroying the group removed the record and
left the sprite on screen. `destroyPlaced()` passes `true` for a Group and
nothing for anything else, because `GameObject.destroy(fromScene)` reads its
first argument completely differently. The plugin's `attachMethods` grafts
`setPosition`, `setScale` and the rest onto the Group, forwarding them to its
children.

## Reordering layers

The grip in each layer row drags; the arrow keys do the same without a
pointer. Pointer events rather than HTML5 drag-and-drop, because the iPad is
a first-class target and `dragstart` never fires for touch.

The gesture is followed on `window`, not through `setPointerCapture` on the
grip. Capture is released the moment the capturing element leaves the
document, and the row is moved through the list as the finger passes each
neighbour — so the pointer-up that commits the drop landed on whatever was
under the finger instead, and the drop was never written. The list looked
right and the document did not change.

Each layer renders into one `.layer-group` holding its row and whatever is
expanded under it, so a reorder moves the layer and its contents as a unit.
Re-rendering is held for the length of the drag: the panel rebuilds on every
document change, and rebuilding under the drag would drop the element being
held.

The inspector's PSD layer list is the same gesture over a different list, and
the code modal's file column is the same again with one difference: a file
tree has one legal drop per row — into that folder, or beside it at that
folder's level — rather than a position in a list, so the row under the
pointer is highlighted instead of the dragged row being moved through the DOM.

A placed PSD listed under an expanded layer has a grip of its own, and
dragging it carries the image to whichever layer the finger lets go over. Same
gesture, different question: a layer takes a *position* in the list, an image
takes a *layer*, so one moves through the DOM as it goes and the other lights
up its destination. The grip is there for the same reason it is on a layer
row — the panel scrolls, and a row that took the pointer outright would take
the scroll with it. `movePlacement` changes which list the record lives in and
nothing else, because a layer is draw order and visibility, not position; the
placement lands at the end of the destination's list, drawing over what was
already there, which is what a drop onto a layer means everywhere else here.
Only placements are carried: a fill is a run of grid spaces and a boundary is
a polygon, both addressed in world coordinates no layer owns, so moving one
between layers is a change of draw order and the reorder above already covers
it.

## Selection

Hit-testing reads the **document**, not the rendered Phaser objects
(`pickPlacement` in `game/doc-renderer.ts`). A placement whose texture failed
to load still has bounds, and has to stay selectable so it can be inspected or
removed — otherwise a broken import is also an unfixable one.

Order follows the draw order: layers are top-first and, within a layer, a
later placement draws over an earlier one, so the front-most candidate is the
earliest layer's final placement. Locked and hidden layers are inert to the
pointer, the same rule Hush applies to its own pick paths.

Placed images resize from their corner handles. The geometry is in
`game/resize.ts`, kept pure so the awkward cases — dragging a corner past its
anchor, the aspect lock, the minimum size — are tested without a canvas. The
opposite corner stays fixed, and the aspect ratio is locked: a stretched
sprite is almost always a mistake, and the inspector's width and height fields
are there for the times it is not. Handles are drawn and hit-tested at a
constant *screen* size, so the world-space target divides by the camera zoom
and stays reachable however far out you are.

Resizing writes a displayed `width`/`height` against the `naturalWidth`/
`naturalHeight` the manifest exported, and their ratio becomes a `setScale`.
A sprite placed with `setOrigin(0, 0)` scales away from its top-left, which is
the corner the placement's x/y describes, so box and image agree.

The same items are listed under each layer in the left panel
(`editor/layer-items.ts`), and selecting one there is equivalent to picking it
on the canvas — which is how you reach something off-screen, underneath
something else, or not rendering. Selecting on the canvas expands the owning
layer so the two views stay in step.

A placed image's title in the inspector is its filename, and retyping the part
before `.psd` renames the file — see *Renaming a PSD*. The field is borderless
until it is focused, like the layer names in the left panel: the panel is a
column of facts and one of them happens to be editable, which a box drawn
round it all the time would overstate. The extension sits beside the field
rather than in it, because it is not part of the name and retyping it would
only be a way to get it wrong.

## The iPad's safe area

`viewport-fit=cover` hands the webview the whole screen, status bar and home
indicator included, so every piece of chrome that touches an edge has to inset
itself back out of them. `tokens.css` exposes the four `env(safe-area-inset-*)`
values as custom properties, which is what lets a rule do arithmetic on them
and gives a browser without them a zero to fall back to.

The chrome grows *into* the inset rather than being pushed off it: the editor
header stands `--bar-h` tall below the status bar and pads upward to cover it,
so its own colour runs to the top of the screen instead of leaving the light
body showing through. The console drawer does the same downward past the home
indicator, the home screen's bar does it at the top, and the code panel does it
only while it is floating — docked it is a row between two rows and insets
nothing.

## Pinning and unpinning the code panel

Docked, the panel is a row of the shell and its divider writes an inline
`height` on it. Floating, it is `position: absolute; inset: 0` — and an
absolutely positioned box given top, bottom *and* a height is over-constrained,
so the browser drops `bottom` and the panel hangs from the top of the shell at
whatever height it was docked at. Unpinning therefore has to take the docked
height off again, in `setPinned`, or it does not look unpinned: it looks like
the panel jumped to the top of the screen, which is exactly what it did.

The header carries New File and New Folder rather than the word "Code" and
the project name. Neither said anything the user did not already know a moment
after opening the modal from that project, and on an iPad the header is the
difference between two rows of chrome above the file column and one.

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
  keys textures on the layer name unless loaded via `loadMultiple`. Reloading
  one of them now leaves the shared texture alone rather than blanking the
  other, so the collision shows as the wrong artwork rather than none — but it
  is still a collision.
- Resizing a placement that holds a *group* of sprites scales each child
  about its own origin, so their relative offsets do not grow with it.
  Scaling a composition as a unit needs a Container, and `place()` returns a
  Group. Single-sprite placements — every converted image — are exact.
- Strokes are listed under a layer as one row rather than individually, and
  are the one thing that cannot be carried to another layer from the panel. A
  sketch is a few hundred strokes and each is a stroke of a pen, not an
  object; the row selects the lot, which is the granularity both conversions
  work at anyway.
- The project thumbnail is a snapshot of Phaser's canvas, so a layer that is
  only a sketch photographs blank.
- There is no undo. The drawing layer wants it most — Hush routes every
  engine mutation into a snapshot stack — and it is the next thing to build.
- Strokes do not reach a publish. They are scaffolding for the PSDs and
  boundaries they become, and play mode hides them for the same reason.
- The code modal edits and saves the project's real files but does not yet
  drive the canvas, and has none of phaser-bench's Phaser-aware completions.
  Unpinned it covers the whole shell; Pin docks it above the console.
- Re-import replaces a whole PSD. There is no diff against the previous
  parse, so a placement is matched to the new file only by its layer path.
- The anchor mark is written on import and read on every parse after, but
  there is no way to move it from inside the editor — that is Photoshop's
  job, which is the point, but it does mean a PSD imported from elsewhere
  anchors on its canvas centre until someone adds one.
- `IMPORT_SCALE` is a constant rather than a per-project setting. A 1× asset
  arrives at half size and has to be resized once.
- A stroke selection converted to a PSD is still centred on the cell under
  its middle rather than sending an `art` offset, so it can land up to half a
  space from where it was drawn. A fill conversion is exact.
- Play mode's character is a placeholder rectangle, not a sprite from the
  template, in both styles.
- A platformer takes a blocking boundary as its bounding box. Resolving
  against the polygon — sloped ground — is a different feature.
- Renaming a PSD moves the file, not the layer inside it, so a renamed file
  keeps the layer path it was imported under. That is what makes the rename
  safe for every placement on it; the inspector's PSD layer list is where the
  layer's own name is changed.
- A blank project's play mode navigates on a square lattice of the project's
  nominal unit rather than on what was actually drawn. A* over single pixels
  would neither finish nor mean anything, but a coarse lattice over free-form
  geometry is a compromise, not an answer.
- `game.config.json` is scaffolded with empty `layers` and `psdKeys` and is
  not yet rewritten from the live document on publish, so an exported project
  runs but starts empty. Both template scenes read the fields already.
- Neither the Tauri build nor the iPad target has been exercised in CI; both
  need a machine with the platform SDKs.
