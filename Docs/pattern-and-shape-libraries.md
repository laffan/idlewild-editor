# The pattern and shape libraries

Two libraries the app owns rather than a project, the two editors that make
rows for them, and everything that draws from both.

Part of [Idlewild's technical documentation](../README-TECHNICAL.md).

---

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

## The library is the app's, not the project's

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

## The lattice, and why the Pattern brush reads as revealing

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

## A shape fills a space, not the box around it

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

## Painted fills need a texture, because Graphics cannot do either

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

## The two editors

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
