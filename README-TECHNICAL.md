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
│  clipboard.rs    the system pasteboard, which WebKit hides     │
│  psd_pipeline.rs PSD → game assets   (psd-to-json-rust)        │
│  templates.rs    per-genre scaffolds, per-projection grid      │
│  publish.rs      zip export, both runtimes included            │
│  game_config.rs  the document, as the exported game reads it   │
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
| One finger, moved, under **Select** | Rubber-band a selection from where it went down |
| One finger, moved, under **Pan** | Pan |
| Space held | Borrow Pan until it is released |
| Two fingers | Zoom about the midpoint; the remaining finger keeps panning on release |
| Hold ~320 ms, still | Begin a grid selection where the finger is, with its action bar |
| Either of those, in extrude mode | Take hold of a face of the shape, or pull the one already held |
| ⌘ (or Ctrl) held, in extrude mode | Borrow X-ray, so the far side is what a click lands on |
| Tap | Pick the image under the finger, else the boundary, else the fill, else clear |
| Double-tap a placed PSD | Open it up into its own layers |
| Ctrl/⌘ + wheel | Zoom (WebKit reports a trackpad pinch this way) |

**The rail's tool decides what a drag means**, through `rig.setMode`. It used
to decide nothing: a drag always panned and only a hold started a selection,
which made Select and Pan the same tool with a delay between them and left no
way to rubber-band over several things at once. The mode takes effect on the
next pointer-down rather than immediately, so a pan never turns into a
marquee halfway across the canvas.

Under Pan — picked from the rail or borrowed with space — the canvas shows a
hand, closed while the drag is under way. A class on the canvas wrapper
rather than an inline style, so the drawing layer's own crosshair still wins
where it is up, and `canvas:active` for the closed hand rather than a pair of
pointer listeners: the canvas keeps its activation state even though every
pointer handler over it calls `preventDefault`.

Space borrows Pan for as long as it is held (`editor/shortcuts.ts`), which is
what makes a Select tool that no longer pans bearable — the camera is one
thumb away from wherever you are. The tool it interrupted is remembered
rather than re-read on release, because the rail shows Pan while the key is
down. An iPad has no space bar, which is why Pan is also a rail tool. A
window that loses focus mid-hold never sees the keyup, so `blur` releases it
too.

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

Only the *current selection* is draggable. A pointer-down anywhere else
starts whatever the tool says — a marquee, or a pan — which makes a drag of
something always something the user picked first. A drag writes to the
document on every pointer move, so the scene brackets it with
`onDragStateChange` and the panels hold their re-renders — otherwise the
inspector would rebuild its colour picker, and the layer panel its name
inputs, every frame.

### What a marquee catches

Select has two gestures, and they ask different questions — which is why
`game/marquee.ts` draws them differently and answers them differently.

**Press and hold asks for a patch of grid**, and a patch of grid is all it
ever answers with. Fill, Add Image and Generate PSD act on it, so it is
measured in spaces and drawn as the grid draws them: under an isometric
template, a diamond. It stays a `region` whatever is standing on the spaces it
covers — holding over a building to fill the ground under it is the ordinary
reason to hold, and handing back the building instead would make the gesture
unusable exactly where it is most wanted. The floating action bar appears over
it, every time.

**A drag asks what is in here.** The things it catches are images sitting at
world coordinates that owe the grid nothing, so a drag is a plain rectangle —
the one that was dragged, pixel for pixel, with no lattice to round to. What
it catches *is* the answer: a `placements` selection, which drags and deletes
as a group, or `none` if it caught nothing, which is what tapping empty space
means too. No action bar: putting a bar of things to make over it interrupts
a gesture that was about picking things up.

Both used to be the same gesture in two moods, both rounded to cells. On an
isometric project that meant dragging a box and watching a diamond appear
somewhere near it, reaching a long way past the corner you started from and
catching images you could see were outside it.

The dragged band is deliberately **not** a `Selection`. It is a gesture still
happening: it draws into graphics of its own, in world coordinates so a
camera that moves under it leaves it over the same ground, and nothing is
chosen until the finger comes up — which also means the inspector is no
longer rebuilt on every frame of a drag for a thing that is not selected yet.

`pickPlacementsIn` therefore hears from the drag alone, and takes the
rectangle's four corners. A placement counts when the rectangle *overlaps* it
rather than contains it — dragging a box that swallows everything whole is the
fiddly half of every marquee, and nothing here is small enough to catch by
accident. It still takes an outline rather than a box because it once served
the held diamond too, whose bounding box reaches a long way past what was
dragged: hit-testing that box let a marquee in one corner of the screen pick
up images in another, the same mistake, in a different place, as the one that
put a 132 × 136 sketch into an 832 × 416 PSD.

The catch is one layer's worth, chosen by the same front-most-wins rule a tap
follows, so a marquee over a stack picks the layer you would have hit by
tapping. One layer because that is what a drag can move together, and because
carrying placements between layers is the layer panel's job rather than
something a marquee should do by accident.

