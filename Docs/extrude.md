# Extrude mode

Pulling a prototype solid out of the grid, and writing it back as a PSD
anchored on the spaces it was built over.

Part of [Idlewild's technical documentation](../README-TECHNICAL.md).

---

Pulling a prototype solid out of the grid, and applying it as a PSD. Entered
from the action bar over a held selection, which becomes the plate to pull.

## The model is voxels, and the two templates share it

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

## Why not three.js

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

## Picking is the drawing read backwards

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

## A sweep runs in the plane of the face it started on

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

## Backfaces, and the two toggles on the bar

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

## A hold still asks for spaces, even on the held face

A pointer that goes down on the held face starts a pull — but only
provisionally. It carries a hold timer of the same 320 ms the rig uses, and a
finger that has not moved by the time it fires turns the gesture into a
selection sweep instead. Without that, the top of a shape that had just been
pulled up was the one place a new selection could not be started, which is
exactly where the next one usually starts.

The mode therefore owns the pointer at every stage, and `world-scene.ts` asks
it first: `beginPull` before `drag.begin`, `beginSelect` before the marquee,
`tap` before the document is hit-tested.

## The dim, and where it sits

The scrim is a `Graphics` at `setScrollFactor(0)` filling a rectangle far
larger than any viewport, so a pan or a zoom needs no redraw at all. Depths
put it above everything the document renders and below the solid, its
highlight, and the marquee — the rubber band stays visible over the shape it
is being dragged across. It is drawn in the scene rather than as a CSS
overlay for the obvious reason: the canvas is one element, and a CSS scrim
would dim the shape along with everything else.

## Apply

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

## Which way up a conversion's stack goes

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

## The marks arrive turned off

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

## A conversion keeps its ink until the artwork is standing

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

## Room around what a conversion writes

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

## A placed group keeps its parts where they were

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

## A file that comes home without its mark

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

## Continuing an extrusion

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

## Layers the app owns the name of

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

## One re-parse, one placed object per layer in the file

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
