# Scenes and layers

A scene is a set of layers and a canvas of its own. A layer is one of four
things, and which one decides what it can hold.

Part of [the Idlewild manual](README.md).

---

## Scenes

- **Scenes**, the way Phaser means them: a set of layers and a canvas of its
  own. A project is several places — a title screen, a cave, the overworld —
  sharing a grid, a genre and a pile of PSDs but not a single thing standing
  on them. The dropdown at the top of the left sidebar switches between them
  and holds New, Rename, Duplicate and Delete; each scene remembers where you
  were standing in it. A duplicate is a real copy, not a second name for the
  same thing

## Four kinds of layer

- **Four kinds of layer**, from the dropdown under the `+` — three on a blank
  project, where a tile layer is not offered because a palette is a picture
  cut into equal spaces and a blank project's spaces are single pixels. An **object**
  layer is what a layer has always been, and it is what every layer in every
  project made until now is: things stand where you put them, and the canvas
  selects, drags and resizes them. It now has one rule — a placed PSD with no
  `P | anchor` at the root of its stack greys out and says **No anchor**,
  under the layer and in the inspector. It is not a refusal: the artwork is
  there and it draws. What it cannot do is come home from Photoshop lined up
  on the same space, because there is no mark in the file for it to line up
  on. The grid footprint stays optional, as it always was
- A **pattern layer** holds a rule rather than a scene. Drop a PSD on one and
  its top-level elements are scattered across the canvas — on and on, because
  there is no edge to reach. What is stored is four numbers and the copies are
  worked out from the camera, one repeat tile at a time, seeded by the tile's
  own coordinates: the same space always answers the same way, so panning
  never re-rolls the pattern under you and the exported game regenerates
  exactly what you drew. The inspector holds the arrangement — **random**,
  which is the default, or **grid** — a **density**, and a **repeat boundary**
  (20 × 20 spaces for a scatter, 10 × 10 for a lattice). **Shuffle** re-rolls
  a scatter without changing anything else about it. Nothing on a pattern
  layer is selected on the canvas, because there is no one object under the
  pointer to name — the PSD on it is reached from the sidebar, and the layer's
  placements are the *palette* the pattern is made of rather than things
  standing anywhere, so resizing the file resizes every copy of it
- **Shapes**, under the pattern's numbers, confine it. An empty list is the
  default and means everywhere. **Add shape** opens the shape editor — the
  fourth of the canvas modes, beside extrude, collider and pen: the rest of
  the canvas dims, and a bar along the bottom offers **Add** and **Remove**,
  **Clear**, **Reset** and the two ways out. The gesture is a sweep: press,
  drag a rectangle over the ground the pattern may use, release. The layer's
  other shapes are outlined behind the one in hand, and **Edit** on any row
  reopens it. Nothing reaches the document until Apply, so Cancel means
  nothing happened. A patch of grid you have already selected has **Pattern
  Shape** on the bar over it, which opens the editor started from those
  spaces; and an outline drawn with the pencil and lassoed can still be
  handed over from the sketch panel, which is the one route that keeps the
  line you actually drew. A shape is stored as the spaces it covers, so the
  pattern asks a set rather than walking a polygon every frame
- The shapes are drawn on the canvas while their layer is the one selected
  and not otherwise, the way a placed image's outline is — a boundary is a
  thing you are working on, not a feature of the ground
- A **background layer** is the backdrop, and **New Background** at the foot
  of its list offers three things. **Colour** and **gradient** are
  camera-locked and have no extent — a backdrop is wherever you are looking,
  which is the only reading that never shows its own edge — so the inspector
  offers colours and a direction and nothing about size or position.
  **Image** asks how much ground the backdrop covers — in grid spaces, 30 ×
  10 by default — and writes a PSD that size with an anchor, the grid drawn
  on it and a `T | Background` group holding one sprite layer to paint into.
  It is the longest wait in the editor, so the sheet stays up and says what
  the pipeline is doing while it happens. That file is a placement like any
  other, so it drags, exports and stacks the way everything else does; what
  makes it a background is the layer it is on
- A **tile layer** is a [Tiled](https://www.mapeditor.org/) map, and it is the
  one kind not offered on a blank project. A PSD dropped on one is not placed
  on the canvas: it is cut into a palette along the same boundaries as the
  main grid and shown in the properties sidebar, where you drag across it to
  take a run of tiles. **Import Tiled**, at the foot of the layer's list,
  takes a `.tmx` or a `.tmj` and brings the map's tilesets and layers in with
  it. The drawing tools are re-pointed there — the Pencil lays what is in hand
  and Fill pours it, and either turned round takes tiles off — while the
  Pattern and Shape brushes and Text step out of the way, having nothing to do
  with a grid of tiles. Everything is saved in Tiled's own format, so a map
  built here opens in Tiled and a map Tiled wrote opens here. See
  [Tile layers](tile-layers.md)

## The layer list

- Layers, under the scene they belong to: drag by the grip to reorder, rename,
  lock, hide, with live counts and an expandable list of what is on each one —
  selecting there selects on the canvas, and a placed PSD listed under a layer
  has a grip of its own. The row's two handles are at its two **ends**: the
  arrow that opens a layer up is at the left, indented over the contents it
  reveals, and the grip that carries the layer somewhere else is at the right,
  past the eye and the lock — so the edge a finger travels down to pick a
  layer up is not the edge those two sit on. Where you let go decides what it meant: over a
  different layer it is carried there, over its own it is **moved in the order
  that layer draws in**, on the canvas and in the game alike. An isometric
  **object** layer is the exception and says so by listing differently — it
  sorts what it draws on screen Y, so a thing standing nearer you draws in
  front of one behind it, and the list is sorted to match rather than showing
  an order the canvas would ignore. Pattern and background layers reorder by
  hand on every projection: a palette all anchored on one space, a stack of
  backdrops behind everything and a tile layer's palettes have no nearer and
  further for a sort to find.
  The two senses of the word stay apart: a layer here is Phaser's — draw order
  over anything at all — so a placed PSD is **one row** however many layers are
  inside the file, and the stack inside it belongs to the inspector. Select a
  layer and the inspector offers **Delete layer**, under the tally of what
  would go with it — it asks first, and the PSDs themselves stay in the
  project. A scene keeps its last layer, and the button says so rather than
  disappearing