A `placements` selection has no resize handles. Scaling a PSD against its own
box keeps its layers in the arrangement they were built in (see *A placed PSD
is one thing*), and there is no such relationship between things that only
happen to be near each other — so sizes stay each image's own.

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
guessing. Getting "Files" to actually mean Files took two goes, so the rule is
written down here: **on iOS the filters decide, not `pickerMode`.** The plugin
shows the media picker when the mode asks for it *or* when the filters name no
non-media type and do name an image or video one — the two are `||`-ed, and
the plugin's own source comment says the media picker wins "regardless of
what's in the filters". Every filter this app would naturally pass (`psd`,
`png`, `jpg`) is an image type, so a filtered call opens Photos whatever the
mode says, and `pickerMode: "document"` cannot pull it back. Passing **no
filters at all** on mobile is what reaches `UIDocumentPicker`; desktop keeps
its filters, where they only narrow what is selectable. The clipboard route
needs no new command: importing bytes under a key that already exists
overwrites that key's PSD and re-runs the pipeline, which is precisely a
replacement — and a clipboard image never carries layers to lose.

**And what the picker hands back is not a path.** Opening the Files browser
only revealed the next problem: the iOS document picker resolves `NSURL`s, and
a `FilePath::Url` crosses the bridge as its absolute string, so every
re-import failed with *No such file or directory* on
`file:///private/var/…/tower.psd`. The URL form is percent-encoded too, so a
file anyone actually named arrives as `my%20sketch.psd`. `psd_write::
source_path` resolves both at the command boundary — `import_image`,
`reimport_psd` and `save_bytes`, which takes a path from the *save* dialog and
has the same problem. Decoding is confined to the URL branch: a `%` in a
filename on disk is a `%`.

Backing out is not failure. Swiping the share sheet away rejects
`navigator.share` with an `AbortError`, which was logged in red every time
somebody changed their mind; a cancelled pick already resolved to null, and
now a cancelled share does the same.

**Share the file, and nothing else.** `navigator.share({ files, title })`
looks harmless and is not: iOS counts the title as a second item, the sheet
says *Save 2 items*, and an app that opens one PSD declines a two-item share
— so Photoshop and Procreate were missing from a list whose entire purpose
was to reach them. The file goes alone, and its name is what names it in the
sheet.

**The clipboard has no image route on iOS.** `tauri-plugin-clipboard-manager`
reads the system pasteboard, which is the right answer on a Mac, but its
mobile half is text-only: `read_image` is a hard error and the iOS Swift
plugin implements `writeText`, `readText` and `clear`. So mobile goes straight
to the webview's clipboard and skips a call that can only fail — which also
stops *Clipboard plugin unavailable* being logged before every successful
paste. When both routes fail, the **webview's** error is the one reported: it
is the route that could have worked, and re-throwing the plugin's made every
failure on an iPad read "Unsupported on this platform", naming the wrong thing
and hiding what the clipboard actually held.

That matters because WebKit exposes only a safe subset of the pasteboard —
`text/plain`, `text/html`, `text/uri-list`, `image/png` and web custom formats
— so a PSD copied out of another app may simply not be there to read whatever
the pasteboard itself holds. When no readable image is found, the types that
*were* offered go into the message, because "the clipboard is empty" and "a
PSD this cannot see" need different answers from whoever reads the console.

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

And a layer that is *new* gets a placement of its own. Reconciliation used to
only revise the placements the document already held, so adding a layer in
Photoshop and re-parsing changed nothing anyone could see: the layer was
parsed, exported and listed in the console, and never drawn. The file said one
thing and the canvas another. A new layer is placed the way its siblings on
that key were — their document layer, their grid space, their scale, and its
own position through the PSD's anchor mark — because that is the only
placement that can be inferred honestly. With no sibling to infer from,
nothing is adopted.

The inspector's list of the file's own layers has to be told too. It is built
once and kept across the panel's re-renders, since it holds half-typed names
and a pending reorder, so a document change never reaches it — only the shell
knows the file itself has moved underneath. It also shows the PSD's canvas
size, which is the number Photoshop opens with and not the one the placement
reports: a converted sketch carries the grid it was drawn over beside the
artwork, so the canvas is the union of the two.

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

### Pasting is importing

A paste on the canvas takes the first image on the clipboard and runs it down
that same pipe, landing it in the middle of the view on the active layer.
There is no separate paste path and no paste-shaped document object: the bytes
become `<project>/psd/<key>.psd` like every other import, which is why a
pasted screenshot can be opened in Photoshop, re-parsed and reconciled with
everything else.

`editor/paste.ts` listens for the DOM's own `paste` event rather than calling
`navigator.clipboard.read()`. The event arrives carrying the data, so there is
no permission prompt and nothing to fall back on; reading the clipboard *cold*
is what the Add Image sheet does, because there no paste has happened. The
listener stands down whenever the caret is in a field — a layer name, a
numeric input, the code editor — where a paste means paste. It knows only
about the clipboard; what happens to the file is `editor/paste-actions.ts`,
beside the other verbs the editor has.

**A paste is marked like every other import.** The two orienting marks are the
whole reason a PSD is worth opening in Photoshop, and a paste with neither has
nothing to draw against — so the artwork's size is measured *before* the
import, because the marks travel with it. `createImageBitmap` is what measures
it, which also settles the other question for free: it decodes every raster
format a clipboard can carry and no PSD at all, so the null it returns is the
frontend reaching the same conclusion Rust reaches from the `8BPS` signature,
from the only evidence each side has. A pasted PSD is therefore unmarked and
untouched — as a `.psd` imported from Files is, and for the same reason:
adding our layers would mean rebuilding someone else's stack.

