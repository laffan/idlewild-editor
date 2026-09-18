# The data model

What a project is on disk and in memory, how a change to it is undone, and the
one file per scene that keeps the document and the project's own code in step.

Part of [Idlewild's technical documentation](../README-TECHNICAL.md).

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
  — see [What is drawn over what](layers.md#what-is-drawn-over-what).
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
has gone (see [One bar of chrome, where there were three](code-panel.md#one-bar-of-chrome-where-there-were-three)), and the trade is
written down there: fifty-six pixels of every file in every placement, against
two buttons in the one placement that hides the header's.

---

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
