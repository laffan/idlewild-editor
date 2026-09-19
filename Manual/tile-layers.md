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

**Drop a PSD on the layer.** It is not placed on the canvas. It is cut into a
palette along the same boundaries as the main grid — a space in the palette is
a space on the ground, so what you pick up is what you put down — and it
appears in the properties sidebar on the right. The console says how many
tiles it came to.

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

The **×** beside a palette's name takes it off the project. It takes every
tile made of it off with it, which is why it is the smallest control in the
panel: a tile whose picture has gone would draw nothing with nothing on screen
to say why.

## Painting

The tools down the left edge are the ones you already know, pointed at tiles.

- **Pencil** lays the run in hand. Tap for one space, drag for a line of them.
  A run of more than one tile is laid out from where the drag started, so
  sweeping a 2 × 2 run across the ground makes a continuous pattern rather
  than the same block over and over.
- **Fill** pours the run into the ground under it — every space holding what
  the space you tapped holds, out to the edge of what you can see. There is no
  edge to this canvas, so what is in view is the edge; zoom out to fill more,
  and close the shape if you meant the room rather than the world.
- **Either one, turned round**, takes tiles off instead. Hold the button for
  half a second, or use the switch at the top of the tool's own panel in the
  properties sidebar — the same erase flag every brush in the editor has.
- **Select, Pan, Point** and **Boundary** are unchanged. A named place or a
  blocking boundary on a tile layer means what it means anywhere else.

Three tools step out of the way on a tile layer: the **Pattern** and **Shape**
brushes and **Text**. None of them has anything to do with a grid of tiles, so
rather than sitting there doing nothing they are not there.

Each sweep is one press of undo, however many spaces it covered.

Nothing on a tile layer is selected by tapping it. There is no one object
under the pointer to name — the tiles are a map, not a pile of things — so the
layer is reached from the sidebar, which is where its palettes are.

## What is saved

The tiles are stored the way Tiled stores an infinite map: sparse patches of
sixteen spaces square, with the empty ground between them costing nothing.
That is the only shape that fits a canvas with no edge, and it is Tiled's own
answer to the same problem.

A project's tile layers reach the exported game in the config its code reads,
in the same shape. What is not there yet is a scaffolded scene that draws
them — see [What is not built yet](roadmap.md).