`planFor` works out where it lands. The artwork goes at half size, centred on
the space in the middle of the view, and the spaces that box covers become the
footprint — `footprintForBox`, so an isometric paste marks the diamonds it
actually sits on rather than the much larger range around them. `art` is sent
rather than left to Rust's default centring, because the anchor a footprint
hangs from is its *top-left* space and is only its middle by accident. The
whole thing then scales by `EXPORT_SCALE`, since marks are in the file's
pixels and the box is in world pixels.

**⌘V is not the only way in.** An iPad has no ⌘ — and would not deliver a
paste event over a canvas even with one — so the paste path would be
unreachable on the platform this editor is mostly for. *Paste Image* in the
header menu runs the same route, differing only in where the bytes come from:
a paste event carries its data, this has to go and ask. What comes back is
wrapped in a `File` so everything downstream is identical, marks included.
Who gets asked is the next section, and it is the whole of the iPad story.

The exception is a grid that does not snap. A blank project's spaces are
single world pixels, so asking which of them a screenshot covers enumerates
every pixel in it — a hundred thousand separating-axis tests for a footprint
nobody can read. There the box *is* the space: `marksForBox` marks it as one,
with nothing to divide, which is what a selection in a blank project already
is.

Two details of the clipboard itself are worth naming. A PSD arrives with
whatever type its platform invented for it (`image/vnd.adobe.photoshop` on
some, nothing at all on others), so a `.psd` name is accepted on its own
account alongside anything matching `image/*`. And a screenshot is
`image.png` on every platform, so an anonymous paste is named
`pasted-<base36>` rather than filling a project with `image`, `image-2`,
`image-3`.

Rust had to learn one thing for this: `psd_from_image_bytes_marked` now checks
the `8BPS` signature and passes a document that is *already* a PSD through
untouched (`psd_write::is_psd`). An import from a path decides that by the
extension, but bytes off a clipboard have no name to read, and handing a
perfectly good PSD to the image decoder only ever produced "failed to decode
image". `import_image_bytes` therefore measures the file it wrote rather than
decoding the input twice.

### The clipboard the webview cannot see

*Paste Image* reported **"The clipboard is empty"** on an iPad holding a PSD
copied out of Files. The clipboard was not empty. The page was never shown
what was on it.

WebKit hands a page only a *web-safe* subset of the pasteboard — plain text,
HTML, a URL list, PNG, and web custom formats — and suppresses everything
else, files included. A PSD is `com.adobe.photoshop-image`, which is on none
of those lists, so `navigator.clipboard.read()` came back with items carrying
no type this app could use, and the only honest thing the old code could say
about that was that it had found nothing.

The other half of the trap is why ⌘V looked like no way round it. WKWebView
on iPadOS delivers a `paste` event only when the caret is in an editable
element. The editor's canvas is never one — every pointer handler over it
calls `preventDefault`, so nothing in the scene is ever focused — so on an
iPad the paste event that *would* have carried the file never fires at all.
Both routes to the *data* are shut, and they are shut by design rather than by
a bug to work around.

The *keystroke* is a different matter, and it is what makes ⌘V work there
anyway. WebKit dispatches DOM key events to the page before it decides what a
key means, editable target or not — it unified those two code paths years ago
— so the keydown arrives even though the paste does not. That is enough,
because on an iPad the bytes were never going to come from the event: the
shell reads the pasteboard, and the keystroke only has to say when to ask.
`listenForPasteShortcut` is that, and `intake.ts` binds it **only** where
`isMobile` — on a Mac the paste event arrives carrying the file, which beats
going and asking for it, and binding both would import the same image twice.
Auto-repeat is ignored, because one press is one image.

So the shell is asked instead. `src-tauri/src/clipboard.rs` reads
`UIPasteboard` on iOS and `NSPasteboard` on macOS through `objc2`, where there
is no web-safe subset: it lists the types the pasteboard is really holding and
takes the bytes of the first one the pipeline can use. Three passes, in the
order that gets the best answer:

1. **A copied file** (`public.file-url`) — the only route that knows the
   artwork's real name, and on macOS the only route at all, since a file
   copied in Finder puts a URL on the pasteboard and no bytes.
2. **The types it knows by name**, PSD first: copying a PSD out of an editor
   usually leaves a flattened preview beside it, and taking the preview would
   silently discard the layer stack.
3. **Whatever is left, by signature** — `8BPS`, the PNG magic, `GIF89a` —
   because an app that invents its own `dyn.a…` type for a perfectly ordinary
   PNG is not a reason to refuse it.

The command is deliberately **not** `async`, which is what makes Tauri run it
on the main thread: `UIPasteboard` requires that and `NSPasteboard` prefers
it. Since iOS 16 a program reading the pasteboard raises a system prompt, so
a *declined* prompt now looks like an empty clipboard again — `describeEmpty`
tells the three cases apart and says which one happened, because "copy
something first", "save it and import it from Files" and "allow the paste when
asked" are three different next steps.

`editor/clipboard.ts` is the frontend half: shell first, webview second. The
fallback is not dead code — it is what the browser harness and any
non-Apple build use, and it is the same route as before, now second in line
rather than first. Both hand back a `File`, so nothing downstream can tell
which answered.

`tauri-plugin-clipboard-manager` went with this. It was the desktop route and
its iOS half implements text only, which is exactly the gap this closes; a
plugin nothing calls is worse than no plugin.

### Dropping is pasting with a pointer

