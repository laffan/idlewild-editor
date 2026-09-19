# Tile layers

A tile layer is a Tiled map. You bring one in, or you make one by dropping a
PSD on the layer and painting with it.

Part of [the Idlewild manual](README.md).

---

## What it is, and when you can have one

A **tile layer** is the fourth kind of layer, from the dropdown under the `+`
in the left sidebar. It holds a grid of tiles: one picture per space, chosen
from a palette, laid down with the drawing tools.

It is offered on **isometric** and **orthogonal** projects and not on a blank
one. A palette is a picture cut into equal spaces, and a blank project's
spaces are single pixels — every tile would be one pixel square. The row
simply is not in the menu there rather than being greyed out with an
explanation.

Everything a tile layer holds is saved in [Tiled](https://www.mapeditor.org/)'s
own format. That is the point of it: a map you build here is a map Tiled can
open, and a map Tiled wrote is a map this can read. Nothing is converted at
either end.

## Getting a palette

Two ways, and they are the same door from opposite sides.

**Drop a PSD on the layer**, or drag one there from another layer in the list.
Either way it is not placed on the canvas. It is cut into a palette along the
same boundaries as the main grid — a space in the palette is a space on the
ground, so what you pick up is what you put down — and it appears in the
properties sidebar on the right. The console says how many tiles it came to.

That works whichever way the PSD got there and whatever made it: a file you
dropped in, a patch of grid you filled and converted, or a tileset a Tiled map
brought with it.

**Import Tiled**, the row at the foot of the layer's own list in the left
sidebar. It takes a `.tmx` or a `.tmj`, brings in every tileset picture the
map refers to, and lays the map's tiles out on the grid. A map with several
tile layers in it becomes several layers here, stacked the way they were
drawn; the layer you pressed the button on takes the first of them.

The pictures a map brings in become PSDs like everything else in this editor,
so a tileset can be opened in Photoshop from the properties sidebar and
brought home again — see [A PSD's own layers](psd-layers.md).

Two things about an imported map are said in the console rather than refused.
A map whose **tiles are a different size** from this project's spaces still
comes in: each tile stands on its space with its bottom edge on the space's
bottom edge, so a taller tileset overhangs upward exactly as it does in Tiled.
A map whose **orientation** differs — an isometric map into an orthogonal
project — also comes in, and will not line up with the grid. A map with object
groups or image layers in it loses those, and the console names them.

Tilesets saved in separate `.tsx` files are the one thing it will not take.
Save the map with its tilesets embedded and import it again.

## The palette

While a tile layer is what the properties sidebar is describing, the sidebar
is the palette. Each picture is shown with the lines where it is cut drawn
over it.

**Drag across a palette to take a run of tiles.** A tap takes one. The
selection is always a rectangle, and it is outlined in red. The line above the
palettes says what is in hand.

A run stays in hand until you pick another one, whichever layer you move to —
the palettes belong to the project rather than to one layer, so a run picked
while one layer was open is still meaningful on the next.

**A tile in the palette is the size it is on the canvas**, at the zoom the
canvas is at when you look at the sidebar. That is the point of it: what you
pick up is what is going to land, at the size it is going to land. A picture
wider than the column therefore runs off the edge of its box, and the box
scrolls.

Each palette also zooms on its own, from the two steps over it. The **−** and
**+** change it; the percentage between them is a button, and pressing it puts
the palette back to whatever the canvas is doing. On a trackpad, ⌘ or Ctrl
with the wheel does the same; on glass, two fingers pinch and move it. One
finger always means *pick*, which is why moving a large palette around takes
the second one.

The **×** beside a palette's name takes it off the project. It takes every
tile made of it off with it, which is why it is the smallest control in the
panel: a tile whose picture has gone would draw nothing with nothing on screen
to say why.

## Painting

A tile layer has a toolbar of its own. The seven brushes step aside — none of
them has anything to do with a grid of tiles — and two tools take their place
down the left edge.

- **Stamp** puts the run in hand down. Tap for one space, drag to lay a line
  of them. A run of more than one tile is laid out from where the drag
  started, so sweeping a 2 × 2 run across the ground makes a continuous
  pattern rather than the same block over and over. What is about to land is
  drawn under the pointer, faded, so you can see it before you commit to it.
- **Sweep fill** is a shape. Press, draw round the ground you mean, and let
  go: every space inside the outline is filled. The shape closes itself, so a
  loop fills the ring it drew rather than the box around it.
- **Both have two settings**, in the properties sidebar while the tool is in
  hand. *Direct* — or *Solid*, on the Sweep — lays the run out in the shape
  you picked it. *Random* gives every space one tile of the run instead,
  chosen as it lands; with Stamp the ghost under the pointer is the one that
  is coming next, so you can see what you are about to get. A random sweep
  gains a **density**: how many of the spaces you swept take a tile, as a
  percentage. A hundred is all of them.
- **Either one, turned round**, takes tiles off instead. Hold the button for
  half a second, or use the switch at the top of the tool's own panel — the
  same erase flag every brush in the editor has. There is no separate rubber.
- **Select** catches tiles. Drag a box over some and they are outlined; drag
  the outlined tiles themselves and they move, and they keep the ground they
  land on. **Delete** clears them, as it clears anything else selected. Only
  spaces with something on them are caught — there is no point selecting bare
  ground on a layer that is about what is standing on it.
- **Pan** is unchanged. Point and Boundary are not offered on a tile layer:
  what they make belongs to the layer it is made on, and a tile layer is
  ground rather than a place things stand.

Each gesture is one press of undo, however many spaces it covered.

A single tap selects nothing. The tiles are a map rather than a pile of
things, so there is no one object under the pointer to name — a box is how you
say which of them you mean, and the layer itself is reached from the sidebar.

## Editing a palette's artwork

Select a palette's PSD in the left sidebar, open its layer list in the
properties sidebar and press **Open PSD**, exactly as you would for a picture
standing on the canvas. Two things are different on a tile layer, both because
nothing there is ever drawn on the canvas.

The file **appears over the tiles** for the length of the session, and the
canvas moves to it — there is nothing else to have brought you there. It goes
again when you Apply or Cancel.

And the **ordinary brushes come back** while it is open. A file you are
drawing into is artwork like any other; the layer underneath it holding tiles
has nothing to do with what the pencil is for. Stamp and Sweep step aside
until the session ends, since there is nowhere for a tile to go while the
canvas belongs to a file.

## What is saved

The tiles are stored the way Tiled stores an infinite map: sparse patches of
sixteen spaces square, with the empty ground between them costing nothing.
That is the only shape that fits a canvas with no edge, and it is Tiled's own
answer to the same problem.

A project's tile layers reach the exported game in the config its code reads,
in the same shape. What is not there yet is a scaffolded scene that draws
them — see [What is not built yet](roadmap.md).
