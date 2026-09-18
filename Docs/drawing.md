# The drawing layer

Hush's stroke engine inside a Phaser canvas: the surface it paints on, the
brushes, the tools built out of them, and how a colour carries its own opacity
everywhere it goes.

Part of [Idlewild's technical documentation](../README-TECHNICAL.md).

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
