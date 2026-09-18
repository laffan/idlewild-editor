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
│  │ Scenes  │  │ ▣▣  Phaser 4 canvas         │  │ TOOL      │  │
│  │ Layers  │  │   ┌─────────────────────┐   │  ├───────────┤  │
│  │ Minimap │  │   │  drawing stage      │   │  │ LAYER     │  │
│  │         │  │   │  (baked ink, one    │   │  ├───────────┤  │
│  │         │  │   │   CSS transform)    │   │  │ OBJECT    │  │
│  │         │  │   └─────────────────────┘   │  │           │  │
│  └─────────┘  │ ▣▣  grid · fills · zones ·  │  └───────────┘  │
│               │ ▣▣▣▣▣  placements           │                 │
│               └─────────────────────────────┘                 │
│  ┌─────────────────────── console drawer ──────────────────┐  │
└──┴─────────────────────────┬───────────────────────────────┴──┘
                             │ Tauri IPC (invoke) + events
┌────────────────────────────▼──────────────────────────────────┐
│                        Rust backend                            │
│  store.rs        per-project directories on disk               │
│  projects.rs     the command surface over the store of them    │
│  psd_write.rs    image / RGBA → PSD  (psd fork, write half)    │
│  psd_merge.rs    several placed PSDs, written back out as one  │
│  psd_paint.rs    ink → a layer already in a PSD                │
│  clipboard.rs    the system pasteboard, which WebKit hides     │
│  psd_pipeline.rs PSD → game assets   (psd-to-json-rust)        │
│  templates.rs    per-genre scaffolds, per-projection grid      │
│  game_files.rs   the editable game/ tree, as the code modal    │
│                  sees it                                       │
│  game_search.rs  ⇧⌘F, over that same tree                      │
│  publish.rs      what a published site is made of, and the zip │
│  deploy.rs       that site, staged and pushed somewhere real   │
│  deploy_ssh.rs     the site over SFTP, on our own connection   │
│  deploy_github.rs  clone the branch, replace the path, commit  │
│  publish_targets.rs  the logins, which are the device's        │
│  github_api.rs   the two questions git cannot answer           │
│  compare.rs      the far end beside the staged site            │
│  site_files.rs   that site, as a list of files with hashes     │
│  export_assets.rs  chosen PSDs alone: sources, output, or both │
│  import_assets.rs  the same door inward, several files at once │
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

## Why the editor runs Phaser in-window, and the game does not

Idlewild's canvas *is* the editor — selection, hit-testing and the inspector
all need direct object access — so the editor's Phaser runs in the app's own
webview rather than behind a bridge.

The **game** is the other case, and it is Phaser Bench's: the program being
played is the user's, it wants isolation and a hard reload, and its console is
something to forward rather than something to share. So Play loads the
project's `game/` tree into a frame over the canvas, from the asset server, the
way a published export loads it — see [What Play runs](#what-play-runs).

Play used to be a mode of the editor's scene: a character added to the canvas,
driven by `game/play-controller.ts` and `game/play-platformer.ts`. That reading
of "play mode *adds a character to the game*" had two costs that took a while
to come due. The project's own scene file — what the code modal opens
— never ran at all, so a `console.log` saved into it went nowhere and there was
no way to tell whether any edit to it had worked. And the same game existed
twice, once in TypeScript for the editor and once in JavaScript for the export,
kept in step by hand. Both are gone with those files.

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
`src/lib/doc-shape.ts` holds the parts of it that are functions rather than
state — an empty layer, a copy of one, how a fill describes what it covers,
and the migration a document goes through on the way in from disk. Split from
`doc-store.ts` for the line rule, and it splits cleanly: none of it touches
the store.

Three fields are about **what a mark is made of** rather than where it is, and
all three are optional because *absent* means the flat colour everything was
before the libraries existed:

| Field | On | What it says |
|---|---|---|
| `Stroke.paint` | a stroke | the library row it is drawn with, and the lattice a pattern is pinned to |
| `Stroke.stamp` | a `"shape"` stroke | the box each stamp fills, and whether the space is the diamond inside it |
| `FillPatch.paint` | a filled run of grid spaces | the same, for ground rather than ink |

A `PaintSpec` names a row by **id**, and the library is per install — see
*The pattern and shape libraries* for what a document carrying an id this
machine does not have draws instead.

- **Layers are top-first**, matching Hush. Phaser depth counts upward, so
  layer *N* of *M* renders at depth `(M − N) × 1000`. Inside a layer's slot
  each placed file takes the next whole number up, in an order worked out once
  — see *What is drawn over what*.
- **Cells are integers**, never pixels. `src/lib/grid.ts` owns the projection:
  isometric tiles are 2:1 diamonds addressed by centre, orthogonal tiles are
  squares addressed by top-left corner. Everything downstream — selection,
  fills, A*, export bounds — is written once against `Grid`.
- **The grid is never stored.** It is recomputed from the camera over exactly
  the cells the viewport can see. There is no world bound to hit.
- **Chrome is measured in screen pixels, not world ones.** Everything the
  editor draws *about* the document — the lattice, a selection's outline, an
  extrusion's hairlines — is stroked at a width divided by the camera's zoom,
  so it reads the same at 1× and at 4×. Phaser scales a line width like it
  scales everything else, so the alternative is a lattice four pixels thick
  over an 8px tile on exactly the projects that are most likely to be zoomed
  in. See the section below.
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
it — the played character is measured in it, and so is the lattice its
navigation walks, in the template's `shared/character.js` as it was in the editor's
own play mode. That is what the New Project sheet's grid scale still means on a
blank canvas, and what the line under the control says.

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
shared with three neighbours, so navigation was blocking a cell either side of
every wall until this existed. `grid.js` in the templates carries the same
distinction, for the same reason.

### Two genres, one document

`genre` decides the scene a project scaffolds, and so — since Play runs that
scene — the game the editor plays. Nothing else. Both read the same document:
a fill marked not-walkable, a boundary marked blocking and a placed PSD's
collider are what a top-down character routes *around* and what a side-on
character stands *on* — a floor plan or a cross-section, the same geometry
either way.

Isometric and platformer is the one pair not offered. Gravity has no
direction on a diamond grid seen from above, so the New Project sheet greys the
option out and `create_project` refuses it rather than scaffolding something
that cannot work.

Both fields are optional on disk (`#[serde(default)]` on the Rust side,
`genre?:` on the TypeScript one) so every project written before the choice
existed still loads, as top down — which is what it has always been.

### Options, and which of them can change

`ProjectMeta.options` — `GameOptions` in `project.rs`, mirrored in `types.ts` —
carries four fields, and they are not the same kind of thing.

| field | what it is |
| --- | --- |
| `pixelArt` | nearest-neighbour textures rather than bilinear ones |
| `roundPixels` | draw on whole pixels |
| `defaultZoom` | the zoom a scene with no camera of its own opens at |
| `character` | whether New Project scaffolded a character controller |

The first three are **settings**. Each reaches two places, and neither place is
told by the other: the editor's own Phaser game, through `game/boot.ts` at
start-up and `game/render-options.ts` afterwards, and the exported game, through
`game.config.json`. So a toggle in Project Options re-filters every texture on
the canvas *and* rewrites the config the project's own code reads, and the two
answers agree because they come from the same field.

`defaultZoom` is two facts wearing one number, which is where it went wrong.
The camera in front of you is one; the zoom a scene *with no camera of its
own* opens at is the other, and that one lived in `WorldSceneConfig` as a
number handed in when the scene was created. Changing the setting moved only
the first, so the canvas went where you asked and every scene nobody had
opened yet went on arriving at whatever the editor booted with. The field is
`() => number` now — asked for at the moment a scene needs it, which is the
same shape everything else that outlives a change already uses. Project
Options still moves the camera itself, through the scene's `zoomAt` so the
move is centred and recorded: the camera rides the scene in the document, and
a zoom the document did not hear about is undone by the next scene switch.

The camera's own clamp has to reach as far as the setting is allowed to go, or
the setting lies without failing: `MAX_ZOOM` was 4 while the sheet accepted up
to 8, so a pixel-art project asked for 6×, got 6× in the config its game
reads, and got 4× on the canvas beside it. `ZOOM_RANGE` in `types.ts` is the
one place that number is written now, and a test pins the scene to it.

And a game that is already running is restarted once the write lands, the way
saving a file in Code restarts it — the config it is running against has just
been rewritten underneath it. Once the write lands, not before: Rust
regenerates `game.config.json` as part of `set_project_options`, so a reload
fired any earlier would come back on the old numbers.

Applying `pixelArt` to a game that is already up is two jobs rather than one.
Phaser reads it once, at construction, where it turns `antialias` off — and
`antialias` is what every texture *source* consults for its filter as it is
created. So `applyPixelArt` writes both fields of the live config, for the
textures not loaded yet, and re-filters every texture already in, which
`TextureSource.setFilter` puts through to the renderer rather than waiting for a
reload. The exported game does none of this: it reads the value at boot, because
a published game is never half-way through being reconfigured.

`character` is the odd one, and it is **history rather than a setting**. Leaving
a character out means not writing the lines that make one, and those lines are
the project's own the moment they are written — so unticking a box later would
not take a character out of code that has one. It is kept because the scaffold
has to stay reproducible: a managed block's Reset asks Rust for the file as it
was first written, and the answer depends on whether a character was in it. The
sheet reports it; it does not offer it.

Every field has a default, and the defaults are what every project written
before any of this has always been: no pixel snapping, zoom 1, and a character,
because the scaffold always wrote one. On the TypeScript side that is
`projectOptions(meta)` rather than four `??`s at each call site.

### Scenes

A scene is what Phaser means by one: a set of layers and a canvas of its own.
A project is several places — a title screen, a cave, the overworld — sharing
a grid, a genre and a pile of PSDs, but not a single thing standing on them.

```text
GameDoc
  scenes: [ { id, name, layers: [...], camera?, startPointId? }, ... ]
  activeSceneId
  extrusions        ← document-level: a PSD is the project's, not a scene's
```

**`DocStore.layers` and `layer(id)` answer about the active scene, and their
signatures did not change.** That is the whole design: the Phaser scene, the
three panels, the renderers, the drag controller and the overlay never had to
learn that scenes exist. Switching scenes is this one object answering
differently, not thirty call sites asking a new question — which is why the
existing suite passed on the new model unmodified.

**Two events, because two things happen.** `change` means the document moved:
re-read it. `scene` means everything on the canvas is now about somewhere
else: rebuild. `change` fires first, so a listener that re-reads runs before
one that redraws. `WorldScene.reloadScene` is the redraw — it cancels
everything half-done (a drag, a marquee, an extrusion, an opened-up PSD),
clears the selection, and then gets the demolition free: the renderer keys its
placements by placement id and destroys every one it no longer finds in the
document, which after a switch is all of them.

**The camera rides the scene**, because a scene is a place and coming back to
it should be coming back to where you were standing.

**A duplicate gets ids of its own, all the way down** — layers, fills,
placements, zones and strokes. Two scenes sharing a placement id would be one
rendered object belonging to both, showing whichever was drawn last. A unit
(the placements one PSD arrived as, which drag together) is remapped rather
than copied, or the duplicate's parts would each think they belong to the
original's unit.

#### What is the scene's, and what is the project's

`psd/` is one directory for the project, so a *file* is project-wide while a
*placement* is a scene's. Three edits are about the file and therefore about
every scene: renaming a PSD, re-anchoring an extrusion, and counting how many
placements draw one layer (the inspector's "editing one edits both", which
under-counting would point the wrong way). They go through
`updatePlacementsEverywhere` and `everyPlacement` and write once.

Renaming is the one where scene-scoping would have been corruption rather
than staleness: a placement in another scene left pointing at a key that has
gone can never render, and there is nothing on screen to say why.

#### Documents written before scenes

`withScenes` folds a legacy document's top-level `layers` and `camera` into
one scene called **Main** — which is what they always were, named for the
first time, and the same name a fresh project's first scene gets, so the two
kinds of project read the same afterwards. It also repairs an `activeSceneId`
naming a scene that is not there, because hand-edited documents are a thing
this app invites. `StoredDoc` is the type at that boundary: a document as it
may arrive from disk, with the two fields a pre-scenes project lacks made
optional, so the migration is a conversion rather than a cast.

Rust reads both shapes too. The config is regenerated on the way *in* as well
as on every save, so a project that has not been opened since the change still
exports what is in it.

### Autosave

`DocStore` debounces writes 800 ms and flushes on navigation. Camera moves set
state without marking the document content-dirty, so a pan-only session does
not queue a save storm — the same distinction Hush draws between repaint-only
and content notify keys.

---

## Undo

The whole thing is a stack of `GameDoc` snapshots, and it is cheap for exactly
one reason: the hard rule at the top of this file. **Document objects are
immutable once stored**, so every commit already builds a new document that
shares every subtree it did not touch. Remembering the one before it is a
pointer copy. A hundred of them — the cap — cost about what a hundred pointers
cost, and a stroke-heavy layer is a hundred references to the *same* strokes.

The alternative reading is an inverse operation per mutation, and it would
need one for each of the thirty-odd methods on `DocStore` plus a fresh one for
every method added after. That pays for itself when a snapshot is expensive.
Here it is not. `lib/history.ts` is the stack — `UndoHistory<T>`, generic
because three separate things hold one; `DocStore.commit` hands its own the
state it is about to replace, and `DocStore.restore` — deliberately not
`commit` — is how one comes back.

### A step is a thing you did, not a write the editor made

The gap between those two is where all the work is. A drag writes on every
pointer move, because that is what makes the canvas follow the finger; a
dropped PSD writes once per layer in the file and once more for its collider.
Recording each of those would be a history of the *loop*, and undoing a drag
would mean pressing ⌘Z forty times.

So a caller can say three things about a write:

| | What it means | Where |
|---|---|---|
| *(nothing)* | one step | every ordinary mutation |
| `history.begin()` / `end()` | the writes between them are one step | `game/drag.ts`, either end of a gesture in extrude and collider mode, and PSD Edit mode's Apply |
| `history.group(fn)` | the same, when the writes are in one place | placing a PSD, Apply, the two conversions |
| `history.silence(fn)` | not the user's edit; leave no step | the migrations that run on open |

`begin`/`end` is a pair rather than only a callback because the two ends of a
drag are two events — a pointer-down and a release — and there is no function
that spans them. A group that wrote nothing leaves no step behind, and that
usually falls out rather than being checked for: the entry is pushed by the
*first* write inside the group, so a drag that never left the space it started
on pushes nothing at all. The exception is a gesture that comes *back* to
where it began, which is what a face pulled ten spaces out and ten back is;
`end` tests the group's entry against the current value by identity, which is
what the immutability rule buys. `Drag.begin` therefore opens the group before
asking whether the gesture grabbed anything, and closes it again when the
answer is no — an open group nobody closed would swallow whatever the user did
next.

`silence` exists because `PsdPlacements.migrate` runs when a project opens: it
backfills the unit and stack fields old documents lack, and writes a default
collider for every placed key that has none. An undo stack whose first entry
is *un-repair the document you just opened* is worse than no undo.

Two things are quiet for a different reason. **A scene switch is navigation,
not an edit** — looking somewhere else is not something to take back, and
`setActiveScene` is silenced for that. And **a camera move never commits at
all**, which it did not before this either; see Autosave.

### Where it stops

Some edits move a file on disk, and a document snapshot cannot describe that.
Renaming a PSD moves `psd/<key>.psd` and its whole `assets/<key>/` tree and
repoints every placement in every scene; re-importing one replaces the file
under a key it keeps. Restoring a document from before either of those would
leave placements pointing at a layer path — or a key — that is not there any
more, which is the one failure this codebase already calls corruption rather
than staleness: nothing renders, and nothing on screen says why.

So `history.clear()` is a **barrier**, and `PsdPlacements.reload` and
`.rename` raise it. Every caller of those goes through them — the inspector's
Re-parse and Re-import, a rewritten layer stack, a drop onto an image already
on the canvas, a re-applied extrusion — so the rule is in one place rather
than at six call sites that have to remember it.

Everything else that writes a file is safe to go back past, because the file
it wrote stays where it is: undoing an import removes the placement and leaves
the PSD in `psd/`, and redoing it puts the placement back onto a key that is
still registered. The orphan is the cost, and it is the same orphan a delete
leaves.

### What a restore has to fire

`change` means the document moved; `scene` means everything on the canvas is
now about somewhere else. A restore works out which it is by comparing
`activeSceneId`, and fires `change` first in either case — so a listener that
re-reads runs before one that redraws, exactly as an edit and a switch do.
Nothing downstream had to learn that undo exists: the panels, the renderers
and the drawing layer re-read on the events they already listened to.

The **selection** is the one thing that is the editor's rather than the
document's, and an undo can leave it naming a placement that has gone — the
inspector would go on describing it and the overlay would outline nothing. So
`lib/selection.ts` asks whether it still names something and
`editor/history.ts` drops it when it does not. Only there: everywhere else,
the thing that removes an object clears the selection on its way out.

### A canvas mode is a session of its own

Extrude, collider and mask mode hold their work in their own objects and touch
the document only at Apply. That is the whole point of them — Cancel is
dropping what is in the object — and it means the document's history has
*nothing* to take back between one pull and the next. A stack that skipped over
that would be a stack with a hole in it exactly where the work is: pull a wall
up ten, pull an arm out of it, and ⌘Z would offer to undo whatever you did
before you entered the mode.

So each mode holds an `UndoHistory` of its own, over the value it is editing —
`ExtrudeState` for one, a set of grid spaces for the other two. The same
snapshot argument applies for the same reason, and collider mode's spaces were
made replace-rather-than-mutate to earn it; mask mode's are the same set under
a different name.

**PSD Edit mode is the exception, and for the same reason read the other way.** Its
work is ordinary strokes on an ordinary document layer, so the document's
history has everything to take back and ⌘Z inside the mode undoes a stroke at
a time, which is exactly what it should do. That is also what makes its Cancel
safe: throwing the session's ink away is a document edit, so it is one press
of undo from coming back.

**A step is a pull or a rub, not a frame of one and not taking hold of a
face.** A sweep rebuilds the shape from its base on every pointer move, so the
gesture opens a group at pointer-down and closes it at the release; a face
pulled out and back to where it started leaves no step at all, which is the
one place `UndoHistory.end`'s identity test actually fires. Every way out of a
gesture goes through `ExtrudeMode.clearGesture` — the release, the hold that
turns a pull into a sweep, leaving the mode — which is what guarantees no
group is ever left open to swallow the next thing done.

Taking hold of a different face records nothing: it is this mode's version of
a selection. It does ride *inside* the snapshot, though, so undoing a pull
puts back the face that pull was made from.

Both stacks are cleared on the way into a session and on the way out of one.
The shape a session remembers stops existing at both ends, and offering to go
back to it would be the same lie a renamed PSD would be.

### Three kinds of history, and which one a press means

The code editor has had its own undo since it was ported — CodeMirror's
`history()`, per open file, over ⌘Z. What did not exist is a rule for which
history a press reaches, and with the code panel pinned two of them are on
screen at once.

**The rule is where you last worked, and then what owns the canvas.** Where
you last worked is read from `focusin` *and* a captured `pointerdown` — two
events rather than one because half this editor cannot take focus at all: the
Phaser canvas and the drawing surface are not focusable, so putting a pencil
on one fires no focus event of any kind and ⌘Z would go on meaning the file
you were last typing in. The header is excluded from the reckoning, and its
two buttons swallow their own `mousedown`, so pressing one neither reassigns
the next press nor takes the caret out of the editor it is about.

Once the press is the canvas's, a mode wins over the document beneath it,
because while one is up there is nothing else on the canvas to edit. A mode
with nothing left says so rather than falling through — the work underneath is
not what the press meant, and Cancel is how you go back past the start of a
session. `editor/history.ts` is built after `bootGame` for this: the mode
stacks live on the scene, and the header and the keyboard reach the controller
through closures rather than by construction order.

⌘Z typed *inside* CodeMirror never reaches `editor/history.ts` at all:
`isTyping` stands the global handler down for anything `contenteditable`, and
CodeMirror's own keymap has the key. That is the same history the button would
have reached, so the two paths agree. The buttons are the case that has to be
explicit, because a press of one leaves the caret exactly where it was.

### The keys, and the iPad

⌘Z and ⇧⌘Z, in `editor/shortcuts.ts` with the rest of the editor's keyboard.
An iPad with a hardware keyboard sends both exactly as a Mac does — same
`metaKey`, same `key` — so there is one code path rather than a platform
split. `key` arrives as an upper-case `Z` when shift is down, so the letter is
compared case-insensitively and shift is read separately. Control stands in
for ⌘ so a keyboard without a Command key is not locked out.

`preventDefault` is load-bearing rather than tidy: WKWebView takes an
un-prevented ⌘Z as its own editing undo, which on iPadOS surfaces as the
system's Undo over whatever field was last touched.

An iPad without a keyboard is why the buttons exist at all. The pair in the
header sits beside the Draw/Code/Play toggle and follows the caret into the
code panel, so a docked panel's file undoes from there.

There was a second pair, in that panel's own footer beside Save, because the
header is behind it whenever it is placed over the whole shell — which is
exactly the moment a device with no ⌘ has nowhere else to press. That footer
has gone (see *One bar of chrome, where there were three*), and the trade is
written down there: fifty-six pixels of every file in every placement, against
two buttons in the one placement that hides the header's.

---

## One screen pixel, whatever the camera is doing

A width handed to Phaser's `Graphics` is in world units, and the camera scales
it with everything else. So a lattice stroked at `1` is one pixel at 1× and
four at 4× — and 4× is exactly what a project drawn on 8 or 16 px spaces opens
at, which made the ground under a pixel-art project read as a drawing over it.

Every overlay on this canvas therefore strokes `n / zoom`: the grid renderer,
the selection outlines, the marquee, the drop target, the collider shapes and
extrude mode's own faces. At 1× that is the weight it has always been, which
is why nothing about a 32 px project changes. The grid renderer's `invalidate`
is part of it: the lines are stroked at a width worked out from the zoom, so a
zoom has to redraw them even when the same cells are still on screen.

The one thing that cannot follow is a line in a **PSD**, which is pixels by the
time anyone looks at it. `editor/import-anchor.ts` has the rule as `hairline`:
an extrusion's lines bake at the weight the lattice has at the zoom the project
opens at — its `defaultZoom` — with a floor of one pixel of the file itself,
because half a pixel of canvas stroke is a grey smear rather than a line. A
project at 1× gets the one world pixel it always got; a pixel-art project at 4×
gets a crisp single pixel instead of four.

---

## The minimap

Along the bottom of the left sidebar, under the layers. The column then reads
as the questions in the order anybody asks them: which place am I in, what is
in it, and where am I standing in it. The third had no answer before — the
canvas is effectively infinite, and work you had drifted away from could only
be found by panning until it came back.

**There is no "fit the whole map in the box".** The lattice is recomputed from
the camera over exactly the cells it can see and there is nothing to hit, so a
document has no extent of its own to frame. What `editor/minimap-view.ts`
frames instead is the **union of everything that has been put down and the
camera's own rectangle**, padded by a margin. That union is what makes the
thing usable in both directions: move about inside your own work and the
picture holds perfectly still, because the union is the work; walk off the
edge of it and the picture opens out until both you and the work are in view,
which is the only way back. A scene with nothing in it frames the camera
alone, and the two hairlines through the origin are all there is to see.

The union is then grown to the **shape of the box** rather than letterboxed
into it. A `contain` fit leaves a strip down two sides, and those strips are
world as much as the middle is — painting them as anything else would draw an
edge onto a canvas that has none. Growing instead means one scale describes
both axes, which is the whole of the projection: `world → box` is a subtract
and a multiply, and `toWorld` is what a finger on the map is pointing at.

**The frame is a div, not paint.** A pan moves the camera every frame while
the map underneath has not changed, and repainting a document to move one
rectangle is the per-frame work this editor keeps off the main thread
everywhere else. So the content is baked into the canvas only when the
document or the framing actually changes — a string of the world rect, the
scale, the box and a revision counter decides — and the camera is a positioned
element over the top of it, dimming the rest of the world with one enormous
`box-shadow` that the body clips. It is the same bargain the drawing layer's
stage strikes with its backing canvas, for the same reason.

It draws from the **document**, not from the scene: the box a placement
occupies rather than its artwork, a fill's own colour, a boundary's polygon, a
stroke as the line it was drawn as, and the markers a point gets on the canvas.
So it needs none of the texture machinery, works before a PSD has loaded, and
costs a second WebGL camera nothing. Layers that are hidden are hidden here
too, and a placed PSD is floored at a couple of map pixels — a sprite a
fraction of a pixel wide antialiases away to nothing, and a map that shows
nothing where there is something is worse than one that shows it roughly.
Strokes are sampled to at most 96 points, which at this size is the same line
drawn faster.

**It is Draw's.** The map frames the camera the canvas is looking through, and in
Code and Play the canvas is behind a running game — so the frame would be drawn
around a camera nobody is looking through. Play takes the whole left sidebar
down anyway; Code is the mode that *keeps* it, to switch scene and adjust the
document while the game runs, so the rule has to name both and
`styles.test.ts` asserts that it does. `display: none` also stops the paint: the
body has no box to fit anything into, `paint` returns on that, and the
`ResizeObserver` brings it back the moment there is one again.

**A scrub freezes the projection.** A press names a place and the camera goes
there at the zoom it is already at; the finger keeps naming places until it
comes up. But centring the camera can widen the union — that is exactly what
walking off the edge of the document does — so re-fitting mid-drag would slide
the map out from under the finger driving it. The view is taken once, at
pointer-down, and held for the gesture; the fit is redone on release.

### The switches above it

Four things on this canvas are drawn *about* the document rather than being
part of it: the lattice, the boundary around the screen the game opens at, the
crosshair on world `0, 0`, and this map. All four are useful and none of them is
useful all of the time — a boundary is what you lay a building against and then
want out of the way, and the map is worth a third of the sidebar right up until
you are working close in. So `editor/overlays-panel.ts` gives each one a switch,
in a foldable **Overlays** section directly above the map.

**Beside the thing they switch, not behind the header's menu.** The Minimap row
sits on top of the minimap it hides, and the rest are in the column you
are already looking at when you notice a mark is in the way.

**Folded to begin with, with every mark showing**, which is two decisions
rather than one. A *mark* switched off by default is a mark somebody has to be
told exists, so all of them start on. The *section* is chrome about the canvas
rather than part of it, and four rows of it permanently above the map cost the
map a third of what it had, every session, to say something you act on rarely —
so it starts folded, with the heading left standing, one tap away and named.

**The grid is the fourth, and it is the one this list was always about.** It is
the most overlay-ish thing the canvas draws: it exists nowhere in the game, it
is recomputed from the camera rather than stored (see [The infinite
grid](#one-screen-pixel-whatever-the-camera-is-doing)), and a scene that is
mostly artwork by now is one where a pale blue lattice printed over every
sprite is exactly the mark you want out of the way while you judge what you
drew. It sits **first**, because it is the ground the other three are marks
*on*, and because the list then reads outward from the canvas: the lattice, the
two things about the game's screen, and finally the picture of the whole scene.

**A project with no lattice gets no row**, rather than a dead one. The blank
template's cells are single pixels and `GridRenderer.update` returns before it
strokes anything, so a `Grid` switch there would be a control over something
that was never drawn — which reads as broken rather than as absent.
`overlayRows(hasLattice)` is that decision, and it is the panel's one piece of
per-project shape; `editor.ts` asks `grid.snaps` for the answer.

**Hidden, not skipped.** `GridRenderer.setVisible` takes the Phaser `Graphics`
object down rather than short-circuiting the redraw, because `visibleRange` is
what the pattern layers are synced over in `WorldScene.update` and that reading
of the camera has to go on happening whether or not the ground under them is
showing. The strokes already in the object stay valid, so switching back on is
a frame rather than a re-walk of the viewport — and the depth `setBackdropDepth`
keeps putting it at is still right when it returns.

**The rest of the order is not the order they were asked for.** Boundary and
centre point are the two marks `screen-guide.ts` draws — one subject, so they go
together — and Minimap is last because that is what puts it against its own map.

**It is panel state, not document state.** Which marks somebody wants on is a
per-install convenience, like a sidebar's width or a folded inspector section,
so it is a `localStorage` record and never reaches `doc.json`. Two people
opening the same project see their own answer, and no overlay switch has ever
been a thing to undo. `readOverlays` is the parse and the tested half: it is
reading something a previous version of this app wrote, out of a store that can
also hand back a half-written string or another tab's JSON, and **anything not
plainly a boolean falls back to showing the mark** — a mark switched off that
nobody asked to switch off, with the switch that would explain it reading *on*,
is the one outcome that cannot be debugged from the screen.

**The lattice is the one exception to that**, because it is paint rather than a
DOM element: it is switched on the renderer, through a `LatticeHost` the panel
is handed once the canvas has booted. The handoff is `setLattice`, beside
`setGuide` and for the same reason — a grid somebody switched off last week has
to be off on the first frame of the scene rather than on the first toggle, and
the scene is the last thing `editor.ts` builds.

**Each switch is a class, and the stylesheet does the hiding.** `display: none`
on the map is the same rule Code and Play already take it down under, and it
stops the paint as well as the picture — the body has no box to fit anything
into, `paint` returns on that, and the `ResizeObserver` brings it back the
moment there is one again. `ScreenGuide.setMarksVisible` does the same for its
two elements and keeps a `showing` flag beside them, so with both off `draw`
returns immediately; it runs on every camera move, and a hidden mark should not
cost one. Turning a mark back on redraws it there and then, so it returns where
the camera is now rather than where it was when it went.

**The switches are Draw's, like the map.** In Code the marks they control are
already down, so every row would be a switch for something not on screen. The
rule names both modes beside the minimap's own, and `styles.test.ts` asserts
it — along with each mark having a rule of its own, the map going down by
`display`, and the rows being `--hit` tall, because the whole row is the target
and there is nothing else on it to aim at.

### The camera came out of the scene

`world-scene.ts` was at the 700-line limit, and the minimap needed one more
thing from it: somewhere to say "stand here". The camera is the part of that
file with a life of its own — it arrives from the document, it is written back
to the document as it moves, and it outlives every tool that borrows it — so
`game/scene-camera.ts` is the clamp, the moves and the persistence, and the
scene keeps the reads. What it needs told about, it is handed as callbacks: the
lattice to invalidate, the chrome to re-stroke after a zoom, and the viewport
to publish.

Three call sites now share it rather than one: the gesture arbiter, the drawing
layer's own two-finger navigation through `panScreen` / `zoomAt`, and the
minimap through `centreOn`. `MIN_ZOOM` and `MAX_ZOOM` live there now, which is
why `tests/options.test.ts` reads that file for the constant.

`editor/tool-routing.ts` came out of `editor.ts` in the same breath and for the
same rule. What a tool means to the pointer — who gets the raw input, what a
drag on empty space does, what the cursor is, what the inspector describes —
was four screens down a file that is otherwise wiring, and the pen rail's three
tools belong with it because they are a brush swap wearing a tool's clothes.

---

## The origin, and the screen the game opens at

The canvas has no edges. The lattice is recomputed from the camera over the
cells it can see, there is no world bound to hit, and a camera that has been
panned for a while is looking at a picture that would be identical a thousand
spaces away. That is the right model for building in and it leaves two facts
about the **game** with nothing on screen to say them.

The first is world `0, 0`. Every coordinate in the document is counted from it,
`config.scenes` hands it to the project's own code, and until now the only
thing that ever drew it was the minimap's two hairlines — three hundred pixels
away in the sidebar, at a scale nothing can be placed against.

The second is how much world a player sees. `templates/common/js/main.js` runs
the game at `Phaser.Scale.RESIZE`, so there is no design size to point at: the
game's screen *is* the window, and what decides how much world fits in it is
Project Options' default zoom. Drawing a building around the origin and finding
half of it off the edge in Play is the ordinary way to learn that, and learning
it in Play means going back to Draw with a number in your head.

So `editor/screen-guide.ts` puts both on the canvas in Draw: a red crosshair on
the origin, and a dashed red rectangle around the screen the game opens at.

**Centred on the origin, not hung off a corner.** A scene has no top-left —
cells count in both directions, a fresh camera centres on `0, 0`, and the
default zoom scales what the game shows about the middle of its screen. And the
rectangle is deliberately not a claim about *where the game's camera will be*:
`spawnCharacter` calls `startFollow` a frame after boot, so on any project with
the character controller ticked the camera is wherever the character is. What
the box can honestly say is **this much world, around here**.

`guideBox` is the whole of the arithmetic and is the thing under test. The
origin is `−originX × zoom`, straight out of the viewport the scene already
publishes; the box is the game's screen scaled by `cameraZoom / gameZoom`. The
property that makes it worth drawing falls out of that second term: **at the
project's default zoom the two cancel**, and the dashes are the game's window
life size on the canvas you are drawing on. Zoom in past it and the box grows
by exactly the ratio, which is the same statement seen closer up.

**The size is the row's, not the canvas's.** Play takes both sidebars down, so
a running game fills the whole of `.editor-main` — measure the canvas in front
of you and the boundary is drawn at whatever width the sidebars happen to be
leaving, which is the one width the game never gets. A `ResizeObserver` on that
row keeps its content box, and `contentRect` is already content: the row pads
itself out of the iPad's side safe areas and a full-screen game does not get
those.

**It is a div, not paint**, which is the bargain `minimap.ts` strikes with its
camera frame and for two more reasons besides. A mark drawn into the scene
would be baked into the project's **thumbnail** — `game/snapshot.ts` takes that
straight off the live renderer — which is a dashed red box across every card on
the home screen. And it would have to be re-stroked at `1 / zoom` on every
zoom, the way every other overlay on this canvas is, where a CSS hairline is
one screen pixel by definition. Two absolutely-positioned elements moved with a
transform cost the renderer nothing and the main thread one write per camera
move, off the same `onViewport` push the drawing layer and the minimap are
already driven by. It gets a `z-index` of its own — 3, under the ink's sheet at
4 and the tool rail at 5 — rather than sharing one with either, because a tie
is settled by document order and the boundary is a rectangle wide enough to
draw dashes across the rail's buttons. Under the ink is also where the scene's
own selection chrome already is.

**A red that is not the accent.** `--canvas-guide` is its own token. The accent
is what the editor draws a *selection* in — outlines, the marquee, the extrude
plate — and these two marks are the only things on the canvas that are there
the whole time and cannot be picked up, dragged or filled. It is the same
argument the colour picker's grey default is there for. The crosshair carries a
one-pixel white halo on top of that, because the origin is the likeliest place
on the whole canvas to have something standing on it, and a red hairline over a
red fill is a mark nobody can find. The boundary needs none: it is dashed, and
nothing else here is.

**Draw's alone**, for the reason the minimap is: in Code and Play the canvas is
behind a running game, so a drawing of where the game's screen falls would be
drawn under the screen itself. `styles/__tests__/guides.test.ts` asserts that
rule names both modes, and that the sheet takes no pointer events — without
that it would swallow every press over the canvas, which is the drawing layer's
own failure by the same mechanism and with nothing to go on.

Two files moved to make room, both to the 700-line rule rather than to
anything about the feature: the guide's CSS is `styles/guides.css` because
`editor.css` was at the limit, and `styles/__tests__/rules.ts` now holds the
`ruleIn` helper that `styles.test.ts` was at the limit holding.

---

## Three sections, not two modes

`EditorMode` is `draw | code | play`. It was `edit | play`, with Code a menu
item that opened a panel, and that made Code a thing you could be half in: the
panel over a canvas whose mode did not know it was there, the inspector
describing a selection nobody could see, undo quietly belonging to whichever of
them had the focus. A section is the honest shape, and the header says so left
to right in the order the work goes.

**Code shows what Play shows.** The project's own game runs in a frame over the
canvas in both, because a code editor beside a still picture of the game is a
code editor you cannot check anything in: a save restarts the thing in front of
you, which is the only way to see whether the edit worked. What Code keeps that
Play does not is the **left** sidebar and the panel, so the scene can be
switched and the project read while the game runs, before a full test in Play.

It used to keep both sidebars, and the right one was a mistake that took a
while to see. The inspector describes what is *selected on the canvas*, and in
Code the canvas is behind a running game: nothing there can be picked, dragged
or resized, so every control in that column was aimed at a selection nobody
could reach. It goes down in Code now, with its divider — a grip that resizes
something nobody can see — and its edge toggle, which would fold a panel that
is already gone. The left column stays and becomes something else; see *The
left sidebar is a directory in Code*, below.

That makes the difference between the two a fact about the shell rather than
about the scene, and the code says so in three places.

- **`WorldScene` keeps a boolean, not a mode.** `editing` is true in Draw and
  false in the other two; every gesture entry point asks it, and `setMode`
  tears down a drag, a marquee and a canvas mode only when it flips. Code and
  Play are the same answer, so switching between them changes nothing on the
  canvas — and a solid half pulled in extrude mode survives neither, because
  the game is about to cover the thing it was being pulled over.
- **The stylesheet takes the tools down in both** — the rail, the tool name,
  the selection bar, the ink's own layer, and the canvas's pointer events —
  the *right* sidebar in both, and the left one in Play only. All three are
  asserted in `styles/__tests__/styles.test.ts`, because "Code keeps the layer
  column" is most of the reason the mode exists and a rule is an easy thing to
  widen by accident.
- **`editor.ts` runs the game for anything that is not Draw**, flushing the
  document first: the config the game reads is written by that save. A scene
  switch does the same, which is what makes the dropdown in the left sidebar
  worth having while the game is up.

**And the toggle that folds the left sidebar had to be lifted over the game.**
The two edge toggles live inside the canvas wrapper at `z-index: 6`, and the
game frame covers that wrapper at `8` — so in Code the button was rendered
underneath a running game: there in the DOM, catching nothing, for the whole of
the mode. One rule (`.editor.code-mode .edge-toggle.left { z-index: 9 }`) is
the whole fix, and it is Code's alone, because Play hides both toggles and Draw
has no frame to be under. Asserted against `.game-frame`'s own z-index rather
than against the number, since the pair only means anything relative to each
other.

Entering Code puts the panel up wherever it was last placed, showing whichever
file that project was last left in, and leaving takes it down, writing a dirty
file on the way out — see *The file it opens with*, below, for why the second of
those needs something outside the panel to hold it. Anything that wants a file
on screen — the console's LOG link, which opens the line a message was written
on — asks for the mode first and the file second.

---

### The left sidebar is a directory in Code

Draw's layer panel is a set of *controls*: rename a layer, hide it, lock it,
carry it up the stack, drag a placed file to another layer, put a new layer on
top. In Code not one of those has anywhere to happen — the game is over the
canvas, nothing in the scene can be picked up, and the panel that would
describe a selection is down. A column of live controls for a document nobody
can touch is worse than useless: it is an invitation to change something and
watch nothing happen.

What is wanted there instead is the **names**. A developer writing against
`config.scenes`, `place()` or a texture key needs to know what the scenes are
called, what the layers in them are called, which PSDs are standing on those,
and what the layers *inside* each PSD are called — and reading the last of
those off the file in Photoshop, or out of `game.config.json`, is two windows
away from where the line is being typed.

So `LayersPanel.setBrowsing(true)` swaps the body for `layer-directory.ts`:
the same tree with the handles taken off and one level added.

- **Every row is inert except its disclosure.** A layer row is a button whose
  whole width toggles it — in Draw that is a 22px arrow because five other
  controls share the row, and with those gone a finger should be able to land
  anywhere. The name is a `span` rather than the `input` it is in Draw; the
  eye, the lock and both grips are simply not built.
- **A placed PSD opens onto its own stack.** This is the level Draw's panel
  deliberately does not have, and it is right not to: a placed PSD is *one
  thing* on the canvas however many layers are inside it, so listing its
  insides there would put a file's stack in the panel that is about the scene
  — see *Two senses of "layer", and why the panels must not mix them*. Here
  nothing is being selected, so the two senses cannot be confused by a click.
- **The layers come from the plugin's own manifest**, through
  `WorldScene.psdLayers` → `PsdPlacements.layersOf` → `manifestLayers`. That
  is the one description of the file already in memory and already kept in
  step with it through a re-parse, a rewritten stack and a rename, so there is
  nothing to cache and nothing to go stale. A key nobody has loaded answers
  with an empty list, and the row says *Not loaded yet* rather than nothing.
- **Nothing is filtered out of it** — the editor's two marks included. A
  directory of what is in a document that quietly drops two rows is a
  directory that disagrees with Photoshop, which is worse than one that shows
  a row somebody has to learn to ignore. What it *does* say is the category
  beside each name, which is also what tells a developer whether a row has a
  texture behind it or is a point the config carries.
- **The indent is the file's.** `layerDepth` reads it off the slash-joined
  path and the row carries it inline, because the nesting is the document's
  and not a number a stylesheet could know.
- **The names are selectable.** The shell suppresses selection globally so a
  drag on chrome never highlights it; this column, while it is a directory, is
  the one place that is the wrong default — the point of a lookup is copying
  what you looked up.

Two things beyond the list go with it. The `+` is hidden, and hiding it takes
a rule of its own: `.panel-add` sets `display: flex`, which outranks the user
agent's `[hidden] { display: none }`, so the attribute alone left the button
exactly where it was. And the scene dropdown offers **the scenes and nothing
else** — switching is navigation, and the reason this sidebar is kept in Code
at all, but New, Rename, Duplicate and Delete are edits to a project whose
canvas is behind a running game, and Delete is the most expensive button in
the column.

The panel keeps one set of open rows across both shapes. The directory's ids
for a placed file are `psd:<layerId>:<placementId>` — keyed on the placement
rather than on the file, because the same PSD on two layers is two rows and
opening one is not opening the other — so they share the set with the layer
ids without colliding, and an id nothing matches is simply never asked about.

---

## The tools, on two columns

They were one column down the left edge of the canvas, split by a gap into
"the game canvas's" and "the drawing layer's". The gap was carrying the whole
distinction, and the column grew a *second* column under it whenever PSD Edit
mode was up — a rail whose buttons moved under your hand.

Two columns now, and **which end of the screen a column hangs from** is the
distinction the gap was carrying (`editor/tool-rail.ts` builds both and keeps
one pressed state across them, because only one tool is ever in hand):

| Column | Where | Tools | What they have in common |
|---|---|---|---|
| rail | hangs from the top left | Select, Pan, Point, Boundary | what you do *to* the canvas: the camera and the pointer, then the two that make something out of bare ground — nothing already on it can be promoted into either |
| draw | stands on the bottom left | Pencil, Pattern, Shape, Slice, Lasso, Fill, Text | the ink |

**Text is the exception on that column**, and it is worth saying why it is
there rather than on the rail. Its gesture is a tap on bare ground, like
Point's, and it is the one tool on the draw column that does not hand the
pointer to the drawing layer. But the columns are about *ownership*, and a word
on the canvas is a note in the margin of the artwork: what it is for is saying
something on the drawing, and the next thing anybody does with one is turn it
into pixels. See *Words on the canvas*, below.

Three of the seven paint with the **library** rather than with a colour —
Pattern always, Shape always, Fill when it is aimed at one — and all three are
set from the same control. See *The pattern and shape libraries*, below.

Four of the seven can be **turned round and used as erasers** — Pencil,
Pattern, Shape and Fill, which is `ERASABLE` in `tool-rail.ts`, the set of
tools that lay a mark down. Slice is not one of them: it cuts a stroke in two rather than
rubbing pixels out, which is a different thing that used to share the name
*Eraser* and now has a knife for an icon. Lasso and the rail's four draw
nothing at all. See *Erasing is a flag, not a mode*, below.

Same class, same 56px buttons, same width: `.tool-rail.draw-bar` is the rail
turned the other way up, and `top: auto; bottom: 16px` is the whole of the
difference. Keeping them the same shape is deliberate — they are one
vocabulary held apart, not two kinds of chrome — and putting the ink at the
bottom corner is the right way round on an iPad, where a hand resting on the
glass is nearer that corner than the top one.

Anchoring the toolbar by its **bottom** edge is the load-bearing bit: a canvas
mode puts a 52px bar along that same edge at a higher z-index, so without a
lift the toolbar sits behind it. PSD Edit mode — whose whole subject is
drawing — lifts it clear; the other three take the pointer outright and it
goes down with everything else. The rail needs none of this, because nothing a
mode puts up reaches the top of the canvas. Two rules in `modes.css`, asserted
in `styles.test.ts`, because a toolbar hidden behind a bar is not an error
anything reports — and so is the `top: auto` itself, since dropping it leaves
the toolbar hanging from the top *over* the rail.

**Every tool is in one of the two columns, and there used to be an exception.**
Rub was a `ToolId` with no button on either — the pencil turned round, rubbing
out PSD Edit mode's own session ink, offered as a toggle on that mode's bar —
and `OFF_BAR` was a second table holding its label so that picking it up did
not look like picking nothing up. Both are gone; see *Rub went, and the four
brushes were already the answer*, below. `tool-bars.test.ts` now asserts the
plain thing: every `ToolId` is in a column. A tool that is in none gets no
button anywhere and a blank label the moment something puts it in your hand,
and nothing else would say so.

## Gesture routing

All pointer input over the canvas goes through one arbiter,
`src/game/camera-rig.ts`, which hands out high-level events. The spec's
contract:

| Input | Result |
|---|---|
| One finger down on the current selection | Drag it, snapped to the grid |
| One finger, moved, under **Select** | Rubber-band a selection from where it went down |
| One finger, moved, under **Pan** or **Point** | Pan |
| One finger, moved, under **Boundary** | Sweep an outline; on release it becomes a blocking zone |
| Space held | Borrow Pan until it is released |
| Two fingers | Zoom about the midpoint; the remaining finger keeps panning on release |
| Hold ~320 ms, still | Begin a grid selection where the finger is, with its action bar |
| Either of those, in extrude mode | Take hold of a face of the shape, or pull the one already held |
| ⌘ (or Ctrl) held, in extrude mode | Borrow X-ray, so the far side is what a click lands on |
| Tap | Pick the point under the finger, else the image, else the boundary, else the fill, else clear |
| Tap, under **Point** | Put a named place on the space it landed on |
| Double-tap a placed PSD | Open it up into its own layers |
| Ctrl/⌘ + wheel | Zoom (WebKit reports a trackpad pinch this way) |

**Which taps are reported is the tool's too.** Under Select a tap is a hold
that never got to fire — the timer was still pending when the finger came up,
so it neither moved nor stayed. Under Point there is nothing to hold for and
the tap *is* the gesture, so a pointer that went down and came up without
becoming a pan is one. Pan reports none at all, which is what makes holding
space safe over anything: the camera tool picks nothing up.

**The tool in hand decides what a drag means**, through `rig.setMode`. It used
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

### Points, and where a scene starts

A point is a named place: psd-to-phaser's `P | name`, made by hand rather than
found in a PSD. It has no size and nothing to fill, so it is a name and a
position and nothing else, and it is the one thing on the canvas that a **tap**
on empty space makes — which is why Point is a tool where a region Fill is
not. Nothing already on the canvas can be promoted into one, and that is the
whole argument: Fill is an action on a patch of grid you have already
selected, so a tool slot for it would only ever have done nothing.

A **Boundary** is now a tool for the same reason read one step further. One
could always be made from strokes already drawn and lassoed, which is the
right gesture when there is a sketch to promote and no gesture at all when
there is not — an empty patch of ground holds nothing to promote. So the two
sit together at the foot of the rail, and the two routes meet in the middle:
`zonePoints` simplifies a swept outline exactly as `strokesToZonePoints`
simplifies a drawn one, and both are named by the same counter, so a boundary
swept with the tool and one converted from a sketch of the same shape are the
same document object. The tool's own half is thin on purpose —
`beginZone` is the lasso's sweep with a different ending, and it hands the
raw polygon out rather than simplifying it, because how coarse a boundary may
be is a fact about the *grid* and the drawing engine knows nothing about
grids.

**It is stored as a cell**, where a boundary is world pixels and a placement
is both. A point is put down on a space and dragged a whole space at a time,
so a world position would be a second copy of the same fact: one more thing
for a grid resize to keep in step, and one that Rust would have to learn the
projection to read back. `cellCentre` turns it into a position wherever one is
wanted — the renderer, the picker, the drag — and on a blank project, where a
cell is a pixel, that is the pixel that was tapped.

**A tap picks a point before anything else.** It is the smallest thing in the
document and the only one drawn over everything, so a point standing on a
building has to win the tap or it can never be picked up at all. Its reach is
half a tile height, which is a finger's worth and less than a space, so
nothing else is caught by it. And the pick is the *nearest* rather than the
front-most, which every other picker answers: two markers close together are
two dots a finger lands between.

**The marker is drawn twice**, a light halo under the accent. Everything the
editor draws is the accent — and the first point anybody puts down goes on a
fill, which is the same accent. A red ring on a red patch is not a marker.

#### The start point

One point per scene can be where play begins, and that is stored as
`Scene.startPointId` — an id on the *scene*, not a flag on the point. The
difference is the whole design: "only one" is then a fact about the document
rather than a rule something has to enforce, and naming a second point is the
first ceasing to be it, with nothing to clear and nothing to go wrong halfway.
It also survives renaming and moving the point, because an id is neither.

Two things clear it, and both write in one commit so a scene never names a
point that is not there for even one `change` event: deleting the point, and
deleting the layer holding it. Duplicating a scene translates it through the
same map that gives the copy's points their new ids — an untranslated id would
leave the duplicate starting on a point in another scene.

It reaches the game as `spawn`, the field both scaffolded scenes have read
since they were written: `game_config` resolves the id to its cell, or falls
back to the origin for a scene that names none — or names one that has been
deleted, which is the same thing honestly reported. So designating a start
point is that field answering differently, and every project's own
`spawnCharacter` follows without being touched. The points themselves travel
too, in `layers[].points`, so a door or a trigger is a matter of reading back
the one you named. `span_for` counts them: the span is also how far the
character may walk, and a start point outside it would put the character
outside the world on the first frame.

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

### ⌘ and ⇧ pick, on both surfaces

The marquee was the only way to make a `placements` selection, and it asks a
question about *where things are standing*: a rectangle. That is the wrong
question for the two things there are now to do with several files at once —
grouping them and merging them — because those are about which files they are.
Three trees in a wood are not a rectangle, and a marquee round them takes the
fence as well.

So **⌘-click and ⇧-click pick**, on a row in the layer panel and on the canvas
alike, and they go through one file — `lib/unit-select.ts`. It is `lib/` rather
than `editor/` for a reason that is not filing: nothing in `game/` imports from
`editor/`, and a second copy of this arithmetic on the canvas side would be two
answers to *what does a toggle leave behind* waiting to drift apart. Ctrl
stands in for ⌘ the way it does for undo, so a keyboard with no Command key is
not locked out.

**What is picked is a unit**, not a placement (see `lib/units.ts`), so
everything there works in whole units and flattens to placement ids at the end,
which is what the document and the canvas both speak. ⌘-tapping a tower's roof
adds the building; otherwise the selection would hold half a tower and a drag
would tear it apart. **One layer's worth**, like the marquee's, and for the same
reason: `placements` carries a single `layerId` because a drag moves every
member by the same cell step. Picking on another layer starts again there rather
than growing a selection spanning two — which is also the only reading the panel
could *draw*, since the rows it would light up are under a different heading.

**The modifiers mean slightly different things on the two surfaces**, and that
is not a compromise. A list has an order, so ⇧ on a row takes the **run**
between the last plain tap and this one, and wins over ⌘ when both are down —
⌘⇧-click everywhere else means *add this run*, which is what unioning the range
with what is held already does. A canvas has no order for a run to be measured
along: the things in it are at positions, not at indices, and "everything
between that tower and this one" names no set anybody could predict. So there ⇧
and ⌘ are one gesture, *and this one as well*, which is what every canvas editor
does with them. `pickMode` takes a flag and is the only place that differs.

**Two things a modifier does not apply to**, both silent when wrong. A ⌘-tap on
**bare ground** keeps the selection rather than clearing it: the modifier says
*as well as*, and clearing is indistinguishable from a mis-aim. And a ⌘-tap on
anything that is **not a placed PSD** — a fill, a boundary, a point, a note — is
read as a plain tap, because `placements` is the one multi-selection the
document has and there is nothing for those to be added to.

There was a **⊕** on each row for a while, on the grounds that an iPad has no ⌘.
It is gone: it was a column of plus signs down a list of files, which reads as
an invitation to add files, and it was chrome standing in for a keyboard that
most of the time is attached. The iPad answer is the marquee and the row itself.

Three details are the ones worth a test, because each is invisible when wrong:

- **A single pick is a `placement`, not a `placements` of one.** Almost
  everything about a placed PSD — the inspector's file panel, resizing, opening
  it up into its own layers — is about one thing, and would have to ask "is
  there exactly one?" on every line otherwise. `selectionOf` is where the count
  decides which kind, and an empty set is `none`: ⌘-clicking the last held row
  clears the selection rather than leaving a panel describing zero images.
- **A row is held when any of its placements is**, which is the rule
  `isSelected` already draws the highlight by — the canvas selects whichever
  layer of a file the pointer landed on. So ⌘-clicking a three-layer PSD the
  canvas caught by its middle layer takes the whole file out rather than adding
  it again.
- **The anchor stays where it was through a ⇧-click**, so a run can be
  stretched and shrunk from the same end. Walking it along with the click is
  the bug nobody notices until they have lost the selection they were
  adjusting.

The anchor is panel state, dropped when the scene changes or when a run is
started on a different layer — a fact about the last row somebody tapped, not
about the document. The canvas passes `null` for it, because a run is a list's
idea and goes with the list.

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

## Editing a PSD, and getting it back

A PSD lives inside the project's own store, so there was nothing for a
re-parse to find that was not already parsed. The round trip is two commands
instead.

`open_psd` goes out through the opener plugin's *Rust* API rather than the
frontend one, so the webview never needs a filesystem scope over the store —
the only path it can ask for is one built from a project id and a PSD key it
already holds.

The way *out* differs by platform, and `platform` is what decides. On desktop
the editor opens the file where it lies in the store and saves over it, so the
file on disk is already the edited one. On iPadOS an app cannot hand another
app its document and get the edits back, so the file goes out through the
share sheet (`navigator.share` with the bytes from `read_psd_bytes`, or a copy
saved through the document picker where the sheet refuses files) and has to be
picked to come home: `reimport_psd` writes it over `<project>/psd/<key>.psd` —
the stem is forced to the existing key, which is what makes it an overwrite
rather than a second import — and re-runs psd-to-json, which clears the old
`assets/<key>/` first.

The way *back* is the same button on both, and it says **Re-parse**. What
differs is only whether it has to ask first. Desktop does not — the file never
moved, so `reprocess_psd` is the whole of it. Mobile asks, because three of
its four answers are a replacement arriving from somewhere.

**The fourth answer was missing, and it was the one a desktop takes for
granted.** The mobile button was called *Re-import* and offered only the three
replacement routes, which made re-parsing in place a thing only a Mac could
do — and there is nothing platform-shaped about it. `reprocess_psd` reads
`<project>/psd/<key>.psd` and runs the pipeline; the file is in the app's own
store on both. Plenty rewrites it without anybody going near Photoshop: Apply
in PSD Edit mode, an extrusion, a layer stack rewritten in the inspector, a
project restored from a `.idlewild` archive. Any of those can leave a manifest
describing the version before it, and on an iPad the only cure was to go
hunting in Files for a copy of a file that had never left. *Re-parse this
file* is now the first row of the sheet, and it is its own runner rather than
an `ImportResult` faked up to fit the import one — nothing is written and
nothing is picked, so there is nothing to report but the manifest.

**Which picker, and why it has to be said.** The other three rows ask *where
the file came back from* — Files, the photo library, or the clipboard — rather
than guessing. Getting "Files" to actually mean Files took two goes, so the
rule is written down here: **on iOS the filters decide, not `pickerMode`.** The plugin
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

psd-to-phaser has **two** loading paths and they name textures differently, and
which one is used is the whole of this section.

`p2p.load.load` keys a sprite on `layer.name` alone: a PSD keyed `tower` holding
`S | roof` produces a texture called `roof` and nothing called `tower_roof`. So
two PSDs with a same-named layer share one texture. That is not a corner case —
`New layer` names its rows `layer-1` upward, *counting within each file*, so two
files that each have one collide by construction. And Phaser's loader **silently
drops** a file whose key already exists (`LoaderPlugin.addFile` consults
`keyExists` and simply does not queue it, with no event and no error), so the
first file's artwork answered for the second and nothing anywhere said so. What
it looked like was a pattern layer scattering the object layer's picture: the
pattern's element had no texture of its own, `place` found the name already in
the cache, and the other file's artwork went everywhere.

`p2p.load.loadMultiple` keys it `<psdKey>_<layerName>` and sets an
`isMultiplePsd` flag that `place` reads back, so both halves agree about the
name. **Every load this editor makes goes through that path**, with one config
in it — see `game/psd-loader.ts` — and `lib/manifest.ts`'s `textureKey` and
`scopeKeys` are the one place that spells the key. `canPlace` asks the same way
round, because asking the unscoped question answered *yes* about a layer whose
name another file happened to share.

What that costs is a **microtask**. `loadMultiple` loads each `data.json`, then
queues the images from a `Promise.all().then()` — and Phaser emits
`filecomplete-json-…` synchronously and then checks its queue in the same tick,
so the pass is declared finished and `create` runs before that callback lands.
The editor does not care: it awaits the plugin's own `psdLoadComplete`, as it
always did. The exported game's scene *did* care, because it placed the document
from `create`, so the scaffold places it from `psdLoadComplete` instead and
`placeDocument` returns early until then. A pattern layer needs no such care: it
places what the camera can see every frame and retries what it could not.

Two smaller consequences:

- **The manifest is cached under `<key>_temp_json`, not `<key>`.** A load has to
  watch for the failure of that key rather than of the PSD's, and — the trap —
  `load.json` on a key the cache already holds is dropped with no event at all,
  so a stale entry is a reload that waits out its whole timeout with the file off
  the canvas. `evictPsd` clears both.
- **Masks stay unscoped**, because `<name>_mask` is what `place` looks one up by
  on *both* paths — scoping one would be a texture nothing ever asks for. The
  multi path does not fetch them either, so `loadPsd` queues them itself after
  the main load, which is the behaviour being preserved rather than traded away.
  A mask can therefore still be shared between two files with a same-named
  masked layer, which is why `evictPsd` still takes the project's other PSD keys:
  a mask another loaded file is using has to survive this file being dropped.
  The artwork needs no such care now, and a `<key>_*` sweep is exact rather than
  a guess.

The old shape is worth keeping on record, because it is what the second half of
`evictPsd` still exists for. The names had to be read out of the plugin's own
parsed data before it was cleared rather than derived from a convention, and
three shapes removed per name — `name`, `name_mask`, `name_tile_<col>_<row>` —
then filtered against every *other* loaded PSD's names, so a name still in use
elsewhere was left stale rather than blanked. Miss one and the reload hangs: the
plugin counts its own assets in and waits for a `filecomplete` that never fires,
`psdLoadComplete` is never emitted, and `loadPsd` sat on its fifteen-second
timeout and placed a PSD whose textures had all been evicted and never replaced.
`loadPsd` no longer hangs when it meets that, because the loader going idle
settles the wait as a second, weaker signal, and any sprite left without a
texture is named in the console.

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

Three things about a PSD layer reach the game, and the inspector edits all
three: order is draw order, the name carries the pipe convention — so renaming
`S | tower` to `T | tower` is what turns a sprite into a tileset — and the eye
decides whether it is drawn at all. None of them is worth a round trip out to
Photoshop and back.

`src-tauri/src/psd_layers.rs` reads the stack and rewrites it,
`src-tauri/src/psd_rebuild.rs` turns an edit list back into a file, and
`src/editor/psd-layers.ts` is the list — with `psd-layer-row.ts` for a row,
`psd-layer-owner.ts` for whose names the app owns, and
`psd-layer-actions.ts` for the buttons around it.

**Every button about the file is one row over the list.** Adjust layers used
to be a note near the top of the inspector, beside the filename; Open PSD and
Re-parse were at the very bottom, under the stack. Three buttons about the
same file, in three places, with the list they are all about in between. They
are one row directly above it now, and what is left where Adjust layers was is
the sentence saying which state the canvas is in — a fact rather than a
control. The list is built once per key and kept across the inspector's
re-renders, so whether the canvas has the PSD open is *pushed in*
(`setAdjust`) rather than read: it changes without the file changing, because
a double-tap on the canvas opens one up.

**A rename is a full rebuild.** The `psd` fork has no way to edit a layer
record in place — it writes a file by rebuilding it from RGBA — so a rewrite
preserves only what `LayerBuilder` can express: pixels, position, name,
opacity, visibility, blend mode, and the nesting `GroupBuilder` puts back.
Layer masks and clipping masks are none of those, and a file using them would
come back flattened, having quietly lost work someone did in Photoshop. `read`
reports such a file `writable: false` with a sentence saying which layer and
why, and the list is shown read-only.

**The list is a tree.** `Psd::layers()` is a flat run of the layers *inside*
things and the groups holding them live in `Psd::groups()`, appearing in
neither — so the list the inspector shows is assembled in `psd_layers::rows`,
in the order Photoshop's panel reads: a group where its topmost child is, then
its contents indented under it. Both halves go through that one walk — `read`
to describe the file, `write` to resolve which row an edit names — so the two
cannot disagree about what row 3 is. `items` is what interleaves them: layers
come top-first by index and groups come bottom-first by id, but a group can be
placed in the layer index space (it sits where its topmost child does), and
sorting on that is the panel's order.

An edit carries its `depth` back, and `nest` reads the flat run of rows into
the tree those depths describe — a row belongs to the last row shallower than
it, which is exactly what the indent is saying. A depth more than one step
past its predecessor is taken as one step, because the list cannot show a gap
and so there is no gap to honour.

**A drag moves blocks, and only among siblings.** `src/editor/psd-layer-tree.ts`
is the arithmetic, kept apart from the panel and tested without a DOM:
`blockLength` is a row plus everything indented under it, `siblingSpan` is the
run either side of a row that never goes shallower, `dropSlots` is the start of
each sibling block plus the end of that run, `moveBlock` does the move, and
`hiddenBy` is the same reading of the depths from the other side — which rows
a set of folded groups takes off the screen.
Two rules fall out of it. Dragging a group takes what is inside it — a group
torn away from its contents is not an edit anyone meant to make. And the last
slot is the *span's* end rather than the list's, so a part cannot be dragged
out of its group and a mark cannot be dragged into one; re-parenting is a
different gesture and is not offered yet.

The panel keeps the order in `this.rows` and redraws from it, rather than
shuffling rows in the DOM and reading the order back as it used to: a block is
several elements, and moving them one at a time is a way to end a drag holding
half of one. The block goes to the *nearest* slot rather than whichever one
the pointer has crossed, because the slots open to a block are not every row
boundary — a rule about passing the midpoint of whatever sits under the
pointer would refuse to commit while the pointer was over a group's contents.

**A folded group's rows stay in the list.** They are rendered `hidden` rather
than left out, so the model and the DOM stay one to one and the drag can go on
indexing one against the other; only `slotY` had to learn about it, looking
past a hidden row to the first one with a box to measure. The separator moved
from each row's bottom edge to its top for the same reason — the first row
always shows and the last one may not.

The fold sits on the group's **second line**, beside `group · 3 layers`,
rather than beside the grip where it would push the name over too: a heading
further right than the rows beneath it reads as being inside something itself.
Which groups are folded is held by the name the file holds them under, not by
index, because the list is re-read on every rewrite and every re-parse and an
index means something different after each of those. The name as *read* rather
than as typed, so a group does not spring open mid-rename; Apply moves the
fold to the new name.

Three details in that rebuild are silent when wrong, and each cost a test:

- `layer.rgba()` returns the layer composited onto the **whole canvas**, not
  its own rect. `crop` reads a window out of it, and anything hanging off
  the canvas edge was never in the buffer to begin with. Those *pixels* are
  gone whatever it does; the **rectangle** is not, and it is load-bearing, so
  what `crop` hands back is the layer's own rect with the part that is off
  the canvas returned clear. Clamping the rect instead is what made a rename
  eat a sketch's anchor — see *A rewrite may not lose a row*.
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

### A rewrite may not lose a row

Apply, New layer and PSD Edit mode's Apply are all the same rebuild, and the
rebuild used to drop any layer with nothing left of it after the crop. That
read as a rule about pixels and was really a rule about *rectangles*, which is
how it came to delete a mark.

`P | anchor` is a twelve-pixel dot centred on the anchor, and `psd_marks::
layout` sizes the canvas from the artwork and the footprint — not from the
anchor. A sketch's footprint is measured from its anchor space *down*, so the
anchor lands on the very top edge and six of the dot's twelve pixels are above
the canvas; and when the anchor space is not one of the spaces the ink covers
— an L, a diagonal, anything whose bounding box has an empty corner — the
whole dot is above it. Neither is a problem for the file as written: the psd
fork records the rect it was given and psd-to-json reports the point's centre
from that rect, negative top and all.

It was a problem for the rebuild. Clamped to the canvas, the edge case came
back six pixels tall with its centre three pixels lower — every placement of
that file three pixels out, once, silently — and the far case came back not at
all. What the console then said was `came back with no "P | anchor" — holding
it where it is`, which reads like a file somebody flattened in Photoshop
rather than like a rename in the inspector, and no re-import fixes it because
the mark is gone from the file on disk.

So `crop` keeps the layer's own rectangle and clears the part that is off the
canvas, and a row whose rectangle is empty outright keeps its place as the
same single clear pixel `add` writes. Nothing a rewrite is asked to carry
across comes out the other side missing.

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

## Layer visibility

A layer turned off in Photoshop was drawn anyway. Visibility was *read* — the
Rust side has had `PsdLayerInfo.visible` since the list existed, and a rebuild
has always carried each layer's eye across — but it stopped there: psd-to-json
never wrote it into the manifest, so nothing downstream could know.

**The PSD is the truth, and everything else is a copy of it.** Not the
document: a placement belongs to a *scene*, and a hidden layer is a fact about
the artwork, so keeping it in the document would let two scenes placing one
file disagree about what it looks like. Photoshop shows it, psd-to-json
reports it, the editor and the game read it, and the eye column writes it back
— one answer, four readers.

**Hidden is about drawing, not about existing.** The asset is exported, the
entry is in the manifest, the object is made, and it starts turned off. That
is what makes it useful in a game — `this.P2P.get(...)` finds the thing and
your own code turns it on — and it is why `psd_pipeline.rs` asks psd-to-json
for `hiddenLayers: "include"`. Skipping would put the file and the document
out of step: a layer the inspector still lists, with no asset behind it.

It is also what lets the two orienting marks be written **off**. The anchor is
read back out of a hidden layer on every import and every re-import — see
**The marks arrive turned off** — which only works because a hidden layer is
still processed, still in the manifest, and still reported at the position it
really holds.

### Four places it has to be carried

- **psd-to-json writes `"visible": false`,** and only when false — beside
  `alpha` and `blendMode`, which are likewise only written when they are not
  the default. A missing flag reads as true, so no manifest written before
  this means anything different than it did.
- **A group carries only its own answer,** which is what Photoshop's panel
  shows: a lit eye on a layer inside a folder that is switched off. Carrying
  it down is the reader's job, and `lib/manifest.ts` does it once on the way
  in — `ManifestLayer.visible` is the *effective* answer, so nothing
  downstream has to walk back up a tree it no longer has.
- **A placement caches it,** as it caches `order`, and for that reason: the
  document is what the game's config is generated from, and once a placement
  is in it nothing says what the manifest said. `hidden` is this layer's own
  answer; `hiddenParts` names the layers *inside* it that are off, because a
  group is placed **whole** and a hidden child of one cannot be expressed by
  leaving a placement out. Both are refreshed on every place and every
  re-parse, and both clear when the file says so — `placedVisibility` returns
  explicit `undefined`s rather than leaving keys out, because the patch is
  spread over a placement that may still carry the last parse's answer.
- **The canvas and the game turn pieces off by name,** which is the only
  handle a placed object has on where it came from: psd-to-phaser calls
  `setName(layer.name)` and nothing else. Two layers sharing a name inside one
  file are therefore one answer — the manifest addresses layers by name too,
  so that ambiguity is the file's rather than the reader's. It is applied
  *after* the placement's own visibility, never instead of it: the plugin
  forwards one `setVisible` to every child of a group, so showing the group
  shows all of it again.

### The eye is staged, and previewed

Clicking it does not rewrite the file. A rewrite is a rebuild and a whole
pipeline run — far too much to hang off a click, and the same reason a rename
waits for Apply — so the eye joins the pending edit and one Apply covers a
handful of clicks.

A staged edit you cannot see is one nobody can judge, though, and the canvas
can show it for free. So the panel hands the scene the manifest names it is
showing as off, and `DocRenderer.previewVisibility` draws that instead of the
document — for one key, which is all the inspector can have open. It is **the
whole answer while it is set**, not an addition to the document's: a layer
staged back *on* has to come back, and a preview that only added would never
let it. Apply clears it, and so do Revert and leaving the panel, because a
preview belongs to the panel showing it.

### The eye a regenerated layer comes back with

A second extrude Apply rebuilds the artwork group from the solid, and a fresh
`LayerBuilder` starts lit — so turning the lines of a block-out off and then
carrying the shape further out used to switch them back on. `parts_group`
reads the eye off the file it is replacing, by name, the same way the marks
and the parts themselves are found on every re-parse. Everything else about a
generated part is regenerated on purpose; its eye is the user's.

The two marks are regenerated on a second Apply too, and they take the same
rule with one difference: `mark_lit` reads the file's own answer and falls back
to `MARKS_LIT` — **off** — rather than to lit, because that is what a file
written from scratch gets. It matches by predicate rather than by name, since
the footprint carries its size in its own name (`Z | grid-4x2`) and a second
Apply over more spaces renames it.

Every other rewrite was already safe, for one reason: an edit that says
nothing about visibility leaves it alone. `LayerEdit.visible` is an
`Option<bool>`, `None` means keep, and `LayerEdit::keep` — which a rename, a
reorder, an added layer and PSD Edit mode's paint all go through — sends `None`.

### What a merged group does instead

An `S | name` group, a tileset and an atlas are composited into a single
image, and compositing has always skipped hidden children the way Photoshop
does. There is no separate asset there to export or to turn on later, so a
hidden child of one is baked out rather than carried. That is psd-to-json's
own behaviour and it is left alone; the flag is for layers that are placed
separately.

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

### Where Convert to PSD's ten seconds went

A lassoed sketch took about ten seconds on an iPad, with no indication that
anything was happening. Three separate things were paying for it. All three
numbers below are measured — the JavaScript in a browser against a
1826 × 1412 raster, the Rust in `cargo test` against the 14.6 MB PSD that
raster actually writes — rather than guessed at from reading the code.

**The base64 was built as one string.** `toBase64` concatenated the whole
buffer into a `binary` string and handed that to `btoa`: for a conversion that
is ten megabytes of rope concatenation and a single `btoa` over ten megabytes,
**435 ms** on a desktop machine and several times that on an iPad. Encoding
48 KB at a time and joining the base64 pieces gives a byte-identical string in
**96 ms**. The trick is that each piece is a **multiple of three** bytes long,
which is what makes it encode standalone — base64 turns three bytes into four
characters, so a run whose length divides by three encodes to exactly what it
would have inside the whole buffer. There were three copies of this function;
there is one now, in `lib/ipc.ts`, so every import, paste, drop, extrusion and
PSD-edit write takes the fast path too.

**The file was parsed to read its own size.** `psd_dimensions` read the whole
PSD off the disk and handed it to `psd::Psd::from_bytes` to ask for `width()`
and `height()` — and every conversion calls it *before* `psd_pipeline::process`
parses the same file again, so the file was decoded twice to place it once.
The first 26 bytes of a PSD are its header, and its layout is fixed: `8BPS`, a
version, six reserved bytes, the channel count, then the height and the width
as big-endian `u32`s. So it reads 26 bytes: **17.6 ms → 0.075 ms**, and a
multi-megabyte read off the disk goes with it.

**And the iPad build is a debug build.** `npm run build:ios` is
`tauri ios build --debug`, so without a profile override every crate in the
tree compiles at `opt-level = 0` on the device somebody actually draws on —
including the entire PSD pipeline, which is *all* dependency code: the `psd`
fork writes the file and psd-to-json parses and slices it. `Cargo.toml` now
carries `[profile.dev.package."*"] opt-level = 3`, which optimises the
dependencies and leaves this crate at 0, so a debug build still steps through
app code and still compiles as quickly as it did. On the same sketch, on the
same machine: writing the file **2.16 s → 0.86 s**, and running psd-to-json
over it **2.34 s → 0.13 s**. Four and a half seconds of Rust becomes one.

Two things are left, and both are somebody else's file. The 13.7 MB base64
string crosses the Tauri bridge as JSON; Tauri 2 can take an `ArrayBuffer` as a
raw request body instead, which would remove the encode, the JSON serialise and
the Rust decode together, at the cost of moving the command's named arguments
into headers. And a 1826 × 1412 sketch — a few percent ink on a clear ground —
writes a **14.6 MB** PSD, which says the channel data is going in uncompressed;
RLE would shrink it and everything downstream that has to read it. That is
`PsdBuilder` in the [`psd` fork](https://github.com/laffan/psd), not this
repository.

**And it says so while it happens.** `editor/psd-progress.ts` already had the
sheet — an undismissable panel with a sliding bar and the pipeline's own
`psd-log-line` events under it — for the background writer; the two conversions
use it now. The one thing that had to be added is that `stage()` **resolves
after a paint**, two `requestAnimationFrame`s deep: the rasterise and the
base64 are synchronous on this thread, so setting the text and going straight
into them puts the words up after the wait they describe. The sliding bar is
CSS `translateX`, which runs on the compositor, so it keeps moving through
those blocked stretches.

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

**And that same decode is what crops the transparent field off it.** Copy a
patch of a drawing out of Photoshop or Procreate and what reaches the
pasteboard is a PNG **the size of the document it came from**, with the copied
marks somewhere inside it and nothing but alpha around them. That is the right
answer for pasting back into the same document — the padding is what makes the
patch land where it was cut from — and the wrong one everywhere else: here the
padding *becomes the artwork's size*, so a thumbnail-sized sketch claims a
footprint the size of somebody else's canvas, the placement's handles are
nowhere near the picture, and the PSD written out of it is mostly nothing.

`trim-alpha.ts` takes the box of every pixel with **any** alpha at all —
`> 0` rather than a threshold, so the feathered edge of a brush stroke
survives — and re-encodes just that box as a PNG. Three cases hand the file
back untouched rather than cropped: nothing transparent to take off (the
common one, and it means no re-encode at all), a buffer that is transparent
*everywhere* (a 0 × 0 import is not a better answer than the empty rectangle
somebody copied), and anything that fails — an undecodable paste, a canvas
with no 2D context, an encode that returns nothing. The padding is a nuisance,
not a fault, so the worst case is the behaviour there was before it.

It runs **here**, on the way in, and not in Rust, because the size is needed
on this side: the marks travel with the import and describe where the artwork
sits, so cropping after they were worked out would mark the grid for a picture
that is no longer that shape. The same call therefore answers both questions
at once, which is what keeps the two from ever disagreeing.

What it deliberately does not touch: a PSD, which the browser cannot decode
and which arrives as its author built it; and a **replacement** for a file
already in the project (`importClipboard` with a `key`, and every route
through `reimport_psd`), because a file coming home is held where it is rather
than re-centred — see *A file that comes home without its mark* — so cropping
one would slide the artwork out from under every placement standing on it.

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

### Copying is not pasting backwards

⌘V worked from the day the shell learnt to read the pasteboard. ⌘C did not, so
PSDs only ever travelled one way — into a project and never out of one — and
carrying a file to a second project meant Share PSD, a trip through Files, and
Import from Files at the other end.

**There is no `copy` event to take.** That is the asymmetry, and it is not the
iPad's: the browser fires `copy` for a **selection**, and a placed PSD is not
one. Nothing in the scene is ever the focused element — every pointer handler
over the canvas calls `preventDefault` — and there is no range for WebKit to
serialise, so no event arrives carrying anything out, on either platform. The
keystroke is all there is, which is why `listenForCopyShortcut` is bound
everywhere rather than only where `listenForPasteShortcut` is. `isPasteShortcut`
and `isCopyShortcut` are one reader with two letters now, auto-repeat guard and
all: held down, both keys repeat, and one press is one file.

**It stands down for somebody else's copy**, and there are three of those. The
caret in a field or in the code editor (`isTyping`, as every shortcut here
asks). A range of text selected anywhere on the page — reading a line out of the
console and copying it is a copy of the line, and the drawer is deliberately
selectable. And no PSD selected, in which case there is nothing here to take. So
`onCopy` answers whether it took the gesture and `preventDefault` is called only
then, rather than the listener swallowing every ⌘C over the shell.

**What goes on the pasteboard is a `public.file-url` naming the PSD where it lies
in the store.** That is the first thing `read_file_url` looks for, and the only
route that knows the artwork's real name, which is the whole reason to prefer it:
a `tower.psd` copied in one project arrives in the next as `tower` rather than as
`pasted-<base36>`, because a PSD's bytes carry no filename. It also points at the
file rather than a snapshot of it, so a PSD edited between the ⌘C and the ⌘V
arrives edited.

On **macOS** the bytes go on beside it under `com.adobe.photoshop-image`, the
same type the read prefers, so the same ⌘C pastes into Photoshop as a document
rather than as a file reference. `clearContents` then `declareTypes:owner:` then
`setData:forType:` per type, because `setData:forType:` writes only a type that
has been declared and a write that did not clear first would leave whatever was
there before offering itself alongside.

On **iPadOS** it is the URL alone. `setData:forPasteboardType:` sets one
representation on the pasteboard's first item, and the documented way to offer
several is `setItems:` — so two types there means building an `NSDictionary` of
them or risking the second call replacing the first. The URL is the half that
matters, because the paste this exists for is Idlewild's own and a URL into the
app's own container is one the app can read; *Share PSD* is already how a file
reaches another app there. And the command is deliberately not `async`, for the
same reason `read_clipboard` is not: Tauri runs a synchronous command on the main
thread, which is where `UIPasteboard` has to be touched.

`file_url` is the inverse of `psd_write::source_path` and lives in
`clipboard.rs` rather than beside it, because this is the only thing that needs
it — a path handed *back* by a picker is already a URL, and the store is the one
place a URL has to be built. Everything outside the unreserved set is escaped,
`/` apart, so an app data directory called `Application Support` survives; the
test is the **round trip** through the real decoder rather than the spelling of
the escape.

**There is no webview fallback, and that is not an omission.** A page may put
plain text, HTML and a PNG on the clipboard and nothing else, so there is no
route a PSD could take through it — `copyPsd` is the shell or it is nothing, and
on a platform with no pasteboard this knows how to write it says so rather than
quietly copying a flattened picture instead of the file.

A PSD pasted back into the **same** project is an import under the same name,
which overwrites that key with its own bytes and places a second unit: a copy of
the thing on the grid, sharing the file. That is an *instance*, which is what an
option-drag already makes, and it is the honest reading of copy-and-paste inside
one project.

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
P | anchor   a red dot on the grid space it is anchored to     — under it, off
Z | grid     the outline of the grid selection it was dropped into  — under it, off
```

Neither mark reaches the game. psd-to-json exports pixels only for sprites
and tilesets — a point becomes the centre of its layer, a zone its bounds —
so both are metadata in the running game whatever they are in the file.
`placeableLayers` drops both for the same reason from the other end: placing a
point yields an empty group nobody asked for.

Both go **under** the artwork in the stack and both arrive with their eye
**off** — see **Which way up a conversion's stack goes** and **The marks
arrive turned off**. Neither changes what the editor reads back, because
nothing downstream of here reads a mark as pixels; what they change is the
file's flattened composite, which is the picture Photoshop and the Finder show
for it.

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
| `engine/stroke.js`'s rAF batching (delta #24) | `frame.ts` — one repaint a frame |

Not coming across, because none of it is drawing: the shelf, the pocket,
splits, proof pages, flowcharts, markdown, text and image shapes, brush slots
and their flyouts, theme-tracking colour sentinels, the highlight bake target
and its second canvas pair, and ML Kit handwriting recognition. `DrawingState`
is replaced by `StrokeStore`, which keeps only what the engine needs and
writes through to the game document, so strokes persist with the project and
appear in the layer panel's counts. Hush's load-bearing invariant comes with
it: strokes are immutable once stored.

### Smoothing, which is not the streamline

Two different things, and conflating them is why the slider needed a second
stage. The **streamline** is a fixed part of how the ink feels — `render.ts`
lags the pointer a little so a stamp chain reads as a stroke — and turning it
up does not produce a straight line, it produces a line that trails further
behind the hand. What the slider asks for is something the hand cannot do: at
100, only straight lines.

So `smoothPoints` is two stages. `relax` is Laplacian passes with the ends
pinned, more of them the higher the setting, which takes a tremor out without
moving where the line goes. `straighten` then pulls every point towards where
it would sit on the chord between the two ends — spaced by distance *along*
the stroke rather than by index, so the stamps stay evenly spread as the curve
flattens — and at weight 1 every point lands exactly on that line. The weight
is the square of the setting, so the first half of the slider is nearly all
tremor-removal and the pull towards the line comes in over the second. The
endpoints never move under either stage: a line that started somewhere other
than where the pen went down is a line that ignored you.

It is applied **as the samples are recorded**, in `beginDraw`, not at render
time — so `StrokeStyle` carries it and `Stroke` does not. What the document
stores is the line that was on the screen, the way a ruler leaves a straight
line behind rather than a note saying one was used. It also means the live
preview *is* the result: at 100 the line under the pointer is already the
straight one it will become, which is the only way a setting like this can be
aimed.

### What a stroke can be

`Stroke.mode` was Hush's two — "ink" paints and "highlight" multiplies — and
the drawing toolbar added more, each of which *is* a tool rather than a
variation on one. "fill" is not stamped at all: its points are a closed
outline and what is drawn is the inside of it. "shape" stamps a *library
shape* into a box at each recorded point, which is what makes the Shape brush
lay tiles rather than a line — its points are grid spaces rather than a path.

"erase" is the fifth and it is **legacy**. It used to be the whole of the Rub
tool: the pencil stamped with `destination-out`. Erasing is a flag now, for
the reason below; a stored stroke that still says "erase" is read as an inked
one with that flag set, so nothing drawn before it changed has to be migrated.

Putting all of them in the stroke model rather than beside it is what keeps
them small. A fill previews, undoes, slices, exports and applies through the code
that was already there for a pencil line; a fill that was a new kind of object
in the document would have needed all five written again.

**A fill is not streamlined, and that is the one thing it does not share.**
The streamline is a lag filter over the path a brush is stamped *along*: it
drags every interior sample most of the way towards the one before it, which
is what stops a hand's jitter from becoming a row of stamps at slightly wrong
angles. A filled region has no stamping and no path — it has corners. Running
it over a shape tapped out corner by corner moved every one of them, so what
appeared the moment you pressed Fill was not the shape on screen; on a swept
outline of several hundred samples a pixel apart the same bug was invisible,
which is how it lasted. `renderStroke` therefore hands a fill its own points
and everything else the streamline, and both previews are honest as a result —
neither `fillPreview` nor the point fill's repaint streamlines either, so what
you were looking at is what lands. Pinned in `render.test.ts`, because the
failure draws a perfectly plausible shape.

### Erasing is a flag, not a mode

Every tool that lays a mark down can be turned round: what it *would have
drawn* is what it takes out. A Pattern brush set to erase removes exactly the
lattice cells it would have revealed; a Shape brush takes back the tiles it
would have stamped; a Fill subtracts its own region. That is why `Stroke.erase`
is a boolean beside `mode` rather than another `mode`: what a mark is made of
and whether it is added or subtracted are two independent questions, and the
old "erase" mode answered both at once and could therefore only ever mean *the
pencil*.

**The subtraction is one composite over the finished mark.** This is the
load-bearing part, and it is not an optimisation. Every one of these marks is
several draws that overlap: a stamped stroke lays seven brush tips on any
given pixel at a spacing of 0.15, `drawShape` cuts a shape's holes out of its
own body with `destination-out`, a pattern fills the lattice cell by cell.
Compositing each of those away separately would take a donut's hole out of the
*canvas* along with its body, and would bite deeper wherever a run crossed
itself. So `render.ts` draws the whole mark into the scratch canvas at full
strength and subtracts the result once — the same flatten path a translucent
stroke and a highlighter already used, generalised into `composited()`. The
colour goes into the scratch **opaque** and its alpha is applied to that one
composite, which is what makes a half-transparent colour a *soft* eraser
rather than an uneven one. `render.test.ts` counts composites on the target
for exactly this: one `drawImage` on the target and a pile of them on the
scratch is it working, and a pile on the target is the bug.

There is one guard around the scratch: `scratchBusy`, because there is a
single scratch canvas for the module and an erase composites a mark that might
itself want flattening. A nested use gives the scratch up and composites
straight onto its target, which is wrong only in the overlaps of a mark that
is already being subtracted whole.

**An antialiased edge keeps a quarter of itself, and that is arithmetic
rather than a bug.** `destination-out` leaves `dst x (1 - src)`, so a pixel the
mark covers half of — which is what an antialiased edge *is* — keeps
`0.5 x 0.5` of what was under it. Erasing a shape with the identical shape
therefore leaves a faint tracing of its outline: measured, nothing keeps more
than **64/255**, and it is confined to the edge, with the interior going to
exactly zero. It is what every raster editor does and what the old Rub tool
always did. The fixes are worse than the residue: compositing the mask twice
leaves an eighth instead of a quarter but eats visibly *past* what the brush
would have drawn, and an eraser fatter than its own pen is a more surprising
defect than a faint edge. A hard-edged mark — the Pattern brush's lattice
cells — has no antialiasing to leave behind and comes out clean.

**An eraser previews on the baked canvas, not on the live one.** Every other
tool draws its in-flight mark on the live canvas, which sits *over* the baked
one. An eraser cannot: `destination-out` into a canvas holding nothing takes
nothing out, and a hole in an upper layer only reveals the layer below it. So
an erase in progress is cut into `done` itself, over the pixels it is actually
taking — `Surface.beginErase` — against a backup of the rectangle the mark
covers rather than a clear. Every frame restores what the last one took and
re-lays the whole mark, which is the same "re-lay it every frame" the live
canvas's callers already do; `endErase` puts it back before the stroke itself
lands, or `apply` would stamp the same subtraction a second time.

The backup is the mark's own rectangle in backing pixels, grown in 256-pixel
steps: a stroke covers a few hundred pixels of a canvas four thousand across,
and assigning `canvas.width` reallocates. `repaint` drops it rather than
restoring it — a re-bake writes the baked state from the strokes themselves,
so a backup taken before it describes nothing.

Which tools are turned round is kept per tool, in `editor/tool-routing.ts`,
not on the style: a Pattern brush left set to erase is still an eraser when
you come back to it, exactly as its size and its pattern are still what you
left them. One flag on the style would have made erasing a property of the
*pen*, so picking up the Pencil to draw a line would have found it rubbing one
out. `apply()` writes `style.erase` on every tool change rather than only when
a tool has a patch, because picking Fill up after erasing with the Pencil has
to *stop* erasing.

### The sweep fill is two tools sharing a colour

**Draw** is the gesture it always was: press, run a closed outline, release,
and the inside of it fills. It takes the pencil's smoothing now, for the
pencil's own reason — an outline is a line, and a fill shows the hand's wobble
more plainly than a line does because there is a flat colour on one side of
it. One shared `smoothPoints`, memoised on the sample count the way
`beginDraw` memoises its own.

**Point to point** is the same shape tapped out a corner at a time
(`drawing/fill-points.ts`), and it is the one thing in the drawing engine that
**outlives a gesture**. Every other tool is a `ToolSession`: pointer down,
record, pointer up, done. This one holds its corners between gestures — that
is the whole feature — so the state lives on an object the layer keeps and
each gesture is a thin session over it. A sweep commits on release and cannot
be corrected, so a shape that came out nearly right had to be drawn again from
scratch; this is the half for a shape with corners in it rather than a gesture
behind it.

One gesture, two readings, which is what saves it from being two gestures: a
press near an existing corner takes hold of it, a press anywhere else drops a
new one *and holds it*, so a tap places a corner and a press-drag places it
where the finger settles. A tap on the **first** corner closes the shape and
lays it down, which is how a polygon has been closed since the first drawing
program — and only a corner that was already there, or the tap that starts a
new shape would fill the nothing it landed on.

**Fill, Undo corner and Cancel float beside the shape**, not in the side
panel. They were rows in the inspector's TOOL zone first, and that was wrong
twice over: a shape is built by looking at the canvas, so a button that
finishes it three hundred pixels away reads as one more setting and is never
pressed; and the closing gesture is the kind of thing you only find once
somebody tells you. The bar standing over the shape is what tells you.
`editor/fill-bar.ts` is the bar and its wiring; it shares its placement with
the action bar over a grid selection through `editor/float-bar.ts`, which is
also where the traps in placing chrome over a canvas are written down —
including the one this added, that the tool columns are inside the column the
bar is bounded by, so a bar centred on something near the left edge landed on
top of the very buttons you reach for.

**It stays on the live canvas through everything but a clear.** The wipe that
made it flicker was the drawing layer's `pointerleave` handler, which exists
for the eraser's disc — that is painted on the live canvas rather than being a
cursor, so it has to stop when the pointer leaves. A blanket clear there took
the half-built shape with it every time the pointer crossed into the sidebar,
and the next camera move brought it back, which is exactly what it looked
like. The shape is the one thing on that canvas meant to outlive the pointer,
so it is repainted there instead.

**It survives a change of tool but stops being drawn.** Holding space borrows
Pan, and every tool in this editor can be interrupted that way; losing four
carefully placed corners to a thumb on the space bar would make the mode
unusable. So `setTool` keeps the shape and only `setLayer` and `setFillMode`
clear it — a half-built shape is about the layer it is being tapped out on,
and switching aim mid-shape would leave corners nothing can commit. What it
does not survive is being *shown* while something else has the pointer: a
polygon hanging over the canvas while somebody draws with the pencil is a mark
nothing explains.

It lands as a `fill`-mode stroke, which is what the sweep lands as, so it
reaches erase, undo, export and Apply through machinery that already exists
and knows nothing about how it was aimed — and it lands at the corners it was
given, which took the renderer's streamline off fills to be true. Until then
it is nowhere in the document at all, which is why both the panel's corner
count and the floating bar are told by hand: nothing fires a `change` for them
to hear.

**The colour reaches the shape as it is picked.** `DrawingLayer.style` is a
property with a setter rather than a plain field for this one case: a
half-built shape is already on screen in the colour it will land in, so the
picker — which fires continuously while it is dragged — has to repaint it.
Everything else the style carries is about a stroke that does not exist yet
and has nothing to repaint, which is why it was a field for so long. The
repaint is on the assignment rather than at each of the three call sites, one
of which would eventually have been added without it.

**One `beginLive` per frame, and that is not tidiness.** `Surface.beginLive`
clears the rectangle it last painted before handing the context back, so
drawing the shape and then its corner handles through two calls erased the
shape and left three dots floating over nothing. `fillPreview` therefore takes
a **context** rather than the surface: opening the live canvas is the caller's
job, once.

### Two brushes were wearing each other's names

Brush 2 is the grainy tip and brush 5 the wet, even-edged one — Charcoal and
Marker the other way round from how `atlas.ts` had them labelled. Only the
*names* were swapped. A stroke records `brushId` and nothing else about its
tip, so swapping the masks instead would have repainted every drawing already
in every project; the ids stay where they are and the labels move.

The buttons no longer carry the number at all. Each one shows **the tip it
stamps with**, which is the reading that cannot be wrong about which brush is
which — a brush is a shape you recognise, and "3" is not that shape. It is a
CSS `mask-image` over the button's own colour rather than an `<img>`, and that
is not decoration: the atlases are black with an alpha channel, because the
renderer tints them `source-in`, so drawn as pictures on this editor's dark
chrome they would be black on black. Masked, the tip takes the button's colour
and goes white when the button is pressed, which is the state it has to read
in. The atlas is four **square** variants side by side, so the stamp is a
square box with the mask at four times its width — `mask-size: 400% 100%` —
putting the first variant in it at its own proportions. Both halves are
asserted in `styles.test.ts`: without the size all four variants are squeezed
into one button, and without the square the buttons' own flexible width
stretches the tip, which is the one thing a picture of a brush must not do.
Neither throws.

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

### What a stroke costs, and the five things that were paying for it

The engine came across from Hush; several of Hush's cost model did not, and
each of the five gaps below was on its own enough to make drawing degrade. The
reported symptom was one sentence — *after the first few strokes it begins to
lag badly, and quick strokes crash the app* — and it is two different
quadratics plus an allocation storm plus a texture upload, which is why it is
worth writing out rather than summarising.

Hush tags every one of its own modifications (`grep -rn "Hush delta #"` in
`hush/src/notebook/drawing/engine/`) and its `README-DRAWING.md` lists them
with the measurements behind them. The numbers quoted here are Hush's.

**1. A repaint per coalesced sample, not per frame.** `getCoalescedEvents` is
drained on every `pointermove` — it is the difference between a curve and a
polyline on a 120 Hz Pencil against a 60 Hz frame — so one event hands the tool
four to eight samples. Each of them called `paint()`, and a paint of an
in-flight stroke is: a smoothing pass over *every sample so far*, a streamline
over the result, a clear, and one `drawImage` per stamp along the whole length
of it. So the work inside one frame was the length of the stroke times the
number of samples in that frame, and every repaint but the last was thrown away
unlooked at, because the browser composites once. That is the quadratic people
feel as *a long line gets slower the longer it gets*.

`drawing/frame.ts` is the fix and it is Hush's delta #24 applied to the ink: a
move records its sample and marks the session dirty, and one
`requestAnimationFrame` does the drawing. Nothing is dropped — the samples are
all recorded before the frame runs and the repaint reads the whole list — so
the line under the pointer is the same line, drawn once. Two escapes, both
needed: `flush` for the hold timer that straightens a stroke (nothing is
moving, so nothing else would ask for a frame) and for a gesture ending, and
`cancel` for a session whose ink is about to be handed to the document.

The erase drag goes through the same gate, and it needed it more: every sample
of it re-baked the whole layer.

**2. Every document change re-laid every stroke.** The store fires `change` for
every edit anywhere in the project — a placement dragged, a density typed, a
layer renamed, a scene switched — and the drawing layer answered every one of
them by repainting its whole stroke list. So did finishing a stroke, which is
the one case that *is* about ink: N strokes on the layer meant N re-laid to add
the Nth, which is the other quadratic and the one that reads as *it gets slow
after the first few*.

Hush's first sync-shim invariant is that unrelated mutations cost the engine
nothing, and it is kept the same way here: **by identity**. The hard rule at
the top of this document — document objects are immutable once stored — means
the strokes array is replaced on every edit to it and on no other edit, so
`Surface.apply` can tell three cases apart with reference compares and does the
cheapest one that is correct:

- the **same array**: nothing happened to the ink. Return.
- an array that **extends** the painted one: stamp the new strokes onto the
  backing, over ink that is already there. No clear, no re-lay.
- **anything else** — an erase, an undo, a stroke restyled, a layer switched:
  re-bake.

The append test is a reference walk over the shared prefix and nothing deeper,
which is exactly as deep as immutability lets it be. `setLayer` and the atlas's
own load event call `repaint` rather than `apply` on purpose: the first changes
which strokes there are and the second changes what all of them look like, and
neither is describable as a diff against what is on the backing.

**3. The tinted atlas was a canvas.** `atlas.ts` already cached one tinted
atlas per brush and colour, and the comment over it already said why a canvas
source is expensive — and then cached a canvas. A canvas used as a `drawImage`
**source** is a mutable object, so WebKit cannot keep the texture it uploaded
for it and re-converts the whole 512 × 128 surface on *every stamp*. A stroke
is hundreds of stamps and a repaint is every stroke. Hush's delta #30 is the
answer: promote each tint to an `ImageBitmap`, which is immutable, so repeated
stamps stay on the GPU. Hush measured the difference on a few hundred stamps as
a ~220 ms commit stall. The promotion is asynchronous, so the canvas stays the
fallback for the millisecond before it resolves and for ever on an engine
without `createImageBitmap`; a tint dropped while its promise is in flight
closes the bitmap rather than keeping it.

**4. The streamline was recomputed for every stroke on every bake.** Hush's
delta #26. It is a pure function of the points and the streamline value, and a
stored stroke's points never change — so `streamlineFor` caches on the points
array's **identity**. A `WeakMap` keyed on that array rather than a field on
the stroke, which is where this parts company with Hush: Hush keeps
engine-private copies it can hang a `_streamCache` on, and here a stroke *is*
the document's record and is serialised to `doc.json` as it stands, so a cache
field on it would be written to disk. Keyed on the array, nothing leaks and
nothing has to be cleaned up. The stroke **in flight** is never cached — its
points array grows in place while its identity stays the same, so a cached
answer would freeze the live line at the length it had when the first sample
landed.

Beside it, `relax` was allocating two objects per point per pass. Fourteen
passes over a few hundred samples, on every repaint of a stroke being drawn, is
tens of thousands of short-lived objects a frame — a garbage collector running
inside the gesture, which on an iPad is the half of this that shows up as the
app going away rather than as lag. It ping-pongs two `Float64Array`s now and
builds the objects once at the end. The arithmetic is unchanged and the
existing smoothing tests say so.

**5. The live canvas held 67 MB while nobody was drawing, and cleared all of
it.** It is sized with the done canvas — up to 4096 a side — and it is empty
except during a gesture. Hush's delta #39: it stays 1 × 1 until a drawing tool
is picked and is handed back when one is put down. Keyed on the **tool** rather
than on the first stamp, which is Hush's own warning: assigning `canvas.width`
reallocates the backing store, and doing that inside a gesture drops the
gesture outright on a third of attempts. Picking a tool is a button press,
which is nowhere near one. `beginLive` re-backs as a safety net, and every
other site that touches the live context is a clear — which on a 1 × 1 canvas
is a correct no-op, which is what keeps that from needing a guard anywhere.

And the clear is now the rectangle that was painted rather than the whole
surface. That is Hush's delta #31 read from the other end: what gets uploaded
is the region dirtied, so fully dirtying a 4096² canvas is a couple of hundred
milliseconds of upload however cheap the drawing that dirtied it was. Each tool
tells `endLive` where it painted — a stroke's box grown by the brush, the
eraser's disc, a lasso's polygon — and the next `beginLive` clears that and
nothing else. Omitting the bounds means "clear the lot", which is what a
re-anchor leaves behind: the rectangle is remembered in *backing* pixels, and
re-anchoring is the world-to-backing mapping changing under it.

**Still outstanding**, and named so it is not mistaken for done: Hush's
blit-forward re-anchor (#25), its opacity-swap double buffer (#29/#31) and its
tile index. The first two are about panning and re-anchoring rather than about
drawing; the third pays off on a layer with thousands of strokes, where a
re-bake's bbox cull is currently the only thing narrowing the work.

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

### Instances

An option-drag copies the fill or placement under the pointer and drags the
copy, so the original stays put and the thing under the finger is the new one.

A copied *placement* keeps its `psdKey`. Both then read the same file, and the
two are **instances** of it: the copy costs one `place()` call and no disk at
all, because the textures are already in. What it costs instead is that editing
the PSD edits both, so the inspector says so above everything else — that is the
consequence, not a detail.

**They were called references, and both halves of that were wrong about what
they described.** A reference reads as one object pointing at another, as though
one of five lamp-posts were the real one and the rest were pointers to it; in
fact none of them is, they are five equal instances of a file, and deleting any
of them leaves the other four exactly as they were. And the way out was called
*Remove Reference*, which names a mechanism rather than a result — and not
accurately, since nothing is removed: the file is copied and this object is
pointed at the copy. **Make Unique** is what that does.

`game/instances.ts` answers the one question the canvas and the inspector both
ask — how many things on the grid an edit to this file would reach. In **units**,
not placements: a PSD with a wall and a roof placed once is one thing standing on
the grid, not two. The old count was of placements matching both the key and the
layer path, which comes to the same number for the copies an option-drag makes
and to a different question for anything else, which is why it went unnoticed.
And it is asked of every scene, because `psd/` is one directory per project.

The canvas says it in its own vocabulary: a selected instance is outlined with a
**dashed** box rather than a solid one. A different kind of line rather than a
different colour, because the accent is the only colour this design has, and
because dashed already reads as *shared with something else*. Phaser's Graphics
has no dash pattern, so `dashedRect` walks the four sides a dash and a gap at a
time, starting each side at a corner so the box reads as a box.

#### Make Unique, and why it used to do nothing

`Make Unique` copies the PSD to a key of its own (`<key>-copy`) and repoints
**the whole unit** — every placement of the object you have selected, and none of
the other instances. Whichever instance you were looking at is the one that
becomes its own; everything else still reading the original is left alone, which
is the point of doing it per object rather than per file.

The whole unit is the fix. It repointed the placement that happened to be
selected, and a PSD with a wall and a roof in it stands on the grid as **two
placements of one unit** — so the object came away half-attached: one row read
the copy and the other went on reading the original, an edit to either file still
changed part of both pictures, and which half came loose depended on which row
had been clicked. The duplicate on disk was real, which is what made it hard to
see. Nothing was missing; the two simply stayed linked, and the feature read as
though it had done nothing at all.

A second, quieter half of the same complaint was the texture cache. The copy is
byte-identical, so its layers have the same *names* as the original's — and until
textures were namespaced on the PSD key, a same-named layer meant a shared
texture, so even a correctly repointed copy went on drawing the original's
artwork. See **The texture keys**.

And the copy takes a collider of its own, derived the way a fresh import's is:
until somebody edits one of them it blocks what the original blocks, but it
blocks it as a record of its own rather than as a second reader of the
original's.

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
list — so the destination is said three other ways instead. The row being
carried dims. The folder the release would drop into lights up, or the whole
column does when that folder is the tree's own root. And a **ghost** of the row
follows the pointer, carrying the name being moved and, after an arrow, the
folder it would land in.

The ghost is the one thing pointer events cost: HTML5 drag draws a picture under
the cursor for free, and without one a finger drag on a tree that does not
rearrange looks like nothing happening at all. It lives on `document.body`
rather than in the column, because the column scrolls and clips, and it is inert
to pointers — otherwise it would be the element under the finger and
`dropTarget` would never find a row. All three marks are read from that same
`dropTarget`, so what is highlighted is what the release will do, including
"nothing": dragged outside the column, the ghost says so rather than going
quiet.

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

The tree it copies is laid out as a small web project is:

```text
index.html
styles.css
js/main.js               registers the scenes and starts the game
js/game.config.json      generated — see `game_config`
js/lib/                  Phaser and psd-to-phaser, written in by the exporter
js/scenes/index.js       generated — the scene list `main.js` reads
js/scenes/<Scene>.js     one per scene in the editor, and the author's
js/shared/canvas.js      the document, drawn: loading, camera, fills, placements, patterns
js/shared/character.js   the genre's wiring between the document and what moves in it
js/shared/grid.js        the projection, and the document's geometry
js/shared/…              the genre's own module: navigation.js or physics.js
js/prefabs/character.js  the body, the walk and the artwork — the author's
```

**`js/lib/` is the one directory with nothing behind it in the store.** The two
runtimes are 1.5 MB that would be identical in every project and are already
constants in this binary, so `file_server` answers for them while a project is
played and `publish` writes them into the zip. Everything else is real files the
code modal opens.

**A project made before that layout keeps the one it was made with.** Its
`game/` tree is its own copy, and nothing rewrites a page someone may have
edited — so both halves of the runtime shim answer both layouts. The server
strips `game/js/lib/` or `game/lib/`; the exporter reads the project's own
`index.html` and writes the runtimes where that page asks for them
(`publish::runtime_dir`). `templates::MOVED` does the same job for the code
modal: a Reset asked for `js/grid.js` is answered with the pristine
`js/shared/grid.js`, because they are the same file under two names and the
block ids inside them are identical.

`js/scenes/WorldScene.js` is deliberately **not** in that table. The file that
replaced it is a short one with no blocks in it at all, so answering with that
would not put anything back — a project holding the old thousand-line scene
keeps it, keeps running it, and owns every line of it from now on. Nothing in
`sync_scene_files` touches such a project either: the test there is whether
`js/shared/canvas.js` exists, which only the new scaffold writes.

That file is the document, in the shape `shared/canvas.js` reads it. Everything
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
| a placement's `collider` | the spaces that file blocks, as offsets from its `anchor` |
| `gridSpan` | how far the character may walk |
| `pixelArt`, `roundPixels` | handed to Phaser in `main.js`, and to the camera in `applyCamera` |
| `zoom` | `setZoom` on the main camera, in `applyCamera` |

A placement carries the size it is *displayed* at beside the size the manifest
exported, and the scene divides them — the same `applyScale` the editor's own
renderer does. Sending the ratio ready-made would hide where it comes from in
a file whose whole job is to be read. Without it every import drew at twice
its size, since an import lands at `IMPORT_SCALE`.

`gridSpan` is measured from the content rather than fixed at 24: fills on a
snapping grid are addressed in cells already, and everything else — a
placement, a rectangle fill, a boundary's outline — is in world pixels and
divides by the grid size. It is clamped because it is the bounds a search walks
— one placement a mile from the origin would otherwise hand A\* a world to
cross before it could answer. It used to bound the drawn lattice as well, which
is the reason it is clamped rather than simply grown: the scenes stroked
`(2n+1)²` cell outlines. They draw no grid now — see below — so this is the
walkable bound and nothing else.

**The scenes draw no grid.** The editor's light blue lattice is scaffolding to
build on; a game is the thing that was built, and a published one showing the
editor's guides is a published one that looks unfinished. So there is no
`drawGrid` in either template and nothing calls one. A project scaffolded before
this still has its own copy of that block and still draws it — `game/` is the
user's tree and nothing rewrites it — and deleting the block, or the one line in
`create()` that calls it, is the whole of turning it off.

**A document that will not parse is not a reason to fail the export.** The zip
is still a runnable game, just an empty one, so a corrupt document falls back
to `empty()` rather than aborting with a half-written archive.

**The load is racy, and the templates now say so.** It was not, on P2P's
single-file path: that queues its sprites from inside the handler that parses
`data.json`, Phaser's loader picks up files added during a pass, and `create()`
waits for the queue to drain — checked in a browser against the real plugin,
with the manifest artificially delayed. `loadMultiple` queues them from a
promise callback instead, which lands one microtask *after* Phaser has declared
the pass finished and called `create`. That is the price of having a texture
named after the file it came from, and it is worth paying — see **The texture
keys**. So the scaffolded scene places the document from the plugin's own
`psdLoadComplete` and `placeDocument` returns early until then, and the editor
goes on awaiting `psdLoadComplete` as it always did, because it loads at
*runtime* rather than from a `preload()`.

## Publishing somewhere real, and logging in once

The zip exports hand you a file. These hand the site to a place that serves it:
a directory on a server over rsync, or a branch of a GitHub repository.

### A site is a list before it is a file

`publish::site_entries` answers with every path a published site has and where
its bytes come from — a file on disk, or bytes this code generated. Two things
consume that list: `build_zip`, which writes them into an archive under a
directory named after the project, and `deploy::stage`, which writes the same
list into a staging directory for rsync or git to push.

That seam is the point. Without it the second one would have been the first one
copied and edited, and **a site that was right in a zip and wrong on a server**
is the kind of difference nobody finds until it is live. A `SiteSource::Disk`
stays a path until the moment it is written, because a processed project is
tens of megabytes of sprite sheets and only the three generated files are ever
bytes in memory.

The zip's root directory is deliberately dropped when staging. An archive
unpacks into a directory named after the project; a document root or a
repository branch is already the place the site goes, and publishing into
`public_html/nine-roads/` when the target said `public_html/` would be this
code naming a directory somebody else owns.

### An options vocabulary, which is not this app's design system

The Logins sheet is a settings page, and the modernist system the rest of the
chrome is drawn in — flat, zero-radius, 2px rules, uppercase micro-labels in
Archivo Narrow — is the wrong tool for one. That system is right for chrome
standing over a canvas, where everything is a control and nothing is prose. A
settings page is a list you run your eye down.

So `styles/options.css` departs, on three counts and only three:

- **Rounded groups.** `--radius-md` is `0` everywhere else in this app. A
  settings list reads as cards of related rows, and the corner is what makes a
  group look like a group rather than like four rules in a row.
- **Sentence case in the body face.** No uppercase `--font-label`. A row's
  title is a name, and a name in narrow capitals is a heading.
- **Two lines to a row.** A title and a quiet second line, rather than a key
  column and a value. The second line is where a row says what it is *for*,
  which is the thing a settings list exists to tell you.

Everything else is the system's — the palette, the body face, the accent —
because a settings page that is a different *colour* is a different app.

**Nothing in it names a feature.** The classes are groups, rows, leads, trails;
`lib/options-list.ts` is the matching set of builders, so a page hands it rows
and gets a page back rather than assembling `div`s. Logins is the first thing
built on it and is meant not to be the last: Project Options and the render
settings are the obvious next ones, and they should be able to copy the *shape*
of `publish-accounts.ts` and share none of its content.

### Why New Project is drawn in the settings vocabulary

Logins was the first page built on it and was meant not to be the last. New
Project is the second, and it is the one that shows what the vocabulary was
missing.

It was a stack of `.field`s — a label, a control, and a grey line of
explanation under each. That is the design system's *form* shape and it is the
wrong shape here: a form is a thing you fill in, and this is six questions with
a right answer already chosen for every one of them, which is a settings page.
Nothing about it was a form except the markup.

**The vocabulary had no controls, only reports.** Logins is a list of things
that exist with buttons to add and remove them, so `optionRow` grew a `value`
and `actions` and stopped there. A sheet where every row *is* a control needed
the other half, and that is `lib/options-controls.ts`: a segmented control, a
switch, a number with its unit, a colour swatch, a text box — each sized to
`.option-btn`'s 30px rather than to a form's 42px, because a row is the subject
and a full-size control at the end of one makes the row look like a toolbar.
`optionRow` takes them as `control`, which sits in the trail before any
buttons. `settings-controls.test.ts` pins the sizing and the accent, both of
which fail quietly.

**The explanations went behind a `?`.** Six rows each carrying two lines is six
paragraphs of grey to read past before you reach the one control you came to
change. None of it was thrown away — every sentence that was a `field-hint` is
on the hint beside its row's title — and the hint opens to a **tap** as well as
to a hover, which is the whole reason it is not a native `title`: see the
exception noted under *Where the panel's explanations went*. An iPad has no
pointer to rest on anything, and this sheet is the only place these sentences
are written down.

`hint` is the alternative to `sub` rather than a companion to it. A row with
both says the same kind of thing twice in two places and leaves a reader to
guess which to trust; a page with room for a sentence should use `sub` and no
`?` at all. Logins still does.

**A hint can be a function**, and one is. What the grid scale *means* changes
with the template — under Blank nothing snaps to it, so it is the unit the
character is measured in rather than the size of a space — and the template is
picked two rows above it. A fixed string would be wrong half the time;
rebuilding the row when its neighbour changes would throw away a control
somebody may be part-way through using. So the text is read at the moment the
bubble opens, which is the moment the answer is wanted.

**And the sheet has no title.** It is opened by a button that says *New
Project*, nothing else on the home screen opens it, and a 22px heading repeating
that word spends the best line on the one thing nobody needed telling. The
dialog still carries the name as its `aria-label`, because a modal with no
accessible name is announced as nothing. `openSheet` takes `titled: false` for
it, opt-in rather than default: a sheet reached from a menu of six is not this
sheet.

Two details are load-bearing, and both are asserted in `styles.test.ts`:

- **The tokens are on `:root`, not on `.options`.** That looks like the wrong
  scope for something namespaced `--opt-*`, and it is the difference between a
  single `.options-field` dropped into a panel that is not an options page
  working and drawing a bright border round itself. An undefined `var()` makes
  the declaration invalid at computed-value time and `border-color` resolves to
  `currentColor` — text, not a hairline. The publish destination sheet uses
  exactly one field that way, so this is not hypothetical. A container that
  wants different numbers sets them on itself.
- **The separator between rows is a pseudo-element, inset to where the text
  starts.** A `border-bottom` cannot be inset, and the rule starting under the
  title rather than at the card's edge is most of what makes a list read as a
  list. It hangs off `.option + .option`, so the first row has none without
  anybody writing `:last-child { border: 0 }`.

`optionRow` takes its quiet lines as an array for a reason worth stating: a
server row has two — what it is, and its host key fingerprint — and the
alternative was the caller reaching into the row it had just been handed to
append one. A builder whose output has to be patched afterwards is a builder
missing a parameter.

### Three sheets, and the seam they are split along

Publishing is made of two things that change at different rates, and the first
version of this UI put them on one sheet. That sheet asked where the project
publishes to, offered two zip exports, and had a way through to the device's
own settings — three questions with nothing to do with each other, and the
relationship between the app-wide half and the per-project half legible only to
whoever wrote it.

It is three sheets now, and the split is the seam:

| | What it is about | Whose it is |
|---|---|---|
| `publish-setup.ts` | which repository, which server and directory | the project's |
| `publish-accounts.ts` | which accounts and servers exist at all | the device's |
| `publish-review.ts` | what to send this time | the moment's |

`publish.ts` is the router between the first and the third — no destination
yet means setup, a destination means review — and it is deliberately tiny.
Everything about *choosing where* lives in one module and everything about
*what gets sent* in another; a third that knew both would be the file every
future change had to go through.

**Setup is two columns** because there are two answers, and the column is laid
out login-then-destination, top to bottom, so the relationship is the reading
order. A column with no login yet shows the way through to the list and nothing
else: a repository picker for an account that does not exist is a box that can
only disappoint. There is no *Nowhere* option — a project that publishes
nowhere is a project that has not opened the sheet, and offering it would be
offering somebody the state they are already in.

**The logins are one list**, GitHub accounts and servers interleaved, with the
kind as a chip in the key column rather than as two headings. They are one kind
of thing — a credential this device holds, shared by every project — and two
sections would say they were two.

**A menu opened from inside a sheet was invisible.** `.menu` was `z-index: 40`
and `.sheet-backdrop` is `50`, which held for as long as every menu in this app
came from the header, the code panel's pin or a row in the file column — none
of them reachable with a modal up. The ssh key chooser and the branch picker
are the first two opened from *inside* a sheet, and both rendered behind it:
nothing appeared and the backdrop swallowed the press, so the button read as
broken rather than covered. It is `70` now, above the drag ghost as well, and
`styles.test.ts` asserts it against the sheet and the ghost rather than against
the number — the point is the ordering, not the value. The rules moved to
`styles/menu.css` while they were being touched: a menu is not editor chrome,
and `editor.css` was at the line limit.

**The keys are offered rather than hunted for.** They live in `~/.ssh`, a
directory beginning with a dot, and macOS's open panel hides those. There is a
keystroke — ⇧⌘. — and it is not something anybody should have to know to
publish a website. `ssh_keys::list_ssh_keys` reads the directory, excludes what
ssh keeps there that is not a key by name, and checks the rest for a PEM
header; the sheet offers them on a menu. The file dialog stays for a key kept
elsewhere and opens *inside* `~/.ssh` when there is one, so even that route
starts where the keys are. An iPad has no such directory, answers with nothing,
and gets the dialog it always had.

**The branch box offers and accepts, and says so.** A typo in a branch name is
the least visible mistake in this sheet: publishing to `gh_pages` *succeeds* —
it makes the branch — and then nothing is where anybody looks for it. So the
branches a repository has are on a menu beside the box.

**New branch is a row on that menu**, above the existing ones, and it empties
the field and focuses it. The box has always taken a name that is not on the
list, but a field whose only visible control is a menu of things that already
exist reads as a picker, and a picker is a thing you choose *from* — so the way
to make one has to be somewhere a person looking for it will look. The line
under the box names which of the two is about to happen, in the accent when it
is a branch that does not exist yet: it is the one thing in this sheet that is
about to be *made* rather than chosen.

**Typing must not redraw.** Every field in the destination sheet went through
the same handler as the pickers, which rebuilt both columns — so the input the
caret was in was replaced on every keystroke and the Branch box lost focus
after each character. Nothing a *field* changes alters the shape of the sheet,
so `set` takes a value and updates only whether **Use this** is available,
while `choose` — a kind, an account, a repository — is the one that redraws.
The same distinction stops a render that renders itself: the server column
picks a default during a draw, and asking for another draw from inside one is a
loop.

**The repositories are searched rather than typed.** `owner` and `repo` were
two text fields; a name typed from memory is a name typed wrong and the failure
arrived as a 404 at the far end of a round trip. The token can already see
every repository it can write to, so `github_api::list_repos` fetches them and
`lib/fuzzy.ts` searches them. A repository that can be read and not written to
is **shown and refused** rather than hidden, because an empty list is a worse
answer than a row that says why.

The matching is a subsequence rather than a substring — `iwed` finds
`idlewild-editor` — since the useful thing to type is the letters you remember
in the order you remember them. What makes that usable is the scoring, because
with three letters typed half a hundred repositories are a legal match: runs
beat scattered letters, word starts beat middles, and earlier beats later as a
tiebreak. The one rebalancing that mattered is that a **run has to outweigh a
boundary** once it reaches two characters — with boundaries worth more, `ide`
ranked `i-d-e-a`, three word-starts, above `ideal`, which is the answer anybody
typing `ide` meant.

### A login is the device's, a destination is the project's

This is the whole shape of the feature, and getting it the other way round is
what makes publishing feel like a password prompt.

| | Where it lives | What it is |
|---|---|---|
| **Login** | `publish.json`, beside the project store | the servers you have an ssh key on, the GitHub account your token is for |
| **Destination** | `meta.json`, beside the render options | which of those servers and which directory, or which repository, branch and path |

So adding a second project is naming a directory, not typing a password again.
`project::PublishTarget` is flat with everything defaulting, exactly as
`GameOptions` is: a project that was rsync and is now GitHub keeps what it had
typed for the other one, and every `meta.json` written before publishing
existed reads as *nowhere*.

`server` names a row in **this install's** settings, which is the reason a
target does not travel in a `.idlewild` file — an id from another machine would
name a server this one has never heard of. `meta.json` does not travel anyway,
for the reason in *The format*; this is a second argument for the same answer.

`is_set` is a kind **and** something behind it. A project that picked rsync and
never named a directory would otherwise be offered a Publish that fails at the
far end.

### What the frontend is told, and what it is not

`read_publish_settings` answers with the servers, the GitHub account's *name*,
and whether this platform can publish. **The token never crosses the IPC
boundary.** A secret handed to a webview is a secret in a webview's memory for
as long as a sheet is open, and nothing in the frontend needs it: the deploys
run in Rust. Signing in again is how a token is replaced.

The file is `0600` on platforms that have such a thing. That is a real
trade-off and it is worth stating plainly: **this is not the system keychain.**
Reaching Keychain and its iOS counterpart through Tauri is a dependency and a
platform pair that have not been taken on, and until they are, a token lives in
a file only this user can read, in the directory that already holds every
project's source. Anything that can read it can already read those.

### Neither of them runs a program, and that is the whole iPad story

The first version of this ran `rsync` and `git`, which made publishing a
desktop capability. The reason given was that iOS does not let a third-party
app create a child process — `fork`, `exec` and `posix_spawn` are denied by the
sandbox, `Foundation.Process` is not in the SDK — and that part is true and
permanent.

The conclusion drawn from it was wrong. It is a constraint on **running
binaries**, not on publishing, and every iOS app that does this kind of work
routes around it the same way: by linking the functionality instead of spawning
the tool. Working Copy is libgit2 through objective-git. a-Shell's commands are
dylibs inside its own bundle, loaded by `ios_system`, which exists precisely to
be a `system()` that App Store rules allow. iSH emulates an x86 machine and
implements the Linux syscalls itself, so the `fork` happens inside the
emulator. None of them spawns a process, and all of them run shells and git.

So:

- **GitHub is libgit2**, through the `git2` crate with `vendored-libgit2`.
  `libgit2-sys` builds the C from source for whatever target Cargo is pointed
  at and defines `GIT_SECURE_TRANSPORT` for any target containing `apple`, so
  an iOS build uses the system TLS stack rather than shipping one. The one
  papercut is that git2-rs gates `openssl-sys` on
  `all(unix, not(target_os = "macos"))`, which iOS matches even though libgit2
  will not use it there — hence `vendored-openssl`, so the dependency is
  satisfiable rather than merely unused.
- **The server half is SFTP over our own SSH connection**, with `russh` and
  `russh-sftp`. Raw sockets are unrestricted on iOS — App Transport Security
  governs `NSURLSession` and WebKit, not sockets — which is how every SSH
  client on the App Store works. `ring` rather than russh's default
  `aws-lc-rs`, because `ring` is what rustls uses everywhere and cross-compiles
  to `aarch64-apple-ios` as a matter of routine.

There is no `can_run` any more. Both platforms can.

Two rules hold across both:

- **No secret is ever in a URL or a command line**, because there is no command
  line. The token reaches libgit2 through a credentials callback as
  `x-access-token:<token>`, GitHub's own scheme for a PAT over HTTPS; the ssh
  key is handed to russh as a parsed `PrivateKey`. `deploy::redact` stays as the
  belt to those braces, because libgit2 quotes the remote in some of its
  messages.
- **Nothing hangs.** Neither path can reach a password prompt: there is no
  terminal to reach one on. A credential that does not work fails.

`publish_to_target` is an `async fn`, and that is load-bearing for the same
reason the PSD commands are `(async)`: a synchronous command runs on the **main
thread** — see *One PSD job at a time* — and this one stages tens of megabytes
and then waits on a network transfer. The SSH half is async and is awaited;
libgit2 is a blocking C library and goes through `spawn_blocking`, so neither
parks a runtime thread on a socket.

### And libgit2 needs two libraries that only Xcode has to be told about

Linking libgit2 instead of spawning `git` is what makes publishing work on an
iPad, and it came with a bill that the Mac never presented. libgit2 needs
**zlib**, because a git object is a deflated blob, and **libiconv**, because
`libgit2-sys` compiles `GIT_USE_ICONV` in for every Apple target — it is
`target.contains("apple")` in its `build.rs`, with no feature to turn it off —
so that a path can be precomposed the way HFS wants it. Both ship in the iOS
SDK. Neither was being linked.

**Why the macOS build never noticed.** On desktop, Cargo drives the final link
itself, so the `cargo:rustc-link-lib=z` and `cargo:rustc-link-lib=iconv` lines
those build scripts print become `-lz -liconv` on the command rustc runs. On
iOS none of that happens: the Rust side is a `staticlib`, **Xcode** does the
link, and a `.a` carries no record of the native libraries its objects still
need. So the same tree that links on a Mac fails on the device with a page of
undefined symbols — `_deflate`, `_crc32`, `_inflate`, `_iconv_open` — every one
of them referenced from `libapp.a` and not one of them anything to do with this
app's own code. The error is at the very last step of a long build and names
nothing that appears in this repository, which is most of why it reads as
something being broken rather than as two flags being absent.

Mach-O does have a mechanism for exactly this, `LC_LINKER_OPTION`, and it is
what puts the auto-linked frameworks on that same command. rustc does not emit
those for `#[link]` yet ([rust-lang/rust#121293][autolink]), and ld64 will not
pick them out of an archive member it is not already loading, so it would not
be dependable from a `staticlib` even once it does. The flags therefore go on
the Xcode side.

[autolink]: https://github.com/rust-lang/rust/issues/121293

**`scripts/patch-ios-linker.mjs` is where**, beside the plist one and for the
same reason: `src-tauri/gen/` is not in the repository, `tauri ios init` writes
it fresh, and `bundle.iOS.frameworks` in `tauri.conf.json` cannot express this
— Tauri turns a bare name into `- sdk: <name>.framework` and anything with an
extension into a vendored path, and `-lz` is neither. The alternative Tauri
does offer is `bundle.iOS.template`, a whole copy of its XcodeGen template
carried in this repository to change two lines of it, which is the kind of
second copy this codebase avoids everywhere else.

It writes `OTHER_LDFLAGS` into two files, because they are read at different
times. `project.yml` is the XcodeGen source, so a regenerated project keeps the
setting; `project.pbxproj` is what `xcodebuild` actually reads, so patching it
is what makes the next build work without anyone re-running XcodeGen. Both
edits are skipped when the setting is already there.

**Which is also how this went wrong the first time, and the mistake is worth
keeping.** Tauri does not use cargo-mobile2's project template. It ships its
own, `templates/mobile/ios/project.yml`, and the two disagree about exactly the
line this anchors on: cargo-mobile2 writes `LIBRARY_SEARCH_PATHS[sdk=iphoneos*]`
and Tauri writes `[arch=arm64]` and `[arch=x86_64]`. Anchored on the first,
this matched nothing in the pbxproj — and since the *yml* half anchors on
`ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES`, which both templates do write, the
script patched a file XcodeGen was not going to read again and reported
success. The build failed on the identical linker error, with a tick above it.

Two things come from that. `TARGET_ONLY` takes **any of three** settings
XcodeGen writes for the app target and nothing else, matched on the stem rather
than on a bracketed variant. And recognising *no* configuration is now said out
loud, distinguished from having nothing to do: the script counts the blocks it
recognised as well as the ones it changed, and warns — after the tick, so the
last line on screen is the problem — naming the settings it looked for.

**A build does not undo it.** Tauri writes the development team and the bundle
identifier into the pbxproj on every build, and its editor is line-based — it
rewrites the lines it owns and leaves the rest — so this survives. `tauri ios
init` is the one thing that does undo it, which is why `npm run ios:init` runs
the script straight afterwards. As with the plist, `beforeBuildCommand` means
`tauri ios build` applies it and `tauri ios dev` does not.

The two string transforms are tested in `scripts/__tests__`, against Tauri's
own template as XcodeGen renders it, and against cargo-mobile2's spelling of
the search-path key beside it. That is unusual for a build script here and it
is the one that earns it: the file being edited only exists on a Mac that has
run `ios init`, nobody reads it, and both ways of getting it wrong are silent —
a pbxproj rebuilt slightly wrong is a project Xcode refuses to open, and a
patch that matches nothing is a build that fails exactly as it did before. So
the tests assert the two hard halves outright: everything but the inserted
lines comes back byte for byte, and both key spellings are recognised.

### SFTP, a manifest, and the host key

**rsync is the one tool here with no library form**, and that is the actual
obstacle rather than the sandbox. `librsync` and `fast_rsync` are the delta
*algorithm* — the rolling checksum. The Rust wire-protocol crates, `arrsync`
and `rsyn`, implement the listing and downloading half against `rsyncd`;
nothing implements the sending client. And rsync's protocol is defined by
rsync's source rather than by a specification, so writing the sender is a
project rather than a dependency. libgit2 could simply be linked; rsync could
not.

SFTP over an SSH connection we make ourselves is the same job with the same
outcome. What it costs is the diff *within* a changed file — a changed file is
sent whole.

**What is put back is skipping the files that have not changed**, which is most
of the practical benefit. A publish leaves an `IDLEWILD-MANIFEST` beside the
site listing every file's SHA-256, reads it back next time, and sends only what
differs. Hashed rather than compared by size and modified time, because the
staging directory is written fresh for every publish: every file's mtime is
*now* and says nothing at all. A manifest that is missing or unreadable means
send everything, rather than fail — the worst a mangled one can do is make a
publish send more than it had to, and refusing to publish over a file whose
only job is to be an optimisation would be the wrong way round.

The name has no dot in it on purpose. A hidden file nobody knows about, in a
directory somebody else's web server is serving, is worse manners than an
obvious one.

**Tidy up walks the far end rather than trusting the manifest.** A file the
manifest never knew about is exactly what that switch is for, and a prune that
only removed what it had put there would leave the last hand-uploaded copy of
the site sitting underneath this one for good. It stays off by default: right
for a directory holding nothing but this site, and also how somebody loses a
`.well-known`.

An empty directory is refused rather than defaulted, as it was under rsync and
for the same reason: it would mean the login's home directory, and publishing a
site over somebody's home directory because a field was blank is not a thing to
do.

### The host key, which is ours to check now

Owning the SSH client means owning the check `ssh` would have done, and getting
it wrong here is a vulnerability rather than a bug: accepting any key at all
means a publish can be handed to whoever answers on that address. russh's
`check_server_key` defaults to rejecting everything and says so in its own
documentation; the tempting thing to write is `Ok(true)`, which is that bug.

It is **trust on first use**, with no terminal to ask at. The first connection
records the SHA-256 fingerprint it saw and every connection after it insists on
the same one. `deploy_ssh::trusts` is that decision on its own, in three lines,
because it should be readable without an SSH session around it.

Three details that are not obvious:

- **The fingerprint is captured even when the connection then fails**, and that
  is the case that matters: a refused host key *is* a failure, and the message
  has to name both fingerprints rather than being whatever russh calls a
  rejected key exchange.
- **It is recorded once the connection stands, not once the publish succeeds.**
  A server that then refuses the key has still proved which server it is, and
  being asked to accept the same new host key twice is being asked twice.
- **A certificate is fingerprinted like a bare key.** Checking one properly
  means carrying the issuing authority's key, which nothing in this app has
  anywhere to get, so a server presenting a certificate to a client that knows
  nothing about the authority gets the same trust-on-first-use answer.

Getting past a changed fingerprint takes a deliberate *Forget key* on the
server's row, with its own confirmation naming the two possibilities. It is not
a checkbox on the publish that failed, because that is the shape that trains
people to click through the one warning that mattered.

**The key itself is imported rather than pointed at**, and that is the iPad
again: there is no `~/.ssh` there, and a file picked out of Files hands back a
security-scoped URL that is not readable on the next launch. So the picker
names a file once, Rust reads it, checks it parses with the passphrase given —
so "that is not a key" is said while the picker is still fresh in mind rather
than at a publish — and stores the key. It is parsed again at every connection
rather than kept decoded, because a private key held in memory for the life of
the app is a private key in every crash report.

### GitHub commits onto the branch, it does not replace it

The quick way to ship a built site is to make a repository out of the output
directory and force-push it. Every static-site deploy script does this, and it
works right up until somebody types `main` into the branch box — at which point
their source is gone from the tip of their default branch because a game editor
decided to.

So instead: **shallow-clone the branch, replace what is at the target path,
commit, push.** No history is rewritten, nothing outside the path being
published is touched, and a mistake is one `git revert` away rather than one
reflog away. A branch that does not exist yet is started from nothing, which is
what makes a fresh `gh-pages` work — and the summary says *a new branch* when
that happened, because a typo in a branch name otherwise looks exactly like a
successful publish to a place nobody will look.

`branch_or_default` is `gh-pages` for the same reason: it is the branch whose
whole job is to be a built site, and the alternative default is the one holding
somebody's source.

Replacing rather than merging is deliberate too. A file the site no longer has
is a file that should stop being served, and a publish that only ever adds
leaves a deleted scene's assets live for good. At the repository root that
means everything but `.git`, which is the clone itself.

**The index is built with `FORCE`, on purpose.** `git add -A` — which is what
this used to run — honours `.gitignore`. For a *site publish* that is a trap
rather than a feature: a `.gitignore` on the branch saying `assets/` would
silently publish a game with no artwork in it, and nothing would report
anything. What is staged is exactly what the site is. The index is cleared
first, too, so a file the site no longer has leaves the index with it —
`add_all` only ever adds.

"Nothing changed" is told from "something went wrong" by comparing the new
tree's id against the parent commit's. Two commits with the same tree is
exactly what nothing changed *means*, and it is a better test than the
`git status --porcelain` the shelling-out version used: `git commit` fails when
nothing is staged, and a publish reporting a failure because the site had not
changed is a publish nobody trusts.

### The two panes, and why a publish is no longer all-or-nothing

`compare_target` lists the far end beside the staged site, and `compare.rs`
marks each local file against it. That is what the Publish sheet opens with
once there is a destination, and it is what made selecting possible.

**A publish used to replace everything at the destination.** The right default
and the wrong only option, for two reasons that each show up exactly once: a
file somebody put there by hand vanished without ever having been shown to
them, and there was no way to push one scene's fix without pushing every asset
again. So `deploy_github::apply` copies what was ticked rather than wiping the
path, and `deploy_ssh::push` takes the same selection. The defaults reproduce
the old behaviour — everything that differs is ticked — so pressing Publish
without reading a row does what it always did.

**Removals are offered, not assumed.** A file at the far end that the site no
longer has gets a checkbox on the left pane, ticked to begin with only when the
destination says to tidy up. Deleting is the one thing here that publishing
again cannot undo.

Each half compares with whatever the far end can be compared against, and that
is the whole reason `site_files::scan_with` takes the hash as an argument:

- **GitHub** hands back a **git blob id** per file, so the local side is hashed
  the same way through `git2::Oid::hash_object` — libgit2 doing exactly what
  `git hash-object` does. Exact, and free of a second implementation of the
  `blob <len>\0` framing that would look like the comparison simply not
  working if it were wrong.
- **A server** has no such thing, so the manifest is the comparison. A file on
  the server the manifest has never heard of is **unknown** rather than
  unchanged — the honest answer, and it is ticked by default, because sending a
  file that did not need it costs a second and skipping one that did costs a
  wrong site.

**The manifest a partial publish writes is not the whole site.** It is what was
there, plus what this run sent, minus what it removed — `site_files::next_manifest`.
Writing the full site's hashes after sending two files would tell the next
publish that files it never sent are already there, which is the one way a
manifest causes a wrong site rather than a slow one.

### Two flags, and the bug they were missing

`russh_sftp::SftpSession::write` opens a file with `OpenFlags::WRITE` alone.
That is "open this file for writing", not "make me this file" — so a server
answers `SSH_FX_NO_SUCH_FILE`, and what a person saw was **No such file**
naming the file they were trying to create. Which is to say the server publish
never worked for a site that was not already there, and read as a permissions
problem every time, because the message points at a file and the file is not
the problem.

`Session::put` opens with `PUT_FLAGS` — `CREATE | TRUNCATE | WRITE`. The
truncate is load-bearing on its own: without it, replacing a file with a
shorter one leaves the tail of the old one on the end, which is a corrupt site
that mostly works. It is a named constant so `deploying.rs` has something to
assert, and so the next person to notice that `write` is shorter finds out why
it is not used.

Two things changed around it, both of them about the *message* rather than the
transfer, because the transfer was only half of what went wrong:

- **The target directory is checked before anything is written.** SFTP answers
  the same `SSH_FX_NO_SUCH_FILE` for a write into a directory that does not
  exist, so a missing destination also arrived as an error about a file.
  `Session::require` stats it first and says so by name, with the `mkdir -p`
  that fixes it. It does not create it: making a directory in a stranger's
  document root because a field had a typo in it is not a thing to do.
- **`explain` translates the two status codes that lie.** *No such file* is
  what a server says when the directory above a file is missing, and *failure*
  is what it says for most permission problems. Both get a clause saying what
  they usually mean.

### The shallow clone that broke every second publish

`RepoBuilder` was given `depth(1)`, on the reasoning that a branch's history is
not what is being published and a site's worth of assets is not worth
downloading twice. It made the **first** publish to a branch work and every one
after it fail, because **libgit2 cannot push from a shallow repository**. What
it says when you try is *"a reference that you are trying to update on the
remote contains commits that are not present locally"* — which reads as
somebody else having pushed to the branch, and is really the graft point at the
bottom of the shallow history.

Publishing twice to the same branch is the ordinary case, so the optimisation
went. `RepoBuilder::branch` still limits the fetch to the one branch being
published to, which is most of what the depth was for.

It is worth saying how this was found, because it is the answer to why the
GitHub half had been written twice without ever running. **A bare repository in
a temporary directory is a perfectly good git remote.** Nothing in
`deploy_github` needs github.com except the URL, so `publish_into` takes the
URL as a parameter and `tests/publishing.rs` drives the whole path against a
local one: starting a branch that does not exist, starting one *beside* an
existing `main`, committing onto one that does exist, sending a subset,
removing a file, noticing that nothing changed, and refusing to let a
`.gitignore` on the branch drop the site. No network, no token, and it would
have caught this on the day it was written.

Two things that only the "beside an existing branch" case exercises, and which
are the case a person actually starts from: the clone of `gh-pages` fails
against a remote that *is* reachable and *does* have refs, so the fallback has
to start an unrelated history — and the push of that orphan history must not
disturb `main`.

**A repository with no commits answers 409, not 404.** GitHub's tree endpoint
says *Conflict* for an empty repository, which the comparison treated as a
failure — so publishing into a repository somebody had made a minute ago
stopped at the comparison, before the screen that would have created the
branch. Both statuses now mean the same thing: there is nothing at the far end
yet, which is an ordinary thing for there to be.

### A publish narrates itself

Every step goes out on `deploy::PUBLISH_LINE` as it is reached, and the Publish
sheet becomes that list while the transfer runs. Two reasons, and the second is
the one that mattered:

- A network transfer of tens of megabytes behind a modal that closed on the
  press is a modal that looks like it did nothing. It used to close and write
  to the console, which is right for a zip — over before the dialog has shut —
  and wrong for this.
- **Publishing is five things that fail differently.** Reaching the host,
  agreeing the host key, the key being accepted, SFTP starting, the directory
  existing. A failure with none of them named is a failure somebody has to
  guess at, and "authenticated fine, SFTP would not start" is a different
  afternoon from "could not reach the host".

The same channel carries progress and trace on purpose: what the publish is
doing now is exactly what you want written down when it stops doing it. The
console keeps every line, because a sheet somebody has closed is a record that
is gone.

**"Check it first" is gone.** It was a `dry_run` parameter on the publish and
it answered a question two better things now answer: *Test* on the server sheet
does the five steps before the server is even saved, and the two panes say what
would be sent before anything is. A rehearsal that stages the whole site to
tell you what the comparison already showed you was a slower way to learn less.

### Trying a server before saving it

A server row that has never been tried looks exactly like one that works, and
the first time anybody found out otherwise was in the middle of a publish.
`test_publish_server` takes the details **as they stand in the form** — reading
`key_file` now if one was picked, falling back to the key already stored under
that id — builds a `Server` that is never written to disk, and runs
`Session::open` against it, collecting the lines rather than emitting them.

It carries the existing row's `host_key`, which matters twice: the check is
against the fingerprint this server is supposed to have, and a first visit
during a test is recorded once rather than asked about again at the publish.

The directory box on that sheet is **not saved anywhere**. The destination
belongs to the project, not the server; that field exists so Test has something
to look for, because checking a login without checking it can reach anything is
half a test.

### What cannot be tested here

A transfer wants a server and a repository, and a suite that reached the
network would be a suite that fails on a train. `tests/deploying.rs` pins
everything a bad publish is made of *before* it leaves: the staged site being
the site the zip carries, a staging directory emptied so a failed publish does
not leave its half-written copy for the next one, a directory that would land
on somebody's home, a branch name git would refuse, a path that climbs out of
the clone, the manifest diff sending what differs and nothing else, and a token
surviving into something somebody reads. Those are worth pinning precisely
because the failure they prevent happens on somebody's live server rather than
in this process — and, for `trusts`, because a mistake in it is a vulnerability
rather than a bug.

What is **not** covered by any of it is the iOS build. There is no macOS or
Xcode in the environment this was written in, so `aarch64-apple-ios` has never
been compiled: the crate selection is argued from how `libgit2-sys` and `ring`
behave on Apple targets rather than from having watched them do it. That is the
one claim here to check first on a real device.

## One file per scene, named after it

A scene in the sidebar and a file in `js/scenes/` are the same thing said
twice. Rename *Cave* to *Cavern* and `Cave.js` becomes `Cavern.js`, with the
class and the Phaser key inside it moving too — so `this.scene.start("Cavern")`
means what it looks like it means, and a project's file list reads like its
scene list.

There was one scene file before, `WorldScene.js`, and it placed whichever
scene the editor had open. That was a defensible reading while the config's
`layers` was the open scene's, and it made "a project is several places" a
thing the editor believed and the game did not.

**The name is the hinge, and only one of its four jobs will take free text.**
It is a label in the sidebar, a filename, a class name and a Phaser key.
`game_config::scene_file_name` reduces it to letters and digits with each word
capitalised — *Title Screen* → `TitleScreen` — and `scene_file_names` dedupes
across the project, because two scenes may share a name and two files may not.
A name that reduces to nothing is `Scene`, one that would start with a digit
is prefixed, and `Index` is reserved for the generated list beside them. The
file name rides in the config as `scenes[].file`, which is what the running
game matches its own key against.

**Renaming is told apart from delete-and-add by the previous config.** Scene
ids never change and names do, so the only way to know that *Cave renamed to
Cavern* is not *Cave deleted, Cavern added* is to know which file that id was
in last time — and the config on disk is exactly that record. So
`sync_game_config` reads it before it replaces it, brings `js/scenes/` into
line first, and writes the new config after: a config describing a tree that
is not there yet would be a lie that survived a crash.

What a rename rewrites inside the file is two anchored replacements of the
scaffold's own text — `class Cave extends` and `super("Cave")`. A file whose
class somebody renamed by hand matches neither, keeps what they called it, and
still moves: the path is the editor's to keep in step, and what is inside is
the author's. Deleting a scene deletes its file, because the sheet that asks
already says everything on the scene goes with it and an orphan nothing
imports is worse than a clean removal.

**`main.js` never names a scene.** `js/scenes/index.js` is generated beside
them — an import per scene, the list, and the same list by name — so adding or
renaming one is never a request to go and edit an import. Which scene the game
*opens* on is three unmarked lines in `main.js` that read `config.activeScene`:
Play and Code show the scene you are looking at, an export carries the one you
published from, and pinning it is replacing one expression.

**Projects made before this are left alone.** They have one
`js/scenes/WorldScene.js` and a `main.js` that imports it by name, so a second
scene file beside it would be a file nothing loads and an `index.js` nothing
reads. `sync_scene_files` returns early unless `js/shared/canvas.js` exists,
which only the new scaffold writes.

### A second scene must not reload the first one's PSDs

The one thing that broke when there was more than one scene, and it broke
silently. `loadDocument` hands `config.psdKeys` to `loadMultiple` and waits for
the plugin's `psdLoadComplete` before placing anything — which is right, and
was fine while there was one scene and one load.

With two, the second scene asks for files the game already has. Phaser's
loader **declines a texture key it already holds**: no file is queued, so
`filecomplete-image-…` never fires for it, so the plugin's own completion count
never reaches its total, so `psdLoadComplete` never arrives. The scene sits
blank until the fifteen-second fallback gives up and places the document. Every
test in the suite passes — the file is valid, the ordering is right, the
document is correct — because none of them run the game.

So `loadDocument` filters to the keys `P2P.getData` does not already answer
for, which is the same guard the editor's own `psd-loader.ts` keeps, for the
same reason. Found by opening a scaffolded tree in a browser and switching
scene; see `dump_a_runnable_tree`.

---

## Three exits

Three *files*, that is. Publishing to a server or to GitHub is a fourth way out
and is not one of these, because nothing is handed over — see *Publishing
somewhere real*, above. These three answer different questions, and the
differences are the source PSDs and whether what comes out is a program at all.

| | Carries | For |
|---|---|---|
| **Export site** (`.zip`) | `game/`, processed `assets/`, both runtimes, a generated config | Serving. Nothing in it is what you would edit the project with |
| **Export project** (`.idlewild`) | the manifest, `doc.json`, `thumbnail.png`, `psd/`, `assets/`, `game/` | Opening somewhere else and carrying on |
| **Export Assets** (`.zip`) | the chosen keys' `psd/<key>.psd`, `assets/<key>/…`, or both | Taking the artwork somewhere that is not a game |

A published site cannot give back the file a sprite was drawn in. That is the
whole reason the second format exists, and why `psd/` is in one and not the
other.

There are two ways **in**, and they are not exits turned round. **Import**, on
the home screen, reads a `.idlewild` back as a project of its own, which is what
makes the second row a round trip; **Import Assets** brings artwork into the
project you are in, off the filesystem or out of another project in this store —
see *Import Assets, which is that door inward*. Nothing reads an Export Assets
zip back: what is in one is `psd/<key>.psd` and `assets/<key>/…` under a
project's own name, and a person who has one of those has files a picker can
already reach. The first of the two was called **Open** for as long as it
existed, and *Where it is in the app* below is why it is not any more.

Two of the three exits write a `.zip` and neither round-trips, which is a
sentence this documentation could say and the app could not. Both are now
recognised on the way in and **named** — see *A zip that is not a backup*.

All three are written straight to the path the save dialog returned
(`publish::publish_site`, `archive::export_project`,
`export_assets::export_assets_zip`, each living with the code that builds it the
way `game_files`'s commands do). The site export used to come back across the IPC
boundary as base64 and be written by `save_bytes`; an archive carrying every
processed asset — let alone every source PSD — has no business being a string in
a JSON message first.

### Export Assets, and why it is a row under Export

The other two hand back something only a program can read. What was missing is
the pictures: the sprite sheets a tileset was sliced into, for another engine or
a document, and the source PSDs, so a file drawn on an iPad opens on a desktop.

It stood on the header menu in its own right for a while, which was right when
the alternative was putting it *inside* Publish — nothing about it runs, and it
is not a publish. With Publish and Export split into two verbs it is simply the
third row under Export, beside the site zip and the project file: all three hand
you a file, and having two of the three in one place and the third somewhere
else was the arrangement nobody could have explained.

So the sheet asks two questions and nothing else. **Which files**, as a list with
a checkbox each, everything ticked to begin with because "all of them" is the
common answer and un-ticking three is less work than ticking twelve. And **what of
them** — assets, PSDs, or both — as one segmented control rather than two
checkboxes, because two boxes let somebody tick neither and find out at the far
end of a save dialog.

It lists what is in `psd/` rather than what the document places
(`export_assets::list`). A file whose placement has been deleted is still a file
somebody drew, and artwork is the one thing this export exists to rescue; the
document's own list would quietly refuse to hand back the only copy of it. A file
the pipeline has never run over says so on its row, because it has no generated
half to give.

Inside the archive the paths are **the store's own** — `psd/<key>.psd` and
`assets/<key>/…` under the project's sanitised name — because that layout is
already described everywhere else in this app and a second one invented for the
zip would be a second thing to learn.

A key the project has not got is **skipped**, not failed on: the list came from a
picker, so the only way to ask for a missing one is to have deleted it between
opening the sheet and pressing the button, and losing the other nine files to
that is not a trade worth making. What *is* refused is an archive that would come
out empty — neither half chosen, no files chosen, or every chosen key missing —
because a zip somebody has to open to discover was empty is worse than one that
did not happen.

### The format

```text
<name>.idlewild            (a zip)
  idlewild.json            format, app version, exportedAt, and the project's own fields
  doc.json                 layers, fills, placements, zones, strokes, extrusions
  thumbnail.png            if one has been taken
  psd/                     the source files
  assets/                  psd-to-json's output, so an import opens without a re-parse
  game/                    the project's own code, as it was edited
```

**Extrusions travel in `doc.json`**, and so do every scene and the one that
was open. `GameDoc.extrusions` maps a PSD key to the voxels its solid was
built from and the space it was anchored to — document-level, because a PSD
is the project's rather than a scene's — and an extruded layer's way back into
extrude mode is that record plus the PSD it wrote — the cube in the inspector's layer list, and the shape that opens when
you click it. Both halves are in the archive, and the map is keyed by *file
stem* rather than by anything about this install, so a re-opened project can
still take hold of a face and pull it. `tests/archive.rs` pins that, because a
project that came back without them would look entirely fine right up until
someone tried.

**`meta.json` does not travel.** A project's id is a directory name in *this*
store; carrying one across would be a second source of truth for where a
project lives. The fields worth keeping are in the manifest and an import
writes a fresh `meta.json` around them — new id, the original `createdAt`,
`updatedAt` of now, since the home screen sorts by it and an import you just
made should be the one at the top.

**A format number, not a guess.** An archive from a later build is refused by
name rather than half-read: one that silently dropped what it did not
understand would look like a project that had lost work.

### An archive is a file someone hands you

`CARRIED_DIRS` and `CARRIED_FILES` are read in both directions — an export
puts nothing else in, an import takes nothing else out — and that second half
is the guard. On the way in, every entry goes through the zip crate's
`enclosed_name` (which refuses absolute paths and `..`) *and* that allowlist,
so the five things an archive is allowed to be made of are the five things it
can write. There are ceilings on entry count and unpacked bytes for the same
reason. A hostile zip is a test rather than an assumption
(`an_archive_cannot_write_outside_the_project_it_claims_to_be`).

An import that fails partway removes the directory it was filling: a
half-written project in the list is worse than a failed import. A `game/` tree
that did not arrive is scaffolded, and the config is rebuilt from the document
that did — so an archive assembled by hand still opens.

### Where it is in the app

**Import**, on the home screen beside New Project. The picker is unfiltered on a
touch device and filtered on a desktop, the same split as the editor's Add
Image and for the same reason: iPadOS reads the filter list to decide *which
picker* to show, and an extension it has never heard of is not a reliable way
to ask for the document browser.

**It was called Open, and that was the wrong word.** The button and the command
behind it have existed since the archive format did; what had not happened was
anybody finding them. A grid of project cards is a screen whose entire subject
is opening things, so *Open* beside *Select* and *New Project* reads as "open
one of these", and the one door on the screen that takes a file was the one
nobody saw. The word people go looking for is *Import*, and it pairs with the
editor's own **Import Assets** rather than competing with the cards: one brings
a project in, the other brings artwork into the project you are in. Nothing
underneath it changed — same command, same guard, same tests.

**The desktop filter takes `.zip` too**, because a `.idlewild` *is* a zip and
the extension is this app's private name for one. Nothing on a machine knows
that name, so a backup that has been through mail, a chat client, a download or
somebody's own Compress arrives as `.zip` — and a file the picker will not show
is a backup that has been lost as surely as if it were deleted. Nothing is
loosened by it: `import` has always decided what a file is by looking for a
manifest at its root, never by its extension, so the filter was the only thing
refusing those and it was refusing them for a reason that was never true. The
touch picker is unfiltered and was never affected either way.

`.idlewild` is not declared as a system file type. Doing so without wiring the
open would put Idlewild in macOS's "Open with" for a file it then ignores; the
declaration and the `RunEvent::Opened` / deep-link handling behind it belong
together, and neither has been exercised on either platform yet.

### A zip that is not a backup

"This file has no idlewild.json — it is not an Idlewild project" is true, and it
is no help at all to the person most likely to read it. Export writes three
files and **two of them are zips**; only the middle row comes back. Somebody who
picked *Site* a week ago, called it a backup and is now holding it in front of
the importer is being told their backup is broken, when what happened is that
they exported the other thing.

So a zip with no manifest is **told apart by its shape and named**. Both of the
others unpack into one directory called after the project, so the first path
segment is dropped before anything is read; `.idlewild` has no such wrapper,
which is the same fact that puts its manifest at the root. A site is
`index.html` or `js/game.config.json` — tested **first**, because a site carries
`assets/` too and would otherwise answer to the test below it. An assets export
is `psd/` or `assets/` and nothing that runs. Anything else keeps the old
sentence, because a zip this app did not write is a zip nothing here can name.

Each answer says which of the three the file is, and points at the row that does
open — *Export → Project* for both, plus *Import Assets* for the artwork one,
which is where those files were actually going. `not_a_project` is the whole of
it, and two tests pin the two shapes; a message that drifted off the sheet's own
wording would send somebody looking for a menu item that is not there.

A site is **not** made importable by any of this, and could not be: it has no
`psd/` and no `doc.json`, so there is no project in it to rebuild. Pretending
otherwise — importing one as an empty project named after it, say — would hand
back something that looked like a recovered backup and was not, which is worse
than a refusal that explains itself.

## Import Assets, which is that door inward

Export Assets hands the artwork back. What was missing is the same door the
other way for **more than one file**: Add Image asks for a file, a paste carries
one, a drop lands one, so a tileset drawn as nine PSDs in another project was
nine trips through a picker. So it is a menu item beside Export Assets — neither
is a publish, and both are about pictures rather than about a program.

**Two routes, and they are the two that are not already served.** *Files* is the
filesystem, with `multiple: true`; *another project* is the rest of this app's
store. The photo library and the clipboard are deliberately absent: both are one
image at a time by their nature, and both already have a route of their own in
Add Image and in ⌘V, which is where anybody looks for them.

The sheet is a **list of routes** rather than a form, the way Add Image, Publish
and Re-parse are, because what somebody came here to say is *where from* and each
answer needs something different next. Files needs a picker and nothing else; a
project needs a project and a set of ticks, so that route opens two more steps in
the same sheet. The project list leaves *this* project out rather than greying it
in: copying a file over itself is not what this is for, and a second copy inside
one project already has a route in **Make Unique**, which gives it a name that
reads as a copy of what it came from.

**Neither route is a new import.** A file off the filesystem goes through the
*paste* path — `read_dropped_file` for the bytes, then `importPasted` — and a
PSD out of another project is copied inside the store by
`import_psd_from_project` and placed. Two things follow from that, and both are
the point. Going through the paste path is what gets the **two orienting marks**
written: they describe where the artwork sits on the grid, and the grid is the
editor's, so a file imported by path arrives with no anchor and says *No anchor*
in the inspector ever after. And a PSD copied between projects needs no marks at
all, because it is already carrying its own — the same reason a `.psd` from Files
is copied rather than rewritten.

The cost of the first is that a padded raster is **cropped** to the pixels in it,
as a drop is and as Add Image is not. A drop off Finder is the same file arriving
by another gesture and it is cropped too, so this sides with the gesture rather
than with the sheet. See *A paste is cropped to the picture in it*.

**Nothing is written over.** Everywhere else a name decides a key outright, which
is what makes bringing `roof.png` home a replacement rather than a second copy.
Here a collision is two files that happen to share a name, and quietly writing
one over the other is the one outcome nobody could have asked for — so
`psd_pipeline::free_key` steps to `roof-2`. It is asked for over the bridge
rather than worked out in the frontend, because the rule for what survives being
a filename is `sanitise_stem`'s and a second copy of it on this side would be a
second answer. `next_free_key` beside it is the same question with a different
answer for **Make Unique**: `roof-copy`, a name somebody can follow back.

**Nothing lands on top of anything else.** Twelve files on the space in the
middle of the view would look like one file, so `importAll` steps each one clear
of the last — by the width of what actually landed plus a grid space, in **world
pixels**, converted back to a cell. World pixels rather than a step in `cx`
because on a diamond grid stepping `cx` walks away from the camera rather than
across the screen. A file that failed to import does not move the cursor: there
is nothing standing there to step around. They go one at a time, which the
pipeline would enforce anyway (`psd_pipeline::exclusive`), and each import's own
width is what decides where the next one goes.

**What a copy between projects does not carry** is the *document's* record of the
file: an extruded PSD arrives as its artwork without the solid behind it, and a
hand-edited collider arrives as the default guessed from the footprint. Both live
in the other project's `doc.json`, which is about a canvas rather than about a
file — and the export that does carry them is `.idlewild`, which brings the whole
project rather than one PSD out of it.

The menu's own wiring moved to `editor/header-wiring.ts` with this, the way the
properties sidebar's lives in `inspect-wiring.ts`: two more destinations put
`editor.ts` over the 700-line rule, and a header that only forwards is exactly
the shape that split is for.

## Select, on the home screen

Rename, duplicate and delete have always been a card's long-press menu, one card
at a time. That is right for rename, which is about one thing by definition, and
wrong for the other two the moment there is a shelf of experiments: clearing out
six was six long presses and six confirmations, and the confirmation is the part
that makes it feel like six separate decisions rather than one.

**It is a mode of the grid, not a modifier on a press.** There is no ⌘-click on an
iPad and no rubber band over a grid of cards, so the honest shape is a switch:
while it is on, a tap picks a card instead of opening it, every card carries a box
in the corner of its thumbnail, and the long-press menu stands down. The row that
normally says how to reach that menu carries All, None, the tally, Duplicate,
Delete and Done — the *same strip of screen* either way, so turning the mode on
does not move the cards under the finger that turned it on. The tick and the
disabled buttons are drawn rather than hidden for the same reason.

The mode is read at press time, not captured when a card is built: the grid is
rebuilt on every reload, and a handler that closed over the mode would be a card
built in one mode and pressed in another. Leaving the mode drops what was picked,
because a selection held over no way to see it is a selection that acts on the
next press somebody makes; a reload drops the ids of projects that have gone,
however they went.

`home-select.ts` is the two bulk actions, and both are **sequential**.
Duplicating a project copies its source PSDs and its processed assets, and six of
those at once is six concurrent walks of the same store. A failure part-way
through does not abandon the rest — five copied and one refused is a better answer
than one copied and five silently dropped, which is what a `Promise.all` would
give — and the console says how many landed rather than one line per copy, which
would be the shape of the loop rather than of what was asked for.

A bulk delete **asks once**. It names the projects while the list is short enough
to read and counts them when it is not: "these 14 projects" is a number somebody
can check, and fourteen titles is a wall nobody reads. Declining is answered
differently from deleting nothing — `null` rather than `0` — because the home
screen has to tell "you said no" from "all six failed": the first keeps the
selection lit for another try, and the second has nothing left to keep.

## Testing

`cargo test --lib` covers the load-bearing path: RGBA → PSD → psd-to-json →
manifest → zip, plus the path-traversal guards, the project scaffold, what an
export's config carries, the whole of a layer's eye — an edit hides it, the
file comes back hidden, the manifest says so, a rewrite that says nothing
leaves it alone, and a second extrude Apply does not switch it back on — the shapes a file picker hands back, and the order a
manifest lists a PSD's layers in — which the frontend mirrors and cannot check
for itself. `tests/exports.rs` holds what leaving with a project *takes*, split
from the scaffold tests along that seam: the document in the shape the game
reads, the spaces every placed PSD blocks, a document too broken to read, and
Export Assets — that it takes the files and the halves it was asked for and
nothing else, and that an archive which would come out empty is refused with a
sentence rather than written. The project's options are next door in `tests/options.rs`: that an unticked
character controller scaffolds the **same tree** as a ticked one and differs
only in the config, that it can be turned off and on again afterwards, and
that changing a rendering option rewrites the config the game reads rather
than waiting for whatever touches the document next. `tests/scenes.rs` is the
file each scene in the sidebar is written in — that a name somebody typed
comes out as a class name, that two scenes called the same thing get two
files, and that the three things which can happen to a scene each do the
obvious thing to its file: scaffolded, renamed *carrying what was written in
it*, deleted.

**And one thing no Rust test can reach: whether the scaffold is a working
game.** Every assertion above is about text. A scene that places nothing, or a
second scene that waits fifteen seconds for assets the first one already
loaded, is valid JavaScript and passes all of it. So `dump_a_runnable_tree` is
an `#[ignore]`d test that writes a real tree — both runtimes included —
somewhere a browser can load it, and the way to use it is to serve that
directory and open it. That is how the reload guard in `loadDocument` was
found: switching scenes in a project with PSDs left the second one blank,
because Phaser's loader silently declines a texture key it already holds, so
the completion its scene was waiting on never came. The asset
server is tested over a real loopback socket — the request psd-to-phaser makes,
byte for byte, and what comes back parsed as an HTTP response rather than
inspected as a `PathBuf`, because the mapping from URL to file is the one
place where a wrong answer looks like a PSD with nothing in it. It runs
against the real store and cleans up after itself, including on failure.

`import_assets.rs` carries its own two, which are the contract Import Assets
places against: that a bulk import never writes over a file the project already
has — including when the name only collides *after* the sanitiser has had it —
and that a PSD pulled out of another project lands byte-identical, under a key of
its own, with the pipeline run over it and the file it did not replace still
standing there.

The pasteboard is split so that most of it is testable anywhere: which type to
take, what extension it maps to, what a buffer's own signature says it is, and —
for the write half — that the `file://` URL ⌘C puts on the pasteboard is one
`psd_write::source_path` takes straight back, which is the round trip rather than
the spelling of an escape. All plain functions with tests beside them, and only
the calls that actually touch `UIPasteboard` and `NSPasteboard` are behind a
`cfg`. Those two
compile on no other platform, so on Linux the module builds its "no pasteboard
here" arm instead and the frontend falls back to the webview — which is the
same code path a Windows build would take. `cargo check --target
aarch64-apple-darwin` and `--target aarch64-apple-ios` are what type-check the
Apple arms without a Mac; neither one links, and neither is a substitute for
running it on a device.

`vitest` covers the pure halves — the grid projection, fill geometry,
picking (a point's and both marquees'), what is drawn over what, resize
geometry, what the minimap frames and that the camera is always inside it,
what a manifest says is hidden and what a placement records about it,
undo's three answers about a write and what a restored document is,
what each canvas mode counts as one step of its own, whether a selection still
names something, the unit arithmetic
behind a placed PSD and how many objects share one of its files, which of its
layers have wandered off the space the file puts them on and that putting one
back lands on the pixel the drag picked it up from — asserted by running the
drag first, because the two have to agree and numbers typed out by hand would go
on passing if the drag changed under them — what a ⌘C and a ⌘V are as
keystrokes, how a texture
is keyed and what dropping a PSD's is allowed to reach, that Make Unique moves
every layer of the object rather than the row that was selected, what the
inspector remembers about a folded section, what a bulk delete asks and how it
answers a no, what the clipboard hands a paste and where that paste lands, what a failed clipboard read says happened and which of a dragged
selection of files a drop takes, colour, the log's `%c` parsing, the manifest
reader, the platformer's body step, the docs panel's markdown rendering and
its two kinds of lookup, what a project with no options of its own renders as,
and the drawing layer's ported maths. The handful of CSS declarations that are
load-bearing for input are asserted as text — the drawing surface's
positioning, the code panel's four placements, where a docked rule that
stopped taking the panel out of `position: absolute` would look like a panel
that had covered the editor, the minimap's `touch-action`, without which
an iPad takes a drag on the map as a scroll of the sidebar it is in, and that the
minimap is down in both of the modes that run the game over the canvas.
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
and one boundary, and reads `window.__platform`, `window.__pick`,
`window.__manifest` and `window.__options` so the platform split, the re-import
path and a pixel-art project can be exercised from a script. `window.__projects`
puts other projects in the store, which is what Import Assets' second route
needs to have anywhere to go, and `window.__movedRoof` stands the fixture's roof
two spaces off its walls — the one state in which **Reset Layer Position** is
drawn, and not one a harness with no asset server can reach by dragging. Its query string picks the fixture's template and
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

**The row's two handles are at its two ends.** They used to sit side by side
in one gutter at the left: the grip, the kind glyph, then the collapse arrow,
then the name. Two different questions in one place, and the more dangerous of
the two — a drag that moves a layer through the draw order — was the one a
finger travelling down that edge met first. So the collapse arrow is first on
the row, indented over the contents it reveals and about the rows underneath
it; the grip is last, past the eye and the lock, where the list ends rather
than where it is read from. Nothing about the drag itself changed — the grip
keeps `touch-action: none`, which is what makes a drag on the iPad a reorder
rather than a scroll of the panel behind it.

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

The inspector's PSD layer list is the same gesture over a different list, with
the difference that its rows nest: it moves a *block* through the model and
redraws, rather than moving one element through the DOM. The code modal's file
column is the same again with one more difference: a file
tree has one legal drop per row — into that folder, or beside it at that
folder's level — rather than a position in a list, so the row under the
pointer is highlighted instead of the dragged row being moved through the DOM.

A placed PSD listed under an expanded layer has a grip of its own, and
dragging it carries the image to whichever layer the finger lets go over. Same
gesture, different question: a layer takes a *position* in the list, an image
takes a *layer*, so one moves through the DOM as it goes and the other lights
up its destination. The grip is there for the same reason it is on a layer
row — the panel scrolls, and a row that took the pointer outright would take
the scroll with it. `movePlacements` changes which list the records live in
and nothing else, because a layer is draw order and visibility, not position;
they land at the end of the destination's list, drawing over what was already
there, which is what a drop onto a layer means everywhere else here. The whole
unit goes and the unit survives: the row is the file, so the drop is about the
file.
Only placements are carried: a fill is a run of grid spaces and a boundary is
a polygon, both addressed in world coordinates no layer owns, so moving one
between layers is a change of draw order and the reorder above already covers
it.

## Three zones, not one heading

The right-hand panel used to be headed **Inspector** and show exactly one
thing at a time: the brush while a drawing tool held the pointer, a layer
while a layer was selected, a placed PSD while one was. Three unrelated
subjects taking turns in one box, each hiding the last — picking a PSD took
the layer's facts away, and picking up the pencil took both away.

The heading was the fault. *Inspector* names the furniture rather than what is
in it, so nothing on screen ever said which of the three you were looking at,
and there was no reading of it under which you could look at two. So it is
gone, and in its place are three zones, always in this order:

| Zone | Subject | Shown when |
|---|---|---|
| **TOOL** | what the thing in your hand has to set | the tool has anything to set |
| **LAYER** | the layer the next thing you do lands on | the layer is the subject — see below |
| **OBJECT** | what is selected on the canvas | something is |

The order is the answer the old panel could not give: what is in my hand,
where is it going, what is it on top of. Read down the column and it is the
same sentence every time.

**A zone with nothing in it is never mounted.** `createZone` hands back an
element and a `mount` that refuses when the body is empty, so a tool that does
one thing with one gesture — Select, Pan, Point, Boundary, Slice, the
Lasso — gets no TOOL zone rather than a heading over a sentence that never
changes. That sentence is exactly what the single *Inspector* heading was, and
reintroducing it once per tool would have been the same mistake nine times.

**The zone's heading is the panel's head.** The panels in `inspect-panels.ts`
and its neighbours open with a kicker and a title — *Boundary* over *Boundary
1* — and the kicker is now what the heading carries: `OBJECT : Boundary`. The
first namer wins, so the LAYER zone names itself after the layer before its
panel can name it after the word "Layer", and a title the heading has already
said is not drawn twice. That is one rule in `Zone.name` and one condition in
`Inspector.head`, and it is what keeps the panels themselves ignorant of zones
entirely: they still write a kicker, a title and sections, into whatever body
the surface hands them.

**The name is the quiet half of its own heading.** `TOOL` never changes —
that is what makes it a zone name — so it is set thin and at half opacity, and
the subject beside it, which is the part that answers *which one*, carries the
panel's full text colour. A band dark enough to read as a button would put the
emphasis back on the label rather than on the thing the label is about, which
is the shape of the first version of this and why the tint below is a shade
rather than a colour.

**The zones fold, and that is why they are now marked.** The sections inside a
panel have folded since `inspect-collapse.ts` existed, which left the three
headings that matter most as the only ones in the column that did not — and a
placed PSD on a pattern layer is five sections under LAYER before OBJECT even
starts. So a zone heading is a control: the same caret, the same store, keyed
`zone:TOOL` through `zoneKey` so that a section which happens to be called
*Tool* is a different thing.

Once the whole column folds, though, a rule between the zones stops being
enough — three foldable headings among foldable headings need something that
says which three are the structure. Three things say it, and they are the only
three of their kind in the panel: a **chip** (a brush, a stack of sheets, a box
with corner handles — what is in my hand, where it is going, what it is on top
of), a ground a shade off the panel's, and a **2px** rule over it where every
section boundary is 1px.

**A heading's explanation is its tooltip.** Every zone heading carries a
`title`, and the TOOL zone prefers the tool's own line from `TOOL_HINTS` when
there is one. That is half of a move the whole panel made — see **Where the
panel's explanations went** below.

**The LAYER zone steps aside for an object.** It was there always, on the
reading that there is always a layer new work lands on — which is true and was
not the question. Picking a placed PSD drew its layer's whole panel *above* it,
so selecting one thing looked like selecting two and the object you had just
tapped started a screen down. It now shows when the layer is what there is to
talk about: a layer selected, nothing selected, or a **region** — ground rather
than a thing standing on a layer, where the zone answers "where would the next
Fill land", which is a question the selection raises and does not settle. That
is `layerZoneApplies`, beside `layerOf` in `inspect-zone.ts`.

Nothing else changes: the object still belongs to its layer, that layer is
still the one new ink lands on, and the left panel still expands to reveal the
object in it. What went is the second subject, not the relationship.

`inspect-zone.ts` is the zone, `inspect-brush.ts` the TOOL zone's contents,
`inspect-wiring.ts` what every control in the panel actually does, and
`inspect.css` the whole panel's stylesheet — split out of `panels.css`, which
had reached the line limit, along the split the panels themselves make: left
sidebar there, right sidebar here.

## The inspector's sections fold

The panel describes one thing at a time, and the thing it describes can be
several screens of it: a placed PSD carries Info, Transform, its collider, its
own layer stack and — on a pattern layer — the rule and its shapes. Most of the
time only one of those is being worked on, and scrolling past four headings to
reach the fifth is the whole of the complaint.

**The fold is applied to the finished panel, not written into each section.**
Sections are built in seven files — `inspector.ts`, `inspect-panels.ts`,
`inspect-placement.ts`, `inspect-collider.ts`, `inspect-pattern.ts`,
`inspect-background.ts`, `psd-layers.ts` — and threading one through all of them
would be seven copies of the same three lines with an eighth forgetting. What
makes one pass over the DOM honest is that the markup already says which sections
have a heading: `inspect-collapse.ts` folds a `.inspect-section` whose **first**
child is an `.inspect-section-title`, and leaves everything else alone. A section
with no heading — the row of buttons at the foot of a panel — is not something to
hide behind a name it has not got.

Two sections used a heading as a *sub-label* rather than as their own name — the
pattern's Density and Repeat boundary, and a gradient's From, To and Direction —
and are now separate sections, because a heading that is not a section's own is a
heading that closes its neighbours with it.

What is folded is state of the **panel**, not of the document, so it is
per-install like a sidebar's width and keyed on the section's **name**: close
Collider once and it stays closed for the next PSD you select, which is the
reason to close it. A heading that counts in itself — `Shapes · 2` — is keyed on
the part before the count, or adding a shape would reopen it. The set is held in
memory as well as in `localStorage`, because the panel rebuilds on every document
change and a drag rebuilds it per pointer move.

The pass is idempotent — a section it has been over carries
`data-collapsible` — which matters because the PSD layer list is built once and
kept across re-renders, so the same element comes back round.

**A heading can carry a subject, and the fold is keyed on the part before it.**
`sectionTitle` builds one — `BRUSH : INK`, the device the zone headings use —
and writes the name to `data-fold-name`, which the pass reads in preference to
the heading's text. Without that, picking a different tip would be a different
section and would reopen one somebody had closed. It is also why the fold's
caret is pushed right with `margin-left: auto` rather than by
`justify-content: space-between`: a heading with a subject is two spans, and
spreading them puts the subject in the middle of the row.

The pencil is what that is for. Its panel used to open with a 19px title naming
the tip — *Ink* — directly above a section heading saying *Brush*, which is one
fact written twice and the only heading in the column at that size. The title
is gone and the heading says both.

## Where the panel's explanations went

Under the heading they explain, as its `title`. The panel used to carry them as
`field-hint` and `lib-hint` lines: a sentence under *Scale* saying what a
pattern's scale means, one under *Brush* saying what the Pattern brush does,
one under *Repeat boundary* saying what a repeat is. Each reads once and is
scrolled past for ever after, and in a 300px column four of them is most of the
column — which is the same complaint the fold answers, one level down.

So `sectionTitle` takes a `hint`, `PanelSurface.section` takes one, and the two
library editors' own `section()` takes one. Three rules decide where a line
lands:

- **A line about a section** goes on that section's heading: *Scale*, *Repeat
  boundary*, *Sweep*, *Arrange*.
- **A line about one control** goes on that control: the eraser toggle's, which
  changes with the state; *Make start point*; *Add shape*. A `title` on a
  container answers for every child that has none of its own, so the shape
  editor's align rule sits on the row of six buttons and hovering any of them
  says it.
- **A line about a tool** goes on the TOOL zone's heading, from `TOOL_HINTS`.
  That is where the Shape brush's went, and it is why it exists: its panel was
  a *Stamp* heading over one sentence and no control at all, so with the
  sentence moved the section had nothing left in it — and a heading over an
  empty box is what the three zones were introduced to stop.

**What stays on screen is what is not an explanation.** A line reporting state
is not asked for, it is read: the pattern layer's *No shapes — the pattern goes
on for ever*, the reason Delete layer is disabled (a disabled control shows no
tooltip anyway), the pen's live count of corners down, the collider section's
*this project has no grid*. Those are the panel's answers rather than its
instructions, and three of the four are the only thing their section contains.

Native `title` rather than a tooltip of the app's own, because that is what the
rest of the editor already uses for exactly this — the tool rail, the mode bars,
every button in the two library editors — and because on the iPad there is no
hover to serve either way. What a tool has to say there, it says in the line the
console prints when it is picked up.

**There is one exception now, and the reason is the sentence above.** "No hover
to serve either way" is an acceptable answer for a *tool*, because a tool that
has been picked up says its piece in the console and the panel is standing
there in front of you either way. It is not an acceptable answer for a sheet
you see once, at the moment you are deciding what a project *is*: New Project's
explanations are the only place the grid scale or the character controller is
described, and a native `title` would have moved every one of them somewhere an
iPad cannot reach. So the hints on that sheet are `lib/tooltip.ts` — a `?`
button that opens to a hover *and* to a tap, which is the thing `title` cannot
be. See **Why New Project is drawn in the settings vocabulary**.

The rule that remains, then: a `title` where there is another way to the same
information, and a `?` where the sheet is the only way.

## The pattern and shape libraries

Two palettes carried over from
[simple-tileset-generator](https://github.com/laffan/simple-tileset-generator)
— fourteen pixel patterns and twenty-nine vector shapes, unchanged — and both
of its editors, rebuilt in this shell. Three tools paint out of them: the
Pattern brush, the Shape brush, and Fill.

```
src/lib/library/
  types.ts         PatternData, ShapeData, and the grid operations
  pattern-defs.ts  the fourteen, pixel for pixel
  shape-defs.ts    the twenty-nine, vertex for vertex
  store.ts         Library<T>: order, customs, renames, selection
  index.ts         patternLibrary, shapeLibrary, onLibraryChange
src/lib/paint.ts        Paint, PaintSpec, and the lattice
src/lib/shape-path.ts   drawing a shape into a box — or into a diamond
src/drawing/paint-render.ts  what the three painters actually draw
src/editor/paint-picker.ts   the one control that picks any of it
src/editor/pattern-editor/   the pixel editor
src/editor/shape-editor/     the vector editor
```

### The library is the app's, not the project's

It lives in `localStorage`, which on this shell is per install — the same
place the sidebar widths, the folded inspector sections and the colour
picker's recent swatches already live. A pattern is a mark you make, the way a
brush is: nobody wants the dither they drew on Tuesday to belong to the
project they happened to draw it in.

What a **document** stores is the id and nothing else, and that is the trade,
stated plainly: a project opened on a machine whose library does not have
`pattern_k3f…` draws that stroke in flat colour and says so — `paintIsPlain`
is the one question every painter asks first, and falling back to the colour
is the answer that is never wrong. The built-ins are in the binary, so a
project using only those is portable with no caveat at all.

Built-ins and customs are the same kind of row: both can be renamed,
reordered, duplicated and taken out of the palette. What a built-in cannot be
is **edited in place** — `Library.save` on one writes a copy and puts the copy
in its slot — so the defaults are a floor you cannot lose, and **Restore
defaults** puts back anything removed. A removed row is still reachable by id,
which is what keeps a document that names it drawable.

### The lattice, and why the Pattern brush reads as revealing

The old Pixels tool was the pencil with a checkered atlas tip. That made it a
textured pencil rather than a tool: a stamp's phase follows the *path*, so two
strokes that crossed disagreed about where the squares were, and drawing over
your own tail thickened the dither.

What replaced it is not stamped at all. `cellsUnderStroke` walks the path and
collects the **lattice cells** the tip passed over; `fillLatticeCells` fills
the ones whose pattern bit is set. Cell `(cx, cy)` is at
`(cx × scale, cy × scale)` in **world** units, so:

- two passes over the same ground fill the same cells,
- a stroke drawn backwards covers the same set,
- a stroke broken into pieces covers the union of them exactly,
- and the result reads as an area that was already filled and is being
  *uncovered*, which is the thing a pattern brush is for.

`paint-render.test.ts` is written as those four claims.

An area **fill** takes the cheap path instead — a `CanvasPattern` whose own
matrix carries the same scale, so the lattice is pinned identically and the
whole region is one call however large. Both are nearest-neighbour: a pattern
pixel is a pixel, and a smoothed one is a smudge that happens to repeat.

`Paint` is split into `PaintSpec` and a colour, because a `Stroke` already has
a `color` and a second copy of it inside a paint field would be a fact stored
twice — the kind that is right for a week and then quietly disagrees.

### A shape fills a space, not the box around it

An isometric grid space is a **diamond**, and its neighbours' bounding boxes
overlap it by half. A shape drawn into the box therefore covers four
half-spaces and lines up with none of them: `square` came out as a square
floating over the lattice instead of the filled space it is meant to be.

`ShapeBox.diamond` maps the unit box onto the diamond inscribed in it —
`(0,0)` to the top point, `(1,0)` to the right, `(1,1)` to the bottom,
`(0,1)` to the left, which is the order `Grid.cellPolygon` lists them in. It
is a shear, so it is one `ctx.transform` and every painter below it is
unchanged. The brush, the swept fill and a filled run of grid spaces all carry
the flag, and `stampsOver` walks whichever of the two lattices the project
has.

The Shape brush records **places** rather than a path: its stroke's points are
the corners of the boxes it stamped, which is why `"shape"` is a stroke mode
rather than a brush. A streamline over those would slide every tile off the
space it was put on, so `renderStroke` leaves them alone exactly as it leaves
a fill's corners alone.

### Painted fills need a texture, because Graphics cannot do either

`DocRenderer` draws a `FillPatch` with Phaser's `Graphics`, which is right for
a colour and can do neither of the others: a pattern is a lattice of thousands
of small rectangles on an object that rebuilds its batch every frame, and a
shape is a bezier path per grid space. So `game/fill-paint.ts` renders each
painted patch **once** into a canvas texture and puts it on the scene as one
image over its own bounds, keyed on a signature of the paint, the colour, the
bounds and the grid. Panning, zooming and every unrelated document edit cost
nothing.

Both paints are clipped to the fill's own **spaces** rather than to its
bounding box — a run of grid spaces is usually irregular and an isometric one
is never a rectangle — and the canvas carries the world transform, so two
patches filled with the same pattern line up across the gap between them.

Two senses of the word *pattern* meet on `FillPatch` and are kept apart:
`kind: "pattern"` is a **PSD in this project** whose texture tiles the patch,
and `paint` is a row in the **app-wide library**. A patch is usually
`kind: "color"` and carries a `paint` as well — the colour is what the pattern
or the shape is drawn in, and what it falls back to.

### The two editors

Both are full-width sheets with the same three columns — a toolbar, the thing
being edited, and a preview of it at the size *this project* will draw it —
because they are the same kind of work and should not have to be learned
twice.

The **pattern editor** shows the tile surrounded by its own repeats, dimmed.
That is the point of it: a pattern is a thing that repeats, and an 8×8 grid on
its own says nothing about whether the repeat is seamless. Every write is
taken modulo the size, so a tip that hangs off an edge paints the opposite
edge and the four seams take care of themselves.

The **shape editor** does not use Two.js, which upstream does. It works in the
format the library stores — flat `{x, y, ctrlLeft, ctrlRight}` in a 0–1 box —
so nothing is converted on the way in or out and there is no place for two
representations to disagree. Its one piece of real geometry is the boolean,
`lib/polygon-ops.ts`: Greiner–Hormann with the clip ring reversed, which is
how a difference is made out of an intersection routine, and traced **always
forwards** on both rings because the reversal is what makes the clip's arcs
run the carving way.

Upstream reaches for a modifier key for three things this editor also has to
offer without one, because an iPad has no ⌘ and no space bar:

| Upstream | Here as well |
|---|---|
| ⌘-drag to select a region of the pattern | a **Select** mode in the toolbar |
| space-drag to change a pattern's phase | a **Pan** mode, and a nudge pad |
| ⇧-click to add a path to the selection | a **⊕** on each row of the path list |
| three clicks on empty canvas make a path | a **Draw a path** toggle, closed by tapping its first corner |

The keys still work for anyone who has them, and both readings write the same
field. The last row is not only about the keyboard: upstream's third click on
empty canvas *is* the new shape, and a click on empty canvas is also how you
deselect — so the gesture is hard to find and easy to trip over. As a toggle
it is the same gesture as this editor's own point-to-point Fill, which anyone
using it already knows. The ⊕ is not quite ⇧-click, though, and the difference was a bug worth
keeping: adding a path to the selection must **not** move the current one,
because *Cut out* takes every other selected path out of the current one — so
a ⊕ that changed the subject took the shape out of the thing being cut with.

Two more things that are upstream's and worth stating because neither is
obvious from the code:

**A selection is not only a box.** Once it has settled, dragging inside it
moves the cells it holds and dragging its corner *repeats* them across the new
size — one `moveRegion`, because the two gestures are the same one with a
different size. Both the lift and the landing wrap, so a motif dragged off the
right edge comes back on the left and the pattern stays seamless.

**Align and distribute read the points first.** Two or more points selected
and it is the points that line up; otherwise a lone path lines up with the
tile and several line up with each other. The selected points are the smaller,
more specific thing you pointed at, and moving the whole path instead would be
answering a question nobody asked. Distribute falls back to *every* path when
fewer than three are picked, because a row is usually the whole shape.

Both editors listen on the document in the **capture** phase and stop what
they handle. The shell's own ⌘Z and space bar are bound to the same document,
and while a sheet is up they are about the wrong history and the wrong camera.

**The toolbar is 210 pixels wide, and three things follow from that.** The mode
row — Draw / Select / Pan — takes the chips' metrics rather than the sheet's own
segmented control, which is built for the New Project sheet where a row is the
width of the page and at 15px with 20px of padding either side wrapped three
options onto three lines. The brush's **size** sits directly under the *Brush*
heading rather than below two rows of buttons, because it is the number that
changes most often and the one the tip buttons are read against: a tip four
cells wide is a different tool from the same tip one cell wide. And the
explanations are tooltips on the headings, per **Where the panel's explanations
went** — with the one that only ever applied to *Select* folded into that
button's own hint instead.

**The ways out sit at the right-hand end, in the order the app ends on.** Undo
and Redo stay on the left, where they are about the work; Cancel, Save as a
copy and Save are a `.sheet-actions-end` group pushed right with `margin-left:
auto`. The button under the thumb is then the ordinary answer and Cancel is the
furthest thing from it, which is how every other sheet in the app already
reads.

## A colour carries its own opacity

The picker grew a second slider beside hue, and what it hands back is still one
string: `#rrggbb`, or **`#rrggbbaa`** once the slider leaves the top. That is
CSS Color 4's eight-digit form, and choosing it over an `alpha` field beside
every `color` is most of the story.

**Opaque is six digits.** `withAlpha` drops the pair back off at 1, so a colour
nobody has made transparent is spelt exactly as it always was. No document
changes shape, nothing already on disk has to be migrated, an older build still
reads a project, and a project where nobody touched the slider has an empty
diff. The alternative — a number beside each colour — would have been five
records to widen (`Fill`, `Background`, `Background.gradient` twice, `Stroke`,
`StrokeStyle`), five readers to teach, and a second field to keep in step for
something already inside the value.

**A 2D canvas reads it for free**, which is most of the editor: the minimap,
the export raster, a fill's preview, the ink itself. Phaser does not — it takes
a packed `0xrrggbb` and an alpha as separate arguments — so `hexToNumber` and
`alphaOf` are the pair every Phaser call site now uses. `hexToNumber` also
replaced two copies of itself that disagreed about what to do with a colour
they could not read, and a straight `parseInt` over eight digits comes back a
thousand times too large and paints something nobody chose.

**Opacity is part of the colour, not a property of the thing wearing it.** A
half-transparent wash and a pale opaque one are two different answers to the
same question, and putting them a panel apart makes the picker lie about what
it is showing. The track is the colour itself fading out over a checker, so
what the slider shows is what the slider does — and the preview and the recent
swatches sit over the same checker, because otherwise a colour that is half
there reads as a paler colour that is not.

### Why ink needed more than a number

A brush stamps at 0.15 of its width, so about seven stamps land on any given
pixel. `globalAlpha` applies to each `drawImage` separately — so a 50 % pen
compounds into a solid core and is honest only at the tips.

That is Hush's delta #38, and porting it fixed two things that were already
wrong before opacity existed: a **highlighter** darkened wherever it crossed
itself, and the **rub** ate further every time it passed, because both were
compositing per stamp too. `render.ts` now stamps the stroke into a scratch
canvas at full strength and lays the result down once, with the mode's
composite and the stroke's alpha:

| mode | composite | alpha |
|---|---|---|
| ink | `source-over` | the colour's |
| highlight | `multiply` | half the colour's |
| erase | `destination-out` | the colour's |
| fill | — a path, not stamps — | in the `fillStyle` |

The atlas is tinted with the colour at **full** opacity and the alpha applied
to the finished stroke, which is the same decision read from the other end:
tinting it in would put the alpha on every stamp. It also keeps the tint cache
keyed on six digits, so a colour used at four opacities is one tinted atlas
rather than four.

Plain opaque ink skips all of it — no composite to apply and nothing to hold
back, so the stamps go straight onto the target, which is the common case and
the cheap one. The scratch is **grow-only**: the three things this renders into
are different sizes (the surface's two backings and whatever `rasterise.ts`
asks for), and letting it shrink would reallocate a backing store twice per
Apply for no benefit.

The two scaffolded scenes read the eight-digit form too — `colorOf` takes the
pair off and `alphaOf` reads it, and a gradient gets **per-corner** alpha,
because a sky fading to nothing over the horizon is two stops where only the
opacity moves. An existing project picks that up with Reset on `paintFill` and
`gradientCorners`.

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
meant. So the placements one `placePsd` call produces share a **unit**, and the
canvas works on the unit by default: selecting any member selects the unit, the
overlay draws the union of their boxes, and a drag moves every member by the
same cell step.

**A unit is not an instance**, and the two are kept apart for the reason the two
senses of "layer" are. A unit is the layers of *one* placed PSD: how many
rectangles move when you drag. An *instance* is one of several placed PSDs
reading the *same file*: how many things on the grid an edit to that file would
change. One file can stand on the grid as three units of three layers each;
every one of those units is an instance of the file, and every placement belongs
to exactly one unit. See **Instances** below.

`game/unit.ts` is the whole of the model — `unitOf`, `unitMembers`,
`unionRect`, `scaleWithin` — and it is pure, so the arithmetic is tested
without a canvas. The unit's id is stored on a placement as `instance`, which is
the older name and stays on disk: renaming a field that every document in every
project carries, and that the exported game reads, to say the same thing a
different way is not a trade worth making, and every reader comes through
`unitOf`. It is optional there, because documents written before units existed
have none; `unitOf` falls back to the placement's own id, which makes such a
placement a unit of one, and the scene migrates whole documents on load so the
fallback is a floor rather than the usual path.

**Resizing scales the members, it does not scale a group.** Each placement is
an independent rectangle in the document, so a member's offset inside the unit
has to scale with its size or the composition comes apart — that is
`scaleWithin`, applied against the union box captured at pointer-down. The
anchors move by the cells the *union's* middle moved, all by the same step:
re-anchoring each layer on its own new middle would let the members drift, and
it is the shared anchor that brings them back in the same arrangement after a
re-import.

**Double-tapping opens a unit up.** In that mode — `adjusting`, holding the
unit id — a drag moves the one layer under the finger, the overlay
outlines it with filled handles and draws its siblings faintly, and the
inspector says so and offers a way out. The scene keeps the field; what it
*means* at the four places it is read is `game/adjusting.ts`, which is a rule
about the document rather than a piece of scene state — nothing in it touches
Phaser, the camera or the display list, and the split is what keeps
`world-scene.ts` about the canvas. Selecting anything outside the unit
closes the mode, so it never outlives what it is about: `setSelection` clears
`adjusting` unless the new selection is a member of it. A double-tap has to
survive a *tap that was offered to the drag controller first*, which is why
`camera-rig.ts` tracks whether a drag ever moved and reports a drag that did
not as a tap.

Carrying a placed PSD to another layer in the left panel takes the unit with
it, its id and all. The panel lists one row per placed *file* rather than
one per layer inside it, so what the gesture picks up is the file — see
**Two senses of "layer"** below.

**The button that takes it off says what it takes.** It read *Remove from
layer*, which named neither end of a sentence with both senses of "layer" in
it: the document layer it is removed from, and the PSD layers that go. It says
**Remove PSD from layer** for a unit going whole, and names the one row when
the file has been opened up and only that row goes — `Remove "roof" from
layer`. That is the same question `doomedPlacements` answers, asked where it is
about to be acted on.

### Groups, which the game is never told about

⌘G ties the placed PSDs that are selected together; ⇧⌘G lets them go. A wall,
a roof and a door become one thing to *work on*: tapping any of them selects
the lot, a drag moves all of them, and the layer panel lists them under a row
of their own.

**It is the first thing in `doc.json` that is not a fact about the game.**
Everything else in the document is there because it is in
`game.config.json` too — a layer is Phaser's draw order, a collider is what
stops a character, a point is a place the project's own code reads back by
name. A group is a statement about somebody's hands. `game_config.rs` reads the
fields it names and ignores the rest, which is the same tolerance that lets a
document written before zones existed still export, so a grouped project
generates the config an ungrouped one does — asserted in
`tests::config::a_group_never_reaches_the_config`, byte for byte, because the
day somebody adds `deny_unknown_fields` for a good reason is the day a grouped
project stops exporting at all.

**It is still saved**, which is the difference between this and the overlay
switches. A group travels in a `.idlewild`, comes back on another machine, is
undone and redone with the rest of the document, and is the same for two people
opening the same project. An overlay switch is none of those things and lives
in `localStorage` accordingly.

`lib/groups.ts` is the model and it works in **units**, not placements — a
placed PSD is one thing however many layers came in with it, and a file
re-parsed into a different number of layers then needs nothing here rewritten.
Four rules, each of which is invisible when it is wrong:

- **Two is the floor.** A group of one names something that already has a name,
  so ⌘G on a single file writes no document and pushes no undo step.
- **A unit is in at most one group**, and grouping a selection that already
  holds grouped units *absorbs* them. A group left with one member goes.
- **The members are brought together into one run of the layer's placements**,
  at the position of the earliest of them. Not tidiness: the panel lists
  placements in the order they draw, so a group drawn as a cluster of rows
  whose members are scattered through that order would be a list saying
  something the canvas does not do. On an isometric object layer the list is
  sorted by screen Y instead, so there the cluster *is* the one place the panel
  departs from strict draw order — and it departs from it to say something
  true.
- **A group that has lost its members is not a group.** Deleting a placement
  and carrying one to another layer are the two ways a unit leaves a layer, and
  neither knows what a group is. `liveGroups` is therefore what every reader
  goes through — stored units filtered to the ones still there, groups filtered
  to those with two left — so a stale id is never something anybody sees.
  `pruneLayerGroups` writes that answer back, and the two callers wrap it with
  their own edit in one `history.group`: a group that lost its last member is
  not a step somebody took.

**Flat, deliberately.** A group holds no groups. Nesting is what every drawing
program does eventually and it costs a tree in the panel, a path in the
selection, and a decision about what a double tap means at each level — none of
which is worth guessing at before the flat version has been lived with.

**Reaching inside one is the sidebar's job, not a second double tap.** A tap on
the canvas means the group (`widenToGroup`, beside the unit rules in
`game/adjusting.ts`, and skipped for a unit that has been opened up). Double
tap is already taken — it opens a file up into its own layers — and a gesture
meaning two different things at two different depths is a gesture nobody can
aim. So the panel lists a group's members indented under it, and picking one
there picks that file alone, which is where you already go to reach something
standing behind something else.

**The buttons are the iPad's half.** There is no ⌘ under a finger, so Group and
Ungroup sit in the inspector beside the list of what is selected — which is
exactly what they act on — and when the selection *is* a group, the heading is
the group's own name and can be retyped. `renderPlacements` asks whether the
selection is a group rather than whether it overlaps one: a heading naming a
group that half the selection belongs to would be a heading saying something
untrue. The panel's own row follows the same rule — `isSelected` lights a
group's row only when **every** member is held, so reaching in to pick one file
does not leave two rows claiming to be the selection.

### Merging, which is every other conversion backwards

Every conversion in this editor turns one thing into one file — an image, a
sketch, a fill, a solid pulled off the grid — and the pipeline places what
comes back. **Merge** goes the other way: files already standing on the grid,
in the arrangement somebody put them in, written into a single document. A wood
drawn as nine PSDs becomes `wood.psd`, and stays a wood.

**The editor owns the arrangement and Rust owns the file**, which is the
division of labour the marks already keep. What crosses the bridge is each
placement's box in the merged file's own pixels — no cells, no projection, no
idea of a grid — so `psd_merge.rs` reads layers out of the sources and stacks
them in the order it is given, and nothing about a diamond has to be true on
that side. `editor/merge-actions.ts` is the arithmetic: the union of the
placements' boxes, `footprintForBox` for the spaces it covers and the space it
hangs from, and each part at `(x - box.x) × EXPORT_SCALE`.

Three things have to survive it, and each is a different way to be quietly
wrong — a roof under its walls is a roof under its walls, whether a merge put
it there or a hand did:

- **Position.** Each source lands where the editor said, relative to the
  others, measured from the anchor at the middle of the new file. Because the
  box sent is the placement's, a file somebody resized on the grid arrives at
  the size it actually *looked*: `raster` resamples it, and skips the resample
  entirely when the sizes match, which is every unresized placement.
- **Depth.** Parts arrive **back-first** and `add_*` stacks bottom-up. On an
  isometric object layer the drawn order is screen Y rather than the
  document's, so `mergeOrder` sorts through `unitsInDrawOrder` — the merged
  file has one stack and it had better be the one that was on screen.
- **The composition inside each file.** Merging is not flattening. Every layer
  comes across as a layer, at its own offset inside the source, and a group
  stays a group. The scale is the **source box's**, not the layer's: one factor
  about one origin, which is the rule an extrusion's parts keep and for the
  same reason — per-layer scaling about per-layer origins lets a composition
  drift apart.

**Every layer is renamed `[kind] | [layer]-[source psd] | [attrs]`** — the
hut's wall becomes `S | wall-hut`, and `S | hero | animation` becomes
`S | hero-guy | animation`, attributes and all. That says where each part came
from in a document that is no longer either file, and it makes the name unique
by construction: psd-to-phaser keys a texture on the layer's own name, so two
files that each call a layer `layer 1` would otherwise be one key for two
pictures. It is the same collision the editor already closes between separate
files by scoping a texture to the file it came from; inside one merged document
there is no file left to scope to, so the name carries it. Applied at **every
depth**, because a key is the layer's name wherever in the stack it sits, and
two merged groups can each hold their own `S | x`.

**The sources' own marks do not survive**: nine anchors would be nine answers
to a question with one. They are never sent, because a placement is made for
the artwork layers alone, and the merged file writes its own pair for the
footprint it covers.

**The anchor goes in the middle of the merged artwork**, not on a corner. A
conversion of one thing anchors on the lowest corner of the spaces it covers,
because it is a thing standing on ground and that corner is where it stands.
What comes out of a merge is not one thing standing anywhere — it is a
composition with its own extent — so the honest fixed point is its centre,
which is also where an import with no opinion is centred. `art` then comes out
negative, which `psd_marks::layout` already handles: every position it lays out
is relative to the anchor either way.

### The pipe prefix, which is why this did not work at first

Every merge failed on every file this editor had ever written, with
*`extrude-mu70cjz3.psd` has no layer called "extrude-mu70cjz3"* — naming the
layer that was right there in the file.

A placement's `layerPath` is what the **manifest** calls a layer, and
psd-to-json strips the pipe prefix on the way through: the group an extrusion
writes as `G | extrude-mu70cjz3` is `extrude-mu70cjz3` by the time it reaches
the document. `psd_merge` was matching raw Photoshop names by equality, so it
never hit anything, and the failure named the stripped form because that is
what it had been asked for.

`parse_name` is the fix and it earns its place twice: the same split into
`kind | name | attrs` is what the lookup compares on *and* what the rename
above is built from. `tests::merging::a_file_this_editor_wrote_is_found_by_its_manifest_name`
is the shape of a real Apply — a `G | …` group holding an extrusion's three
parts, beside the marks — so the bug cannot come back quietly.

**The source files stay in the project.** What goes is the *placements* — a
placement is a drawing of a file, the file lives in `psd/`, and another scene
may be drawing it too. So merging four trees into a copse leaves `tree.psd`
where it was and Export Assets still offers it. The placement of the merged
file arriving and the originals going are **one history step**, because a
history that could put the originals back without taking the merged file away
would leave the same artwork on the grid twice.

The key is taken from `free_key` rather than the name offered outright: a merge
writes a *new* file, and writing over a `tower.psd` still standing on the grid
is the one outcome nobody could have asked for. The name it starts from is the
back-most source's, which is what the rest was built around nine times in ten.

Refused for a source carrying masks or clipping, for the reason every rewrite
in this editor refuses one: the fork cannot express either, so what came out
would have quietly lost work.

### Words on the canvas

Blocking a level out means writing on it — *door to the cave*, *boss here*, a
sign's own words — and until the Text tool there was no way to put a word on
the canvas but to draw it by hand or to go and make a PSD of it somewhere else.
A tap with Text puts a `TextItem` where the finger landed, selected, with the
inspector already open on the field to type into.

**It is temporary, in exactly the sense a sketch is.** It sits on a layer, it
moves, restyles and deletes, and the game is never told about it — asserted in
`tests::config::a_note_on_the_canvas_never_reaches_the_config`, byte for byte
against the same document without it. **Convert to PSD** is the one exit, the
same exit a fill and a lassoed sketch take.

That is not a limitation dressed up. A `TextItem` is drawn by the *browser*, in
a family that is on this device because the operating system ships it — and a
published game is a directory somebody serves to a machine that may have none
of them. Shipping the words as words would mean shipping a font, choosing a
fallback, and accepting that a sign reflows on the day the fallback is wrong.
Pixels have none of those questions in them, and a PSD of the words is also a
file somebody can open and paint over, which is usually what a sign in a game
wants next.

**Which is what makes a local font safe here.** Since what ships is artwork, a
note can be set in anything the device has, and `lib/system-fonts.ts` finds out
what that is. Not by asking: `queryLocalFonts` would answer outright and is
Chromium's alone, and this editor runs in WKWebView on both of its platforms;
`document.fonts.check()` answers about *loading* rather than availability and
says yes to families that are not installed. So the families are **probed**,
the way every font picker on the web has done it for twenty years — a string is
measured in the candidate family with a generic behind it, and again in the
generic alone; a family that is not installed falls through and the two match.
Against all three generics, because a face that happens to match `monospace`'s
metrics will not also match `serif`'s.

It is a **list of candidates, not an enumeration**: nothing can find a typeface
it was not told to look for, so what the picker offers is `CANDIDATES` — the
system faces of macOS, iPadOS and Windows — intersected with what is there, and
a missing one is a line to add. The three generic stacks are always offered, so
the picker is never empty and a note written elsewhere keeps its own family
selectable. The probe runs once and is kept: installing a font is not something
that happens between two renders of a sidebar. **No webfonts**, which is the one
rule — this editor works offline, and text whose metrics arrive after the box
was measured is text that no longer sits where its outline says.

The picker is a menu rather than the row of three chips it started as, because
there are now as many families as the device has. **Each name is drawn in its
own face**, in the button and in every row: *Didot* set in the panel's own font
says nothing about Didot. A family the document names and this device has not
got still reads as its own name — `fontLabel` unpicks it from the stack it was
stored as — because the note is set to it and a panel showing the fallback
instead would be agreeing with something nobody chose.

### What a note is made of

The words go through three files, and the split is what keeps the canvas and
the PSD it becomes from ever disagreeing:

- `lib/text-markdown.ts` reads one line into **runs of emphasis**. Three marks
  and no more — `**bold**`, `*italic*`, `<u>underline</u>` — because every other
  thing Markdown has is a *block*, and a block changes the size, the leading or
  the left edge of a line, which would make this a document renderer. `<u>`
  rather than a fourth mark because CommonMark deliberately leaves underline to
  HTML, and inventing a dialect is worse than borrowing a tag. **Unmatched
  marks are text**: `2 * 3 * 4` is arithmetic, `game_config.json` is a filename,
  and `a **thing` is somebody mid-sentence — a parser you have to escape your
  way out of is worse than no parser in a field three words wide.
- `lib/text-layout.ts` turns those runs into **lines**, wrapping and measuring
  them. It measures through a `Ruler` it is handed rather than touching a
  canvas, which is what makes the awkward half testable: the tests use a ruler
  where every character is ten wide, because line breaking is arithmetic over
  widths and a real font would make every expected number a magic one.
- `lib/text-items.ts` owns the item, the store edits and the drawing.

**Emphasis is the font string's**, not a transform on the glyphs: `fontString`
takes `bold` and `italic` and puts them where the CSS shorthand wants them, so
what is measured and what is drawn are the family's own faces. A run measured
upright and drawn slanted is a run that overlaps its neighbour.

**Wrapping breaks on words, and the spans come apart with them.** A run of
emphasis can be half a sentence, so a line cannot be chosen between whole
spans: each word is measured in its own face, and a span that straddles a break
is written into both lines still bold. A word wider than the column is left
over the edge — hyphenation is a language's business and a URL cut in half is
worse than one that overhangs.

**A wrapped note's box is the column, not its longest line.** That is what
makes the handle on the canvas mean something: the box is what somebody set, so
it stays still while the words inside it change. Without it the handle would
walk as you typed.

**The handle is at the end of the text, not the corner of the box.** On a note
laid into the grid the column runs off along a diagonal, so `textFrame` gives a
note its own coordinate space and `textPoint` puts the handle at text-space
`(width, height / 2)` in whichever of the four orientations it is in.
`textWidthAt` is the way back, and it is the **inverse of the plane** rather
than a projection onto the axis the text runs along. That distinction is the
one bug a test caught here: the two axes are not perpendicular — that is the
whole of what a shear is — so a dot product with one picks up a share of the
distance along the other, and since the handle sits half the note's height down
the second axis, grabbing it would have snapped the column to a different width
before the pointer moved at all.

### Lying in the grid's plane

On an isometric project a note drawn flat is the one thing on the canvas facing
the viewer while everything else is seen from above and to the side, so it reads
as floating in front of the world rather than being part of it. **Track the
grid** lays it into the grid's own plane instead: a line runs along `+cx` and
the next line steps along `+cy`, so a label reads as painted on the floor.

**Four orientations, which are two decisions.** Which of the grid's diagonals a
line runs along — NW→SE or SW→NE — and whether the lines step *across the
floor* or *straight down the screen*. Standing up changes only the second axis:
the line still follows the grid, and the lines below it drop vertically, which
is what makes a run of text read as a sign on the face of a wall rather than a
label on the floor in front of it. Two controls rather than four named
orientations, because they are independent and a list of four is a list
somebody has to decode.

`groundPlane` is the whole of it — the two grid axes from `Grid.cellToWorld`,
each **normalised to length one**. Normalised rather than raw is the part that
would be silently wrong: the axes themselves are a *cell* long, so using them
would scale every note to the size of one grid space however big the words
were. What the transform keeps is the length of a horizontal and a vertical run;
what it changes is the angle between them, which is what makes the words lie
down.

**The shear is baked into the texture, and the box follows it.** `planeBox` puts
the four corners through the transform and takes the rectangle around them, and
both the measuring and the drawing ask it — so the canvas a note is drawn into
is exactly the box the document stores, and picking, dragging, the outline, the
minimap and the conversion's crop all go on reading a plain rectangle. That is
also why `tracksGrid` is in the texture's signature and in the list of patches
that re-measure: it changes the picture and the box without changing a word.

The row is not drawn at all on an orthogonal or blank project, where the grid's
plane *is* the screen: a switch that does nothing says the feature is broken
rather than inapplicable, and `groundPlane` answers null there rather than an
identity transform so every caller skips the work instead of multiplying by one.

**The box is measured once and stored**, which is the decision everything else
here rests on. Text is the only thing in this document whose size nobody typed:
it comes out of the font, the size and the string, and the browser is what
knows. So `updateText` measures on every edit that could have changed it — the
words, the size, the family, and not the position — and writes `width` and
`height` onto the item. Picking, dragging, the selection outline, the minimap
and the conversion's crop then all read a plain rectangle, the same rectangle a
placement has, instead of laying the text out again. Measuring goes through one
2D canvas kept for the life of the page, because a canvas per measurement is a
canvas per keystroke.

**The canvas and the conversion draw through one function.** A note on screen
is not a Phaser `Text`: it is a texture from `rasteriseText`, which is also
what a conversion reads back as RGBA. Phaser's `Text` would have been a second
layout engine to keep in step — its line advance is the font's own ascent plus
descent plus a spacing value, and matching that from outside Phaser means
guessing at metrics it measured for itself — and a note whose lines sit further
apart on the canvas than in the file it becomes is exactly the kind of
difference nobody sees until the artwork has been painted over. The baseline is
**alphabetic** for the same reason: `textBaseline: "top"` puts the ascent's own
box at the top and moves every glyph down by whatever padding the family
leaves.

`game/text-render.ts` makes the same bargain `fill-paint.ts` does, down to the
signature: one texture per note, rebuilt only when something about that note
changes, at twice the world scale so it stays sharp as the camera comes in. A
drag changes no part of the signature, so moving a note costs a `setPosition`.
It draws at the **front of its layer's slot**: a note written over a building
belongs over it, and a note on a layer behind one is behind it, because that is
what putting it there said.

**There is no caret on the canvas.** A text editor over a Phaser scene would be
a second input model — an iPad keyboard, an IME, a selection, a cursor drawn at
whatever the camera's zoom happens to be — carried for a string that is usually
three words long. The field is in the inspector, where every other property of
every other object is typed, and the canvas is its preview. That is also why it
commits on **every keystroke** rather than on blur: text whose shape only
appears when the field loses focus is text laid out by guesswork. Which in turn
is why `editor/inspect-focus.ts` exists — every keystroke rebuilds the panel
under the caret that produced it, so the caret is read off before the rebuild
and put back after it, and without that, typing a note gets one character in
and stops.

**Restyling one sets the tool**, so the next word is written the same way — the
reading every brush keeps about its own size, and the reason there is no second
control for "what the next one will look like". Two controls for one question
is how they end up disagreeing. The style lives on the scene
(`game/text-style.ts`), beside the active layer, because those are the two
facts a tap on bare ground needs.

Point and Text are the only two tools whose gesture *makes* something out of
bare ground, and the three things that have to be true about that gesture are
the same for both — so they are written side by side in `game/tap-makes.ts`,
where the one difference is on screen: **a point takes a space and a word takes
a position**. A point is a place the game reads back by name, so a space is
what it *is* and a sub-cell offset would be a number nothing downstream could
use; a word wants to sit beside a doorway rather than over the space the
doorway is in. Both are dragged a whole space at a time afterwards, which keeps
whatever offset the word landed with.

A tap picks a word up **before an image and after a point**, which is the order
its depth already implies: it is drawn at the front of its layer, so a tap that
landed on the letters and picked up the building under them would be picking
something the user cannot see they hit. What is hit-tested is the measured box
rather than the glyphs — the gap inside an O is not a hole anybody expects a
tap to fall through.

**Converting is that same rasterisation at `EXPORT_SCALE`**, with the pixels
read back — so `editor/text-actions.ts` adds a `getImageData` to what the
canvas is already showing and nothing else about the layout. The file is named
after the words — `door to the cave` becomes `door-to-the-cave.psd` —
which is better than the `text-m2k9f1` every other conversion has to settle for,
because a fill and a sketch have no words in them to name it with.

### A layer that has wandered, and the way back

Opening a unit up is the one gesture that can leave a PSD's layers somewhere the
file does not put them, and until now it was a one-way door. Nothing on the
canvas could say a layer had moved — a roof dragged half a space sideways looks
exactly like a roof drawn half a space sideways — and a **re-parse does not put
it back**, which is the part worth being clear about: `reviseExisting`
recomputes each placement from *its own* anchor cell, and moving a layer is
precisely a change to that cell. So the arrangement was gone, silently, with the
file still saying something else.

**The document already knows.** Every placement one `placePsd` makes is anchored
to the same grid space, and the file's own arrangement is then carried by each
placement's offset from that space — `positionFrom` over the layer's position
inside the canvas. That offset survives everything the canvas does to a *whole*
unit: a drag moves every anchor by the same cell step, and a resize scales every
member against the union box and moves every anchor by the same step again. So a
unit whose members disagree about which space they are on is exactly a unit
somebody has moved a layer in, and `displacedMembers` in `game/layer-home.ts` is
that tally. No manifest is read, and the common answer — nothing has moved — is
one pass over three placements, which is what lets the inspector ask it on every
render.

It decides what putting them back *means*, too. Each displaced member keeps the
offset it is holding — that offset is still the PSD's own — and is carried onto
the space the rest of the file stands on, which is the drag run backwards: a
layer nudged three spaces and reset lands on the pixel it left from, however the
placement has been resized since. Recomputing from the manifest instead would
have been a second answer to a question the document had already answered, and a
wrong one for a file that has been through Photoshop since.

**Which space is "the rest of the file" is a vote.** `unitAnchor` takes the
space most of the unit's layers still agree about, because four layers with one
dragged away name the space the other three are on. An even split falls to the
**back-most** layer's space — the back of a PSD's stack is the ground of whatever
is drawn in it, walls under a roof and an extrusion's silhouette under its
shading — so a two-layer file whose roof was nudged puts the roof back rather
than carrying the walls after it. It is a tie-break rather than a claim about
intent, and it is honest about the case it cannot get right: move the *ground*
layer of a two-layer file, reset, and the other layer follows it, because the
document holds nothing that could tell that apart from the first case. What
comes back either way is the file's arrangement.

**Reset Layer Position** is therefore a row of its own directly over the layer
list rather than a fourth button in the row above it (`resetPositionsRow`). Those
three are always there and are about the file; this is usually absent and is
about the document, and its *appearing* is the whole notice. It asks before
acting — `editor/layer-positions.ts` — because it is work somebody did that will
not exist afterwards, and it names the layers while the list is short enough to
read. The write is one `history.group`, like the drag that made the mess, so undo
reaches it in one step.

The unit is read out of the selection **before** the sheet goes up and acted on
by id afterwards. A sheet is a round trip through the user and the selection is
free to move under it; a unit that has gone in the meantime is dropped rather
than half-reset.

## Three kinds of layer

A layer says what it is *for*, and that decides what putting a PSD on it
means. `LayerKind` is `"object" | "pattern" | "background"`, and everything
that reads it goes through `layerKind()` in `lib/layer-kinds.ts`.

**Absent is object.** Every layer in every document written before there was
more than one kind has no `kind` field, and every one of them is an object
layer — the reading the whole editor was written against. So the migration is
a default rather than a rewrite: nothing walks the document on open, nothing
is written back, and a project opened by an older build still reads. A layer
made *now* writes `"object"` out even so, so nothing downstream has to tell
"old" from "deliberately an object".

The types are in `types.ts`, beside the rest of the document's shape; the
functions over them are `lib/layer-kinds.ts`, which the store reaches through
one hatch — `DocStore.editLayer`. That split is the line rule and a real seam
at once: the store is about the document, and what a *kind* of layer holds is
a different question it has no opinion on.

### An object layer's one rule

A placed PSD needs `P | anchor` at the **root** of its stack. Without it the
row greys out and says *No anchor*, under the layer and in the inspector.

Not the same question `manifest.anchor` answers. That one finds the mark
wherever it is, because a file whose author tucked it inside a folder should
still land where they put it. `hasRootAnchor` is the *rule*: the mark has to be
a top-level layer, where anybody opening the file sees it and nothing else in
the stack can hide it, turn it off, or take it away by being deleted.

It is not a refusal, and that is deliberate. The artwork is placed and it
draws; what it cannot do is come home from Photoshop lined up on the same
space, because there is nothing in the file to line up on — `anchorOffset`
falls back to the canvas centre, which moves the moment anyone crops. That is
worth saying where the file is listed and not worth throwing artwork away
over. The grid footprint stays optional for the same reason it always was: it
is an orienting mark, not a fact anything reads back.

**Asked, not cached.** `PsdPlacements.anchored` reads psd-to-phaser's own copy
of the manifest — `getData(key).original` — rather than a field on the
placement. A cache would have to be kept in step through a re-import, a
rewritten layer stack and a rename, three edits that can each take the mark
away, and a stale *anchored* is exactly the reassurance this exists to
withhold. A key that has not loaded answers **true**: the panel greys a row to
say a file is wrong, and saying so about a file nobody has read yet would put
the warning on every row for the first second of every session. `onPsdsLoaded`
is what re-renders the panels once the manifests are in — nothing in the
document moves when they arrive, so the change event the panels normally
listen to never fires.

The rule is an object layer's alone. A pattern layer's placements are a
palette and a background layer's are scenery; neither is a thing standing on a
grid space, so neither has anywhere to be anchored *to*.

### A pattern layer holds a rule, not a scene

There is no world bound in this editor to fill. The lattice is recomputed from
the camera over exactly the cells the viewport can see, and a pattern has to
be able to do the same — so what is stored is four numbers and a list of
shapes, and what falls where is worked out on demand.

`PatternSpec` is the type: an arrangement (`random` or `grid`), a density, a
repeat in grid spaces, a seed, and the shapes it is confined to. `lib/pattern.ts`
is the generator, and it is asked *what falls in this repeat tile* one tile at
a time. The tile's own coordinates are part of the seed, which is what buys
three things at once: the same space answers the same way whatever route the
camera took to get there, so panning never re-rolls the pattern under you;
`patternInstances` over a wide range and over a narrow one inside it agree
exactly, so the edge of the viewport is not a seam; and the exported game
regenerates the arrangement from the same four numbers rather than being
shipped ten thousand positions.

**The placements on a pattern layer are its palette.** They are what the
pattern is made of rather than things standing anywhere, so nothing reads the
`x`/`y` a placement carries as a position — what is read is the *offset* from
the space the file was anchored to, which is what makes a copy of a tree stand
on its space exactly the way the original did. It is also the only reading
under which the inspector's size controls mean anything there: resizing the
file resizes every copy of it. `doc-renderer.ts` and the minimap both skip
those placements, and so does the scaffolded `placeDocument`; drawing them
where the document holds them would put one of every element in a heap on the
anchor space, underneath the pattern made of them.

`game/pattern-render.ts` makes copies as they come into view and destroys them
as they leave, keyed by tile and index, so panning back over ground you have
already crossed re-uses what is there.

**The exported game has to wait for the same load the document waits for, and
it did not.** `placeDocument` has always held off until `psdLoadComplete` —
`loadMultiple` queues its images from a promise callback that lands one
microtask after Phaser has called `create`, so a placement made from `create`
is a placement against textures that have not arrived. `syncPatterns` looked
like it needed no such care, because it runs every frame and could simply try
again. It cannot, and the reason is the cache that makes it cheap: a copy is
**kept**, keyed by the tile it belongs to. psd-to-phaser's `place` against a
parsed manifest whose textures are missing does not fail — it warns, and hands
back a group with no sprites in it — so the first call cached an empty group
for every tile on screen and nothing ever revisited them. `create` is exactly
that moment, and the tiles on screen then are the ones you are looking at. The
symptom was a pattern layer that never appeared in the exported game while the
editor drew it perfectly, which is about as far from its cause as a bug gets.
Both templates now read `psdsReady` at the top of `syncPatterns`, and
`both_scenes_hold_their_patterns_until_the_psds_are_in` pins the guard ahead of
the place on both genres.

The editor's own renderer was never exposed to this: `canPlace` asks
`PsdPlacements` whether the *texture* is in, not just the manifest, and a range
with anything missing from it is not remembered. The templates cannot ask that
question — they have no `PsdPlacements` — so they ask the one they can. `MAX_ON_SCREEN` is a ceiling rather
than a budget: a density typed one digit too long is four thousand Phaser
groups, and the difference between a slow pan and an editor that has stopped
answering is whether anything said no. The console says when it bites, because
a pattern that silently stops half way across the screen looks like a bug in
the pattern.

**A copy must be let go of before its textures are.** A re-import, a rename
and a repoint each evict the textures behind a key and load them again, and
the doc renderer's `detachKey` has always covered its own objects. A pattern
layer's copies are the first Phaser objects on this canvas the *document* has
no record of, so nothing knew to tell them — and a sprite drawing against a
frame whose source has been destroyed is not a blank sprite. It is
`frame.source.resolution` of null, thrown inside the renderer, on every frame
from then on: the pass dies part-way through and nothing is flushed, so the
lattice stops appearing and the canvas freezes on its last good frame.
`PsdHost.releaseKey` is the hook, called beside every `detachKey`, and it is
where a future renderer that makes objects from a PSD hooks in too.

`invalidate` is not enough on its own, which is the part worth remembering: a
copy is kept when the file it came from still *looks* the same, and after a
re-import that is exactly the case — same key, same layer path, same size, and
a texture that has gone. `dropKey` destroys.

Nor is dropping enough on its own, which is the second half of the same bug.
`dropKey` runs *before* the eviction and the load that replaces it, and this
renderer is on the frame loop — so it went straight on to rebuild inside that
window, against textures that were not there, and psd-to-phaser answered
*Texture not found for sprite*. The empty sprites then stayed, because the
next frame found copies whose file still looked the same and left them alone:
the pattern was broken over exactly the ground that was in view when the file
was rewritten, and came right the moment you panned somewhere that had to be
built fresh.

**Three questions, and the first two are not the same** — `PsdPlacements.canPlace`
is all three, and both renderers ask it rather than keeping opinions of their
own. `getData(key)` says the *manifest* parsed, and psd-to-phaser records that
the moment `data.json` lands, several frames before any image does. The
**texture** is what its own `place` looks for, keyed on the manifest layer's
own name — `textureKey` — and missing it is what prints that warning. Asking
only the first was the whole of the second round of this bug: adding a layer to
a file placed on a pattern layer printed it once per copy on screen, and a
rename made every copy vanish. And **held** is the third, because there is an
instant before an eviction where both of the others say yes and the textures
are about to go.

`PsdPlacements.offline` is what holds it. Every rewrite — a re-parse, a
rename, a repoint — is the same four steps in the same order: take down what
is standing on the file, evict its textures, load the new ones, place again.
Doing that by hand at three call sites is how the fourth forgets, and the
fourth did: the *document* renderer learned to ask for an object when the
canvas lacks one (below), the rename's own rewrite fires a document change,
and a change is a repaint. So the bracket is one method, it holds every key
the edit touches — a rename holds both names — and the release is in a
`finally`, because a key left held is a key nothing would ever draw again.

Beside all that, **a range with anything missing from it is not remembered**,
so the next frame tries the whole thing again. That is what makes the window
self-healing rather than a handshake between two objects that have to be kept
in step.

**PSD Edit mode is the one thing that draws a palette where it stands.** It frames
the PSD's own canvas at the space the file is anchored to, and on a pattern
layer nothing is ever drawn there — so it opened on an empty box, which was
correct and useless. `DocRenderer.revealInstance` puts the prototype back for
the length of a session, derived in `psd-edit.ts`'s `sync` the way extrude derives
its own suppression, so that however the mode ends the canvas goes back to
what it was. Revealing by itself was not enough either: nothing had ever
*placed* that unit, so there was no object to show. `DocRenderer.draws` is the
one answer both the renderer's sweep and `PsdPlacements.placeOne` read — a
sweep that destroys what a placement has just attached is a flash of a heap of
elements on the anchor space, and a placement that never happens is a reveal
with nothing in it — and `placeUnit` is what makes the objects.

**And a layer that can refuse to draw its placements needs the other
direction too.** This renderer *updates* what it has been handed; something
else makes the objects, because making one is an ask of psd-to-phaser and
`doc-renderer.ts` knows nothing about loading. That was fine while every
placement was drawn from the moment it was made. Carry a PSD off a pattern
layer onto an object one and the document says draw it, nothing on the canvas
answers to it, and what you get is a selection outline around an empty box.
`setPlacer` is the way back: the sweep collects the placements it draws and
has nothing for, and asks — after the sweep, and behind a flag, because
`attach` runs the sweep again for each one and the first would otherwise
recurse through the rest of the list.

It also made this renderer a thing that creates objects, which it had never
been, and that is what broke renaming a PSD: the rewrite fires a document
change, a change is a repaint, and a repaint now asks for an object at exactly
the moment the old textures have gone and the new ones have not arrived.
`canPlace` is what it asks, so the window closes for both renderers at once.

**And `attach` destroys what it replaces.** `placements` is the only handle
anything has on a placed object — `detachKey` works from it, and so does the
sweep — so an entry overwritten in place left a live Phaser object that
nothing could ever take down. Invisible while its textures lasted, and a throw
inside the renderer on every frame the moment they were evicted. That is not
an exotic path: PSD Edit mode's Apply derives the canvas state on every progress
line the pipeline emits, so the same placement was placed a dozen times while
the file was written and then had its textures pulled from under every orphan
at once. The fix is in `attach` rather than at the caller, because the next
caller driven by a callback will do the same thing — and `revealInstance`
answers whether anything *changed*, so being told the same thing again costs
nothing at all.

**Nothing on one is picked on the canvas.** `picking.ts` makes a pattern layer
inert to the pointer, for the reason a locked one is but a different one:
there is no single object under the pointer for a tap to *name*. The copies
belong to no record. A pattern layer is reached from the sidebar, which is
where the thing it holds actually is.

**The repeat follows the type while it is still a default.** Switching from
random to grid brings grid's own 10 × 10, because 20 × 20 is what a scatter
arrives with rather than a number anybody chose — but a repeat somebody typed
is theirs, and switching type is not a reason to throw it away. The same
distinction a collider draws between a guess and an answer, and `edited` is
what a collider uses; here the test is whether the numbers are still the ones
the old type ships with.

### Shapes, and why a drawn one is baked

An empty shape list means everywhere, which is the default and the whole of
what makes a fresh pattern layer infinite. A shape in it confines the pattern
to the spaces it covers.

A shape is **the spaces it covers**, and a drawn one keeps its outline beside
them. What a pattern asks of a shape is *is this space inside*, once per
element per frame, and a point-in-polygon walk over a few hundred vertices at
that rate is the difference between a pan and a stall — so a drawn outline is
baked down to cells the moment it is made (`cellsInPolygon`), and the line is
kept only so the canvas can draw what somebody actually drew. A shape carrying
only an outline — which only a hand-edited document could hold — confines the
pattern to **nothing** rather than to everything, since the alternative is a
shape list that silently stops confining anything.

**They are drawn while their layer is the selection's, and not otherwise.**
That is the rule every other mark this editor makes about the document already
keeps — a placement's box, a fill's outline, a zone's wash all appear when the
thing is chosen and go when it is not — and a shape had been exempt from it.
Left up unconditionally it does not read as a boundary; it reads as a patch of
grid that has been highlighted and cannot be un-highlighted, which is exactly
how it was reported. `PatternRender.drawShapes` takes the layer the selection
names — `selectionLayer` in `lib/selection.ts`, which is every kind but
`none` and `region` — and the focus is part of the signature `sync` compares,
because a selection moving from one layer to another changes what is drawn
without moving the camera a pixel. Mask mode draws its own, so there is always
a way to look at one on purpose.

### Mask mode

The fourth canvas mode, and the one that replaced a mechanism rather than
adding a feature.

**What it replaced.** Making a shape used to be a *request*: press Add Shape
and the editor remembered which layer had asked while you went and made a
gesture somewhere else. Two buttons set that request and two other buttons, in
two other panels, consumed it. The **select** half worked — long-press a patch
of grid, press *Pattern Shape* on the floating bar. The **draw** half was
wrong in three ways at once, and each of them was silent:

- the pencil was left loose over the whole editor, with nothing on the canvas
  saying anything was waiting for it;
- *Finish shape* took **every stroke on the layer**, including ink that had
  been there for an hour, and deleted it;
- and it concatenated all of them into one path before simplifying, so two
  separate loops came back as a single polygon with a corridor running between
  them.

The answer is not a better Finish button. A boundary drawn on the grid is the
same kind of work as a collider drawn on the grid, and this editor already
knows what that looks like: a mode that owns the canvas, dims what is not the
subject, says what the pointer does, and has one way in and two ways out.

`game/mask-mode.ts` is the state, `game/mask-render.ts` the dim and the
shapes, `editor/mask.ts` the session, `editor/mask-bar.ts` the bar — the same
four-file shape collider mode has, and mostly the same code: a set of grid
spaces in absolute coordinates, an add tool and a remove tool, its own
`UndoHistory`, and nothing reaching the document until Apply.

**One shape, not the mask.** The mode edits one of a layer's shapes rather
than the union of them. The union is simpler to hold and it would collapse a
layer's named shapes into one anonymous blob the first time anybody opened it
— so the panel's rows keep their Remove and grow an **Edit**, and *Add shape*
opens the mode on one that does not exist yet. Apply on a new shape adds it;
Apply on an existing one rewrites its cells in place, keeping its id, its name
and its place in the list, because everything else refers to it by id and rows
that reshuffled under the user's hand would be worse than any of this.

**And it loses its outline when the spaces move.** `writePatternShape` drops
`points` on a shape whose cells changed, which is the honest answer rather
than a convenience: the line is kept so the canvas can draw what somebody
drew, and once the spaces are not the ones that line enclosed, the line is a
drawing of a shape that no longer exists. Cells that come back unchanged mean
nothing was swept, so the line still describes them and stays.

**The gesture is a sweep, not a paint.** Press, drag a rectangle, release, and
every space it covered is added — or taken away, with Remove up. That is where
it parts company with collider mode, which paints space by space. A collider
is a handful of spaces under one file and painting them one at a time is the
whole job; a pattern's boundary is tens or hundreds of spaces and it is the
shape of a *region*. It is also the gesture the working half of the old route
already used, so the one that worked is the one that survived — it simply
happens inside a mode now. A press that never travels is a 1 × 1 sweep, so a
tap paints one space without a rule of its own, and `tap` claims the gesture
and does nothing else because the rig reports a press that did not move as a
tap *as well as* a drag.

**The release is where the step is.** One entry in the mode's undo stack per
sweep, however many spaces it covered — `record` rather than a `begin`/`end`
bracket, because unlike a paint drag there is exactly one write and it is the
one at the end.

**Reset is not Clear.** Reset goes back to the shape as the mode found it,
which on a shape somebody made last week is that shape; a Reset that emptied
would be a delete key wearing another name. Clear is the one that empties, and
it is there because emptying is sometimes the point — but **Apply refuses an
empty shape**, since an empty shape *list* is what makes a pattern layer
infinite and a shape holding no spaces would confine the pattern to nowhere.
So the way to get rid of one is Clear, then Cancel, then Remove on its row.

**The layer's other shapes are outlined behind the one in hand**, faintly, in
the same accent. Editing one boundary without seeing the ones it sits beside
is editing blind, and this is the one place in the editor where that would
happen. `pattern-render.ts` draws nothing at all while the mode is up, for the
other half of the same reason: it would draw the document's copy of the shape
being edited, which is by then the version before the edit.

**The two shortcuts survive.** *Pattern Shape* on the floating bar over a grid
selection **seeds** the mode rather than writing a shape — so the spaces can
still be trimmed and Cancel still means nothing happened. And a lassoed sketch
can still be handed over from the sketch panel, which is the one route that
keeps the line that was drawn; it is offered when the *ink's own layer* is a
pattern layer, which needs nothing remembered. `editor/pattern-actions.ts` is
what is left of the held request, and it is a quarter of what it was.

### A background layer is the backdrop

`Background` is a colour or a gradient, and both are camera-locked with no
extent: a backdrop is wherever the camera is looking, which on a world with no
edge is the only reading that never eventually shows its own. So there is
nothing to position and nothing to size, and the inspector offers colours and
a direction and nothing else.

`game/background-render.ts` draws the camera's own `worldView` rather than
using `setScrollFactor(0)`. A scroll factor of zero pins an object to the
camera but not to its *zoom*, so a backdrop sized to the viewport in screen
pixels shrinks away from the corners the moment anybody zooms out. Following
the world view is the same answer with none of that. Gradients go in as
Phaser's four corner colours, each corner sampled off the gradient's own axis
— which is what makes an angle mean anything at all through an API that only
takes four colours.

**The lattice floats over them.** A backdrop is a flat colour across the whole
view, and a backdrop over the grid is a canvas with nothing left to build on —
which is what it did, because a backdrop sits inside its layer's own depth slot
and the lattice was pinned at −10,000, under everything. The fix moves the
*grid* rather than the backdrops, and which of the two moves is the whole
decision. Where a background layer sits among the others is something somebody
chose and the exported game honours it, so pushing every backdrop under the
document would make Play show a different world from the one you built. The
lattice is the other kind of thing entirely: it is scaffolding for building on,
it is what a selection is measured in, and **it does not exist in the game at
all** — no template draws it. So `GridRenderer.setBackdropDepth` takes the
front-most backdrop's depth from `BackgroundRender.frontDepth` and sits half a
step above it, which is still below anything standing on that layer: the
lattice never covers a fill, a point or a placed file, on that layer or any
layer in front of it. With no visible backdrop it goes back under everything,
where it has always been.

**An image background is a placement, not a record.** A picture painted in
Photoshop is a thing of a certain size standing in a certain place, which is
what a `Placement` already is, and the editor and the exported game both
already load, place, scale and stack one. A second kind of record holding the
same key would be two things to keep in step for nothing. What makes it a
background is the layer it is on.

The file is written in Rust — `psd_background.rs` — and no pixels cross the
bridge. A backdrop is an RGBA buffer the size of the whole backdrop, and
base64 of a big one is hundreds of megabytes of string through an IPC bridge.
Zeroed pages cost almost nothing to allocate and compress to almost nothing in
the file, so the one place the size is real is `MAX_BACKGROUND_PIXELS`, which
turns a careless count from an allocation nobody recovers from into a sentence
naming the limit. The sheet holds the same number and says so while somebody
is still typing.

**A tile is a grid space.** The sheet asks for a count and Rust is told a size
in pixels, because how wide a space is — and whether it is a diamond — is
something only the editor knows. It was psd-to-json's 512px slice, which is a
number about how a tileset is cut up for the runtime to load and says nothing
about how much ground a backdrop covers: "thirty tiles wide" came out fifteen
thousand pixels across on a thirty-two pixel grid, four hundred and eighty
spaces of ground for a strip somebody wanted thirty. The slice is still 512
and still `ProcessOptions`'; it is simply not the question being asked. What
the editor sends is `generatePsdForRegion`'s arithmetic — the range's world
bounds at `EXPORT_SCALE`, with `marksForSelection`'s footprint — so the file
opens with the grid drawn on it and lands over exactly the spaces asked for.

Writing one is the longest wait in the editor, most of it inside a single
`await`, so `openPsdProgress` holds an undismissable sheet with the shared
indeterminate bar and each stage the pipeline names. The stages are the ones
already going to the console drawer as `psd-log-line`; nothing new is
reported, it is simply put in front of whoever is waiting.

It is anchored on the origin space with its **top-left** on it rather than
centred the way an imported image is: a backdrop has an opinion about where it
begins and none about where its middle is, and a strip thirty spaces wide
centred on the origin would start fifteen spaces off the left of everything
anybody has built.

**What a painted `T | Background` becomes is not what it looks like.** It
comes back as a **tileset**, cut into slices whose textures are
`Background_tile_<col>_<row>`; nothing is ever loaded under the name
`Background`, and the sprite row the artist paints into is a *child* of the
tileset that psd-to-phaser never loads as a sprite — its categoriser descends
into a group and stops at a tileset. Both ends of the editor were asking the
sprite question about it: `canPlace` looked for a texture named `Background`,
answered no every frame, and never placed a backdrop that had been written,
parsed and loaded; and `reportMissing` warned that `background` had no texture,
which is true and means nothing. `textureNeeds` in `lib/manifest.ts` is now
the single answer to *which textures is this layer owed*, read by both, and
pinned on the Rust side by `a_painted_backdrop_is_a_tileset_of_slices`.

### What the exported game is told

`game_config.rs` carries `kind` on every layer — written out as `"object"`
where the document is silent, so no reader of the file has to know that absent
means object — plus the pattern's rule and a background layer's backdrops.
Both ride through opaque: a pattern is a rule the scene's own code runs, and a
backdrop is two colours and an angle, so passing them along is the whole of
what Rust has to do with them.

The scene templates gain three marked blocks: `paintBackgrounds`,
`placePatterns`, and `patternRule` — the generator itself, mirroring
`lib/pattern.ts` line for line. The generator is **in the scene file** rather
than in `js/shared/`, which is the one thing here that looks like a mistake
and is not. A project's `game/` tree is its own copy and only `addMissingBlocks`
can carry a new feature into one that predates it; an import at the top of a
scaffolded module is outside every block, so a helper in another file could
never reach a project made before today. That is also why the shared modules
kept their markers when they stopped being mixed with anybody's code: a file
being the editor's end to end does not give it a way to be *updated*.

Keep the two copies in step. The same rule the editor drew has to come out of
the game, or Play shows a different world from the one you built —
`lib/__tests__/pattern.test.ts` pins the contract both depend on rather than a
screenshot of the numbers.

### The order placed files draw in, and who chooses it

Within a document layer, the order is `lib/units.ts`. A placed PSD is a
**unit** — one placement per placeable layer in the file, sharing an
`instance` — and `layer.placements` is the units flattened, so the list the
panel shows and the order the canvas draws in are the same fact.

Dragging a row by its grip used to mean one thing: carry this file to another
layer. It now means two, decided by where the finger ends up — over a
different layer it is still a carry, and that layer lights up; over its own it
is a **reorder**, and the row travels through the DOM as it goes, the way a
layer row does. One gesture, because that is how it reads: a layer row takes a
position in a list, and a file takes a layer *or* a position. `reorderUnit`
moves every placement of the unit as a block and leaves `order` — what is on
top *inside* the file — alone, because that is the file's business.

**An isometric object layer does not get a say, and the panel says so by
listing differently.** `drawOrder` sorts units on screen Y there, so a thing
standing nearer the viewer draws in front of one behind it — that is not a
default a manual order should override, it is what makes the projection read
as a space at all. So `unitsInDrawOrder` sorts the *list* the same way, and
the grip carries without reordering: a list in document order under a canvas
that ignored it would be a row that stayed where you put it while nothing
moved. The sort is stable, so two units on the same row keep the document's
order.

**A pattern or background layer is not that, on either projection.**
Y-sorting answers *which of these two things is nearer*, and neither kind
holds things standing in the space for it to answer about. A pattern layer's
placements are the palette a rule scatters, every one anchored on the same
grid space, and `paletteOf` reads `layer.placements` straight through to
decide which element lands where — so sorting them on Y sorts a column of
identical numbers while the order that really matters was the document's all
along. A background layer's are backdrops: parallax bands, a horizon, a sky,
behind everything and often behind each other at the same Y, where which is in
front is a decision rather than a position.

`ordersByHand(layer, isometric)` in `lib/units.ts` is the single answer, and
three things read it so they cannot disagree: `unitsInDrawOrder` for the list,
the panel for whether the grip reorders or only carries, and `DocRenderer` for
what it hands `drawOrder`. The scene template mirrors the same condition at
its own `placeDocument` call, so Play and a published export stack a layer of
backdrops the way the editor drew it.

Flat projections take the document's order straight through everywhere — to
the canvas through `drawOrder`, and to the exported game through
`game.config.json`, which carries `placements` in exactly that order.

### Two senses of "layer", and why the panels must not mix them

A **document layer** is Phaser's idea: draw order and visibility over anything
at all, and it is what the left panel lists. A **PSD layer** is Photoshop's,
and it is the inspector's subject — the stack inside one file, which the
inspector lists and rewrites.

The two met by accident. Placing a PSD makes one placement per placeable layer
in the file, and `layerItems` listed placements — so a three-layer tower put
three rows named `tower.psd` under Foreground, which reads as three towers and
is really one file's insides leaking into the panel about the canvas. The rows
are **units** now, one per placed file: `placedUnits` groups a layer's
placements by `instance`, and the row carries every member id in `members`.

That list is what makes the row behave like the thing it names. The canvas
selects whichever member the pointer landed on — a tap on the roof selects the
roof's placement — so a row matching only the id inside its own selection went
dark when you clicked the thing it was about; `isSelected` asks whether the
selection is *any* member. The grip carries all of them, which is why
`movePlacements` takes a list. And the detail column says "3 layers" rather
than naming one of them, because how deep a file is belongs in the panel that
can open it.

### What is drawn over what

`src/game/draw-order.ts` is this, split out of `doc-renderer.ts` when that file
reached its 700 lines — and a clean seam rather than a convenient one: nothing
in it touches Phaser's display list or the document store. It holds
`DEPTH_STRIDE`, `applyDepth`, `drawOrder` and `layerDepth`, which is the whole
answer to "which of these two is in front", and the exported game's
`shared/canvas.js` carries the same answer in blocks of its own because it
cannot import it.

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

- **Between placed PSDs**, an isometric *object* layer sorts on the **outermost
  edge of each unit's collider**: `max(cx + cy)` over the collider's spaces,
  plus one. Everything else leaves units in the order they were placed: every
  layer of a flat projection, and a pattern or background layer of either.
  `drawOrder` itself takes a plain boolean; the rule that decides it is
  `ordersByHand`, above.
- **Within one placed PSD**, the author's stack and nothing else.

**Why the collider's outer edge**, and why it took three goes to get there. The
key is looking for the corner of a thing's footprint nearest the camera — where
the two visible faces of a box meet, and the line straight up from that corner
is what a passer-by crosses to stop being behind it and start being in front.
On an isometric grid `cx + cy` counts rows away from the camera, so the largest
of a footprint's rows is that corner and the row after it is the line. Three
earlier answers were wrong in three different ways:

- The artwork's **top** edge, `min(p.y)`, is a fact about how *tall* a thing
  is. A short thing standing behind a tall one sorted in front of it, and a
  unit's place in the order moved whenever anybody redrew its roof.
- The unit's **anchor**, `cx + cy`, is the space the file hangs from — which on
  a footprint more than one space across is the *middle* of it. So anything
  walking through a building swapped over half way along, which is exactly what
  it looked like.
- The artwork's **bottom** edge, `max(y + height)`, is the right corner
  measured the wrong way: it reads the pixels. A cast shadow, a transparent
  margin or a picture pasted flat all move that edge and none of them move
  where the thing stands, so the line drifted off the ground it belonged to.

The **collider** is the same corner read off the record that already holds it.
A collider is which grid spaces a file stands on — "the spaces its base covers"
by default, or the ones an extrusion's voxels rest on at level zero (see *The
defaults*) — so what a thing sorts behind and what it blocks are the same
footprint by construction rather than by coincidence, and a footprint somebody
has corrected by hand corrects the sorting with it. It is also the one quantity
a thing that *walks* can work out for itself, because it is grid spaces rather
than a texture: see **A character sorts itself in**.

The lookup is handed in rather than read inside `drawOrder`, because the two
sides keep colliders in different places — the document holds one record per
PSD key, the exported config writes it onto the first placement of a unit — and
a unit with no collider recorded yet falls back to its anchor, which is the
old answer for the frame or two before the record lands.

A single number per object cannot be exactly right for every arrangement of
extended footprints — the exact rule is a pairwise "is A behind B" over the two
grid axes, and resolving it is a topological sort rather than a sort key. What
the near corner gets wrong is objects that do not overlap on screen anyway: a
wall running along one axis and something level with its far end sit side by
side rather than in front of each other.

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

**One placement can hold several sprites, and their order is its own.** A PSD
whose layers are inside a group is placed as a single unit — an extrusion is
three parts in one group — and psd-to-phaser hands that back as a Phaser
`Group` with its own `setDepth` grafted on, one that **recurses**: setting a
depth on the group gives every child the same number, which threw away the
stacking the manifest had already applied and left the parts to Phaser's
display-list order. The file was right and the canvas was wrong, which is the
hard version of this bug to find.

So `applyDepth` sets a group's children rather than the group: it ranks them
by the depth they already carry and spaces them *inside* the placement's own
step, at `depth + (rank + 1) / (n + 1)`. Fractions rather than whole numbers
because the step between placements is one, and a unit that spilled past its
step would sort against the placement in front of it. Ranking rather than
assigning by index makes a repaint idempotent — the second pass reads the
numbers the first one wrote and puts them back in the same order. A placement
holding one object is set directly, which is every converted image.

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

**The artwork is a group, not a sprite.** An extrusion is not one picture, and
flattening it threw that away before anyone saw the file. So the face list is
walked three times and the parts go in as `G | extrude-…` holding
`S | lines-…`, `S | shading-…` and `S | shape-…`, top-first as Photoshop
lists them:

- **shape** is every face in the one flat tone — the silhouette.
- **shading** is the walls in their own tones over it, which is what makes it
  read as a solid. A flat projection has none, and gets an empty layer rather
  than a different stack.
- **lines** are the edges between spaces.

Stacked in that order they composite to exactly what the canvas drew; taken
apart they are three things worth having separately. Every part is written at
the **same size and the same offset**, which is not housekeeping: psd-to-phaser
places a group as a Phaser Group and resizing one scales each child about its
own origin, so children with different origins would drift apart. Identical
geometry makes that operation exact.

**Two of the three have to earn on their own what the composite gets for
free**, and neither did at first.

The *shape* is stroked as well as filled, in its own tone. A silhouette
assembled out of dozens of separately filled quads is not a solid shape: two
antialiased boundaries meeting on a shared edge come to about three quarters
of full coverage between them, so the whole lattice was ghosted into the layer
that is meant to be the flat ground under it — the lines layer, printed into
the shape. And the silhouette stopped half a line short of the drawing at its
outer edge, because a stroke straddles the boundary it is drawn on. One stroke
in the fill's own colour answers both.

The *lines* rub out before they draw. On the canvas every face is filled
opaque and then stroked, so a face in front hides the edges of whatever is
behind it. A layer with no fills in it has nothing to hide them with, so every
occluded edge came through and the lines read as a wireframe: an overhang's
own edges and, straight through it, the edges of the ground it stands over. So
each face clears its own polygon out of what is already there — one
`destination-out` fill — before stroking its edges. Same order, same result,
nothing opaque left behind.

Neither is testable from node: both are facts about how Canvas2D composites,
and there is no canvas in vitest. They were checked by rendering a solid with
an overhang in the browser harness and comparing the three layers stacked
against a single-pass render of the same faces. Every remaining difference is
one pixel wide and lies along an edge — the antialiasing that layering costs —
and no differing pixel has a differing neighbour on all sides, which is what
would say a whole region had come out wrong.

The group is named after the key, which is also what the lone sprite was
called — so a document written before this keeps working, because a
placement's `layerPath` still resolves.

The footprint marks the spaces the solid **stands on**, not the ones its walls
reach across on screen: a tall block is anchored to the ground it was built
from, which is where it has to come back down. `shapeBounds` is taken from
every voxel rather than from the visible faces, because the underside of the
lowest layer is never drawn and a box that stopped at what is drawn would clip
it off the bottom of the file.

### Which way up a conversion's stack goes

One way up, now, for every file this editor writes: the footprint at the
bottom, the anchor over it, the artwork over both. `add_layer` stacks
bottom-up, so the marks go in first and the artwork last, and
`psd_from_rgba_marked`, `psd_from_parts_marked` and `psd_background`'s empty
backdrop all do it in that order.

It used to be a choice. `AnchorMarks.art_on_top` put the artwork over the
marks for a sketch and under them for everything else, on the reading that a
mark is *for* being painted under. The reading that won is the other one: the
artwork is the row the author cares about and the one row in the file anybody
would rename, and the marks are read-only rows the editor owns and regenerates
by name. A list that buried the author's layer under both of them read
backwards for a sketch, and it read backwards for an import too. The flag is
gone rather than defaulted, because a flag with one reachable value is a trap
for whoever reads it next.

Nothing is lost by the move, which is the part that had to be checked. A mark
is never *drawn over* the artwork in this editor — the canvas places neither,
`placeableLayers` drops both, and psd-to-json exports pixels for neither — so
the only place the order was ever visible is Photoshop's own canvas, and there
the marks are turned off anyway.

### The marks arrive turned off

`psd_marks::MARKS_LIT` is false. A mark is the editor's drawing rather than
the artist's, and every program that opens a PSD draws the file's **flattened
composite** — so a red dot and a lattice printed over the artwork was what a
finished import looked like everywhere except in the editor that wrote it. In
Photoshop the eye is the way back in: turn the grid on to line something up,
and off again.

It costs the anchor nothing, which is the only reason it is safe to do at all.
The anchor is what tells this editor where on the grid a file belongs, so a
pipeline that skipped hidden layers, or reported one at the origin, would
break every re-import silently. Four things make it true, and the round trip in
`tests/marks.rs` holds all four down at once:

- `psd_pipeline` asks psd-to-json for `hiddenLayers: "include"`, so a hidden
  layer is processed and written into the manifest like any other — see
  **Layer visibility**.
- A point's position comes off the layer's own rectangle, not out of its
  pixels: `process_point` reads `x + width / 2`.
- Neither `manifest.anchor` nor `hasRootAnchor` — the rule an object layer
  enforces — asks whether the mark is lit.
- `placeableLayers` drops both marks before anything is placed, so `hidden`
  and `hiddenParts` never see them either.

A **rewrite** hands the eye back rather than forcing it: `rewrite_parts_marked`
reads whatever the file being rewritten says, by predicate rather than by name
because the footprint carries its size in its own name and a second Apply can
rename it. That is the same trade `parts_group` makes for an extrusion's
layers — everything else about a mark is regenerated on purpose, its eye is
the user's — with the one difference that a file which has no such mark yet
gets a dark one rather than a lit one. Every other rewrite was already safe:
`LayerEdit.visible` is an `Option<bool>` and `None` means keep.

The one visible consequence elsewhere is `preview_data_url`, which composites a
PSD for an inspector preview and, like every compositor, skips hidden layers.
Nothing in the frontend calls it.

### A conversion keeps its ink until the artwork is standing

`PsdPlacements.place` answers whether anything landed. Two of its paths are
refusals with nothing on the canvas to show for them — a locked layer, a file
the pipeline found nothing placeable in — and `convertStrokesToPsd` *consumes*
what it converts. Taking the strokes away after a refusal is how a sketch
becomes nothing at all: no ink, no artwork, and no error anybody would connect
to either. So the ink now goes only once there is something standing where it
was.

`tests/sketching.rs` pins the other half, which is the half that is invisible
from inside the editor: a sketch that writes correctly and *exports* blank
looks exactly like a sketch that vanished, because the PSD opens perfectly in
Photoshop and the canvas shows nothing. Every other conversion sends a
rectangle of artwork filling most of its canvas; a sketch sends a few percent
of one, and its footprint is measured from the anchor *down* — so the anchor
lands on the top edge of the canvas and the dot drawn around it hangs six
pixels above it. Both cases go through the real pipeline and come back with
their ink counted.

### Room around what a conversion writes

A canvas cropped exactly to a block-out is a file with nowhere to draw the
eaves that hang past the wall. So Apply and the fill conversion both ask for a
**margin** — one grid space, in the grid's own shape, which is a tile's width
across and a tile's height down on a diamond — and `psd_marks::layout` grows
the canvas by it on every side.

The margin is a fact about the *canvas* and nothing else, which is the whole
of why it is safe. Every position in that layout is relative to the anchor,
the anchor moves out with the canvas, and the artwork keeps its offset from
it — so the picture does not move on the grid, its placement is not rewritten,
and its collider, which is derived from what the artwork covers, never sees
it. Padding the raster instead would have done all three: transparent pixels
in the exported sprite, a bigger box for `defaultCollider` to read, and a
converted fill blocking a ring of spaces around itself.

A blank project's cell is one pixel, so there the margin is the nominal grid
size the New Project sheet set — the same fallback `size` serves everywhere else
nothing rounds to it.

The size the command **reports** is the file's, not the buffer's. The three
commands that write a PSD from raw pixels used to echo back the raster they
were handed, which stopped describing the file the day marks existed — the
canvas already grew to hold the footprint beside the artwork — and the margin
made it wrong every time. `extrude-mtx2vyzs.psd (256×320)` in the console for
a file that is 512 × 448 is the one place the editor says how big a generated
PSD is, so all three now measure the file the way every import path already
did.

### A placed group keeps its parts where they were

`P2P.place()` hands back a Phaser **Group**, and a Group is not a container:
its children live on the scene's own display list at their own coordinates,
and the `setPosition` the plugin grafts on forwards one pair of numbers to
every one of them. So a placed group put every layer inside it on the
placement's corner. This is the same graft that flattened `setDepth` and threw
away an extrusion's stacking; the depth half was fixed and the position half
was not, because nothing showed it.

The margin is what showed it. A raster layer's bounds in Photoshop are the box
around its ink, so a file saved from there comes back with each part cropped
to what it actually draws — and an extrusion's three parts are *not* the same
picture. The shading paints the walls only, so its ink starts half a tile
below the silhouette's: on a 2 × 2 plate pulled up three, `shapeBounds` is
160 world pixels tall and the shading's ink is 128 of them, starting 32 down.
The parts go into the file at one rect on purpose, and Photoshop hands them
back at three. Painting into the clear canvas the margin leaves does the same
thing from the other end — new ink past the artwork moves the group's own
corner, which is the corner `placedPosition` measures the placement from. So
the next Re-parse drew the parts stacked on one corner instead of over each
other, and what that looks like is the whole thing jumping.

`game/placed-parts.ts` reads each piece's offset off the objects the plugin
has just made, while they still stand where the manifest put them, and every
move afterwards is made against those offsets rather than through the group.
The corner they are measured from is the pieces' own bounding corner, which is
exactly the box psd-to-json gives a group — the union of the layers in it — so
offset zero is the placement's own x and y and a single-sprite placement comes
out where it always did.

The offsets are in the PSD's own pixels, so they scale with the placement.
That is the other half of the same bug, and it was in Known gaps: a resized
group used to leave its parts the distance apart they were at 100%, because
`setScale` is forwarded to each child and a child scales about its own origin.
Positioning the parts from scaled offsets is what a Container would have done,
without needing one.

Generate PSD and the sketch conversion do not ask for one. The first is
defined as the size and shape of the selection, and the second as the ink plus
the spaces the ink covers; both would be saying something less true about
themselves with a margin on.

Nothing reaches the document until Apply. The shape lives in the mode object,
so Cancel is dropping it and entering play mode drops it too.

### A file that comes home without its mark

`P | anchor` is what keeps a PSD on its grid space, and a round trip through
Files gives it back untouched — the bytes that went out are the bytes that
come back, and an artist who resizes the canvas or moves the artwork moves the
dot with them, which is the design working rather than surviving. Run through
the real writer and the real pipeline, an extrusion re-imported as a PSD lands
on exactly the same world point it left from, and cropping every layer to its
ink on the way — which is what a paint app does on save — does not move it
either.

Two round trips do not give it back. An editor that **flattens** on save takes
the mark with every other layer, and an edit brought home through the photo
library or as a PNG arrives as a picture with no marks in it at all —
`reimport` writes none, because the file coming back is supposed to be
carrying its own.

`anchorOffset` answered that with the canvas centre. That is the only
defensible guess about a file nobody has placed, and a bad one about a file
already standing on the grid: the artwork moves by however far the centre is
from where the mark was. Measured on a 2 × 2 plate pulled up three — a
512 × 480 canvas with the artwork at (128, 64) and the dot at (256, 288) —
flattening moved it **64 world pixels sideways and 8 down**, a whole tile off
the grid, and coming back as a picture dropped it a **full tile height**. The
margin is what makes it that bad: the room is not symmetric about the anchor,
because the solid reaches up out of the footprint and the footprint stays
down, so the centre of the canvas is nowhere near the dot.

So `reconcile.ts` asks for the anchor once, at the top, and a file with no
mark is pinned by **what is already on the canvas** — `anchorImpliedBy` runs
the placement formula backwards over the first placement that still resolves,
giving the anchor that file would have needed to land where the thing is
standing now. Every other layer is positioned against the same point, so the
file's own arrangement is kept: a layer added in Photoshop still arrives
beside the one it was drawn beside. A key with no placements at all falls
through to the canvas centre, which is right — there is nothing to be pinned
by, and it is a first placement rather than a re-import.

The pin is recomputed on every parse, so a file that has lost its mark goes on
working. What it cannot do any more is **move**: re-anchoring by dragging the
dot in Photoshop is gone with the dot, so the console says so by name the
first time a parse finds no mark. Putting the mark back into a file that
arrived without one is the obvious next step and is not done here — it means
writing a layer into somebody else's stack, which is the one thing
`import_file_as_psd` deliberately does not do.

The placement's own box is still the **artwork**, not the canvas, which is
what makes the margin safe: `defaultCollider` reads that box for everything
that is not an extrusion, so a canvas-sized box would put a ring of blocked
spaces around every converted fill, and picking would catch a placement from a
space away from anything drawn. The room to paint in is real and is in the
file; it is deliberately not a bigger thing on the grid.

### Continuing an extrusion

Pixels cannot say where the columns were, so Apply used to be a one-way door.
The solid now goes into the document beside the artwork — `GameDoc.extrusions`,
keyed by PSD key — and the cube on the extruded layer's row in the inspector's
PSD layer list opens it back up. On the row rather than in Info because that is
where the layer it is about is: the button and the thing it acts on are the
same line.

The record is written **before** the artwork is placed. Placing selects the new
PSD and the inspector builds its layer list from that selection, so a record
written afterwards arrives too late for the row that offers the way back in.

**Keyed by the file, not carried on a placement**, because that is what the
shape is a fact about: two instances of one PSD are two views of the same
solid, and continuing either rewrites the file both draw. A rename moves the
record with the file and Make Unique copies it to the new key, for the same
reason.

**The record keeps the anchor it was written at.** A placement that has been
dragged since is now some number of spaces from where its voxels were
described, and the difference between the two anchors is exactly that
distance — so `translateShape` carries the shape the same way and it reopens
under its own artwork.

A resumed session holds **nothing**. There is no plate to pull, the shape is
already there, and guessing which of its faces someone came back for would be
worse than letting the next tap say.

**Apply rewrites the file rather than replacing it.**
`create_psd_group_from_rgba` builds a PSD from nothing — the group, the
footprint, the anchor — which is right for an import and wrong for a second
Apply: a layer painted over the greybox in Photoshop would not be preserved,
it would simply not be there any more. So there is a second command.
`psd_write::rewrite_parts_marked` parses the file that is already on disk,
regenerates the group's contents and both marks *each in the place they held
in the stack*, and carries every other layer across with its pixels, position,
name, opacity, visibility and blend mode — **nesting included**. Groups are
the one thing it had to learn, because the artwork it regenerates is one:
`Rebuild::items` reads a level of the stack by placing layers and groups in
the same index space (a group sits where its topmost child does) and sorting,
which is what interleaves them the way Photoshop shows them.

A file written before extrusions were groups has its artwork as a lone
top-level sprite named after the key. That layer is one of ours, so it is
dropped and the group takes its place — which migrates the file the first time
it is carried on.

**The anchor is what the preserved layers hang from.** A shape pulled further
out grows the canvas, which moves every canvas coordinate in the file — but
not relative to the anchor mark, which is the fixed point the whole marks
design is built on. So a preserved layer moves by the distance the anchor
moved, and the wall someone painted stays on the wall the greybox drew.

It is refused for a file carrying masks or clipping, which `LayerBuilder`
cannot express — the reason `psd_layers` refuses a rename of one. Groups are
no longer on that list, and now that the inspector's list is a tree they are
not on its list either: `unwritable_because` asks `unrebuildable_because` and
nothing more, so an extrusion's own file is listed the way any other file is,
with its group indented and its cube on the group's row.

Either way the mode stays up until the file is written: a refusal arriving
after the session had closed would have taken the shape with it.

The one thing that has to happen before the reload is the anchor on the
*document* side: a footprint that has grown past where it started moves the
space the artwork hangs from, and `reconcilePlacements` positions each
placement from the anchor the document holds.

**The unit steps aside while the work goes on.** A reopened solid stands on
exactly the ground its own flat artwork covers, and drawing both is seeing
double. `DocRenderer.suppressInstance` keeps it off the canvas without
touching the document, so a cancelled session leaves no trace — and it is
derived from the mode's state on every change rather than switched on and off
at each call site, so however the session ends the placement comes back.

**The record outlives everything that happens to the file.** A re-parse, a
re-import, a layer stack rewritten in the inspector: none of them change the
key, and the key is what it hangs from. That is the point — a way back into
extrude mode that editing the artwork takes away is no way back at all, and
the first pass dropped the record on exactly those edits for fear of
overwriting hand-painted work. The fear is real and is now stated where it
belongs, in the gaps below, rather than enforced by taking the feature away.

The key is also the more durable anchor than the placement would be:
reconciliation can remove a placement and adopt a replacement with a new id
when a layer is renamed outside the app, and the key does not move.

### Layers the app owns the name of

Some layers in a PSD belong to the editor rather than to whoever opens the
file, and their names are load-bearing. `P | anchor` is found *by name* on
every parse (`findAnchor`), so renaming it costs the artwork its alignment on
the next re-import — silently, a re-parse later. `Z | grid` is written by the
same pass. And an extrusion's artwork layer is regenerated under the file's own
key every time the solid is applied again, so a new name would survive exactly
one Apply.

`psdLayerOwner` is the rule and `PsdLayerEditor` renders it: an owned row is
read-only however writable the file is, and its field carries the reason as a
title rather than leaving the reader to discover that typing does nothing. It
reads `manifestName` rather than the whole label, because the exported name is
the second pipe segment and that is what both psd-to-json and a placement's
path are made of — so `P | anchor | note` is still the anchor.

`isMarkLayer` is the shared predicate, and the footprint is why it is a
predicate rather than a set: it carries its size in its name once it covers
more than one space — `grid-4x2` — so the match is a prefix. It was an
equality, which meant every multi-space import had a mark neither the reserved
name rule nor the placement filter recognised.

An owned layer may offer something in its place, which is the other half of
why the rule exists: the extrusion's row carries the cube that reopens the
mode that wrote it.

### One re-parse, one placed object per layer in the file

A re-parse turned one placed PSD into three: the artwork, and one apiece for
the two orienting marks. The extra two drew nothing, because psd-to-json
exports no pixels for a point or a zone — so the symptom was rows appearing in
the layer list with nothing to show for them on the canvas.

The cause is one bare string. `category` is what decides whether a layer is
artwork or metadata, it comes from a separate program on its own release
schedule, and `parseManifest` read it strictly: anything it did not recognise
fell to the default, `"group"`, which is placeable. So a spelling this parser
did not know — capitalised, plural, or carried under `type` — made every layer
in the file placeable, and `adoptNewLayers` dutifully gave each one a placement
of its own. Reading it strictly did not fail loudly; it failed by
*multiplying*.

Two things close it, and both are worth having on their own account.
`CATEGORIES` is now a table of every spelling to answer to, falling back to
`type` the way psd-to-phaser itself does and treating `tile` and `tileset`
alike, as it also does. And `placeableLayers` refuses the editor's own marks
**by name** whatever category the manifest gives them — `anchor` and `grid`
are reserved, which is the same fact the inspector states when it will not let
them be renamed.

Two smaller disagreements were fixed alongside. Adoption treats a top-level
layer as taken when a placement stands on it **or on anything nested under
it**, so a group whose child is placed is not a layer that has appeared. And
revision **repoints** a placement standing on a layer with no pixels onto the
file's first placeable one, keeping its id, instance and anchor — that
placement was drawing an empty group, which is the thing `placeableLayers`
exists to refuse. One comes to be there through the migration early builds
needed: `layerPath: "root"` was repointed at the file's *first* layer, which
for everything this editor generates is one of the marks drawn over the
artwork.

The reconciliation is `game/reconcile.ts`, split out of `psd-loader.ts`
because that file imports Phaser for its side of the loading contract and none
of this touches a canvas. The same bargain `instance.ts` and `resize.ts`
already make, and it is what lets all of the above be tests.

## Colliders

What a placed PSD stops. Until this existed the only geometry in a document
that a character could not walk through was a fill marked not-walkable or a
boundary drawn by hand, so every image on the grid was scenery and a tower was
something to walk through.

### It is a fact about the file, and it is stored as offsets

`GameDoc.colliders` is keyed by PSD key, beside `extrusions` and for the same
reason: two instances of one file are two views of the same thing, and a tree
that blocks the space it stands on blocks it wherever it is put. A copy made by
Make Unique takes the collider with it and the two part company from then on,
which is what Make Unique means everywhere else.

The spaces are **offsets from the anchor** — `{cx: 0, cy: 0}` is the space the
artwork hangs from. That is what lets a placement be dragged without anything
being rewritten, and it is what lets two placements of one file share one
record at all. `lib/collider.ts` is the arithmetic, and everything that reads
a collider goes through it: `colliderCells` for a top-down character routing
around spaces, `colliderBoxes` for a side-on one standing on rectangles.

A project whose grid does not snap has no spaces to name, so its collider is a
`rect` instead — measured from the anchor in the same units, since a cell
there is one world pixel. The same either-or `FillPatch` already carries, for
the same reason: a hundred thousand one-pixel records is not a document.

### The defaults, and why they are written rather than derived

Every placed key has a record. It is written when the PSD is placed, again
when the artwork changes under it, and backfilled on open for every document
written before this existed (`PsdPlacements.migrate`, beside the instance and
stacking migrations). Deriving it on demand instead would make a project play
differently depending on what had been looked at, and would put the same guess
in three places — the editor's two play modes and the exported game.

What the guess is depends on how the PSD was made:

- **An extrusion** is a solid whose shape is known exactly, so the default is
  the spaces its voxels rest on at **level zero** — `groundOffsets`. That is
  one rule with two readings. Under an isometric template it is the blocks
  that touch the ground, which is the 3D logic the mode was pulled with: an
  arch pulled up and over blocks its piers and not the road between them, and
  a shape hanging in the air with nothing at level zero blocks nothing, which
  is the honest reading of a shape you can walk under. Under an orthogonal one
  every voxel is at level zero already — `levelHeight` is 0 there — so the
  whole shape is a collider and nothing needed a second rule to say so.
- **Anything else** — an import, a converted sketch, a converted fill — has
  only its artwork, so the default is the spaces its **base** covers. On a
  square grid that is the whole picture: a sprite there occupies what it is
  drawn over, and a side-on project wants its full height as ground anyway.
  On a diamond grid it is the bottom tile-height of it, which is the same rule
  the extrusion gets, read for flat artwork — the projection puts *away* up
  the screen, so a 64 × 96 tower sweeps its bounding box across fourteen
  diamonds, thirteen of them the hillside behind it. Within that strip a space
  counts when its **middle** is under the artwork rather than when the two
  merely overlap, because a diamond the base clips a corner off is a space
  beside the tower, and blocking it is what makes a character stop a tile
  short of everything. The middle can miss every space — a picture smaller
  than one, dropped between four — so the space under the middle of the base
  is the floor: a collider is never empty for want of a rounding. Past
  `MAX_COLLIDER_CELLS` the whole thing falls back to the box, because a
  default derived from something somebody resized to the width of a continent
  should not be a hundred thousand records.

Blocking, in every case. A placed thing being solid is what makes the toggle
worth having — a document where nothing collides until each file has been
visited one at a time is the state this exists to end — and it is the default
a fresh fill already takes.

`edited` is what keeps the two halves apart. A default is a guess that has not
been corrected yet, so it is recomputed whenever the thing it was guessed from
changes: the artwork's footprint on a re-import, the solid's ground on a
second Apply. An edited collider is somebody's answer, and neither of those is
a reason to throw it away. Apply sets it only when the shape actually differs
from the default, so drawing a space and rubbing it out again leaves a default
that still follows its artwork.

### Collider mode

Extrude mode one dimension down, and deliberately the same shape: a scrim, a
bar along the bottom, the mode owning the pointer while it is up, and nothing
reaching the document until Apply. `game/collider-mode.ts` holds the spaces in
absolute grid coordinates because that is what the pointer hands over; Apply
turns them back into offsets.

What differs is the middle of the bar. Extrude's toggles describe the *view* —
see through the shape, rub spaces out — and these describe the *edit*: Add and
Remove are a pair with a pressed state because one of them is always true, and
Reset is a plain button because it happens once and is over. The dim is
lighter than extrude mode's, because there the solid replaces what is under it
and here the artwork *is* what you are aiming at.

Both tools are idempotent, and that is load-bearing rather than tidy: the
gesture arbiter reports a press that never moved as a drag **and** as a tap,
so a click paints the same space twice. Adding an added space or removing a
removed one has to be nothing, or every click would undo itself.

The mode is refused where the grid does not snap, as extrude mode is, and the
inspector replaces the button with the reason rather than offering it and
declining.

**`game/canvas-modes.ts` is what asks them.** Four modes that own the canvas
now, entered from places that have no reason to know about each other — the
floating action bar, a row of the inspector, a row of a PSD's layer list, a
pattern layer's own panel — so entering one leaves the others there rather than
by convention. It is also the one place the scene asks "has a mode claimed this
gesture": call sites deciding for themselves is how a mode ends up owning drags
but not taps.

### What reads it

**The game does, and nothing else.** Play runs the project's own code over
`game.config.json`, which is regenerated on every save, so there is one
implementation of what a collider means rather than one in the editor and
another in the export. `grid.js` turns a collider into spaces or boxes —
`colliderCells` and `colliderBoxes` — and the two genres read it the way each
needs to: a top-down `shared/character.js` builds the blocked set once when it
spawns, because `isWalkable` runs per node of every search and the document
does not change under a running game, and `physics.js` adds the boxes to the
ground the character stands on.

Spaces are taken as spaces wherever the document has them. Reducing an
isometric diamond to its bounding box first would block the neighbours its
corners reach into, so only a project whose grid does not snap goes through
boxes — and there the collider *is* a box.

`game_config.rs` decides **which** placement carries it: a collider rides on
the first placement of each unit and on none of the others, so a PSD placed as
three layers contributes its ground once rather than three times. What Rust
does not do is the arithmetic. The offsets and the anchor travel unresolved,
because adding them up needs the projection and the projection lives in
`grid.js` — resolving in Rust would mean a second copy of `cellToWorld` to
keep in step with the one the game already has.

A collider is document-level, beside the extrusions and for the same reason: a
PSD can stand in more than one scene and blocks the same spaces in each. So
the export hands every scene the same map, and the backfill on open covers
every scene's keys rather than the open scene's — a file standing somewhere
nobody has looked at this session is still in the published game.

## PSD Edit mode

Drawing straight into one layer of a PSD, from the canvas, without a trip out
to Photoshop. Entered from the pen on a sprite row of the inspector's layer
list — the same place, and the same idea, as the cube on an extrusion's row.

`game/psd-edit-mode.ts` is the state, `game/psd-edit-render.ts` the frame and the dim,
`editor/psd-edit.ts` the session, `editor/psd-edit-bar.ts` the bar, and
`src-tauri/src/psd_paint.rs` the pixels.

### The frame is the document, not the artwork

A placement's outline is **one layer's pixels cropped to what is in them**,
and that is not where the PSD ends. Everything this editor writes gets a grid
space of clear canvas around it — see *Room around what a conversion writes* —
and a multi-layer file's canvas is bigger than any one of its layers by
construction. So a frame drawn from the placement would sit inside the
document by most of a grid space, and it is a boundary somebody is going to
draw right up against.

`canvasBox` in `lib/manifest.ts` is `placedPosition` run over the canvas
corner instead of a layer: put the file's anchor mark on the placement's grid
space, step back by where that mark sits inside the canvas, and take the
canvas's own size — all scaled by how big the artwork is being shown against
its own pixels. It needs the manifest, which is read from disk on the way in,
because a placement knows how big its own layer is and nothing at all about
the document around it.

### It owns no pointer

This is where it parts company with the other three canvas modes. Extrude,
collider and mask are made of gestures; PSD Edit mode is made of a rectangle. What draws in
it is the drawing layer — a stack of 2D canvases over Phaser's, with a pencil,
five brushes, an eraser and pressure already on it — so entering picks the
Pencil and the ink goes where ink always goes.

It still claims every gesture in `canvas-modes.ts`, and returns true without
doing anything with them. That is not an oversight: the rail and the drawing
toolbar both stay reachable while the mode is up — the camera has to be, and
the toolbar *is* what this mode is for — and a drag made with Select under the
dim would move the very artwork being drawn on, sliding the file out from
under a frame that was worked out when the mode opened.

### Which strokes are the session's

The ink that was not there when the mode opened. `editor/psd-edit.ts` remembers the
stroke ids on the document layer at the start and takes everything else on it
at the end. One honest edge: erase a stroke that was already there and its
surviving halves are new strokes, so they count as the session's. Both
readings are defensible and this one is at least simple to say out loud.

Both ways out consume it. Apply rasterises and writes; Cancel discards. Neither
leaves ink lying over the artwork, which is what a mode that framed a file and
then left a copy of the drawing on top of it would do — and Cancel is an
ordinary document edit, so ⌘Z brings the strokes back.

### The ink goes in at the file's resolution

`rasteriseStrokes` is asked for `1 / scale` pixels per world unit, where
`scale` is the placement's. Every import lands at half size, so a stroke drawn
on the glass is stamped into the document at twice the size it was drawn —
the same bargain `EXPORT_SCALE` makes in `import-anchor.ts`, arrived at from
the other direction. Rasterising at screen resolution and letting the file
scale it up would put half the detail in the PSD.

### Compositing happens in Rust

The editor could composite against the sprite psd-to-json exported, but that
PNG is quantised on the way out (`png_quality_range`), so a round trip through
it would degrade the artwork a little every time anybody drew on the layer.
The layer's real pixels are only in the PSD, so `psd_paint::over` does a plain
Porter-Duff `over` on straight alpha — which is what `LayerBuilder` takes and
what `PsdLayer::rgba` hands back — on the rectangle covering both, and the
layer grows to hold what it had and what was added.

Two rules are decisions rather than mechanics. **Ink is laid over, not
instead of**: a layer painted into keeps what was in it. And **a blank layer
has no rectangle worth keeping**: an empty layer is a single transparent pixel
at the origin, and treating that pixel as part of the artwork would leave
every layer drawn into from scratch carrying a transparent margin back to the
corner of the canvas.

Ink that falls outside the canvas is trimmed rather than refused — the frame
is a boundary to work inside, not a wall — and Apply is disabled until some of
it is inside, because a write that trimmed everything away would rebuild the
file and re-run the whole pipeline to change nothing.

### Naming the row, twice

`paint_psd_layer` takes the row's `index` **and** the name it was showing, and
checks both. The two are only in step for as long as nobody else has rewritten
the file, and a paint against a stale index would put somebody's drawing into
the wrong layer — the one failure here that would be completely silent.

### Applying is not instant, and used to look like a crash

Rebuilding the PSD and running psd-to-json over it takes several seconds on
anything with layers in it, and the window did not repaint for any of them.
Several seconds of a dead window reads as a crash rather than as a wait.

That was not a missing spinner; a spinner would have sat perfectly still
through it. **A synchronous Tauri command runs on the main thread.** Every
command in this app was one, so the pipeline ran on the thread that drives the
window, and nothing in the editor could draw until it returned. The twelve
commands that write a PSD are `#[tauri::command(async)]` now, which runs the
same synchronous body on the runtime's pool.

What that gives up is an accident: the main thread was also what stopped two
of them overlapping. So `psd_pipeline::exclusive` says it on purpose — one
global lock, taken for a whole job rather than for the parse alone, because
the half that matters is read-rebuild-write and a second job racing it writes
over what the first read. It is coarse because a job is seconds of CPU over
one file and a person drives one at a time; a poisoned lock is taken anyway,
since a panic over one file says nothing about the next one.

**A std `Mutex` is not reentrant, so every entry point comes in a pair.**
`process`/`process_held`, `psd_layers::write`/`write_held`: the plain name
takes the lock, the `_held` one is for a caller that already has it. Miss one
and the thread waits for a lock it is holding, which is a hang rather than an
error — renaming a PSD is the path that found it, because renaming the file
and renaming the layer inside it that was named after it are one job with
`write` in the middle of it. The suite caught it, four tests at once: the one
that deadlocked, and every other test that then queued behind the lock it
never let go of.

The progress itself needed no new channel. `psd_pipeline` already names each
stage as it starts it and emits it as `psd-log-line` for the console, and
those lines now arrive *as they happen* rather than all at once when the
window comes back. `editor/psd-progress.ts` follows them and the pen bar shows
the latest, under a line that moves. One piece of parsing, and it is
structural rather than a guess about wording: `process` emits the whole layer
tree as a single multi-line event and every stage line as an event of its own,
so a payload with a newline in it is the tree and belongs in the console
rather than in a progress line.

The line itself is indeterminate. The pipeline reports the stage it has
reached, not how far through it is, and a bar filling at a rate nobody
measured would be a guess dressed as a measurement — where the question being
answered is only whether anything is happening at all.

Still on the main thread: `open_psd`, publish and export, and the cheap
commands. The first has to be; the other two are slow too and have not been
looked at.

### Apply runs once

The write is not quick — the file is rebuilt and the whole psd-to-json
pipeline runs over it — and the bar stays up for all of it, because a rewrite
can be refused and a session that had already closed would have taken the
drawing with it. Nothing stopped a second press in that window, and a second
press was not a second no-op: the strokes are only discarded once the first
write lands, so the same ink went into the file twice. The second pass then
read `session` after the first had set it to null, and what reached the
console was `Could not draw into <key>.psd: d@tauri://localhost/assets/
index-….js:150:38810` — a minified stack where a sentence should be.

So there is a `writing` flag: Apply returns early while one is in flight, both
buttons on the bar go quiet, and the bar says what it is doing rather than
looking ready. Cancel as well as Apply, because the ink it would throw away is
the ink being written. And the session is taken as a local at the top of
`apply` — everything after the `await` belongs to that call, and the field it
used to read can be null by then.

### Hold still, and the rest of the stroke is ruled

A second inside a stroke with the pen not moving and `beginDraw` latches its
smoothing to 100 for the remainder of it; the next stroke starts again at
whatever the slider says. Pause at the end of a wobbly line and it snaps
straight; pause before drawing and everything after is a ruled line. Those are
the same rule read from either end, which is why it is one rule.

**Still, not merely down.** A stroke that took longer than a second to draw is
an ordinary stroke, and straightening it would be the editor overruling the
hand — so the timer is re-armed whenever the pen strays more than a few screen
pixels from where the hold began. And the fire has to repaint by itself:
nothing is moving, so nothing else would.

A second rather than extrude mode's 320ms, and for a reason worth naming. A
hold *instead of* a drag has to be decided before the drag gets going. This
one interrupts something already happening, so it has to be longer than a
pause for thought.

PSD Edit mode's, not the pencil's everywhere: `DrawingLayer.straightenHoldMs` is
zero unless `editor/psd-edit.ts` sets it, and it is set from `sync` rather than at
the two ends of a session so it follows the mode however it was left —
including being stopped from outside, which play mode and the other two canvas
modes all do.

### The tool draws itself under the pointer

A brush is a size, a tip and a colour, and a crosshair says none of the three.
Until the first mark is down you are guessing, and the guess is worst exactly
where it costs most — the first stroke on a clear canvas, a pattern whose scale
has just changed, a shape just picked off the palette. So the pencil, the
Pattern brush and the Shape brush each paint one stamp of themselves where the
pointer is, faded: `drawing/cursor.ts`.

**It is the mark, not a picture of the mark.** What it paints goes through the
same `renderLive` a session paints through, with the same style, at a lower
`globalAlpha`. The tip is the tip, the pattern lands on the world's own lattice
at the scale it will, and a shape fills the space it is going to fill — a
diamond on an isometric project, because the box comes from the same `boxAt`
the stamp session takes it from. There is no second painter, so there is
nothing to drift.

**It lives on the live canvas**, beside the eraser's disc, and that is what
makes it free to take away. A session's first `beginLive` clears the rectangle
the last paint reported, so pressing to draw removes the preview without
anything having to remember to — see **The dirty region is what gets uploaded**
in `surface.ts`. What a press *does* have to do is cancel the queued frame:
one that fired after the session started would paint the cursor over the stroke
and leave its rectangle behind as the next clear. `dropCursor` is that, on
pointer-down and on the pointer leaving.

It is batched through `onFrame` for the reason a stroke is. The eraser's disc
is painted straight from the move handler and gets away with it because it is
one `arc`; a pattern preview fills every lattice cell under the tip, and a
120 Hz pointer against a 60 Hz frame would do that eight times for one picture.

**Erasing is a ring, not a tint.** A tool turned round previews in the accent
red — but a six-pixel tip tinted red over artwork that is *already* red is
nothing at all, which is precisely the block-out somebody reaches for the
eraser on, and a pattern is mostly holes so there is barely a mark to tint. So
the mark is drawn in red *and* ringed: the tip's circle, or the space's own
outline for a shape. The ring is stroked twice, a dark halo under a red line,
because one colour cannot be seen against both a pale lattice and whatever has
been painted on it.

The preview never takes the erase path itself. `renderLive` composites
`destination-out` for an erasing mark, and a hole punched in the live canvas
shows nothing — the real subtraction is cut into the *baked* canvas by the
session, which has not happened yet. So `erase` is forced false and the colour
carries the meaning.

**The system cursor goes where a preview comes.** `.draw-surface.active` is a
crosshair, and `.paints-cursor` — set for exactly the tools `previews` answers
for, Slice included — turns it off. A crosshair on top of a six-pixel tip is
most of what the preview was drawn to show, and the preview marks the point
more exactly than the crosshair did: it *is* the mark. The rule and the class
are asserted together in `styles/__tests__`, because a stylesheet has no type
checker over it and the failure is silent.

**Three tools have no preview and it is not an oversight.** Fill, the Lasso and
the Boundary sweep are a *path*: what they lay down is decided on release by
where the whole gesture went, so there is nothing at the pointer to show.
Slice keeps its own disc, because what it takes away is not a mark it could
draw. `hasToolCursor` is the membership, and `__tests__/cursor.test.ts` pins
it — a tool added to `DrawingTool` and forgotten there gets no preview and
nothing says so.

### Rub went, and the four brushes were already the answer

There used to be a second tool rail under the editor's own, up only while this
mode was, carrying three tools: **Rub**, **Fill** and **Pixels**. Two of the
three did not belong to the mode at all. A swept shape and a hard checker for
a tip are useful on any layer, on any project, at any time — the only reason
they were in here was that they arrived with the mode — and the column they
were in appeared and disappeared under your hand, which is a rail whose
buttons move.

So Fill and Pixels became tools on the drawing toolbar (`editor/tool-rail.ts`),
where the rest of the ink is, and this mode borrows them like everything else.
What was left was Rub, which *was* the mode's: what it rubbed out is this
session's ink, which only exists while the session does. One tool does not
want a column, so it became a toggle in the middle of the mode's own bar.

**And then erasing became a flag, which left Rub with nothing to be.** Pencil,
Pattern, Shape and Fill can each be turned round — what the tool *would have
drawn* is what it takes out instead, per tool and remembered, from the switch
at the top of its own panel or a long press on its button. That is four
erasers inside this mode, each of them the ordinary editor-wide gesture, and
beside them Rub was a fifth: a tool that was only ever an eraser, with a
button in a place no other tool has one and a rule (`tool === "rub"` forcing
`erase`) that no other eraser needed. It is out of `TOOL_IDS` entirely, and
with it go `OFF_BAR`, the `rub` rows in `DRAWN`, `ANNOUNCE` and `styleFor`,
the *Rubber* panel in `inspect-brush.ts`, and `useRub` / `isRubbing` down
through `editor.ts`, `canvas-mode-ui.ts`, `psd-edit.ts` and the bar itself.
Nothing was added anywhere to replace it.

What is *not* removed is the `"erase"` stroke **mode**. It was the whole of
what Rub laid down, documents on disk still hold strokes that say it, and
`isErasing` reads it as an inked stroke with the flag set — for as long as
those documents exist, which is forever. See `lib/types.ts`.

The bar is left saying which file and which layer, counting the ink, and
offering the two ways out. Nothing in hand is set from it at all now, which is
the rule the rest of the editor already followed: the brush, the size, the
smoothing, the colour and the eraser switch are in the inspector's TOOL
section, and a second copy of any of them on a mode bar is a second place they
can disagree.

All three of the original tools were the pencil with something changed about
it, and only one of them ever needed the engine to learn anything:

| Tool | What it was | What it cost |
|---|---|---|
| **Rub** | the same brush taking its mark back out | a `mode` on `Stroke`, now a flag every brush carries |
| **Pixels** | the same brush with a hard checker for a tip | a mask with no PNG behind it |
| **Fill** | the lasso's gesture ending in a shape instead of a selection | a `mode`, and `beginFill` |

Being a brush and a stroke mode rather than a gesture is exactly what let them
be ordinary buttons: `tool-routing.ts` holds the one table that says what
picking any tool means to the pointer, and each of them differs from Pencil
only in the lines of style it patches in.

**A fill is a stroke.** `mode: "fill"` means the points are a closed outline
and what is drawn is the inside of it, filled `nonzero` so a loop that crosses
itself comes out solid rather than holed. Making it a stroke rather than a new
kind of object is the whole reason it is small: it previews, undoes, erases,
exports and applies without a line of new plumbing anywhere. A bucket that
floods the area under a tap is the version after this one, and it needs a
raster of the session to flood — which is the thing this deliberately does not
build yet.

**The eraser reaches the artwork, in the file and on the screen.** Two halves,
and they were broken separately.

*In the file*: the raster Apply sends is drawn on a **clear ground**, so an
erasing stroke in it takes out the ink laid before it and there is nothing else
in there to take — and the result was then composited *over* the layer. Rubbing
somewhere the session had not drawn produced a buffer of nothing and changed
nothing.

*On the screen*: the PSD is drawn by Phaser underneath the drawing surface, and
a 2D canvas above it cannot punch a hole in one. So even when the file was
being cut correctly, you could not see it until Apply had written and re-parsed
the whole thing.

**The layer moves into the drawing surface for the duration of the mode.** That
is the answer to the second half and it makes the first half honest as well.
`psd-edit.ts` takes the layer's own texture — Phaser's, the one already on
screen, so the swap is invisible — and hands it to `Surface.setBackdrop`, which
bakes it under the ink on every re-bake; `DocRenderer.drawIntoPsdLayer` turns
the canvas's own copy off, because two of them would be seeing double. An
eraser then has something to erase, the hole appears under the pointer as it is
dragged, and what you are looking at while you work is the composite Apply is
going to make rather than a picture of the intention. `sync` pushes and clears
it beside `revealInstance` and the straighten hold, for their reason: however
the mode ends, and whatever ended it, the layer goes back to the canvas.

The one thing it costs is stacking. While the mode is up, that layer draws
above everything Phaser does, so a *sibling layer above it in the same file*
appears underneath it. The ink already had that property — it has always drawn
over the whole canvas until Apply — and for a file this editor wrote there is
one sprite layer, so the case is rare; a foredrop canvas over the live one is
what would fix it.

So Apply sends two buffers over the same rectangle. `rasteriseStrokes` with
`eraseMask` renders the erasing strokes a second time as the marks they *would
have drawn* — same geometry, same brush, same colour opacity, so a soft eraser
makes a soft mask — and `psd_paint::cut` multiplies the layer's own alpha by
`1 - mask` before the ink goes over what is left. That order is the order the
strokes were drawn in: rub a hole and then draw into it, and the new ink lands
on bare canvas rather than being taken straight back out.

Overlapping erase strokes need no special case, because they never arrive
separately: they are all drawn into the one mask with `over`, and
`1 - (a₁ + a₂(1 - a₁))` is `(1 - a₁)(1 - a₂)` — the same product rubbing twice
would have left. Pinned in `painting.rs`, along with the two decisions that are
silent when wrong: a rub outside the layer does not drag its rectangle out to
meet it, and a session that only rubbed sends blank ink which is not laid on at
all.

What Apply sends is unchanged by any of that: the strokes and the mask, not the
backdrop. The preview and the file are two runs of the same arithmetic over the
same strokes rather than two descriptions of it.

**The pixel brush is out of the numbered set** (`PIXEL_BRUSH = 90`). The five
are the pencil's, chosen from the inspector's own TOOL section; this is a tool
on the drawing toolbar, and giving it a sixth button beside them would put it
in two places. Its mask is
generated rather than drawn, because the whole of it is a rule and a PNG of a
checkerboard is a file to keep in step with the rule.

### The dim follows the camera

`extrude-render.ts` pins its scrim to the screen with `setScrollFactor(0)` and
makes it big enough for any viewport. PSD Edit mode's cannot: it has a hole in it,
the hole is in world space, and Phaser's Graphics has no even-odd fill — so
the dim is four rectangles around the gap, in world units.

Sizing those from a constant large enough for the widest possible view (the
camera zooms out to 0.1, so a viewport is thousands of world units across)
puts tens of thousands of units of geometry through the batch and comes back
with holes in it. So the rectangles are cut from `camera.worldView` instead,
grown by an overdraw, and redrawn every frame from the scene's `update` — four
`fillRect`s, which is cheaper than working out when a pan or a zoom needed
them.

## Adding a layer, and the empty one

`New layer` under the stack writes an empty sprite layer onto the top of the
file and re-parses, through `psd_layers::add`.

It is written **straight away** rather than held with the pending renames and
reorders above it, because the point of the row is to have somewhere to draw
and PSD Edit mode can only put ink in a layer the file really has. The file is read
again afterwards, so a half-typed rename waiting for Apply is lost — which is
why the button goes quiet while the write is in flight rather than trying to
merge the two.

The layer holds **one transparent pixel**. A layer of no pixels is not
something the fork will write, and a layer the size of the canvas would arrive
on the grid as a placement covering the whole file: invisible, and swallowing
every click over the artwork under it. One pixel is the smallest honest
placeholder, and `adoptNewLayers` skips a manifest layer of one pixel or less
for exactly that reason — it becomes a placement the moment somebody draws in
it, because painting replaces the blank rectangle with the ink's own.

`add` and `paint` are both expressed as **edit lists against the file's own
order** and go through the same rebuild a rewrite does — `psd_rebuild.rs`,
split out of `psd_layers.rs` once three operations ended there. `LayerEdit`
grew two optional fields for it: an absent `index` is a row the file does not
have yet, and `paint` is ink to lay over whatever the row already holds.

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

## The iPad needs a scene

Apps built against the **iOS 27 SDK** must adopt the UIKit scene life cycle or
they are refused at launch — "Apps built with the latest SDK must adopt the
scene-based life cycle or they fail to launch", in that release's UIKit
deprecations. The refusal is an `EXC_BREAKPOINT` inside
`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`, before any of
this app's own code runs, so there is nothing in the console and nothing on
screen: the app quits as it opens.

It arrives with the *toolchain* rather than with the device. Updating the Mac
that builds is enough — the new Xcode brings the new SDK, the next build links
against it, and an iPad that was running yesterday's build stops running
today's. macOS is untouched throughout, because `UIScene` is UIKit's and the
desktop app is AppKit; the same bundle and the same Rust behave differently
because only one of the two platforms has the mandate.

**The switch is one Info.plist key, and it is not the one you would guess.**
This project is pinned to tao 0.35.3 — `tauri 2.11.5` depends on
`tauri-runtime-wry`, which requires `tao ^0.35.0` — and in that version a
single predicate decides whether the scene path is taken at all:

```rust
// tao 0.35.3, src/platform_impl/ios/scene.rs
pub unsafe fn multiple_scenes_enabled() -> bool {
  // Info.plist → UIApplicationSceneManifest → UIApplicationSupportsMultipleScenes
}
```

It gates three separate things, and all three have to happen:

| Call site | What it does when the key is true |
|---|---|
| `view.rs:750` | adds `application:configurationForConnectingSceneSession:options:` to the app delegate |
| `app_state.rs:611` | defers `did_finish_launching` to the first scene instead of running `on_app_ready()` |
| `view.rs:540` | attaches the `UIWindow` to a `UIWindowScene` |

So declaring a scene delegate statically and leaving the flag false is not a
lighter-touch version of the same fix: it produces a scene that connects, an
app that has already started up the old way, and a window that never joins the
scene. The flag is the fix, and `scripts/patch-ios-plist.mjs` writes it — a
third block beside the document types and the ATS exception, in the file that
exists for exactly the things `tauri.conf.json` cannot reach.

tao supplies the rest itself: `configuration_for_connecting_scene_session`
(`view.rs:629`) builds the `UISceneConfiguration` and sets `TaoSceneDelegate`
as its delegate class, so the plist does not have to. The block writes a
static `UISceneConfigurations` entry anyway, naming the same class under the
same configuration name tao uses — it is what UIKit falls back to if it ever
does not get an answer from the delegate, and matching the names is what stops
the two descriptions from disagreeing.

**What it costs is multi-window.** `UIApplicationSupportsMultipleScenes` is a
statement to the OS as well as a flag tao reads: on an iPad
`UIApplication.supportsMultipleScenes` is true, so the system will now offer a
second window of the editor. That sits badly beside **One game at a time** —
`PluginCache` is a module-level singleton and two editors over one store is the
condition that section exists to prevent — and nothing yet refuses the second
scene. It is listed under **Known gaps**. The trade was taken deliberately:
the alternative is an app that does not start.

**Why not just upgrade tao.** 0.37.0 fixes this properly — it always installs
`application:configurationForConnectingSceneSession:options:` and attaches
windows to a scene whenever one connects, rather than only when the plist
enables multiple scenes — and it would let the flag go back to false. It is not
reachable from stable Tauri 2: `tauri-runtime-wry 2.11.4` requires `tao
^0.35.0`, so `cargo update` can only ever land on 0.35.x, and only
`tauri-runtime-wry 3.0.0-alpha.1` moves to `^0.37.0`. A `[patch.crates-io]`
override is not a shortcut either, because 0.36 moved the mobile lifecycle
events onto `WindowEvent` and 2.x is not written against that. When a Tauri 2
release carries tao ≥ 0.37, this block and the gap below come out together.

**The patch script is now load-bearing rather than cosmetic.** It runs from
`beforeBuildCommand`, so `tauri ios build` applies it and `tauri ios dev` does
not — which used to mean a dev build with broken images and now means a dev
build that will not launch. Run `node scripts/patch-ios-plist.mjs` by hand
after `tauri ios init`; the generated plist is kept, so once is enough.

The other half of that release's launch prerequisites is a launch screen — the
final plist has to declare one of `UILaunchStoryboardName`, `UILaunchStoryboards`,
`UILaunchScreen` or `UILaunchScreens`. Tauri's generated plist carries
`UILaunchStoryboardName`, so nothing is added for it here; it is worth checking
rather than assuming after any `tauri ios init`.

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

## What Play runs

Play loads `http://127.0.0.1:<port>/<project-id>/game/index.html` into an
iframe over the canvas (`editor/game-frame.ts`). That is the project's own
`game/` tree — the files the code modal edits — served by `file_server.rs`,
and it is the same program a publish zips. What plays and what publishes
cannot drift, because there is only one of them.

Two paths exist in an export's layout and not in the store's, and the server
answers both rather than putting copies on every project's disk:

| Request | Answered with | Why not on disk |
|---|---|---|
| `<id>/game/js/lib/phaser.min.js`, `…/psd-to-phaser.umd.js` | the constants `templates.rs` already holds for the exporter | 1.5 MB, identical in every project |
| `<id>/game/assets/…` | `<id>/assets/…` | the pipeline's output sits *beside* `game/` in the store and *inside* it in a zip |

The traversal guard is unchanged: the rewrite happens before `resolve`, which
still canonicalises and checks against the store root, and the runtime shim
answers only those two exact names — under `game/js/lib/`, where the scaffold
puts them now, or under `game/lib/`, where a project made before the tree moved
still asks for them.

### The console the game logs into

The frame is a different origin, so the editor cannot read its console. It
reports instead: `templates/play/console-bridge.js` wraps `console.*`, listens
for `error` and `unhandledrejection`, and posts each call to the parent.

It works out two things the editor cannot. Each argument is **flattened** into
the tagged shape `lib/log-value.ts` describes, because a structured clone of a
live Phaser object throws and a clone of a scene would carry the whole game
across to be printed as one line. And each call's **site** — the file and line
it was written on — is read out of a thrown error's stack and mapped back to a
path inside `game/`, which is what makes the drawer's level chip a link into
the code modal.

`file_server.rs` injects the bridge at the top of `<head>`, and only for a
request carrying `?idlewild=console` — which only `game-frame.ts` sends. So the
project's `index.html` says nothing about it, and the page that publishes is
byte for byte the page that was edited. First in the head on purpose: a boot
failure in the very first module is exactly what it exists to report.

`game-frame.ts` checks what arrives rather than trusting it — the path is
about to be handed to the code modal to open — and unwraps a top-level string
back to a plain one, because the first argument of a call is a *format string*
when it has directives in it and Phaser's boot banner is exactly that.
Arriving in the drawer, those lines are tagged **JS** — see
[Console](#console).

### Stacking, which the game got wrong

A PSD is a stack of layers and the order is the artwork: a roof over a tower
is not the same picture as a tower over a roof, and an extrusion's `lines`,
`shading` and `shape` stacked backwards is a solid with its silhouette painted
over everything that made it read as one.

Two things reach the game now that did not:

- **`order`** — how high a layer sat in its file's stack, counting up from the
  back — and **`instance`**, the unit the placements of one PSD share. Neither
  was in `game.config.json`, so the game had nothing to sort by.
- **`applyDepth`**, in the template. `P2P.place()` returns a Phaser **Group**,
  whose children live on the scene's own display list rather than inside it —
  so `setDepth` on the group writes one depth onto every child and the
  artwork's order collapses. Phaser then draws them in the order it was handed
  them, which is the manifest's top-first order, which is upside down. Each
  child is now ranked by the depth psd-to-phaser gave it and spaced inside the
  placement's own slot, so the file's stack survives and the group still sits
  between the placement below it and the one above.

The editor's renderer learned both lessons already, in `doc-renderer.ts` — it
is where the `drawOrder`/`applyDepth` pair came from. So the same ordering
exists twice, once for the editor and once in the project's own
`shared/canvas.js`, which cannot import it. `game/__tests__/draw-order.test.ts`
holds them to the same fixtures by pulling the template's functions out
between their markers and running both, the same arrangement the console
bridge's snapshot is under.

### A character sorts itself in

The character was pinned at depth `1e6`, which is in front of the whole
document and every layer of it. On a flat projection that is the right answer
and on an isometric one it is the bug: an isometric world is a world you walk
*behind* things in, and a character that is always in front is a cut-out held
over the picture.

**Sorting it needs one key everything shares.** The placements' depths are
ranks in an ordering worked out once, not world coordinates — see *What is
drawn over what* — so there is no number a character can compute from its own
position that slots between two of them. Two ways out of that: make every
depth a function of position, or let the character find its rank in the
ordering that already exists. The second is what this does, and it is the one
that leaves the document renderer alone.

So `placeDocument` keeps the numbers it sorted by. One per step, already in
order, on the layer the character walks:

```js
this.walkAmong = {
  base: depth * 1000,
  near: nearPoints(order, this.grid.tileHeight / 2),
};
```

and `walkDepth` is a binary search for the character's own position in that
list — `base + low − 0.001`, where `low` is the first placement standing nearer
the camera than the character is.

**Plain world Y on both sides**, which is what makes it one comparison rather
than a projection. An object's number is the line its collider's outer edge
sits on, in world pixels: `nearRow × tileHeight / 2`, because an isometric row
is half a tile of screen height. The character's is the **bottom of its
artwork**, which `groundOf` works out as `sprite.y + displayHeight × (1 −
originY)`. Both are the point the thing touches the ground at, and that is the
only thing being compared. A space whose middle is level with an object's near
corner is *beside* it rather than behind it — on a diamond grid the two share
an edge — so `<=` counts level as past, which is the right way round.

**The bottom, not `sprite.y`**, and this one was worth a whole row. Anything
drawn from its middle has `sprite.y` half its height up the screen, and the
template's character is half a space tall while an isometric row is half a
tile — so that half is *exactly one row*. Sorted on it the character reads as
standing a row further from the camera than it is and stays behind things it
has already walked past. At a glance that does not look like an off-by-one; it
looks like a character stuck behind the scene.

The two sides mean the same thing only because the rectangle is drawn centred
on its space and half a space tall, which puts its bottom edge exactly on that
space's **near vertex** — the same line an object's key is measured to. That is
the property to preserve when the rectangle is replaced, and the two ways to
lose it are opposite: artwork with empty space under the feet sorts late by
however much of it there is, and a sprite given its *feet* as its origin has
its bottom edge on the middle of the space rather than the near vertex of it,
which is a row short again. A numeric `ground` on the character overrides the
arithmetic, which is what either case should reach for.

**The position comes off the sprite, not off the character's cell.** `cell` is
as much where it is walking *to* as where it is — `moveTo` picks a path and the
destination is known from the first frame of the walk — so a depth taken from
it would put the character behind the tree it is about to pass the moment you
tapped, and leave it there for the length of the walk. The sprite's own Y moves
with the tween, so the character slides through the ordering rather than
snapping through it a space at a time. (Reading the sprite fixed a second thing
on the way. `cell` was a field holding the destination, and `moveTo` pathed
from it — so a second tap mid-walk searched from somewhere the character was
not, and it set off diagonally towards a route it had never been on. It is a
getter over the sprite now.)

**Every member of a unit carries its unit's number**, which is `nearPoints`'
whole job and the half that is easy to get wrong and impossible to see.
`drawOrder` hands back a flat list — a three-layer building is three entries —
and the collider rides on the first of them, so each placement's own number
dips in the middle of a unit as the rest fall back to their anchors. A binary
search over that does not give a fuzzy answer; it finds a place *between* two
layers of one building and draws the character inside it. Because `drawOrder`
sorted the units by exactly this number, giving each member its unit's makes
the list non-decreasing by construction.

**A thousandth, not a half.** This is the number that has to be right, and the
obvious one is wrong. Placement `k` sits at `base + k`, and `applyDepth`
spaces the parts of a multi-layer PSD across the *whole* interval above it —
`(rank + 1) / (parts + 1)`, which for a three-layer building is 0.25, 0.5 and
0.75. So half a step down from `base + k` is not the gap between two
placements; it is the gap between somebody's walls and their roof, and a
character put there is drawn inside the building. The sliver clears the
topmost part of any PSD short of a thousand layers.

At `k = 0` it lands just under `base`, which is where a **fill** used to be.
Fills moved down a whole step to `base − 1`, which they wanted anyway: a fill
is the ground of its layer and everything placed on that layer stands on it,
so tying with the first placement and settling the tie by which Phaser was
handed first was never an answer.

**Where the line falls** is one constant and one comparison, both in
`walkDepth`, which is the thing to reach for when it feels early or late. The
character is in front of a placement once its own ground point is past that
placement's near corner; moving the comparison to `<` holds it back until it
has properly left, and offsetting the stored number half a space either way
moves the line within the crossing step.

**Which layer it walks on is the layer the start point is on**, as long as
there is something on it. A point used to say where play begins is the one
thing in the document that says where the character *belongs*, so the stack
around it means something: scenery on that layer sorts against the character
space by space, everything on a layer behind it is always behind, and
everything on a layer in front is always in front. That last one is how an
overhang works — put a canopy, a bridge or a doorway's lintel on the layer
above and the character walks under it however far forward it goes, which is
not something a single ordering can express.

The qualification is not a detail. An **empty** layer gives the character a
list of nothing to find its place in, so it lands at the bottom of that layer's
slot and every layer in front draws over it — a character behind the entire
scene, from one point dropped on a layer that happens to hold no artwork. So a
layer qualifies only if it is a visible object layer *with placements on it*,
and a start point on anything else falls through to the front-most layer that
is, which is where scenery normally is. Nothing qualifying at all leaves
`walkAmong` null and the character in front of everything, which is the failure
you can see rather than the one you cannot.

A flat projection sets nothing at all either, so the character keeps the depth
the prefab gave it and draws in front of everything; sorting a flat top-down
game on Y is a real thing to want, and it is a change to `drawOrder` as much as
to this.

`walkDepth` is a marked block and the only one the two genres do not share: a
platformer is seen from the side, where nothing sorts on Y at all. Its test
pulls the block out of the template and runs it, the way the `drawOrder` test
does — and it is the test that caught the half step.

### Arrows beside the tap

The top-down character takes the arrow keys as well as a tap, and the two are
not alternatives. A tap walks there over A\*, which is the game. A held arrow
nudges the sprite directly, which is not: it goes where a path cannot — half a
space into a doorway, right up against the near edge of a building — and that
is what you want when the thing you are checking is whether what you drew sorts
the way you meant it to. Sorting is continuous in `sprite.y`, so the line it
turns on can be found by leaning on a key rather than by tapping either side of
it and inferring.

Four decisions in `character.js` worth keeping:

- **Screen directions, not grid axes.** On an isometric map the grid runs
  diagonally, so a keyboard bound to it moves the character in directions the
  arrows are not pointing. Up the screen is also *away*, which is the axis the
  sorting turns on — the one you want a key for.
- **A held key kills the tween.** Two things moving one sprite is a sprite that
  jitters between them, so an arrow takes the character off whatever path it
  was walking and keeps it.
- **Each axis committed separately**, and only onto walkable ground. A
  character pushed into a wall slides along it rather than stopping dead, and
  can be parked anywhere inside a space instead of on its middle — which is the
  point of having it.
- **`delta` clamped at 50ms.** A tab left in the background hands back one
  enormous frame, and a step taken by it crosses the map.

The keys are a set of flags read once a frame by `character.step(delta)`,
called from `update` next to `sortCharacter`, rather than a callback that moves
anything: what a key means is the character's business. WASD is bound beside
the arrows. Both are in the prefab, which is the file a project is expected to
replace — a sprite instead of a rectangle, a run of animations — so none of it
is in the scene.

### Saving applies

`CodeModal.save` reports the path it wrote; the shell reloads the frame if a
game is up. That is what "saving code applies it" means here — the program
restarts against the file just written, which is the only way to see whether
the change worked. Entering play mode flushes the document first and waits for
it, because the document's save is what rewrites the config the game reads.

**A rewritten PSD restarts it too**, for the same reason and it used to not.
A file can be rewritten while its game runs beside it — ink applied in PSD
Edit mode, a layer renamed or turned off, a re-parse, a file replaced by a
drop. Every one of those re-places the canvas from the new
manifest and left the game holding the textures it loaded at start — the two
halves of one window showing two versions of one file. `psdChanged` in
`editor.ts` is the one line the paths that rewrite a PSD now share, and it is
a no-op in Draw, where nothing is running.

The pipeline itself was never the gap: `psd_layers::paint` rebuilds the file
and runs psd-to-json over it inside the same lock, so the sprite the game
loads is written before Apply returns. A test pins that end to end, because
it is invisible from the editor — the canvas re-places from the manifest it
is handed either way, so a paint that stopped re-parsing would look right up
until the moment somebody pressed Play.

### What went with it

`game/play-controller.ts`, `game/play-platformer.ts`, `game/platformer.ts`,
`lib/pathfinding.ts` and `editor/play-pad.ts` are deleted. Each had a
counterpart in the templates — `navigation.js` and `physics.js` — and the
templates are what runs now. The editor's scene keeps one line about play
mode: put the tools down.

The platformer's own on-screen pad went the same way, a little later. Three
buttons pinned to the viewport were a guess at a game nobody has written yet:
a template's job is to run so there is something to change, not to decide what
the controls of your platformer look like. `bindControls` is the keyboard and
nothing else, and the comment over it says what putting a pad back takes. Only
a project scaffolded after this gets the shorter file — `game/` is the user's
copy and nothing writes into it unasked — so an existing platformer keeps its
pad until those lines are deleted, or Reset is used on the block.

## The config the game reads

`game/js/game.config.json` is the document in the shape the project's own code
reads it — `psdKeys` to load, layers to place, the grid to draw. It is
generated, and `store::sync_game_config` rewrites it from `doc.json` on **every
save**, not only on the way out to a zip.

That is a three-line change with three consequences. The file the code modal
opens describes the canvas beside it rather than being the empty one a new
project scaffolded with. Play mode, which now runs that code, runs against what
has actually been built. And the export's own rewrite becomes a re-derivation
of the same thing rather than the only time it ever happens.

A failure never fails the save: `doc.json` is the truth and this is derived
from it, so a document mid-migration keeps a stale config rather than losing
the write that carried the work. An unchanged config is not rewritten at all,
which matters because a drag saves on an 800 ms debounce and the code modal
watches this file.

## The page around the game

Everything else in this editor is about what is on the canvas. This is about
the **HTML document the canvas is embedded in** — the page a published site
opens as, and the page Play runs in.

There has only ever been one of those, and it was the same for every project:
the game filling the window, square-cornered, flush to every edge, on the
scaffold's `#d9e6ef`. That is a reasonable default and a poor only answer. A
320×568 phone game shown on a desktop should be a 320×568 game on a desktop,
not one stretched across it, and nothing in the app could say so.

**Page Setup** is the sheet, beside Project Options in the header's menu rather
than inside it, because the two are about different things: Project Options is
how the *canvas* renders and reaches the editor's own view; this only ever shows
up in Play and in an export. Six settings — fixed size with a width and a
height, centred or top left, a margin, a corner radius, and the page colour.

### Why it is not `GameOptions`

Two reasons, and the better one is not the language's.

The language's is that `GameOptions` is `Copy` and is copied all over the
editor, and a colour is a `String`.

The other is that `GameOptions` is how the canvas renders — `pixelArt`,
`roundPixels` and the zoom are applied to the editor's own view the moment
they change, which is what `render-settings.ts` is for. None of these six
reach that canvas at all, because the editor draws a *world* and this describes
a *page*. Keeping them apart means nothing in the editor ever has to ask which
half of one object applies to it. So `Presentation` is its own field on
`ProjectMeta`, beside `PublishTarget`, defaulting the same way.

### Why it writes nothing into the project's own files

The literal build is to rewrite the rules in the project's `styles.css`
whenever a number changes — it *is* a CSS template, after all. It is also the
build that fights the person using it. A `game/` tree is the project's own copy
the moment the scaffold writes it, and an editor that owns lines inside a
stylesheet is an editor that undoes your edits to them. That is the whole
argument of **Lines the editor owns**, and a stylesheet is the worst file to
have it in: CSS is where somebody changes one number to see what happens.

So these ride in `game.config.json` the way `pixelArt` and the zoom already do,
and the scaffold reads them. `main.js` writes them onto the document as custom
properties in its `presentation` block; every rule in `styles.css` reads one
with a fallback:

```css
#game {
  width: var(--game-width, 100%);
  height: var(--game-height, 100%);
  border-radius: var(--game-radius, 0px);
  overflow: hidden;
}
```

Three things follow, and all three are the point. A rule you rewrite keeps what
you wrote. Delete the block in `main.js` and the page is exactly what it always
was, because **the fallbacks are the old stylesheet** — it is correct opened
straight off disk, with a config that predates the feature beside it, or with
no JavaScript having run. And a project made before any of this existed picks it
up on its next save, without the editor having touched a file it wrote.

`scale` is the half CSS cannot do, and it is in the same block. A game filling
the window wants `RESIZE`, so the camera gets the viewport; a fixed-size game
wants `FIT` against the size it was given, so a window too small for it scales
the game down instead of cropping it. `max-width: 100%` on the box is the CSS
half of that same answer.

**Two backgrounds, and they are not the same one.** `Presentation.background` is
the `html` background, behind everything. Phaser's own `backgroundColor` is
behind what the scenes draw. They are only ever both visible once a margin, a
radius or a fixed size has pulled the game back from an edge — which is exactly
when you want to choose them separately, and is why the sheet's row says *page*
colour and the scaffold keeps its own literal.

**They default to two different colours, on purpose.** The tidy answer would
have been `#d9e6ef` for both, and it is the wrong one. That blue is the
*world's*: the editor's canvas ground, what Phaser paints behind the scenes,
what a player reads as sky. The page is the surface the game is *mounted on*,
and at the only moment it is visible — the moment something has framed the game
— a second field of the same sky reads as the world running on past its own
border, which is precisely the impression a framed game exists to avoid. So the
page defaults to a neutral dark and the world keeps its blue, the way a video
player mats a picture. The dark is the app's own `--color-neutral-900`
(`#2d2b2b`) rather than an invented hex: one fewer arbitrary number, and a
framed game sits on the same ground the editor is drawn on.

The `styles.css` and `main.js` fallbacks carry that value too. A fallback that
disagreed with the default would mean a project rendering one colour with its
config and another without, which is the kind of difference nobody can debug —
so the rule is that every fallback in the scaffold is the default the editor
would have sent anyway. It is the one default that is *not* what a project had
on screen before Page Setup existed, and it is invisible to every one of them
until they frame something.

### What is checked, and where

`Presentation::sane()` clamps on the way **out**, into the config — not on the
way in, to disk. A width typed as `4` that became `16` under the cursor would
be the sheet arguing with somebody still typing; what matters is that nothing
absurd reaches a stylesheet. Three things can put absurdity there and none of
them is the sheet: a hand-edited `meta.json`, an archive from another machine,
and a build whose bounds were different. A zero width is a game nobody can see;
a margin of four million is a game pushed off the page.

The colour is checked rather than clamped, being the only one that is not a
number. It is written into a CSS custom property, and while a browser drops a
property it cannot parse, a value this code has never looked at is not a thing
to hand a stylesheet. `#rgb`, `#rrggbb` and `#rrggbbaa` — what this app's own
picker writes — survive; anything else falls back to the default.
`tests/presentation.rs` pins both halves, along with the archive carrying it and
a project that has never heard of a page still describing the one it has.

### Where it takes effect

There is no preview on the canvas behind the sheet, because there is nothing on
that canvas this describes. What there is instead is Play: the sheet restarts a
running game through the same `onChanged` the render settings use, so with Play
up the sheet *is* its own preview, and the page you are describing is the page
in front of you.

## Lines the editor owns

The editor writes code into a project and the user edits that same code.
Without a rule the two fight: the editor rewrites a function and takes a
hand-made change with it, or it stops rewriting and the code stops matching the
canvas. There are two rules, and the coarse one came second.

**The coarse one is the file.** `js/shared/canvas.js` and
`js/shared/character.js` are the editor's; `js/scenes/<Scene>.js` and
`js/prefabs/character.js` are the author's. That sounds obvious and was not
what this used to be: the whole of the machinery lived at the top of the scene
file, so the file somebody was meant to work in was a thousand lines of
somebody else's with room to type between them. Splitting them means the
question "is this mine?" is usually answered by which file is open, and a
scene file carries no markers at all.

**The fine one is the line, and it is still there** — because a file being the
editor's does not make it untouchable. Inside the shared modules, ownership is
per line:

```js
// idlewild:begin placeDocument
export function placeDocument(scene) { … }
// idlewild:end placeDocument
```

Inside that range a line is the editor's if it is *still one of the lines the
scaffold wrote*, decided by a longest common subsequence against the pristine
template (`code/managed-blocks.ts`). Anything else between the markers was
typed by the user and stays theirs. So a `console.log` dropped into the middle
of `placeDocument` is one line you can edit and delete while the lines around
it stay locked. A subsequence rather than a line-for-line comparison because
that is the whole point: inserting a line must not disown every line after it.

The markers themselves are always owned, which is what stops a block being
dissolved from the inside. A `begin` with no `end` is not a block at all —
locking the rest of the file would be the worst way to fail.

`code/managed-view.ts` turns that into CodeMirror. The filter's job is narrower
than "read-only": an owned line's *text* must survive, and it must still be a
line of its own afterwards. So a break typed at the end of one is allowed —
that is how you get a line of your own inside a block — and deleting a whole
line above one is allowed, while a character typed at either end of an owned
line, or a backspace that would join it to its neighbour, is not. A refused
edit says so in the file bar rather than doing nothing.

**Reset** sits at the end of each block's opening marker and puts that block
back the way the scaffold wrote it, dropping whatever was added inside it. It
saves as it goes: the reason to press Reset is that the running game is broken,
and a repair you then have to remember to save is half a repair. `templates.rs`
answers for the pristine text (`read_game_template`), so the blocks a project
can reset are the blocks its own genre scaffolds.

**A block the template gains later** is the case Reset cannot serve: a
project's `game/` tree is its own copy, so there is nothing in the file to put
back. `analyse` names those in `missing`, and a strip above the editor offers
to put them in — `addMissingBlocks` inserts each where the scaffold has it
*relative to the blocks the file already has*, so a helper lands beside the
code that calls it rather than at the end. An offer rather than an edit: code
appearing in someone's file unasked is the fight this whole mechanism exists
to avoid.

This is not hypothetical. The scene template gained `drawOrder` and
`applyDepth` when the exported game learned to stack a PSD the right way up,
and without that strip every project made before it would have drawn
multi-layer files upside down for good. It is also the reason the shared
modules keep their markers at all, now that each of them is the editor's end
to end: without the markers there would be no way to offer a project made
today a block the scaffold gains next year.

The generated config is the whole-file case of the same idea. It has no room
for comments and nothing in it was written by hand, so it is owned end to end
and read-only in CodeMirror's own terms as well — the caret still moves,
because reading and copying it is the point. There is no allowance for a break
at the end of a line there, unlike a block: no line of that file is not about
to be rewritten. It is re-read whenever the document is saved, so what is on
screen is what the running game reads.

Resetting the config means *regenerating* it — its pristine form is the
document as it stands, not the empty file a new project scaffolds with.

Today `canvas.js` marks sixteen — `sceneOf`, `loadDocument`, `updateCanvas`,
`applyCamera`, `placeDocument`, `paintBackgrounds`, `placePatterns`,
`paintFill`, `nearPoints`, `drawOrder`, `applyDepth`, `applyScale`,
`applyHidden`, `pointsToVectors`, `gradientCorners` and `patternRule` — and
it is one file for both genres, so there is no longer a pair that can drift.
`character.js` marks its own, and the two genres' differ: a top-down character
sorts itself into an isometric ordering and a platformer does not, so
`sortCharacter`, `readColliders` and `walkDepth` are the first's and
`readSolids` is the second's. `main.js` marks `pixelPerfect` and
`presentation` — both of them a setting read out of the generated config and
handed to Phaser and to the page — and the config and the scene list are
generated whole.

A test pins each file's set and that every marker closes, because a block is
found by id and one renamed would quietly stop offering its Reset. It also
pins that a **scene** file marks nothing at all.

`drawGrid` was one of them and is gone: the scaffold draws no lattice now. A
project scaffolded before that still has the block, and Reset on it reports that
there is no scaffold to go back to rather than emptying it — which is the same
answer the modal gives for any file the template does not write, and the right
one: what to do with a block the template dropped is the author's call.

### The character controller stopped being a scaffold-time conditional

There used to be a second directive beside the managed blocks, resolved as the
scaffold was written rather than after:

```js
// idlewild:if character
this.spawnCharacter();
// idlewild:end if
```

The marker lines never reached disk; what was between them did only when the
option was on. The reasoning was that `character` could not reach a project
through the config, because *leaving a character out means not writing the
lines that make one* — and that was true while the lines were in the scene
file, which was the author's. It stopped being true when the wiring moved into
`js/shared/character.js`, which is the editor's: the file is scaffolded either
way and `spawnCharacter` reads `config.character` and returns null.

So the directive is gone, and with it `templates::resolve` and the whole idea
of a template that is not the same text every time. That is worth more than
the feature it bought: the file on disk and the pristine text a Reset compares
against were only equal because both halves of the editor asked the same
function for the same project, which is a rule somebody had to keep. Now they
are equal because there is one answer.

What it buys directly is a **switch**. Project Options could previously only
*report* whether New Project had written a character, because unticking a box
cannot take one out of code that already has it. It is a toggle now, and
turning it on is a save — the prefab is scaffolded whether or not it is
spawned, so there is a `js/prefabs/character.js` waiting rather than a file to
go and create.

## Where the code panel sits

There are three places, and they are three different jobs: a row above the
console, a column to the **right** of the canvas, and over the whole shell. The
first two are docks — part of the layout, with the canvas keeping whatever is
left — and the third is an overlay.

There was a left dock for one build. It was the right one mirrored, and code
about a canvas reads better *after* the canvas than in front of it, so it went
— `readPlacement` answers "right" for anyone who was in it, which is the same
column on the other side and the same remembered width.

**It opens on the bottom.** Code in this editor is code about the thing beside
it: the config follows the canvas, a save while a game is up restarts it, and a
console line opens the file it was written in — all of which you want to be
looking at while it happens, and the bottom dock is the placement that says so
with the least moved. The other two are in the pin's menu, and the choice is
remembered (`codePlacement`, and the old `codePinned` is read once for anyone
who only ever answered that: "not pinned" was today's full screen).

A column is there because a file is taller than it is wide. On a wide screen the
bottom dock gives the editor a strip of the window's height and the canvas the
rest; the column gives the editor the whole height of the row, which is the
shape the thing being edited actually is.

Docked, the panel is a row or a column of the shell and its divider writes an
inline `height` or `width` on it. Over the shell, it is `position: absolute;
inset: 0` — and an absolutely positioned box given top, bottom *and* a size is
over-constrained, so the browser drops `bottom` and the panel hangs from the top
at whatever size it was docked at. Every move therefore takes **both** inline
sizes off first, in `place`, and the new placement's divider puts its own back —
which is also how each placement keeps a size of its own: a height for the
bottom, a width for the two columns. Without that, moving from a column to the
overlay does not look like an overlay; it looks like the panel jumped to the top
of the screen, which is exactly what it did.

### One bar of chrome, where there were three

The panel had a **head** across the top carrying three placement buttons, Docs
and Close; a **file bar** under it carrying the column's switch and the open
file's name; and a **footer** under the editor carrying Save, the words "⌘S"
and a pair of history buttons. Sixty, forty-four and fifty-six pixels — a
hundred and sixty of the window spent on nine controls, in a section whose
whole subject is a file taller than the screen, on a device where the screen is
not large to begin with. The editor is developed on an iPad; that is a third of
a bottom dock gone before a line of code is shown.

It is **one 44px row** now, `code/code-bar.ts`, and it reads left to right as
two groups. On the left, what is about the **file** under it: the column's
switch, the path, whether it is saved, and whatever the editor last had to say
about an edit. Right-aligned, what is about the **panel**: the pin, the
reference, Close. That is the same sentence the head and the file bar were
saying between them, in one row instead of two — and it is why the three that
moved are the ones that moved, rather than the ones that happened to fit.

**The pin is a menu now.** Three is still the right number of places, and a
control that *cycled* through them would be a guessing game — but a menu is
not a cycle: it says all three at once, ticks the one in force rather than
dropping it, and costs the bar a single 32px button instead of most of its
width. Docs loses its word for the same reason; the book is what the reference
is everywhere else in this editor, and the sentence it stood beside is on its
tooltip. All four buttons in the bar are now the same 32px square, where they
had been a bordered pill, a labelled group and a full-height icon button on
two different bars.

**The footer is gone outright, not moved.** Nothing on it did anything the
keyboard does not — ⌘S, ⌘Z, ⇧⌘Z — and the two jobs Save was quietly doing are
done without it: the modal writes a dirty file when another is opened in it
(`openFile`) and when the section is left (`CodePanel.hide`), so nothing typed
can be lost by leaving. The history pair went with it; the editor's own header
carries one that follows the caret in here. What that costs is the full-screen
placement, where the header is covered: there, on a device with no keyboard,
there is now no button for undo. That is the trade — 56px of every file in
every placement against two buttons in one of them.

**Two safe-area insets had to be caught by what is left.** The head owned the
top, so the file bar takes it or it sits under the iPad's status bar; the
footer owned the bottom, so `.code-panel` takes it or the last line of the file
sits under the home indicator. Both fail silently and neither fails on a Mac,
which is why `styles.test.ts` asserts them.

**And the path had to learn to be cut.** One row means the filename shares it
with everything else, and in a 260px column dock `js/prefabs/character.js` has
to lose something. It is two spans rather than one string: the folders shrink
and ellipsize, the filename never does, and the whole path is on the title. A
bar that cut the other way would be a bar naming a folder.

**New File and New Folder are over the column they create into**, which is where
they belong: they read which file is open to decide where a new one goes, and
they used to sit in the head, a long way from the thing they make. They are the
width of that column and shorter than a button in the bar, because they are a
strip rather than a row of chrome — and in a column dock they stack, because 170
px is not two names wide and clipping "New Folder" to "New Fold" is the other
answer.

**The reference takes whichever side the panel has room for** (`placeDocs`):
beside the editor when the panel is wide — the bottom dock and the full-screen
one — because a reference page is a column of prose and the bottom dock has no
height to spare for one; under the editor when the panel is itself a column,
where there is no width to give away and where phaser-bench had it. Each side is
a divider on a different axis, so each remembers its own size and the inline
size the other one wrote comes off first — the same trap as the panel's own
placements, one level down.

**Beside the editor it is the same panel turned sideways, and it was not.** Its
contents list used to stack *above* the page there rather than staying beside
it, which was wrong twice over: a contents list reads as a column and a page of
prose reads under a heading, and the page was then a `flex: 1` child of a
column with no `min-height: 0` — so it could not shrink below its own content,
grew past the panel, and was cut off by the panel's `overflow: hidden` with no
scrollbar to get any of it back. A longer page showed *less* of itself, which
is not a shape anybody debugs quickly. The nav stays beside the page on both
sides now, narrower where the column is, and `.docs-content` carries a
`min-height: 0` as well as its `min-width: 0` because the panel is laid out
both ways.

**And it may have the whole height of the row it is in.** The rule that was
actually cropping it is `.code-backdrop.docked .docs-panel { max-height: 50% }`
— right for a reference stacked on a 320px bottom dock, which has to leave the
editor above it something, and meaningless for one *beside* the editor, where
the height is the row's and there is nothing underneath to leave room for. A
`max-height` is also the one thing that beats the `height: auto` a stretched
flex item needs, so the panel stopped at half the dock and its page was cut off
at the same line however long the page was. Lifted for `docs-right` only.

**The file column folds two ways.** Its folders collapse — the list Rust returns
is flat and sorted, so "inside" is a path prefix and a shut folder is rows not
rendered — and the choice is remembered per install rather than per project,
because `js/shared` means the same thing in every project this editor makes and
a fold that reset every time Code was left is a fold nobody would use. Opening a
file opens the folders above it, so a file reached from a console line is still
findable in the column, and a drop into a shut folder opens it rather than
looking like the file went nowhere. The whole column comes off on the switch
beside the open file's path, which is the control a 420 px column dock most
wants: the tree is the half you only need between files.

### The file it opens with

The panel is built on the way into Code and destroyed on the way out. That is
what makes Code a *section* rather than a floating window, and it is also why
"which file is open" cannot live in the panel: every visit would decide it
again. It did, and the answer was a constant — `js/scenes/WorldScene.js`, the
one scene file a project had when there was only ever one. A project
scaffolded since is a file per scene named after it, so that lookup found
nothing and a new project opened into an empty editor; an old one opened into
its scene and then closed it again the moment you went to look at the canvas.

`code/last-file.ts` holds it outside the panel, in `localStorage` beside the
folds the file column keeps. Two things about the shape:

- **Keyed by project.** A path means nothing across them —
  `js/prefabs/character.js` is a different file in each — so it is a map, and
  the map is capped at the most recent thirty-two so a row per project ever
  opened is not something nobody prunes.
- **A remembered file that no longer exists is not an answer.** `opening`
  takes the listing as well as the remembered path and only answers with one
  the tree still has, as a file rather than a folder. Then the project's first
  scene — not `js/scenes/index.js`, which is a generated list of scenes rather
  than a scene — then `js/main.js`, then whatever is first. A project with no
  files at all answers null and the panel opens with no file, which is the
  honest thing to show.

A rename carries the answer with it (`onMoved`), and a delete drops it, so the
next visit falls through rather than looking for something that is not there.

---

### Find, twice, because there are two questions

⌘F is about the file in front of you and ⇧⌘F is about the project. They are two
panels, coordinated by `code/finding.ts`, and where each one *is* is most of
what it means.

**⌘F floats over the editor.** The panel already spends one 44px bar of a
window on chrome, in a section whose whole subject is a file taller than the
screen; a fifth dock would cost every placement another forty pixels for
something that is up for as long as it takes to type six characters. So it is
absolutely positioned in the top right of the editor column — which is why
`.code-main` carries `position: relative`, asserted in `styles.test.ts`,
because without a containing block the box hangs off the shell instead and
nothing throws. It opens seeded from the selection, when the selection is one
line's worth, and it selects the match rather than only scrolling to it, so
Escape leaves the caret on what you were looking for.

**⇧⌘F stands at the top of the file column.** Its answers are files, and the
column of files is already there; a second floating window listing files, over
a panel with a list of files down its left edge, would be the same list twice.
The results take the column while they are up (`FileTree.setSearching`, and one
rule in `code.css`) because a 170px column dock has room for one list at a
time — nothing is destroyed, so the tree comes back folded exactly as it was,
with the same row still marked open.

**Both are plain substring, with a case switch.** What anybody searches for in
this tree is `config.scenes` or `place(`, and a box that quietly reads those as
patterns answers a question nobody asked. Case is the one option that is
genuinely wanted, because `Scene` and `scene` are a class and a variable in
every file here.

**The cross-file half is Rust.** `game_search.rs` is one call per query rather
than a read per file — the alternative is twenty round trips and twenty copies
of the tree crossing the IPC boundary as JSON strings on every keystroke — and
it walks `store::list_game_files`, the same listing the column shows, so a
result and a row are the same set of files said twice. It skips what it cannot
read as text (somebody will drop a PNG into `game/`) and what is over 512 KiB,
and caps the answer at three hundred matches, saying so.

The one subtle thing in it is the **column**. The frontend adds it to a
CodeMirror line offset, and CodeMirror counts a document the way JavaScript
counts a string, in UTF-16 code units. A byte offset would be right for every
ASCII file in this tree and one place out on the first line carrying an em dash
in a comment — which is most comment lines in a project this editor scaffolded.
So the scan works in `char`s and the column is a sum of `len_utf16`. Case
folding is done **per character**, taking a character's lower case only when it
has exactly one, for the same reason: `char::to_lowercase` is an iterator
because a few characters lowercase to several, and a folded line of a different
length from the line it came from is how an offset ends up pointing at the
wrong place.

Both bindings are registered **twice**, and that is deliberate. CodeMirror's
content is `contenteditable`, so a keystroke in the editor goes to its keymap
and never reaches a document-level listener — `editor/shortcuts.ts` stands down
for text fields by design. The keymap entries are in `editor-state.ts`;
`Finding.handleShortcut` covers the rest of the panel, and `defaultPrevented`
is what stops the two from both firing as an event bubbles out of the editor.
Preventing the default matters beyond tidiness: WKWebView takes an
un-prevented ⌘F as its own page search.

---

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

### A line is parts, not a string

An entry carries a list of **parts**: runs of text, with whatever styling a
`%c` asked for, and *values* — arguments that were objects, which the drawer
draws as a tree you can open a level at a time (`editor/log-tree.ts`), with
keys, strings, numbers, booleans and nulls each shown as what they are.
Children are built on first open, so a five-hundred-line drawer has not built
any of them.

The value in a part is a **snapshot**, never the object (`lib/log-value.ts`).
Two reasons, and the second is the hard one: the drawer keeps its last 500
lines, so live references would pin every sprite ever logged; and the game
frame is a different origin, which can only post — and a structured clone of a
Phaser scene throws before it gets anywhere.

The snapshot is tagged rather than plain JSON, because the tags are the things
a console is for. `"5"` is not `5`; `NaN` and `-0` do not survive a JSON round
trip; a class instance says which class (`Body {vx: 0, vy: 12}`) where a plain
object stays unlabelled; a `Map` or `Set` is opened, since Phaser is full of
both and `Map {}` says nothing; and `[Circular]` is a cut cycle rather than a
string that happens to read that way. `seen` is the chain of *ancestors*, not
everything visited, so the same sprite logged twice side by side is shown
twice. Depth caps at 4, entries at 100, and what was cut is counted rather
than quietly dropped.

A snapshot shows what was true when the line was written, where devtools shows
what is true when you open it. That is a difference worth knowing and, for a
game mutating one sprite sixty times a second, mostly an improvement.

**The same flattening exists twice.** The bridge cannot import
`log-value.ts` — different origin, plain injected script — so it carries its
own copy, and hangs it off `window.__idlewildSnapshot` before it looks for a
parent. `__tests__/log-value.test.ts` runs both over the same fixtures, which
is what holds one contract across two implementations.

### LOG is a link

`console.log` is labelled **LOG**, not INFO: `log` is what you write while
debugging and `info` is what a library announces itself with, and the editor's
own commentary is the second kind. So `LogLevel` has both.

Where a line came from a file the code modal can open, its level chip *is* the
way back to it — the fastest thing in a console is the one that answers "where
did this come from". The bridge reads the site out of a thrown error's stack
with one regex for two engines (JSC writes `fn@url:line:col`, V8 writes
`    at fn (url:line:col)`), and steps over two kinds of frame that are never
the answer: its own, and anything under `lib/`. That second skip is why a
`console.log` reached through a Phaser callback still reports the line you
wrote. `siteIn` is pure and exposed for the same reason the snapshot is;
`__tests__/console-site.test.ts` puts real stacks from both engines through
it.

Clicking the chip opens the code modal — pinned, if it was not already up — at
that file, centres the line and selects it, so the active-line highlight lands
on it rather than leaving you to count rows. The editor's own JS lines carry
no site: the frames behind them are this bundle's, and a link into a minified
chunk is a link to nowhere.

### App and JS

The drawer does double duty, so every entry carries a `source` and the header
carries a toggle for each.

**App** is the editor talking about itself: every `log.info`/`warn`/`error`
call in this codebase, plus psd-to-json's progress, which arrives from Rust as
`psd-log-line`. **JS** is the JavaScript console — whatever `console.*` is
handed in this page, plus everything the game frame forwards, plus uncaught
errors and rejected promises from both. The App half is all `info`, which is
what makes the JS half's `log` legible beside it.

The two are told apart at the call site rather than afterwards: the editor's
own commentary goes through `info`/`warn`/`error` and never touches `console`,
and `captureConsole` tags what it wraps. `logFrom({ source, site }, level, …)`
is the one entry point that says which, and the only one that can attach a
site.

The toggles are right-aligned in the header bar and appear only while the
drawer is open — a filter on output you cannot see is chrome for nothing. The
choice is remembered in `localStorage` under `consoleSources`, and both are on
for anyone who has never touched them.

An `Error` is now stringified with its stack. `TypeError: undefined is not an
object` with no frame under it names nothing you can go and look at, and a
frame is the point of the JS half.

**Clear** sits beside the two toggles and is not a third one. A filter hides
lines; this throws them away, both sources at once, which is what you press
before trying the thing you are actually debugging so that what appears next
is only about that. It goes through `log.clearLog`, so the store and every
drawer painting from it empty together. Not remembered, and not undoable — the
console is a record of what happened rather than a document.

## Known gaps

- **The server publish is SFTP, not rsync**, so a changed file is sent whole
  rather than as a diff against what is already there. The manifest recovers
  skipping unchanged files, which is most of the benefit, and not the rest. The
  sending half of rsync's wire protocol is published as a library by nobody and
  is defined by rsync's own source rather than a specification.
- **The iOS build has never been compiled.** There is no macOS or Xcode in the
  environment this was written in. `libgit2-sys` defining `GIT_SECURE_TRANSPORT`
  for `apple` targets, `ring` cross-compiling to `aarch64-apple-ios`, and
  `vendored-openssl` covering git2-rs's `not(target_os = "macos")` gate are all
  arguments from how those crates are built rather than from having watched
  them build. It is the first thing to check on a device.
- **The GitHub token and the ssh key are in a file, not in the system
  keychain.** `publish.json` is `0600`, beside the project store — anything that
  can read it can already read every project's source — but Keychain and its
  iOS counterpart are the right answer, and are a dependency and a platform
  pair that have not been taken on. The key's passphrase sitting beside the key
  is the sharper half of that: it is the difference between somebody who has
  the file having a key and having a *usable* key.
- **An ssh password is not an option, only a key.** Storing one would mean
  carrying a password to disk with nothing better to put it in, and
  `ssh-copy-id` is the answer everybody already has — but it does mean a host
  that only takes passwords cannot be published to from here.
- **A server certificate is trusted on first use like a bare key.** Checking one
  properly means carrying the issuing authority's key, and nothing in this app
  has anywhere to get one.
- **A publish target does not travel in a `.idlewild` file.** It names a server
  by an id that exists only in this install's settings, and `meta.json` does not
  travel anyway. A project opened on another machine has to be pointed
  somewhere again.
- A publish says how it went in the console rather than showing progress.
  `rsync` and `git` are run to completion and their last lines are reported;
  neither is parsed as it goes, so a large first publish is a line saying it
  started and then a line saying it finished.
- ⌘C on an iPad puts a `public.file-url` on the pasteboard and nothing else, so
  what it copies is pasteable into Idlewild and not into another app — which is
  the half the gesture is for, and *Share PSD* is the other half. Offering the
  bytes beside it there means an `NSDictionary` through `setItems:`, since
  `setData:forPasteboardType:` sets one representation on the first item. See
  *Copying is not pasting backwards*.
- A PSD imported out of another project arrives as its artwork alone: the
  document's record of it — the solid behind an extruded layer, a collider
  somebody edited — lives in that project's `doc.json` and does not travel. The
  export that carries them is `.idlewild`, which brings the whole project, and
  there is no half-way format between the two.
- Pattern fills store their PSD key and render as a tint; the texture is not
  yet sampled into the fill. That is a *fill* whose texture is a **PSD in the
  project**, and it is a third sense of the word, unrelated to a pattern layer
  and unrelated to the app-wide library. A fill made of a library pattern or
  shape does draw — see *The pattern and shape libraries*.
- There is no **combination** editor, which is the one thing
  simple-tileset-generator has that this does not: a shape spanning several
  tiles, with a pattern per path. Every piece is here — the shapes, the
  patterns, the lattice, the boolean — and what is missing is the editor and
  somewhere for a multi-tile stamp to live in the document, since a `Stroke`'s
  stamp is one space.
- A shape stroke carries a shape *or* a pattern, never both. The combination
  editor's per-path patterns are the obvious place that would be wanted, and
  `PaintSpec.kind` would have to stop being one of three things first.
- The SVG reader does not convert arcs. An `A` comes through as a straight
  line to its endpoint, which is honest but lossy; every other command, in
  both cases, round-trips.
- The boolean cut answers in polygons, not curves. A cut edge is the curve
  walked at twelve samples a segment, which reads as the curve at a tile's
  size and does not if the shape is later scaled far up. A boolean over
  beziers is a much larger piece of work, and upstream makes the same trade.
- A painted fill larger than 3072 world pixels a side keeps its flat colour:
  the canvas texture it would need is the trap `fill-actions.ts` guards
  against when it generates a PSD, measured in hundreds of megabytes.
- The library is per install and a document names a row by id, so a project
  moved to another machine loses any custom pattern or shape it used — it
  draws in its colour and says so. A library export, or carrying used rows in
  the `.idlewild` file, is the fix and neither is written.
- A pattern layer is absent from the minimap in both directions: its
  placements are a palette standing nowhere, so drawing them would show a
  heap of elements on one space, and the pattern made of them reaches
  everywhere, so there is nothing about it a map of where your work *is*
  could usefully frame.
- A pattern's elements are placed one Phaser group at a time, which is what
  `MAX_ON_SCREEN` exists to bound. A scatter dense enough to matter wants a
  blitter or a render texture, and at that point the ceiling becomes a
  performance note rather than a wall.
- An image background is written as a canvas covering the spaces asked for,
  with one clear sprite layer inside `T | Background`. Nothing samples what
  the artist paints back into a *smaller* file, so a backdrop asked for at
  thirty spaces stays thirty spaces wide however much of it is left
  transparent.
- The progress a background sheet shows is indeterminate. The pipeline names
  the stage it has reached and not how far through it is, and a bar filling at
  a rate nobody measured would be a guess dressed as a measurement.
- A pattern shape drawn with the pencil is baked to cells when it is made and
  never re-baked. Changing the grid size afterwards leaves the spaces where
  they were rather than following the line that produced them.
- A character sorts into the isometric ordering of **one** layer — the
  front-most object layer — so scenery on another object layer is either
  always in front of it or always behind. That is a useful thing to be able to
  say and a limitation where it was not meant.
- Nothing sorts on Y under a flat projection, in the editor or in the game, so
  a top-down orthogonal character is always in front. The sort key exists and
  the machinery is the same; what is missing is a reading of `cy` that a
  square grid's placements agree with.
- Only the character sorts itself in. Anything else the project's own code
  adds to an isometric scene — a second walker, a projectile, a door that
  opens — has to do the same lookup, and `walkDepth` is exported into the
  scene for exactly that, but nothing does it for you.
- A colour's opacity reaches the exported game and the PSD pipeline, but
  **not** a PSD's own pixels: ink applied in PSD Edit mode is composited into the
  file at the opacity it was drawn with, which is correct, and there is no way
  to change a layer's opacity in the file afterwards.
- The point-to-point fill's shape reaches no history. It is drawing-layer
  state rather than a document object, so ⌘Z does not take a corner back —
  Undo corner on the floating bar is the whole of it, and leaving the layer
  throws the shape away without a way back. The thing it *becomes* is a
  stroke, which undoes like any other.
- The floating bars keep a fixed left gutter rather than one that knows where
  the tool columns actually are. The rail hangs from the top and the drawing
  toolbar stands on the bottom, so between them they cover most of that edge
  and a constant is honest most of the time — but a bar over something in the
  vertical middle of the canvas is pushed right by 88px for nothing.
- The Boundary tool sweeps freehand and nothing else. There is no
  point-to-point boundary the way there is a point-to-point fill, and the two
  are the same shape of problem — a polygon tapped out and adjusted — so the
  second one is a matter of reusing the first rather than of new thinking.
- A boundary swept with the tool arrives blocking, and the only way to make it
  passable is the inspector row afterwards. There is no modifier or toggle on
  the tool itself, because a bar for one tool is chrome and the row is one tap
  away.
- Mask mode sweeps rectangles and nothing else. A boundary that is genuinely
  diagonal is a staircase of sweeps, and the obvious answer — dragging a
  freehand path that paints the spaces under it — is one method away. The
  rectangle is what the working half of the old route did, so it is what
  shipped first.
- A pattern shape edited in mask mode loses the outline a pencil gave it, and
  that is deliberate rather than pending: the line described spaces that are
  no longer the shape's. What is missing is the other direction — no way to
  take a drawn line *into* the mode and adjust it as a line.
- The drawing layer's re-anchor still re-bakes what is visible rather than
  sliding the baked pixels and repainting the newly exposed strips (Hush's
  delta #25), and its done canvas is a single buffer rather than the
  opacity-swap pair (#29/#31). Both are about panning and re-anchoring; the
  stroke path itself has been through the rest of Hush's deltas — see **What a
  stroke costs**.
- There is no tile index over the strokes on a layer. A re-bake culls on each
  stroke's bounding box against the backing, which is enough at the sizes a
  sketch reaches and is not the same thing as knowing which strokes touch a
  dirty rectangle.
- Two PSDs with a same-named **mask** still collide in Phaser's texture cache.
  Artwork no longer does — every load goes through `loadMultiple`, which keys a
  texture on the PSD as well as the layer — but `place` looks a mask up as
  `<name>_mask` on both of the plugin's loading paths, so there is no key to
  scope it under. Masks are rare, and a shared one is a wrong shape rather than a
  missing picture. See **The texture keys**.
- A placed group is still a Phaser Group rather than a Container. Its parts
  are positioned and scaled one at a time, from the offsets they were made
  at, which is what makes a composition move and resize as one — but there is
  no single object underneath it, so there is nothing to rotate, clip or mask
  as a whole.
- Strokes are listed under a layer as one row rather than individually, and
  are the one thing that cannot be carried to another layer from the panel. A
  sketch is a few hundred strokes and each is a stroke of a pen, not an
  object; the row selects the lot, which is the granularity both conversions
  work at anyway.
- The project thumbnail is a snapshot of Phaser's canvas, so a layer that is
  only a sketch photographs blank. It is also the one thing leaving a project
  waits for, and `renderer.snapshot` queues its callback for the end of the
  next render pass — so a pass that cannot finish used to mean a promise that
  never settled and a Back button that did nothing. It times out now: no
  picture is an answer, and a thumbnail must not be able to hold the door
  shut.
- The minimap re-bakes whenever the framing moves, and the framing moves on
  every pan where the camera is not already inside the work — which is most of
  them. It is cheap because what it draws is boxes and sampled lines rather
  than artwork, and a heavy scene measured under software rendering costs it
  under two milliseconds a frame; the version after this one bakes the content
  once at its own framing and blits it, the way the drawing layer presents its
  backing rather than repainting it.
- A minimap tap moves the camera but never the zoom, so there is no framing a
  region by dragging a box on it, and no way back to the whole document in one
  gesture.
- **A step has no name.** The stack holds snapshots and nothing else, so the
  buttons say "Undo" rather than "Undo Move image", and the console says
  nothing when a step goes back. Labelling would mean threading a string
  through every mutation on `DocStore`, and what the canvas does when you
  press it is already the answer most of the time.
- Undoing an import leaves the PSD it wrote in `psd/`, and undoing a
  conversion leaves the file the fill or the sketch became. Nothing points at
  them, and redo finds them still registered — but a project accumulates
  orphans that only a re-export sheds.
- The two file operations that raise a history barrier — renaming a PSD, and
  bringing an edited one back — clear **both** stacks rather than fencing the
  part of the document they actually touched. Twenty steps of grid work are
  gone the moment a file is renamed, which is heavy-handed for safety that a
  per-key fence would give more cheaply.
- An undo that lands in another scene switches to it, which is right, but it
  arrives with no notice — the canvas simply becomes somewhere else.
- A canvas mode's history is the session's and dies with it, so Cancel is
  still all-or-nothing: there is no undoing your way out of a mode, and no
  redoing a shape you cancelled. Apply is the same door in the other
  direction — the pulls that made a solid collapse into the one document step
  that placed it.
- Strokes do not reach a publish, and play mode is a publish now, so they do
  not reach play either. They are scaffolding for the PSDs and boundaries they
  become.
- Play mode is the published game, which means it does not inherit the
  editor's camera: it opens where the project's own scene puts it. That was a
  deliberate trade for running the user's code, but "play from where I am
  looking" is a real thing to want.
- The code modal has none of phaser-bench's Phaser-aware completions, and the
  binding runs one way: the canvas drives the code, through the generated
  config, and code does not yet drive the canvas.
- **A 1× asset still arrives at half size.** `IMPORT_SCALE` is a constant
  rather than a per-project setting, so an 8px project importing 1× art has to
  resize it once — and `defaultZoom` does not help, because it is a camera.
  Neither of them is "this project's art is 1×", which is the setting a
  pixel-art project actually wants.
- Pixel art applies to the *editor's* textures and the game's renderer, and to
  the camera for whole pixels — but the drawing layer's own backing canvases are
  not re-filtered with them, so ink drawn while it is on can still be smoothed
  as the canvas scales. The ink is baked at its own resolution; making it blocky
  is a question about the brush engine rather than about this setting.
- A project made before the eye column keeps its own `placeDocument`, so its
  game draws a hidden layer until that block is Reset — `applyHidden` is
  offered as a block it has never had, but nothing can add the line that calls
  it. The editor's own canvas hides it either way, which is the half that is
  not template code.
- Hiding a layer inside a **merged** group — an `S | name` over a group, a
  tileset, an atlas — bakes it out of the composited image rather than
  carrying it as a flag. That is psd-to-json's behaviour and the right one for
  a single image, but it means "hidden is still exported and accessible" holds
  only for layers that are placed separately.
- A project's `game/` tree is never migrated, which is what makes it the user's
  — and what means the new layout, the camera block and the dropped grid reach a
  project made before them only as far as the offer to add a missing block goes.
  There is no "bring my tree up to date", and the three shims that keep the old
  layout working (the server's runtime paths, the exporter's, and
  `templates::MOVED`) are the price of not having one.
- Re-import replaces a whole PSD. There is no diff against the previous
  parse, so a placement is matched to the new file only by its layer path.
- The anchor mark is written on import and read on every parse after, but
  there is no way to move it from inside the editor — that is Photoshop's
  job, which is the point, but it does mean a PSD imported from elsewhere
  anchors on its canvas centre until someone adds one.
- A stroke selection converted to a PSD is still centred on the cell under
  its middle rather than sending an `art` offset, so it can land up to half a
  space from where it was drawn. A fill conversion is exact.
- Play mode's character is a placeholder rectangle, not a sprite from the
  template, in both styles. It is the template's own rectangle now, so it is at
  least a thing you can go and change.
- A managed block's ownership is decided by a line diff, so two identical lines
  inside one block — a bare `}`, a blank line — can swap which of the pair is
  called the editor's. Nothing breaks; a line you typed may simply be the
  locked one. Reset is the way out.
- A re-import reconciles the placements of that PSD in the **open scene**
  only: other scenes keep the geometry they had, and a layer the new file
  added does not appear in them. Staleness rather than corruption — the
  placements still point at a key that exists — but it is a scene switch away
  from being visible and there is nothing that says so.
- There is one Phaser scene per Idlewild scene now, and the exported game
  opens on the one the editor had open. What there is no shape for yet is
  **transitions**: `this.scene.start("Cave")` works and is documented in the
  scaffold, and anything softer than a cut is the author's to write.
- `canvas.js`, `character.js`, `main.js` and the generated config carry
  managed blocks. `grid.js`, `navigation.js` and `physics.js` are the
  project's alone, even though the scaffold wrote them and the editor's
  config is what they read — and a **scene** file is the project's by
  design, which is the point of the split.
- A platformer takes a blocking boundary as its bounding box, and a
  collider's spaces go through the same reduction in `physics.js`. Resolving
  against the polygon — sloped ground — is a different feature.
- **Resizing a placement does not resize its collider.** The shape is a fact
  about the file and the size is a fact about the placement, so a copy scaled
  to twice the size goes on blocking the spaces the original did. Re-opening
  the collider and drawing the difference is the way round it; making it
  follow the scale would mean the two copies of a referenced PSD could no
  longer share one record.
- A collider record outlives the last placement of its key, the way an
  extrusion's solid does. Nothing reads it while nothing is placed, and
  placing the file again finds the shape it had.
- A collider on a project whose grid does not snap is the artwork's box and
  cannot be edited: there are no spaces to paint. The box follows the artwork
  as it is dragged, so the honest gap is that it cannot be made tighter than
  the picture.
- Renaming a PSD moves the file, not the layer inside it, so a renamed file
  keeps the layer path it was imported under. That is what makes the rename
  safe for every placement on it; the inspector's PSD layer list is where the
  layer's own name is changed.
- A blank project's play mode navigates on a square lattice of the project's
  nominal unit rather than on what was actually drawn. A* over single pixels
  would neither finish nor mean anything, but a coarse lattice over free-form
  geometry is a compromise, not an answer.
- Opening a `.idlewild` from Files or the Finder is not wired: the format is
  real and the in-app Open reads it, but there is no system file-type
  declaration and nothing handles a file the OS hands the app.
- An import trusts the archive's `assets/` rather than re-running the
  pipeline over its `psd/`. That is what makes an import instant, and it means
  an archive whose assets were stale carries the staleness across; the fix is
  the same Re-import that fixes it anywhere else.
- An export ships the `game/` tree as it stands on disk, which is what makes
  it the user's source — so a project scaffolded before a fix to the template
  keeps its own copy of the old scene, and its managed blocks reset to the
  template the *current* binary holds rather than the one it was made with.
  `game.config.json` is the exception twice over: it is generated, kept in step
  on every save, and rewritten again on the way into the zip.
- Pattern fills export as a flat colour, matching what the editor draws, and
  a pattern's PSD key is not among the `psdKeys` an export loads.
- Neither the Tauri build nor the iPad target has been exercised in CI; both
  need a machine with the platform SDKs. The pasteboard's Apple arms are
  type-checked against both Apple targets but have never been run on one.
- **The iPad now advertises multi-window, and nothing refuses the second one.**
  `UIApplicationSupportsMultipleScenes` is true in the patched Info.plist
  because in tao 0.35.3 that key is the only switch for the whole UIScene path,
  and without the scene path iOS 27 will not launch the app at all — see **The
  iPad needs a scene**. The consequence is that the system offers a second
  window of the editor, and a second editor over one project store is the
  condition **One game at a time** exists to prevent: `PluginCache` is a
  module-level singleton, and the second game's `PsdToPhaser` would be refused
  the key the first still holds. Nothing handles `SceneRequested` and nothing
  declines it. Two ways out and both are elsewhere: tao 0.37 makes the flag
  unnecessary, and until then the honest fix is to answer the event rather than
  to hope nobody drags the icon.
- An import takes its key from the file's name and overwrites a PSD already
  under it. That is deliberate for the clipboard — it is how *Replace from
  clipboard* works — but it means a dropped `roof.png` silently replaces an
  earlier `roof.psd`, where a drop *onto* an image asks first. The two ought
  to agree, and making them agree is a decision about what an import means,
  not a bug fix.
- Dropping several files at once takes the first one the pipeline can read.
  A drop is one gesture landing on one space, and a run of images would need
  somewhere to put the rest.
- Continuing an extrusion is refused on a PSD carrying masks or clipping,
  which the fork cannot express. The cube is still offered on such a file and
  Apply says why it will not write, which is one step later than it could be.
- Renaming an extrusion's *file* no longer renames the group inside it. The
  group is named for the key the file had when it was written, and only Apply
  renames it.
- Two groups sharing a name fold and unfold together, because a fold is held
  by name. Photoshop allows the duplicate; the alternative keys all come apart
  on a re-parse, which is the case the folds are most worth keeping through.
- The layer list shows nesting and reorders within a level, but offers no way
  to move a layer into or out of a group. That is a different gesture — a
  horizontal one, or a drop onto the group row — and a drag that could do it
  by accident would be worse than not offering it.
- A preserved layer that hung off the edge of the old canvas is cropped to it,
  because `crop` reads from the canvas-sized buffer the fork hands back and
  what was outside it was never in that buffer. The same is true of a rename,
  and has been all along.
- A continued extrusion keeps whatever scale its placement was resized to, so
  a block-out scaled to 80% comes back at 80% rather than snapping to the
  grid. The shape is right and the displayed size is the user's; they are only
  the same thing until someone resizes it.
- A fill or a sketch converted to a PSD is still a one-way door. Only an
  extrusion keeps what it was made from.
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
