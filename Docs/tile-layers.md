# Tile layers

A fourth kind of layer, and the one whose data is not ours. What a tile layer
holds is a Tiled map — in Tiled's records, in Tiled's spelling — and every
decision below follows from that.

Part of [Idlewild's technical documentation](../README-TECHNICAL.md).

---

## The rule the rest of it hangs from

**Tile layer data is indistinguishable from data the Tiled app wrote.** Not
*convertible to*, not *exportable as*: the same records, held the same way,
so that `doc.json` and a `.tmj` carry the same bytes for the same facts.

That is a stronger claim than it sounds, and it is the reason this feature
looks different from the three kinds of layer beside it. A pattern layer's
`PatternSpec` and a background layer's `Background` were designed here; they
are what this editor decided a pattern and a backdrop are. A tile layer's
`tiles` is `TiledTileLayer` and the document's `tilesets` is Tiled's tileset
array, both transcribed from [the JSON map
format](https://doc.mapeditor.org/en/stable/reference/json-map-format/) field
for field — all lower case and unabbreviated, which is why nothing in
`lib/tiled/types.ts` is camel-cased like the rest of the document.

The payoff is that there is no converter to keep honest. A map is
**assembled** on the way out rather than translated, and read straight in on
the way back; the only places a number changes are the two where it has to,
and both are written down below.

The cost is that a reader of this codebase meets a second vocabulary. `gid`,
`firstgid`, `chunk`, `tilecount`, `margin`, `spacing` are Tiled's words and
they mean what Tiled means by them. `Docs/tile-layers.md` — this page — is
where they are explained; nothing else here redefines them.

## Infinite, because this canvas has no edge

There is no world bound in this editor. The lattice is recomputed from the
camera over exactly the cells the viewport can see, a project has no corner to
reach, and every other feature here is written against that — a pattern is a
rule rather than a list, a backdrop is wherever you are looking, and
`gridSpan` in the exported config is a *report* of how far the content reaches
rather than a wall.

A tile layer with a `width` and a `height` would therefore have to pick some
rectangle and call it the world. Tiled had exactly this problem and answered
it with **infinite maps**, so that is the shape the document holds: a sparse
set of fixed chunks, sixteen spaces square, aligned to multiples of sixteen
from the origin, each holding one gid per space, row-major.

`lib/tiled/chunks.ts` owns it, and three things about that file are
load-bearing.

**A space that has never held a tile is in no chunk at all**, and a chunk that
has been emptied is dropped rather than kept as two hundred and fifty-six
zeroes. That is what keeps a document holding a long thin road from also
holding the desert it crosses — and what stops a long session of rubbing out
growing the file without bound.

**Every write replaces.** The hard rule at the top of README-TECHNICAL applies
here like everywhere else: `writeTiles` builds a new layer sharing every chunk
it did not touch, and copies a chunk only on first touch, because the chunk in
hand may still be the one a snapshot on the undo stack is holding. That is
what makes undo a pointer copy over a map of fifty thousand tiles.

**A write that changed nothing hands the layer back by identity.** A paint
drag writes on every pointer move and crosses ground it has already covered on
most of them, so this is the common case rather than the careful one —
`paintTiles` checks before it commits, and `UndoHistory.end`'s identity test
is what turns that into *no step at all* for a sweep that moved nothing.

`startx`, `starty`, `width` and `height` are Tiled's description of where the
content is, and they are **derived on every write rather than stored**. A
description maintained by hand is one that goes stale the first time a write
forgets it; a file this editor produces writes them because Tiled does.

**A finite map is cut into chunks on the way in.** A `.tmx` off somebody
else's disk usually has a fixed size, and `chunked()` converts it once at the
door so everything downstream reads one shape. The layer keeps its gids and
loses its rectangle, which is the honest conversion: the rectangle was a claim
about a map with edges, and this one has none.

## A gid is not an index

The number in a tile layer's data is a **global tile id**: the low 28 bits are
a tile's id across every tileset in the map, offset by the tileset's
`firstgid`, and the top four bits are flags saying the tile is flipped or
turned. Zero means the space is empty, which is why every emptiness test in
this feature is `gid === 0` rather than a null.

`lib/tiled/gid.ts` is that packing and nothing else, and it exists as a file
rather than as a couple of inline masks for one reason: `0x80000000` does not
fit in a signed 32-bit integer. JavaScript's bitwise operators work on signed
32-bit values, so a flipped tile read without `>>> 0` is a large negative
number matching no tileset — and the symptom is a map that draws perfectly
until somebody mirrors one wall in Tiled.

**Which tileset a gid belongs to is a search, not an index.** The rule is
Tiled's: the tileset with the largest `firstgid` that is still no larger than
the gid. A map's tilesets are not required to be in order, and one removed
from the middle leaves a gap rather than renumbering everything after it.

## The two places a number changes

Everything else is carried verbatim. These two are not, and both are forced.

**Layers come out back-first.** This editor stores layers top-first, matching
Hush and matching the panel; Tiled lists them in draw order, back to front.
One reversal, in `tiled/write.ts`. Getting it wrong exports a map whose sky is
under its ground.

**An imported map's gids are renumbered.** A map off somebody's disk starts
its `firstgid`s at one, and this project may already have palettes using those
numbers. So the imported tilesets take the next free block — one block for the
whole map, so the distances between its own sets are kept — and every gid in
the imported layers moves by the same amount. The flags are why that is not
`gid + shift`: adding to a gid carrying them would carry into the tile id, so
each one is taken apart and put back together.

A `firstgid` handed out is **permanent** for as long as anything is standing
on it. That is what makes `GameDoc.tilesets` document-level rather than per
scene or per layer: a gid means *the nth tile across every tileset in the
map*, so adding a palette in one place would otherwise silently renumber the
tiles standing in another. It is also why removing a tileset takes every tile
made of it off with it, and why the sets that are left keep their own numbers.

## A PSD on a tile layer is a palette

This is the part that is Idlewild's rather than Tiled's, and it is the same
answer the pattern layer gives to the same question: **the placements on a
tile layer are not things standing anywhere.**

A PSD dropped on one is placed — that is what loads its artwork and lists it
under the layer — and then cut into a tileset on the project's own grid
boundaries. `PsdPlacements.place` decides which of the two it is doing from
the kind of layer the file lands on, so every route in goes through one
decision: a drop, a paste, Import Assets, Add Image.

**A tile layer gets no collider**, where a pattern layer does. Nothing on one
stands anywhere, and the exported game reads a collider off the first
placement of each unit — so one would put a solid rectangle in the world where
a picture of a palette is not.

**The cut is the project's grid**, which is the whole of what "divided along
the same boundaries as the main canvas" means: a space in the palette is a
space on the ground, so what is picked up is what is put down. On an isometric
project that is the diamond's **bounding box** — `tileWidth` by `tileHeight`,
2:1 — because a picture is cut into rectangles whatever shape is drawn inside
them, and Tiled cuts an isometric tileset the same way.

**Which PSD a tileset is cannot be recovered from a path**, so it rides in a
custom property — `idlewild:psd`, with `idlewild:layer` for the layer inside
it. Those are ordinary Tiled properties: a map can go out to Tiled, be worked
on, and come home still able to say which file each palette was.

`image` names the artwork psd-to-json exported, under `assets/<key>/`, so a
`.tmj` written beside the project points at a real picture.

**Nothing on the layer is drawn or picked.** `DocRenderer.draws` refuses a
tile layer's placements outright and `picking.ts` makes the layer inert —
the same two hooks a pattern layer uses, with one difference: a pattern layer
has an exception for PSD Edit mode, which frames the space the file is
anchored to, and a tile layer has none. A palette has no anchor and nothing is
copied from where it sits, so there is nothing to frame. It is looked at in
the inspector, which is where it actually is.

## The palette, and what it hands the tools

`editor/tile-palette.ts` is the control and it takes the inspector sidebar
while a tile layer is the panel's subject. That is the arrangement Tiled has
between its palette and its tools, and it is the one this is modelled on:
**the palette holds what is in hand, and every tool is a way of putting it
somewhere.** Nothing else passes between them.

The picture is an `<img>` read over the asset server rather than a texture out
of Phaser — it is a control in a panel, not an object in a scene, and the
server is already how psd-to-phaser reads the same file. Everything is laid
out as a percentage of the image rather than in pixels, so a resized sidebar
needs nothing measured again; the one place a real measurement happens is a
pointer event, where the box the browser laid out is exactly what has to be
divided.

The lattice over it is two repeating gradients rather than one element per
space. A tileset is often hundreds of tiles, and hundreds of elements in a
panel that is rebuilt on every document change is a panel that stutters. The
lines are **rectangles even on an isometric project**, because rectangles are
how the image is actually cut: a diamond is what the *ground* looks like, and
drawing one here would say the artwork outside it is not part of the tile.

**The selection is a rectangle**, for the reason a stamp has to have a shape:
an L-shaped one would have to decide what the missing corner does to the
ground under it.

**The run in hand is the shell's**, not the document's and not the panel's.
Not the document's because it is the state of a *tool*, like the pencil's size
or the colour the picker last settled on, and nothing in a saved project
should record which tile somebody had in hand. Not the panel's because the
inspector is rebuilt on every document change, and a pick that did not survive
one would be lost the first time anybody put a tile down.

Every palette on screen re-reads when any of them is picked from, so the one
that *had* the run lets go of it — and each listens on its own element, which
is deliberate: a listener on the frame dies when the panel holding it is
thrown away, and a subscription to the selection would need taking off again.
The render that forgot would leak one per rebuild for the life of the session.

## The tools are the drawing tools, re-pointed

A tile tool is not a new toolbar. On a tile layer the **Pencil** lays the run
picked in the palette along a drag and **Fill** pours it into a region; turned
round — the same erase flag every brush already has — either takes tiles off
instead. Everything on the rail proper is untouched: Select, Pan, Point and
Boundary are about the canvas rather than about what is drawn on it, and a
named place or a blocking boundary on a tile layer means what it means
anywhere else.

**Three are withdrawn.** The Pattern and Shape brushes reveal a library row
and stamp a library shape, and the Text tool writes words that become pixels;
none of the three has anything to do with a grid of tiles, and a button that
silently does nothing is worse than a button that is not there. Hidden rather
than disabled, because the rule is about the *layer* rather than about the
moment — a disabled button is one somebody has to work out the reason for.

`toolsFor` and `tileVerbOf` in `editor/tool-rail.ts` are the two tables, and
`tool-routing.ts` reads both: a tile tool keeps the pointer with the canvas
and hands the drawing layer nothing, because what it makes is a gesture over
the grid rather than ink on the drawing surface. The tool in hand is put down
and picked up again whenever the active layer moves, because that is the only
thing that changes what it means.

### Why it is not a canvas mode

Extrude, collider, mask and PSD Edit take the canvas over: they dim what is
not the subject, say what the pointer does, and have one way in and two ways
out. A tile tool is none of that. It is simply what the pointer does while it
is in your hand, the way the Pencil is — so `game/tile-paint.ts` sits *between*
the modes and the drag controller in the gesture chain and refuses every
gesture unless a tile tool is held over an unlocked, visible tile layer.

`RigMode` grows a `"tile"` value all the same, and what it is really saying is
*no marquee and no hold*: a box dragged round ground that has nothing on it to
select would be a gesture with no meaning, and a hold would open one half a
second into every sweep.

**A stroke is one step.** The group opens at pointer-down and closes at the
release, the same bracket `game/drag.ts` keeps and for the same reason.

**A stamp lays its run out from where the gesture started**, not from each
space it crosses, so dragging a 2 × 2 run across the ground makes a continuous
pattern rather than a 2 × 2 block centred on every space the finger touched.
That is what Tiled does and the only reading under which picking more than one
tile is worth doing.

**A bucket fill is bounded by the ground in view.** There is no edge on this
canvas for a flood to stop at, so what you can see is the edge, with
`MAX_FILL_SPACES` behind it in case the window handed in is larger than
anybody meant. It is a ceiling rather than a budget: filling an unenclosed
patch of empty ground is a gesture that cannot mean what it looks like it
means, and the difference between a slow fill and an editor that has stopped
answering is whether anything said no.

## Drawing them

`game/tile-render.ts` makes the same bargain the lattice and the pattern
renderer make: nothing about what is on screen is stored, and everything is
rebuilt from the camera over exactly the spaces the viewport can see. A map
here is infinite, so the alternative is an object per tile ever laid down —
tens of thousands of them for a screen showing two hundred.

**A tile is a patch of a tileset's texture.** psd-to-phaser loads a PSD's
layer as one image, and what a gid names is a rectangle inside it, so each
distinct tile gets a Phaser frame cut on that texture the first time it is
asked for. No pixels are copied and nothing is uploaded twice: a tileset of
four hundred tiles is one texture and four hundred entries in a map. Frames
are never taken off again, because a texture going away takes its frames with
it.

**Where a tile stands is Tiled's rule, not ours.** The image's bottom edge
sits on the bottom edge of the space, and its left edge on the left edge of
the space's bounding box. That is what makes a tileset whose tiles are taller
than the grid overhang *upward* — which is how every isometric tileset in the
world is drawn, and how the map looked in Tiled before it was brought here.
Getting it wrong is not a small error: it is every wall in the map sunk into
the floor. It is also why an imported map whose tile size differs from this
project's grid is a **warning rather than a refusal**: the tiles still draw,
and they overhang exactly as they did where they were made.

**Depth within a layer is the diagonal.** Two cells on the same isometric
diagonal are at the same screen height and never overlap, so they share a
depth; one further down the screen draws in front. On an orthogonal grid tiles
do not overlap at all and the rule costs nothing, so there is one rule rather
than two. It is clamped so a tile a long way from the origin cannot climb out
of its layer's own slot.

**A tile must be let go of before its textures are**, which is the hazard
`PatternRender.dropKey` exists for and the same answer. A re-import, a rename
and a repoint each evict the textures behind a key and load them again, and an
Image drawing against a frame whose source has been destroyed is not a blank
sprite: it is a throw inside the renderer on every frame from then on.
`PsdHost.releaseKey` tells both renderers, and `offline` keeps the rebuild
from happening inside the window where the old textures have gone and the new
ones have not arrived. A range with anything missing from it is deliberately
not remembered, so the next frame tries the whole thing again — which is what
makes the window self-healing rather than a handshake.

## Import Tiled

At the foot of the layer's own list in the left sidebar, where New Background
sits and for the same reason: nothing on a tile layer can be put down by
aiming at the canvas until there is a palette to aim *with*, and a file
somebody already made is not a gesture at all. One row rather than a menu,
because there is exactly one answer.

`.tmx` and `.tmj` both, because those are the two Tiled saves and somebody
with a map already made has whichever one they have. They are the same
document said twice, so `lib/tiled/read.ts` parses both into one shape and
everything after it reads one. Four encodings on the way in — a CSV list, raw
XML `<tile>` elements, base64, and base64 through zlib or gzip — and one on
the way out, a plain array of numbers, which is what Tiled itself writes for a
JSON map and the one form that is readable in a diff. zstd is refused, because
the platform has no decompressor for it and a wrong answer would be a map full
of plausible rubbish.

**A tileset's artwork becomes a PSD like everything else.** Every picture that
enters this editor is written out as a Photoshop document and run through
psd-to-json — see [The PSD pipeline](psd-pipeline.md) — and a tileset is not
the exception. So a `.tmx` referring to `tiles.png` beside it brings that PNG
in by the ordinary route, and what the tileset then names is the artwork
psd-to-json exported. The upshot is the one the whole pipeline exists for: a
tileset can be opened in Photoshop and brought home again, and the map that
draws from it never knows.

**The whole import is one undo step**, because it is one thing somebody did. A
stack offering to take back the fourth of six tilesets would be a stack
describing the loop rather than the act.

**What it cannot read, it says.** Object groups, image layers and groups are
named in the console rather than dropped in silence, because a map that came
back from Tiled missing half of itself with no word said is the worst of the
three possible answers. External `.tsx` tilesets are refused with the remedy —
save the map with its tilesets embedded — rather than guessed at.

Where the layers land: the layer the button was pressed on takes the first of
them when it has nothing on it yet, which is the case every time, and
everything after that becomes a layer of its own named after the layer in the
map. A layer that was already here keeps **its own** name; the map's name is a
suggestion for a layer being made, not a reason to rename one somebody has
already called something.

## What the exported game gets

`game_config.rs` carries `tiles` and `tilesets` through untouched, and that is
the whole of Rust's part in this. Every other record in the document is
reshaped on its way into the config — a fill's cells are reduced to a unit, a
placement picks up its collider — and this one must not be, because what makes
it worth having is that it *is* a Tiled tile layer.

The tilesets sit **beside** the layers rather than inside them, where a Tiled
map keeps them and where a gid can be read against the whole list.

A template that draws them is not written yet; see [Known gaps](known-gaps.md).
The data is in the config a project's own code reads, in the shape every
Phaser tilemap helper already expects, which is the half that had to be right
first.

## Where the pieces are

| File | What is in it |
|---|---|
| `lib/tiled/types.ts` | The JSON map format, transcribed |
| `lib/tiled/gid.ts` | The packing: flags, tileset lookup, the patch of image a tile names |
| `lib/tiled/chunks.ts` | An infinite layer, and the sparse patches it is made of |
| `lib/tiled/read.ts` | `.tmj` and `.tmx`, and the four encodings |
| `lib/tiled/write.ts` | A map assembled from the document, and the `.tmj` |
| `lib/tile-layers.ts` | What the document does with all of that: palettes, stamps, fills |
| `editor/tile-actions.ts` | Import Tiled, and the shell's side of a palette |
| `editor/tile-palette.ts` | The control, and the run in hand |
| `editor/inspect-tiles.ts` | The panel it sits in |
| `game/tile-render.ts` | The tiles on the canvas |
| `game/tile-paint.ts` | The gesture that puts them there |