A file dropped on the canvas takes the same route a paste takes — bytes to
Rust, a marked PSD written, psd-to-json over it, a placement anchored on a
grid space. The only thing a drop knows that a paste does not is *where*, and
that buys the two things `editor/drop.ts` is for: the image lands on the space
it was let go over rather than in the middle of the view, and a drop onto an
image that is already there is an offer to replace the file behind it.

**Two routes in, because the platforms differ.** On macOS the shell intercepts
the drag before the webview sees it, and Tauri reports it as an event carrying
OS paths; on iPadOS there is no such interception and the webview gets
ordinary HTML5 drag events carrying `File`s. Both are wired, which is the
arrangement phaser-bench arrived at, and exactly one of them fires per
platform. They meet at `Incoming`, which is a name, an optional OS path, and a
thunk for the bytes — a thunk because the confirmation names the file, and
reading a fifty-megabyte PSD to put its name in a sentence the user is about
to decline is work for nothing.

Positions from the shell are **physical** pixels and everything in the page is
in CSS pixels, so they are divided through by the device pixel ratio. (With
the web inspector attached, macOS reports them from somewhere else entirely.
That is a known Tauri limitation, not something to correct for.)

**What is under the pointer is drawn where the image is.** `game/drop-target.ts`
hit-tests the document with the same front-most rules a tap follows and
outlines the whole placed *unit* rather than the one layer under the pointer,
because that is what a replacement acts on. It has graphics of its own rather
than the selection overlay's: dragging over something does not select it, and
a highlight that moved the selection would leave the wrong thing chosen when
the drag was abandoned. The canvas frame says a drop will be taken at all.

**A replacement asks first, and then keeps the key.** Replacing rewrites
`<project>/psd/<key>.psd` and re-runs the pipeline, so every placement of that
PSD changes with it — including copies elsewhere in the project that reference
the same file. That is what makes the gesture worth having and what makes it
worth a question, so the sheet offers Replace, Add as new, and Cancel. A path
goes through the same `reimport_psd` a picked file does; bytes are written
under the existing key, which overwrites it for the same reason
`import_image_bytes` is already how the clipboard replaces a PSD.

Names still decide keys, so dropping `roof.png` into a project that already
has a `roof.psd` overwrites that file, as importing it from Files always has.
A drop onto empty grid is the same import by another gesture, and inherits
that.

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

## Publish, and what the exported game reads

An export is the project's `game/` tree, its processed `assets/`, the two
vendored runtimes, and one file the export writes rather than copies:
`game.config.json`.

That file is the document, in the shape `WorldScene.js` reads it. Everything
else in `game/` is the user's source — the code modal edits it, and an export
must not overwrite what someone typed — but the config is *generated*, and
shipping the empty one the scaffold wrote is what made an export run and start
empty. `src-tauri/src/game_config.rs` owns its shape and both writers go
through it: `empty()` at scaffold time, `from_document()` on the way out. The
zip skips `js/game.config.json` when copying the tree and writes the generated
one in its place, because two entries under one name in an archive is not
something to rely on a reader resolving.

The config is a *projection* of the document, not a second copy. Rust
deserialises only the fields the scenes read, every one of them optional, so a
document written before zones or rectangle fills or instances existed still
exports. What it carries:

| field | what the scene does with it |
| --- | --- |
| `psdKeys` | `P2P.load.load` in `preload()`, one per key |
| `layers[]` | in order, top-first; the index becomes the depth |
| `fills[]` | painted, and a non-walkable one is an obstacle or the ground |
| `placements[]` | `P2P.place`, positioned, scaled, given a depth |
| `zones[]` | a blocking one is ground in a platformer |
| `gridSpan` | how far the grid is drawn and the character may walk |

A placement carries the size it is *displayed* at beside the size the manifest
exported, and the scene divides them — the same `applyScale` the editor's own
renderer does. Sending the ratio ready-made would hide where it comes from in
a file whose whole job is to be read. Without it every import drew at twice
its size, since an import lands at `IMPORT_SCALE`.

`gridSpan` is measured from the content rather than fixed at 24: fills on a
snapping grid are addressed in cells already, and everything else — a
placement, a rectangle fill, a boundary's outline — is in world pixels and
divides by the grid size. It is clamped, because the scenes draw `(2n+1)²`
cell outlines and an unbounded span is a stall.

**A document that will not parse is not a reason to fail the export.** The zip
is still a runnable game, just an empty one, so a corrupt document falls back
to `empty()` rather than aborting with a half-written archive.

**The load is not racy, and the templates do not treat it as one.** P2P queues
its sprites from inside the handler that parses `data.json`, so it is fair to
wonder whether a scene that loads in `preload()` and places in `create()` can
find no textures. It cannot: Phaser's loader picks up files added during a
pass, and `create()` waits for the queue to drain — checked in a browser
against the real plugin, with the manifest artificially delayed. The editor
waits on `psdLoadComplete` because it loads at *runtime*, long after any
`preload()`, which is a different situation.

## Testing

`cargo test --lib` covers the load-bearing path: RGBA → PSD → psd-to-json →
manifest → zip, plus the path-traversal guards, the project scaffold, what an
export's config carries, the shapes a file picker hands back, and the order a
manifest lists a PSD's layers in — which the frontend mirrors and cannot check
for itself. The asset
server is tested over a real loopback socket — the request psd-to-phaser makes,
byte for byte, and what comes back parsed as an HTTP response rather than
inspected as a `PathBuf`, because the mapping from URL to file is the one
place where a wrong answer looks like a PSD with nothing in it. It runs
against the real store and cleans up after itself, including on failure.

