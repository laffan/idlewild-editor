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
│  game_files.rs   the editable game/ tree, as the code modal    │
│                  sees it                                       │
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
to come due. The project's own `WorldScene.js` — the file the code modal opens
— never ran at all, so a `console.log` saved into it went nowhere and there was
no way to tell whether any edit to it had worked. And the same game existed
twice, once in TypeScript for the editor and once in JavaScript for the export,
kept in step by hand. Both are gone with those files.

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
`src/lib/doc-shape.ts` holds the parts of it that are functions rather than
state — an empty layer, a copy of one, and the migration a document goes
through on the way in from disk. Split from `doc-store.ts` for the line rule,
and it splits cleanly: none of it touches the store.

- **Layers are top-first**, matching Hush. Phaser depth counts upward, so
  layer *N* of *M* renders at depth `(M − N) × 1000`. Isometric placements add
  their world Y so nearer objects draw in front.
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
navigation walks, in the template's `WorldScene.js` as it was in the editor's
own play mode. That is what the New Game sheet's grid scale still means on a
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
direction on a diamond grid seen from above, so the New Game sheet greys the
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
| `character` | whether New Game scaffolded a character controller |

The first three are **settings**. Each reaches two places, and neither place is
told by the other: the editor's own Phaser game, through `game/boot.ts` at
start-up and `game/render-options.ts` afterwards, and the exported game, through
`game.config.json`. So a toggle in Project Options re-filters every texture on
the canvas *and* rewrites the config the project's own code reads, and the two
answers agree because they come from the same field.

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
| `history.begin()` / `end()` | the writes between them are one step | `game/drag.ts`, and either end of a gesture in both canvas modes |
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

Extrude and collider mode hold their work in their own objects and touch the
document only at Apply. That is the whole point of them — Cancel is dropping
what is in the object — and it means the document's history has *nothing* to
take back between one pull and the next. A stack that skipped over that would
be a stack with a hole in it exactly where the work is: pull a wall up ten,
pull an arm out of it, and ⌘Z would offer to undo whatever you did before you
entered the mode.

So each mode holds an `UndoHistory` of its own, over the value it is editing —
`ExtrudeState` for one, the collider's set of grid spaces for the other. The
same snapshot argument applies for the same reason, and collider mode's spaces
were made replace-rather-than-mutate to earn it.

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

An iPad without a keyboard is why the buttons exist at all, and it is also why
there are four of them. The pair in the header sits beside the Draw/Code/Play
toggle; the code panel carries a second pair in its footer beside Save,
because the header is behind it whenever the panel is placed over the whole
shell — which is exactly the moment a device with no ⌘ has nowhere else to
press.

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
Play does not is the editor *around* the canvas — both sidebars and the panel —
so the scene can be switched and the document adjusted while the game runs,
before a full test in Play.

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
  and the sidebars in Play only. Both halves are asserted in
  `styles/__tests__/styles.test.ts`, because "Code keeps the sidebars" is the
  whole reason the mode exists and a rule is an easy thing to widen by
  accident.
- **`editor.ts` runs the game for anything that is not Draw**, flushing the
  document first: the config the game reads is written by that save. A scene
  switch does the same, which is what makes the dropdown in the left sidebar
  worth having while the game is up.

Entering Code puts the panel up wherever it was last placed and leaving takes it
down, writing a dirty file on the way out. Anything that wants a file on screen
— the console's LOG link, which opens the line a message was written on — asks
for the mode first and the file second.

---

## Gesture routing

All pointer input over the canvas goes through one arbiter,
`src/game/camera-rig.ts`, which hands out high-level events. The spec's
contract:

| Input | Result |
|---|---|
| One finger down on the current selection | Drag it, snapped to the grid |
| One finger, moved, under **Select** | Rubber-band a selection from where it went down |
| One finger, moved, under **Pan** or **Point** | Pan |
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

### Points, and where a scene starts

A point is a named place: psd-to-phaser's `P | name`, made by hand rather than
found in a PSD. It has no size and nothing to fill, so it is a name and a
position and nothing else, and it is the one thing on the canvas that a tap on
*empty space* makes — which is why Point is a rail tool where Fill and
Boundary are not. Nothing already on the canvas can be promoted into one.

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
js/main.js
js/game.config.json      generated — see `game_config`
js/lib/                  Phaser and psd-to-phaser, written in by the exporter
js/scenes/WorldScene.js  the genre's program
js/prefabs/character.js  what walks it, when New Game asked for one
js/shared/grid.js        the projection, and the document's geometry
js/shared/…              the genre's own module: navigation.js or physics.js
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
modal: a Reset asked for `js/WorldScene.js` is answered with the pristine
`js/scenes/WorldScene.js`, because they are the same file under two names and
the block ids inside them are identical.

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

