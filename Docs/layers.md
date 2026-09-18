# Three kinds of layer

Object, pattern and background — what each one holds, what the document stores
for it, and what the exported game does with it.

Part of [Idlewild's technical documentation](../README-TECHNICAL.md).

---

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

## An object layer's one rule

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

## A pattern layer holds a rule, not a scene

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

## Shapes, and why a drawn one is baked

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

## Mask mode

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

## A background layer is the backdrop

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

## What the exported game is told

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

## The order placed files draw in, and who chooses it

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

## Two senses of "layer", and why the panels must not mix them

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

## What is drawn over what

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