The pasteboard is split so that most of it is testable anywhere: which type to
take, what extension it maps to, and what a buffer's own signature says it is
are plain functions with tests beside them, and only the two calls that
actually touch `UIPasteboard` and `NSPasteboard` are behind a `cfg`. Those two
compile on no other platform, so on Linux the module builds its "no pasteboard
here" arm instead and the frontend falls back to the webview — which is the
same code path a Windows build would take. `cargo check --target
aarch64-apple-darwin` and `--target aarch64-apple-ios` are what type-check the
Apple arms without a Mac; neither one links, and neither is a substitute for
running it on a device.

`vitest` covers the pure halves — the grid projection, fill geometry,
picking (a point's and both marquees'), what is drawn over what, resize
geometry, the unit arithmetic
behind a placed PSD, what the clipboard hands a paste and where that paste
lands, what a failed clipboard read says happened and which of a dragged
selection of files a drop takes, colour, the log's `%c` parsing, the manifest
reader, the platformer's body step, the docs panel's markdown rendering and
its two kinds of lookup, and the drawing layer's ported maths.
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

### The floating action bar

Fill, Add Image, Generate PSD and Extrude, over a region selection. All four
turn *this much space* into something, which is the test for belonging there —
Export failed it (it sends content out rather than making any) and moved to
the inspector's region panel, where the rest of what is true about a
selection already lives.

Extrude is the one that is not always there. It needs a lattice to stack on,
and a blank project's spaces are single world pixels, so the button is built
only where `Grid.snaps`.

**Generate PSD** is an empty PSD the size and shape of the selection: the
shortcut for filling it transparent and converting that fill, with neither
step visible. Transparent means there is nothing to rasterise, so unlike a
fill conversion it writes the buffer straight. The artwork is the selection's
bounding box — a PSD canvas is a rectangle whatever shape the spaces under it
are — and the marks say which spaces those were, so what comes out is a file
with the grid drawn on it, already the right size and already anchored where
it will sit. It is capped at roughly a 4K canvas: the selection is drawn at
`EXPORT_SCALE`, and a careless drag over a few hundred spaces asks for a
buffer measured in hundreds of megabytes.

The bar is centred over the selection and sits above it where there is room.
Two coordinate spaces meet in `update`, and getting them confused is what
made it hang off the selection's corner: the anchor is in *viewport*
coordinates, and the bar is absolutely positioned inside the canvas column,
which starts where the layers panel ends. The arithmetic is done in viewport
terms, because that is where the edges it must stay clear of are, and only
the last step subtracts the column's origin. Those edges are the column's,
not the window's — bounding it by the window let it slide under the layers
panel, where the column's own overflow clipped the first button off.

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

### A placed PSD is one thing, until you say otherwise

Placing a PSD makes one placement per placeable layer — that is what
psd-to-phaser hands back and what the inspector needs in order to talk about a
stack. But a file with three layers in it is still *one thing someone dropped
on the grid*, and dragging a roof off its tower is almost never what was
meant. So the placements one `placePsd` call produces share an `instance` id,
and the canvas works on the instance by default: selecting any member selects
the unit, the overlay draws the union of their boxes, and a drag moves every
member by the same cell step.

`game/instance.ts` is the whole of the model — `instanceOf`, `instanceMembers`,
`unionRect`, `scaleWithin` — and it is pure, so the arithmetic is tested
without a canvas. `instance` is optional on disk, because documents written
before it existed have none; `instanceOf` falls back to the placement's own
id, which makes such a placement a unit of one, and the scene migrates whole
documents on load so the fallback is a floor rather than the usual path.

**Resizing scales the members, it does not scale a group.** Each placement is
an independent rectangle in the document, so a member's offset inside the unit
has to scale with its size or the composition comes apart — that is
`scaleWithin`, applied against the union box captured at pointer-down. The
anchors move by the cells the *union's* middle moved, all by the same step:
re-anchoring each layer on its own new middle would let the members drift, and
it is the shared anchor that brings them back in the same arrangement after a
re-import.

**Double-tapping opens a unit up.** In that mode — `adjusting`, holding the
instance id — a drag moves the one layer under the finger, the overlay
outlines it with filled handles and draws its siblings faintly, and the
inspector says so and offers a way out. Selecting anything outside the unit
closes the mode, so it never outlives what it is about: `setSelection` clears
`adjusting` unless the new selection is a member of it. A double-tap has to
survive a *tap that was offered to the drag controller first*, which is why
`camera-rig.ts` tracks whether a drag ever moved and reports a drag that did
not as a tap.

Carrying a placement to another layer in the left panel takes it out of its
unit — `movePlacement` strips `instance` — because a unit is made together on
one layer and a member that has moved away is no longer part of what the rest
of them are.

### What is drawn over what

A PSD is a stack of layers and the order is the artwork: a roof over a tower
is not the same picture as a tower over a roof. psd-to-json reports that
order — the manifest lists layers top-first, as Photoshop's panel does, and
numbers each `initialDepth` counting up from the back — and psd-to-phaser
applies it to every object it creates.