**The load is not racy, and the templates do not treat it as one.** P2P queues
its sprites from inside the handler that parses `data.json`, so it is fair to
wonder whether a scene that loads in `preload()` and places in `create()` can
find no textures. It cannot: Phaser's loader picks up files added during a
pass, and `create()` waits for the queue to drain — checked in a browser
against the real plugin, with the manifest artificially delayed. The editor
waits on `psdLoadComplete` because it loads at *runtime*, long after any
`preload()`, which is a different situation.

## Publish has two exits

They answer different questions, and the difference is the source PSDs.

| | Carries | For |
|---|---|---|
| **Export site** (`.zip`) | `game/`, processed `assets/`, both runtimes, a generated config | Serving. Nothing in it is what you would edit the project with |
| **Export project** (`.idlewild`) | the manifest, `doc.json`, `thumbnail.png`, `psd/`, `assets/`, `game/` | Opening somewhere else and carrying on |

A published site cannot give back the file a sprite was drawn in. That is the
whole reason the second format exists, and why `psd/` is in one and not the
other.

Both are written straight to the path the save dialog returned
(`publish_site`, `export_project`). The site export used to come back across
the IPC boundary as base64 and be written by `save_bytes`; an archive carrying
every processed asset — let alone every source PSD — has no business being a
string in a JSON message first.

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

**Open**, on the home screen beside New Game. The picker is unfiltered on a
touch device and filtered on a desktop, the same split as the editor's Add
Image and for the same reason: iPadOS reads the filter list to decide *which
picker* to show, and an extension it has never heard of is not a reliable way
to ask for the document browser.

`.idlewild` is not declared as a system file type. Doing so without wiring the
open would put Idlewild in macOS's "Open with" for a file it then ignores; the
declaration and the `RunEvent::Opened` / deep-link handling behind it belong
together, and neither has been exercised on either platform yet.

## Testing

`cargo test --lib` covers the load-bearing path: RGBA → PSD → psd-to-json →
manifest → zip, plus the path-traversal guards, the project scaffold, what an
export's config carries, the shapes a file picker hands back, and the order a
manifest lists a PSD's layers in — which the frontend mirrors and cannot check
for itself. The project's options are next door in `tests/options.rs`: that an
unticked character controller means no prefab and no `spawnCharacter` rather
than one that is never called, that no conditional marker survives into a
project's own files either way, that a Reset asks for the scaffold the project
was *made* with, and that changing a rendering option rewrites the config the
game reads rather than waiting for whatever touches the document next. The asset
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
geometry, undo's three answers about a write and what a restored document is,
what each canvas mode counts as one step of its own, whether a selection still
names something, the unit arithmetic
behind a placed PSD, what the clipboard hands a paste and where that paste
lands, what a failed clipboard read says happened and which of a dragged
selection of files a drop takes, colour, the log's `%c` parsing, the manifest
reader, the platformer's body step, the docs panel's markdown rendering and
its two kinds of lookup, what a project with no options of its own renders as,
and the drawing layer's ported maths. The handful of CSS declarations that are
load-bearing for input are asserted as text — the drawing surface's
positioning, and the code panel's four placements, where a docked rule that
stopped taking the panel out of `position: absolute` would look like a panel
that had covered the editor.
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
path and a pixel-art project can be exercised from a script. Its query string picks the fixture's template and
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

Carrying a placed PSD to another layer in the left panel takes the unit with
it, `instance` and all. The panel lists one row per placed *file* rather than
one per layer inside it, so what the gesture picks up is the file — see
**Two senses of "layer"** below.

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
size the New Game sheet set — the same fallback `size` serves everywhere else
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
shape is a fact about: two placements of one PSD are two views of the same
solid, and continuing either rewrites the file both draw. A rename moves the
record with the file and Remove Reference copies it to the new key, for the
same reason.

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
reason: two placements of one file are two views of the same thing, and a tree
that blocks the space it stands on blocks it wherever it is put. A copy made
by Remove Reference takes the collider with it and the two part company from
then on, which is what breaking a reference means everywhere else.

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

**`game/canvas-modes.ts` is what asks them.** Two modes that own the canvas
now, entered from places that have no reason to know about each other — the
floating action bar, and a row of the inspector — so entering one leaves the
other there rather than by convention. It is also the one place the scene asks
"has a mode claimed this gesture": three call sites deciding for themselves is
how a mode ends up owning drags but not taps.

### What reads it

