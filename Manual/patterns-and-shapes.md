# Patterns and shapes

Two libraries the app owns rather than a project, and the two editors that
fill them.

Part of [the Idlewild manual](README.md).

---

## A library, and whose it is

- **The patterns and the shapes are a library, and it is the app's rather than
  the project's.** Fourteen patterns and twenty-nine shapes come from
  [simple-tileset-generator](https://github.com/laffan/simple-tileset-generator)
  — the same fourteen, pixel for pixel, and the same shapes, vertex for
  vertex. A dither you draw on Tuesday is in the palette of the project you
  start on Wednesday, because nobody wants a mark they made to belong to the
  file they happened to make it in. What a *document* stores is the id, so a
  project opened on a machine whose library does not have that row draws the
  stroke in its colour and says so; the built-ins are in the binary, so a
  project using only those is portable with no caveat at all. New, Edit,
  Duplicate, Rename and Remove are under the swatches, and **Restore
  defaults** puts back anything taken out. Editing a built-in makes a copy and
  puts the copy in its place — the defaults are the floor, and you cannot lose
  them

## The pattern editor

- **The pattern editor** opens on the row in your hand: the tile surrounded by
  its own repeats, because a pattern is a thing that repeats and an 8×8 grid
  on its own tells you nothing about whether the repeat is seamless. Every
  write wraps, so a tip that hangs off an edge paints the opposite edge and
  the four seams take care of themselves. Four tips — square, round, airbrush,
  and one made from a selection or an uploaded image — an erase toggle, a
  straight line on shift, a selection to fill, clear or turn into a tip, a
  grid from 4 to 64, a pattern you can push around to change its phase,
  invert, import an image, save a PNG, and undo. A box you have drawn is not
  only a box: drag inside it and the cells it holds move, wrapping; drag its
  corner and they **repeat** across the new size, which is how a motif drawn
  once becomes a row of itself. Beside it is the pattern at **this project's**
  scale, because a dither previewed at some arbitrary zoom says nothing about
  whether it is the density you wanted on this grid. The brush's size sits
  straight under the *Brush* heading, where the number that changes most often
  belongs, and Draw / Select / Pan are the size of the grid chips above them
  so the three fit on one line of a 210-pixel column

## The shape editor

- **The shape editor** is the vector half: drag points and handles, click an
  edge to drop a point into it, ⌥-click a point to turn a corner into a curve,
  add a square, circle, triangle or hexagon, flip, align — with the tile when
  one path is picked, with each other when several are — distribute, punch a
  hole, cut one path out of another, resize and rotate under ⌘, crop to the
  tile, and SVG in and out. The paths are listed, because *Cut out* and
  *Align* are aimed at a selection and ⇧-click is not a gesture an iPad has:
  tapping a row picks it, and the ⊕ beside it adds it to the selection without
  moving what the cut is about. Align and distribute read the **points** when
  two or more of them are picked and the paths otherwise — the selected points
  are the smaller, more specific thing you pointed at. And **Draw a path** is
  the pen: tap corners, tap the first one again to close, which is the same
  gesture as the point-to-point Fill on the canvas outside
- Both editors keep **Undo** and **Redo** on the left of the bar, where they
  are about the work, and put the ways out at the right-hand end in the order
  every other sheet ends on: Cancel, Save as a copy, Save. Their toolbars'
  explanations are tooltips on the headings, as the inspector's are