The editor then overwrote all of them. `syncPlacements` gave every placement
on a document layer the same depth, so the stacking fell to the order Phaser
happened to be handed the objects in, which was the manifest's: top-first. The
result is that every multi-layer PSD was drawn **upside down**, background
over foreground. Under an isometric template it was worse than arbitrary:
depth was `layerDepth + placement.y`, which sorted a unit's own layers against
each other by screen Y, so a roof — which sits higher up the screen than the
tower under it — was pushed behind the building.

So depth is now assigned from an explicit order. `drawOrder` sorts one
document layer's placements back to front, and each takes the next depth up
from the layer's base:

- **Between placed PSDs**, an isometric scene still sorts on screen Y, so
  nearer things draw in front. A unit sorts on its *own* Y — the topmost of
  its members — rather than each layer separately, which for a single-layer
  PSD is the same number it used before. Flat projections leave units in the
  order they were placed.
- **Within one placed PSD**, the author's stack and nothing else.

The stack is recorded on each placement as `order`, because once a placement
is in the document nothing in it says which of two layers was above — and it
is not derivable from what is there. It comes off the manifest at import, is
re-read on every re-import, and that last part is the point: reordering a
PSD's layers in the inspector and pressing Apply rewrites the file, and the
whole visible effect of that edit is which layer is now on top.

`order` is optional on disk for the same reason `instance` is. A document
written before it existed has its placements in the order they were made,
which was the manifest's, so the scene's migration counts down from the first
member of each unit and the file comes back up the right way.

Since depth is now the position in an ordering rather than a world
coordinate, a placement's Y no longer leaks into the number. It used to: at
`DEPTH_STRIDE` of 1000, anything below y = 1000 on a lower document layer
drew over a higher one.

## Extrude mode

Pulling a prototype solid out of the grid, and applying it as a PSD. Entered
from the action bar over a held selection, which becomes the plate to pull.

### The model is voxels, and the two templates share it

A shape is a set of integer `(cx, cy, cz)` triples — the project's own grid
coordinates, plus a level counting up from the ground (`lib/extrude.ts`). It
is the same bargain `Grid` already makes: one integer space, and the
projection appears only where something is drawn.

That is what lets the two templates share every operation. Isometric has a
**level height** of half a tile's width, which is what makes one voxel read as
a cube on the usual 2:1 diamond; orthogonal has a level height of zero, so
every voxel stays at `cz = 0`, the vertical walls are degenerate and never
drawn, and a pull along a grid axis is exactly *fill the spaces that way*.
`axesFor` is the whole of the difference: six directions where there is
height, four where there is not.

A pull's direction is read off the drag rather than picked from a control.
Every axis is a direction on screen, and the finger is going whichever one the
drag projects furthest along. Under an isometric template those directions are
63° apart — down-right, straight down, down-left — which is far enough to tell
a pull sideways from a pull downward without asking anyone to be precise, and
the projection is divided by the camera zoom so a pull counts spaces rather
than pixels.

Three things can happen, and which one falls out of what is already there
rather than out of a mode to pick:

- **A plate becomes solid as it is pulled.** The first step lays the selected
  spaces themselves down, so one step up and one step down are the same
  single layer and every further step goes the way it was pulled.
- **A face pulled away from the solid adds** spaces ahead of it.
- **A face pulled into the solid takes them away**, which is what makes a face
  pushed back the way it came undo itself. Only when *every* space ahead of
  the face is occupied: a top face pulled sideways off the edge of a block is
  someone widening the block, not carving it.

### Why not three.js

The view is one fixed axonometric projection of axis-aligned boxes. Every face
is a quad whose corners are known exactly, hidden-surface removal is *is there
a neighbour on that side?*, and a painter's sort on `cx + cy + cz` is not an
approximation of the right answer, it is the right answer — step once along
the view ray and all three rise together, so a voxel in front of another
always sorts after it. Against that, a second renderer would mean a WebGL
context beside Phaser's, a camera slaved to Phaser's, and a readback path to
get the pixels into a PSD, for geometry that comes out of six integers.

Only three of a voxel's six sides ever face this camera — the top and the
walls towards `+cx` and `+cy` — and each is emitted only where there is no
neighbour against it, so an interior face costs nothing.

### Picking is the drawing read backwards

`shapeFaces` returns the surface sorted back to front, so walking it *front to
back* and taking the first polygon that contains the point answers "what is
under the finger" with exactly the geometry that was put on the screen. There
is no second ray to keep in step with the renderer, and the awkward case
solves itself: the top of a five-level block is drawn 160px above the ground
it stands on, and a click on it is about the column it belongs to rather than
about the ground the pointer happens to be over.

What comes back is a face — a voxel **and** which of its sides — because a
voxel alone only half-identifies what was clicked. The wall of a space and the
roof above it are different things to take hold of, and pulling one is not
pulling the other.

### A sweep runs in the plane of the face it started on

Which is what makes the mode worth staying in. A selection that was always a
patch of *ground* could only ever grow the top of a shape; a selection that is
a patch of one **face** can be a run of levels up a wall. So a tower goes up
ten, one of its `+cx` faces three levels from the bottom is taken hold of and
pulled ten spaces sideways, five of that arm's roof tiles are swept and stood
up again — each step selecting in a different plane.

`across` and `rebuild` in `lib/extrude.ts` are the whole of it: a voxel split
into the two coordinates that run across an axis and the one that runs along
it, and put back together. The sweep is a rectangle in `(u, v)`; `w` is
searched. One pair of functions serves all six directions rather than three
copies with the coordinates permuted.