**The game does, and nothing else.** Play runs the project's own code over
`game.config.json`, which is regenerated on every save, so there is one
implementation of what a collider means rather than one in the editor and
another in the export. `grid.js` turns a collider into spaces or boxes —
`colliderCells` and `colliderBoxes` — and the two scenes read it the way each
needs to: `WorldScene.js` builds the blocked set once in `create()`, because
`isWalkable` runs per node of every search and the document does not change
under a running game, and `physics.js` adds the boxes to the ground the
character stands on.

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
`WorldScene.js`, which cannot import it. `game/__tests__/draw-order.test.ts`
holds them to the same fixtures by pulling the template's functions out
between their markers and running both, the same arrangement the console
bridge's snapshot is under.

### Saving applies

`CodeModal.save` reports the path it wrote; the shell reloads the frame if a
game is up. That is what "saving code applies it" means here — the program
restarts against the file just written, which is the only way to see whether
the change worked. Entering play mode flushes the document first and waits for
it, because the document's save is what rewrites the config the game reads.

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

## Lines the editor owns

The editor writes code into a project and the user edits that same code.
Without a rule the two fight: the editor rewrites a function and takes a
hand-made change with it, or it stops rewriting and the code stops matching the
canvas. The rule is that ownership is **per line**.

A scaffolded file marks its editor-owned runs:

```js
// idlewild:begin placeDocument
placeDocument() { … }
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

This is not hypothetical. `WorldScene.js` gained `drawOrder` and `applyDepth`
when the exported game learned to stack a PSD the right way up, and without
that strip every project made before it would have drawn multi-layer files
upside down for good.

The generated config is the whole-file case of the same idea. It has no room
for comments and nothing in it was written by hand, so it is owned end to end
and read-only in CodeMirror's own terms as well — the caret still moves,
because reading and copying it is the point. There is no allowance for a break
at the end of a line there, unlike a block: no line of that file is not about
to be rewritten. It is re-read whenever the document is saved, so what is on
screen is what the running game reads.

Resetting the config means *regenerating* it — its pristine form is the
document as it stands, not the empty file a new project scaffolds with.

Today the marked blocks are `preload`, `applyCamera`, `placeDocument`,
`paintFill`, `drawOrder`, `applyDepth`, `applyScale` and `pointsToVectors`,
the same eight in both scenes, plus `pixelPerfect` in `main.js` and the config.
A test pins that the two genres mark the same set and that
every marker closes, because a block is found by id and one renamed on one side
would quietly stop offering its Reset there.

`drawGrid` was one of them and is gone: the scenes draw no lattice now. A
project scaffolded before that still has the block, and Reset on it reports that
there is no scaffold to go back to rather than emptying it — which is the same
answer the modal gives for any file the template does not write, and the right
one: what to do with a block the template dropped is the author's call.

### A scaffold-time conditional, which is not the same mechanism

`character` cannot reach a project through the config, because leaving a
character out means not writing the lines that make one. So the templates carry
one directive the scaffold resolves as it writes:

```js
// idlewild:if character
this.spawnCharacter();
// idlewild:end if
```

The marker lines never reach disk; what is between them does only when the
option is on. It is deliberately *not* the managed-block mechanism, which is
about lines the editor goes on owning after they are written — this is a choice
made once, before the file exists. The two do not interfere because both halves
of the editor ask `templates::template_files` for the same project: the file on
disk and the pristine text a Reset compares against are resolved the same way,
so a managed block's diff compares like with like. It is one level deep and one
option wide on purpose; a nested condition would be a templating language
growing out of a single checkbox.

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
with the least moved. The other three are one tap away and the choice is
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

### What is in the panel's own chrome

The head carries the three **placement** buttons on the left — the one control
in here that is about this row rather than about what is inside it — and
**Docs** with Close at the other end. The word "Code" and the project name were
there once and said nothing the user did not already know a moment after opening
the modal from that project.

**New File and New Folder are over the column they create into**, which is where
they belong: they read which file is open to decide where a new one goes, and
they used to sit in the head, a long way from the thing they make. They are the
width of that column and shorter than a button in the head, because they are a
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

## Known gaps

- Pattern fills store their PSD key and render as a tint; the texture is not
  yet sampled into the fill.
- Two PSDs with a same-named layer collide in Phaser's texture cache: P2P
  keys textures on the layer name unless loaded via `loadMultiple`. Reloading
  one of them now leaves the shared texture alone rather than blanking the
  other, so the collision shows as the wrong artwork rather than none — but it
  is still a collision.
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
  only a sketch photographs blank.
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
- The exported game places the open scene. Every scene's layers are in the
  config and every scene's PSDs are loaded, so switching in your own code is
  a matter of reading `config.scenes` — but the template does not, and one
  Phaser scene per Idlewild scene, with transitions, is a feature rather than
  a line.
- Only `WorldScene.js` and the generated config carry managed blocks.
  `grid.js`, `navigation.js` and `physics.js` are the project's alone, even
  though the scaffold wrote them and the editor's config is what they read.
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
