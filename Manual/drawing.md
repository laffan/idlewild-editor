# Drawing

Hush's stroke engine, on any layer: five brushes, pressure and tilt, and the
tools built out of them.

Part of [the Idlewild manual](README.md).

---

## The two columns of tools

- **The tools are two columns down the left edge.** The **rail** hangs from
  the top corner and is what you do *to* the canvas: Select, Pan, Point and
  Boundary — the camera and the pointer, then the two that make something out
  of bare ground. The **drawing toolbar** stands on the bottom corner and is
  the ink: Pencil, Pattern, Shape, Slice, Lasso, Fill and Text. They were one column with a
  gap in the middle doing the work of saying that Select and Pencil answer to
  different owners, and it grew a second column under it whenever PSD Edit
  mode was up. Which end a column hangs from carries that now — and the ink is
  at the corner a hand resting on an iPad's glass is nearest, which is the
  right way round for the thing a hand is doing most often
- **On a tile layer three of them step out of the way.** The Pattern and Shape
  brushes and Text have nothing to do with a grid of tiles, so rather than
  sitting there doing nothing they are not drawn — and the Pencil and Fill
  mean something else there: they lay the run of tiles picked in the palette
  and pour it, and either one turned round takes tiles off. See
  [Tile layers](tile-layers.md)

## The brushes

- Draw on any layer with Hush's stroke engine: five brushes, pressure and
  Apple Pencil, a knife that slices strokes, and a lasso. A brush's button shows **the tip
  it stamps with** rather than a number, at the tip's own proportions, because
  a brush is a shape you recognise and "3" is not that shape. Fingers never draw — they pan
  and pinch the game camera, so a hand can rest on the glass. The ink is
  baked into a canvas that follows the camera, so a pan or a zoom is one
  compositor transform and touches no pixels; a stroke finished is stamped
  onto that canvas rather than the layer being re-laid, and the line under
  the pointer is redrawn once a frame however many samples a 120 Hz Pencil
  hands over in one
- Every colour the editor picks carries its **opacity**, on a second slider
  beside the hue one: the track is the colour itself fading out over a
  checker, and what it hands back is one value — `#rrggbb`, or `#rrggbbaa`
  once the slider leaves the top. It works the same everywhere a colour is
  picked: a fill, a backdrop, either stop of a gradient, and the pen. A
  translucent stroke is composited once rather than per stamp, so a half-there
  line is half there along its whole length instead of solid down the middle
- **Smoothing**, beside Size: how much of the hand's wobble comes out of a
  line as it is drawn. At 0 the ink follows every tremor; turned up it takes
  the shake out without moving where the line goes; at 100 it draws nothing
  but perfectly straight lines, from where the pen went down to where it came
  up. It is a property of the pen rather than of the stroke — what the
  document stores is the line that was on the screen, the way a ruler leaves
  a straight line behind rather than a note saying one was used. The sweep
  fill borrows it on its own: its outline is a line, and a fill shows the
  hand's wobble more plainly than a line does because there is a flat colour
  on one side of it
- **The tool draws itself under the pointer.** The pencil, the Pattern brush
  and the Shape brush each show a faded stamp of what they are about to lay
  down, where it would land: the tip's own shape at its own size and colour,
  the pattern on the world's lattice at its own scale, the shape filling the
  space it is going to fill. It is the real mark at a lower opacity rather
  than a drawing of one, so it cannot say something the tool does not do, and
  it goes the moment you press. A tool turned round to erase previews in red,
  ringed — a tint alone is invisible over a block-out that is already that
  colour

## Fill

- **Fill has two modes.** **Draw** is the sweep: press, run a closed outline,
  release, and the inside of it fills, landing as one thing you can erase or
  undo like a stroke. **Point to point** is the same shape tapped out a corner
  at a time, with every corner draggable until you lay it down. A sweep
  commits on release and cannot be corrected, so a shape that came out nearly
  right had to be drawn again; this is the half for a shape with corners in it
  rather than a gesture behind it
- **Fill, Undo corner and Cancel float beside the shape** while one is being
  tapped out, with the corner count beside them — a shape is built by looking
  at the canvas, and the same three buttons in the side panel were three
  hundred pixels away from the thing they were about. Tapping the first corner
  again still closes the shape, which is how a polygon has always been closed;
  the bar is what tells you so
- **Fill takes all three.** The swept shape and the tapped-out one can be a
  flat colour, a pattern revealed on the world's own lattice, or a field of a
  shape — and so can a filled run of grid spaces, where a shape fill is a
  tileset laid down in one gesture: the spaces are already there, so *a shape
  in every space* is exactly what it sounds like. It is the one tool that
  offers the choice, which is why it is the one that shows the three-way
  switch

## Pattern and Shape