At each spot in that rectangle the face on show belongs to the **outermost**
voxel along the axis — nothing lies beyond it, so its face on that side is by
definition the exposed one. Read down `+z` that is the top of each column;
read along `+cx` it is the face of whichever block sticks out furthest that
way, so a sweep down a tower with one space jutting out of it takes the jutting
block at that level and the tower face above and below. It is one pass over the
shape into a map rather than a search per position, because it runs on every
pointer move of a sweep.

A sweep only grows across faces of the same orientation, and the far corner is
the last one the pointer was actually over — so wandering onto the roof half
way up a wall holds the selection rather than reinterpreting it. A sweep that
began on bare grid has no face and no plane, so it falls back to a patch of
ground, which is what the mode was entered with in the first place.

### Backfaces, and the two toggles on the bar

Three of a voxel's six sides face away from this fixed camera: the walls
towards `-cx` and `-cy`, and the underside. They are never drawn in the
ordinary view and never exported — but they are real faces of the shape, and
there is no other way to pull the far wall of a box outward.

**Backfaces** puts them in the list and takes the near ones out of it.
`shapeFaces(grid, shape, true)` adds them at `depth − 0.5`, so one sort still
puts every face in painter's order: rear walls, front walls, then the top the
voxel sits under. The renderer then draws the rear side solid and the near
side at a quarter alpha over it, which is what makes the far side both visible
and worth clicking on — and picking is restricted to rear faces, because a
click that landed on the near side would defeat the toggle just reached for.
A flat projection has none of this: its spaces have no sides, so the button is
hidden rather than disabled.

**The held face is the other way in, and it has to be shut too.** A
pointer-down claims a pull without picking anything — it only asks whether the
point is on the face already held — so while that face is a near one it would
claim every drag that started over it. After a pull upward the held face is
the whole roof, which is most of the silhouette, and a back wall could then
only be swept from the sliver the roof did not cover. So a near face is not
pullable while X-ray is on: the drag falls through to a sweep, which picks a
rear face as it should. A rear face stays pullable throughout, which is what
makes ⌘ work as a momentary borrow — hold it, sweep the far wall, let go, and
pull what is now held.

The toggle is on the bar, and **⌘ (or Ctrl) borrows it while held**, the way
space borrows Pan. Watched on the window rather than the canvas, which never
takes focus — every pointer handler over it calls `preventDefault`, so nothing
in the scene is ever a key event's target — and `blur` releases it, since a
window that loses focus mid-hold never sees the keyup.

**Erase** turns the pointer into a rubber. It claims every pointer-down,
because what it acts on is wherever it is put rather than what happens to be
held, and it takes whatever a click would have taken hold of — so in X-ray
mode it reaches a space on the far side, which is the only way to reach one.
The tap the rig reports after a drag that never moved is deliberately ignored
there: rubbing out the space *behind* the one that has just gone is not what a
single tap meant. A plate that has not been pulled yet has no faces at all, so
there erasing trims the selection it is still made of.

### A hold still asks for spaces, even on the held face

A pointer that goes down on the held face starts a pull — but only
provisionally. It carries a hold timer of the same 320 ms the rig uses, and a
finger that has not moved by the time it fires turns the gesture into a
selection sweep instead. Without that, the top of a shape that had just been
pulled up was the one place a new selection could not be started, which is
exactly where the next one usually starts.

The mode therefore owns the pointer at every stage, and `world-scene.ts` asks
it first: `beginPull` before `drag.begin`, `beginSelect` before the marquee,
`tap` before the document is hit-tested.

### The dim, and where it sits

The scrim is a `Graphics` at `setScrollFactor(0)` filling a rectangle far
larger than any viewport, so a pan or a zoom needs no redraw at all. Depths
put it above everything the document renders and below the solid, its
highlight, and the marquee — the rubber band stays visible over the shape it
is being dragged across. It is drawn in the scene rather than as a CSS
overlay for the obvious reason: the canvas is one element, and a CSS scrim
would dim the shape along with everything else.

### Apply

The fourth bridge into the PSD pipeline, beside an image import, a lassoed
sketch and a fill — and written against the same helpers, so a block-out
pulled out of the grid arrives at the same resolution as everything beside it.
The pixels come from walking the same face list the canvas drew, in the same
order, with the same palette, because the point of Apply is to keep what the
user is looking at.

The footprint marks the spaces the solid **stands on**, not the ones its walls
reach across on screen: a tall block is anchored to the ground it was built
from, which is where it has to come back down. `shapeBounds` is taken from
every voxel rather than from the visible faces, because the underside of the
lowest layer is never drawn and a box that stopped at what is drawn would clip
it off the bottom of the file.

Nothing reaches the document until Apply. The shape lives in the mode object,
so Cancel is dropping it and entering play mode drops it too.

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

## The reference along the bottom of the code modal

Ported from phaser-bench, where it sits under the editor for the reason it
sits under this one: the question *what does this method take?* arrives while
you are typing the method, and an answer in another window is an answer you
go and look up rather than read. Docs opens a fourth region of the modal on a
divider of its own, remembered like the console's.

Four references behind one toggle, and the panel knows none of them apart —
`docs/types.ts` is the six questions it asks of whichever is selected, and
everything else is a `DocsSource`.

