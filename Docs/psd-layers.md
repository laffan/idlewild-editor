# A PSD's own layers

The stack inside a file, edited without leaving the app: the inspector's layer
list, an eye per row, reordering, the empty layer, and PSD Edit mode, which
reaches the artwork rather than the placement.

Part of [Idlewild's technical documentation](../README-TECHNICAL.md).

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
  eat a sketch's anchor — see [A rewrite may not lose a row](#a-rewrite-may-not-lose-a-row).
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
reason (see [Reordering layers](#reordering-layers)), and the Apply row appears only once
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

---

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

---

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
space of clear canvas around it — see [Room around what a conversion writes](extrude.md#room-around-what-a-conversion-writes) —
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
