# Selection

What is selected, on a canvas where the answer can be a run of grid spaces, a
rectangle of bare pixels, a placed PSD, several of them, or a lassoed patch of
ink.

Part of [Idlewild's technical documentation](../README-TECHNICAL.md).

---

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

## The floating action bar

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
before `.psd` renames the file — see [Renaming a PSD](shell-and-runtime.md#renaming-a-psd). The field is borderless
until it is focused, like the layer names in the left panel: the panel is a
column of facts and one of them happens to be editable, which a box drawn
round it all the time would overstate. The extension sits beside the field
rather than in it, because it is not part of the name and retyping it would
only be a way to get it wrong.

## A placed PSD is one thing, until you say otherwise

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

## Groups, which the game is never told about

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

## Merging, which is every other conversion backwards

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

## The pipe prefix, which is why this did not work at first

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

## Words on the canvas

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

## What a note is made of

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

## Lying in the grid's plane

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

## A layer that has wandered, and the way back

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