| Source | What it is | Where it comes from |
|---|---|---|
| Concepts | Phaser's prose guides, 48 pages | `public/data/phaser-concepts/` |
| API | Phaser's own JSDoc, keyed by expression | `public/data/phaser-docs.json` |
| JS / CSS / HTML | MDN's reference, ~2,800 pages | `public/data/web-docs/` + a generated index |
| P2P | psd-to-phaser's docs, 18 pages | `public/data/p2p-docs/` |

**Automatic follows the caret.** `code-modal.ts` reports every selection
change into `panel.onCursor(lineText, col, path)`, and the source works out
what is under it: `phaser-api.ts` matches the expression prefixes people
actually type — `this.physics.add.`, `Phaser.Math.` — longest-first, since
`this.` is a prefix of half the others and would otherwise answer for all of
them. The word under the caret is read from both sides of it, so `setSc|ale`
asks about `setScale`. The two written guides have nothing a caret could
mean, so Automatic is hidden while one is up and the nav column takes its
place — which is what `cursorMode` on the source is for.

**MDN follows the file.** A caret in `styles.css` asks the CSS reference and
one in `index.html` asks the HTML reference, so that one button changes its
own label between JS, CSS and HTML as the editor moves between files. It is
told even while the panel is closed, so the label is right before anyone
looks at it rather than one keystroke later.

**The index is loaded; the pages are not.** `web-docs-index.json` is 884 KB of
title, description, path and page type, plus three maps from the thing you
would type to the page about it. A page is fetched only when it is opened, and
kept in a small cache — there are 2,806 of them and they are 38 MB together.
For the same reason the Automatic mode shows the index's one-line description
first and swaps the full page in behind it, guarded on the caret not having
moved on.

**The two guides were one module twice.** phaser-bench's `concepts-docs.js`
and `p2p-docs.js` were the same two hundred lines with different constants, so
`guide.ts` is a factory called twice. Their search is full text over an index
built in the background on load: forty-odd small files, where a title-only
search answers "tilemap" with nothing at all. A title match outscores a body
match by two orders of magnitude, and body matches are capped per word so one
page repeating a term cannot bury the page that is about it.

**P2P is always there.** In phaser-bench that button appeared only for
sketches that used the plugin, and it read `js/main.js` after every sketch
switch to decide. Every Idlewild project is a psd-to-phaser project, so the
check and the switching it hung off both go.

**Markdown, not a markdown library.** `markdown.ts` reads the part of markdown
this corpus uses — headings, lists, blockquotes, fenced code, links, inline
emphasis — plus MDN's KumaScript macros, which are stripped or reduced to
their first argument because there is nothing on the other end of them here.
It renders to a string and the panel assigns it with `innerHTML`, which is
safe on one condition the file states and the tests pin: every piece of text
goes through `esc` before a tag is put near it, so the only HTML in the output
is the HTML it wrote.

### Where the data came from

All of it is vendored, generated by phaser-bench's `scripts/build-phaser-docs.js`
(which clones Phaser and reads its JSDoc) and `scripts/build-web-docs.js`
(which indexes a checkout of `mdn/content`). The generators are not ported
here: they are run once per upstream release, and the second one needs an MDN
clone staged by hand first. Re-running them there and copying `public/data/`
across is the way to move the pin.

The MDN pages are CC BY-SA 2.5, which is why every page rendered from them
carries a line saying so.

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
- An export ships the `game/` tree as it stands on disk, which is what makes
  it the user's source — so a project scaffolded before a fix to the template
  keeps its own copy of the old scene. `game.config.json` is the exception:
  it is generated, and the export rewrites it every time.
- Pattern fills export as a flat colour, matching what the editor draws, and
  a pattern's PSD key is not among the `psdKeys` an export loads.
- Neither the Tauri build nor the iPad target has been exercised in CI; both
  need a machine with the platform SDKs. The pasteboard's Apple arms are
  type-checked against both Apple targets but have never been run on one.
- An import takes its key from the file's name and overwrites a PSD already
  under it. That is deliberate for the clipboard — it is how *Replace from
  clipboard* works — but it means a dropped `roof.png` silently replaces an
  earlier `roof.psd`, where a drop *onto* an image asks first. The two ought
  to agree, and making them agree is a decision about what an import means,
  not a bug fix.
- Dropping several files at once takes the first one the pipeline can read.
  A drop is one gesture landing on one space, and a run of images would need
  somewhere to put the rest.
- An extrusion applies as flat artwork. The shape it was built from is not
  kept anywhere, so a PSD cannot be opened back up into the solid that made
  it — Apply is a one-way door, the same one a fill conversion is.
- Extrude mode has no undo of its own. A pull too far is corrected by pulling
  the face back, which the carve rule makes exact, and a space too many by
  rubbing it out; Cancel is the only way back to nothing.
- A sweep across faces stops growing when the pointer wanders onto a face of
  another orientation rather than following the surface round the corner.
  Wrapping a selection around an edge is a different question from sweeping a
  rectangle, and the rectangle is what a drag describes.
- X-ray mode shows the far side but not the inside: a voxel walled in on every
  side has no exposed face, so there is no way to select or rub out a space
  buried inside a solid block.
- An extrusion is greybox: one palette, three shades, no way to colour it.
  What comes out is a stand-in to paint over in Photoshop rather than
  finished artwork, which is what the marks in the file are for.
