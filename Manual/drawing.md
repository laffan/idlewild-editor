# Drawing

Hush's stroke engine, on any layer: five brushes, pressure and tilt, and the
tools built out of them.

Part of [the Idlewild manual](README.md).

---

## The two columns of tools

- **The tools are two columns down the left edge.** The **rail** hangs from
  the top corner and is what you do *to* the canvas: Select and Pan, the
  pointer and the camera. The **drawing toolbar** stands on the bottom corner
  and is the ink: Pencil, Pattern, Shape, Fill and Text, with **Lasso and
  Slice** in a short group of their own just above it — both act on strokes
  that are already there rather than laying one down. They were one column with a
  gap in the middle doing the work of saying that Select and Pencil answer to
  different owners, and it grew a second column under it whenever PSD Edit
  mode was up. Which end a column hangs from carries that now — and the ink is
  at the corner a hand resting on an iPad's glass is nearest, which is the
  right way round for the thing a hand is doing most often
- **Every tool has a tooltip and most have a key.** Rest the pointer on a
  button, or tab to it, and it names itself and its key: **V** Select, **T**
  Text, **L** Lasso, **P** Pattern, **S** Shape (Stamp on a tile layer, where
  there is no Shape brush), **E** Slice, and Pan is the space bar held. A key
  only picks up a tool the toolbar is showing, and does nothing while you are
  typing in a field or while a mode — Plan, Extrude, Collider, Mask — has the
  canvas
- **On a tile layer the ink column is a different column.** All seven brushes
  step out of the way — none of them has anything to do with a grid of tiles —
  and three take their place: **Stamp**, which puts the tiles picked in the
  palette down, **Sweep fill**, which fills a shape you draw freehand, and
  **Shape fill**, which fills a rect or a circle you drag out.
  The rail above is unchanged, because Select and Pan are about the canvas
  rather than about what is drawn on it. The brushes come
  back while a PSD is open in PSD Edit mode, since a file you are drawing into
  is artwork like any other. See [Tile layers](tile-layers.md)

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
- Every color the editor picks carries its **opacity**, on a second slider
  beside the hue one: the track is the color itself fading out over a
  checker, and what it hands back is one value — `#rrggbb`, or `#rrggbbaa`
  once the slider leaves the top. It works the same everywhere a color is
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
  hand's wobble more plainly than a line does because there is a flat color
  on one side of it
- **The tool draws itself under the pointer.** The pencil, the Pattern brush
  and the Shape brush each show a faded stamp of what they are about to lay
  down, where it would land: the tip's own shape at its own size and color,
  the pattern on the world's lattice at its own scale, the shape filling the
  space it is going to fill. It is the real mark at a lower opacity rather
  than a drawing of one, so it cannot say something the tool does not do, and
  it goes the moment you press. A tool turned round to erase previews in red,
  ringed — a tint alone is invisible over a block-out that is already that
  color

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
  flat color, a pattern revealed on the world's own lattice, or a field of a
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
- **Use Grid**, under Use as Eraser in the Shape brush's panel, is on to
  begin with. Off, the shapes go where the pen goes instead — square, a grid
  space wide, laid side by side along the drag — rather than into the spaces
  it crosses, and the faded preview under the pointer follows suit. A project with no lattice has no such switch

## Straight along one axis

- **Hold Shift** while drawing with the Pencil, the Pattern brush or the Shape
  brush and the mark keeps to one axis — a straight row across, or a straight
  column down. Which one is the way the pen first moves; let go of Shift and
  it is free again

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
  says nothing about Didot. Six sizes, a color and an alignment beside it, and
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
- **Putting a note down selects it and picks up Select**, so the next tap
  moves or restyles it rather than putting down another
- **A new note wraps.** It starts with a column 288 pixels wide and a handle
  to drag its width; turn **Wrap the words** off on one and the next note
  follows, like the rest of the style
- **Letter spacing**, under the line height: extra space after every
  character, against the size (`0.1 em` is a tenth of it), so a heading made
  bigger keeps its tracking
- **The project's own fonts.** Drop font files — TTF, OTF, WOFF or WOFF2 —
  anywhere on the properties sidebar, or press **Add font…** under the font
  button for **From files…** or **From clipboard** — a font file copied in
  Finder or Files, or a font's bytes copied from another app, which are named
  from the font itself and offered for renaming (on an iPad the button is the
  dependable way; a drop needs Files open beside the app). They are kept in the project, travel in
  an `.idlewild`, and head the font menu marked *project*, named after the
  file: `Recoleta-Bold.otf` is *Recoleta-Bold*. The cross on a font's chip
  takes it out of the project

## Moving, scaling and turning a sketch

- **What the Lasso catches wears a box.** Drag inside it to move the strokes,
  drag a corner to scale them — in proportion; hold Shift to stretch one way
  — and drag the round knob above it to turn them, in 15° steps with Shift.
  The strokes follow as you drag, and the change is one step to undo. A
  stroke scaled up is drawn heavier, as if it had been drawn at that size
- **The color of a selection** is in the right sidebar under it, whichever
  brush drew it — a pen's ink, or the color a pattern is revealed in. It
  changes the selected strokes as you pick
- The box is there under the Lasso and under Select, Pan and the other tools
  that do not draw — so strokes picked from the Strokes list can be moved
  with Select in hand — and goes while a brush is up

## Plan mode

- **The pencil beside the scene's name** opens plan mode: tracing paper over
  the scene. The canvas goes under a white wash, artboards and all, and the
  toolbars give way to **Pencil**, **Eraser**, **Lasso** and **Done**. The
  pencil only draws in bright blue; the eraser takes plan ink out. The right
  sidebar's TOOL zone has the pencil's and the eraser's brush, size and
  smoothing — everything but the color — and each remembers its own. The
  Lasso catches plan strokes to move, scale and turn in the same box as
  above, or to remove with Delete — or, from the right sidebar, **Convert to
  PSD**: the strokes leave the plan and arrive as a placed PSD on the top
  object layer in the list, whichever layer you were working on. Done, the
  pencil again or Esc puts it away
- **The plan is on no layer.** It belongs to the scene, saves with the
  project and undoes like anything else, but it is not in any layer's
  strokes, not in what the game is sent and not on any page that prints
- **Out of plan mode the plan stays on the canvas** — just the blue strokes,
  without the tint — over everything, and it never takes a tap or a click.
  While the open scene has a plan, Overlays has a **Plan** row with its own
  switch and an opacity slider; while plan mode is up it also has **Plan
  overlay**, the same pair for the white wash, which starts at half and is
  remembered. Fingers pan and pinch in plan mode as they do everywhere else

## Loose strokes

- **Strokes**, at the top of the left sidebar above the layer list, lists
  every stroke in the scene that has not been converted to a PSD, grouped by
  the tool that drew it — Pen, Pattern, Shape, Fill and Eraser — with how
  many there are and, when they are spread over more than one layer, which
  layer they are on. Ink is not in what the project exports until it is a
  PSD, so this is the list of what would be left out
- **Tap a row to select those strokes** on the canvas — the Select tool is
  put in hand first, so the box they wear is there to move them — ready to
  convert or delete. The heading keeps the total when the list is folded, and the whole
  section goes away when there are no loose strokes left

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