- **The Pattern brush is a fill brush.** It was *Pixels*, and it was the
  pencil with a hard checker for a tip — which made it a textured pencil
  rather than a tool of its own: the checker was stamped along the path, so
  its phase followed the hand and two strokes that crossed disagreed about
  where the squares were. What it lays down now is a pixel pattern's own
  cells, on a lattice pinned to the **world**. Drawing over your own tail
  changes nothing, a second pass continues the first exactly, and the area
  reads as one that was already filled and is being *uncovered* — which is
  what a pattern brush does in every pixel-art editor that has one. There is
  no brush row under it, because there is no tip: the size is how wide the
  opening is, not what shape the paint is, and it keeps a size of its own
  because six pixels of pencil is a line and six pixels of this is a
  checkered thread
- **Shape**, beside it, stamps a shape into every grid space you cross. It
  records *places* rather than a path: drag across the grid and each space
  takes one copy, filling that space exactly; cross it again and nothing
  happens, because the space already has one. On an isometric project a space
  is a **diamond**, so the shape is mapped into the diamond rather than into
  the box around it — *square* fills its space, *half circle bottom* meets the
  space below, and a run of quarter circles rounds a corner along the lattice.
  That is what the shapes are for: they come from a tileset generator, where
  the tile is the unit

## Erasing, and the knife

- **Every brush can be turned round and used as an eraser.** Pencil, Pattern,
  Shape and Fill: what the tool *would have drawn* is what it takes out
  instead, so a Pattern brush set to erase removes exactly the lattice cells it
  would have revealed and a Shape brush takes back the tiles it would have
  stamped. Two ways in — the **Use as Eraser** switch at the top of the tool's
  own panel, and a **long press** on its button in the toolbar — and a turned-round tool
  carries a slash across its icon, in the accent when it is not in hand and in
  white when it is. Erasing is one composite over the *finished* mark rather
  than one per stamp, which is the whole of why a donut's hole is not taken out
  along with its body and a run that crosses itself does not bite deeper where
  it does. While you drag, what is about to come off is shown as a translucent
  hole: an erase in progress is cut into the baked canvas itself, over the
  pixels it is taking, and put back before the stroke lands for real — so what
  you watch while you drag is what the release leaves behind
- **Slice** is the knife, and it used to be called Eraser. It never rubbed
  anything out: it cuts a stroke in two where the disc passes and leaves both
  halves, which is what makes it useful on a sketch. Beside four brushes that
  genuinely erase, the old name was the wrong word for it

## Text

- **Text**, at the foot of the drawing toolbar: tap and write on the canvas.
  What lands is a **temporary object**, the same kind of thing a sketch is — it
  sits on a layer, drags a space at a time, restyles and deletes, and the game
  is never told about it. **Convert to PSD** is its one exit, and the words
  become pixels in a file of their own standing exactly where they were. That
  is not a limitation dressed up: a font on this device is a font a published
  game's players may not have, so shipping words as words would mean shipping a
  typeface and accepting that a sign reflows on the day the fallback is wrong.
  Pixels ask none of that, and a PSD of the words is also a file somebody can
  open and paint over — and it is what makes using a *local* font safe, so the
  picker offers **the typefaces this device actually has**. There is no honest
  API for that here, so they are found by measuring: a family that is not
  installed falls through to a generic and measures the same as one. Each name
  in the list is set in its own face, because *Didot* in the panel's own font
  says nothing about Didot. Six sizes, a colour and an alignment beside it, and
  restyling one sets the next — the same way a brush keeps its size, and it is
  the whole style rather than a list somebody has to remember to extend. A
  **line height** against the size, so a note retyped twice as big keeps its
  spacing. The field reads a little **Markdown** — `**bold**`, `*italic*` and
  `<u>underline</u>`, and nothing else, because everything else Markdown has
  would change the size or the left edge of a line. A mark with no partner is
  just the character it is, so `2 * 3` is still arithmetic and
  `game_config.json` is still a filename. **Wrapping** is a switch: turn it on
  and the note gets a column with a handle at the end of it, dragged on the
  canvas to set the width. On an isometric project there are the grid controls:
  **Track the grid** lays the words along the grid's own two axes, and once it
  is on, which diagonal they run along — NW→SE or SW→NE — and whether they lie
  on the floor or **stand up** like a sign on the face of a wall. The
  field is in the inspector rather than on the canvas, because a caret over a
  running Phaser scene is a second keyboard, a second selection and a second
  cursor for a string three words long; the canvas is the preview instead, and
  it follows every keystroke. The file even comes out named after the words:
  *door to the cave* is `door-to-the-cave.psd`

## Handing a sketch to its layer

- Hand a lassoed sketch to its layer as a PSD to flesh out elsewhere, or as
  a blocking boundary play mode walks around. The PSD carries the same
  orienting marks an import does — the anchor dot and the grid the sketch was
  drawn over — so there is a grid under the ink when you open it to paint.
  Its canvas is the ink plus the spaces the ink actually covers, not the
  larger diamond enclosing them, and the ink is the **top** layer of the
  file: it is the one row anybody would rename, and the marks are the
  editor's. The strokes are only consumed once the artwork is standing where
  they were — a conversion that is refused leaves the sketch where it is
