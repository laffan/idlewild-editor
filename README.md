# Idlewild

A game editor and publisher for iPad and macOS, built around
[psd-to-phaser](https://github.com/laffan/psd-to-phaser). Start from a prefab
template, then build by drawing directly in the editor and importing images.

Tauri 2 (Rust) + Phaser 4 + TypeScript, no frontend framework.

## What it is

Idlewild is a prototyping environment. You pick a template — isometric,
orthogonal or blank — and a style — top down or platformer — and get a light
blue, effectively infinite grid you build on with your fingers: hold to select
a run of spaces, fill them, drop images into them, export a patch as a
transparent PNG. On a blank canvas nothing snaps and a selection is exactly
the rectangle you dragged. Every image that enters, including a pasted PNG,
becomes a PSD and goes through
[psd-to-json](https://github.com/laffan/psd-to-json-rust), so the
psd-to-phaser integration is uniform: a screenshot and a hand-built Photoshop
document arrive at the runtime the same way.

Publishing hands you either a zipped runnable site or a `.idlewild` file — the
whole project, source PSDs included, to open somewhere else — and Export Assets
hands back the artwork on its own, for the PSDs that are wanted somewhere that
is not a game. Direct publishing to a web server over rsync is planned and
explicitly out of scope for now.

## Status

This is the first vertical slice — everything below runs end to end, and the
remaining pieces are wired to real slots rather than mocked.

**Working**

- Project list with thumbnails, long-press rename / duplicate / delete
- **Select**, beside Open, turns the grid into a set of choices: a tap picks a
  card instead of opening it, each one carries a box in the corner of its
  thumbnail, and the row above them offers All, None, Duplicate and Delete. A
  bulk delete asks **once**, naming the projects while the list is short enough
  to read and counting them when it is not. There is no ⌘-click on an iPad and
  no rubber band over a grid of cards, so the mode is the honest shape; the
  card's own menu is untouched, and stays the only way to Rename
- New Game: template (isometric, orthogonal, blank), style (top down,
  platformer) and grid scale (8–256 px — 8 and 16 are there for pixel art,
  where a space is a sprite rather than a room). Blank has no lattice: a
  selection is the exact rectangle it was dragged across, and a fill on it is
  one rectangle rather than a run of spaces
- And how it renders, on the same sheet. **Pixel perfect** is one box for the
  two settings that go together — nearest-neighbour textures, so a 16px sprite
  scaled up stays blocky, and whole-pixel drawing, so a camera at a fractional
  scroll does not smear it. **Default zoom** is what a scene opens at, here and
  in the game; 8px art usually wants 3× or 4×. Both are in Project Options
  afterwards, as two switches and a number, and changing one is live: the
  canvas re-filters every texture it has, the camera in front of you goes to
  the zoom you just typed — and stays there for a scene you have never opened
  — the config the game reads is rewritten under it, and a game that is
  running restarts on it
- **A character controller, and it is a switch.** Ticked — the default — the
  project spawns `js/prefabs/character.js`: a prefab that walks the grid over
  A\*, or runs and jumps along it. Unticked, it places the document and waits
  for yours. It used to be the one choice Project Options could only *report*,
  because it was resolved when the files were written and unticking a box
  cannot take a character out of code that already has one. The wiring is in
  `js/shared/character.js` now, which is the editor's and is written either
  way, so it reads the answer out of the config and turning it on is a save
  rather than a file appearing in your project
- On an **isometric** project the character sorts itself into the scene as it
  walks, so it goes behind a tree it is standing behind and in front of one it
  is standing in front of. The line it crosses is the one straight up from the
  corner of a thing's **collider** nearest you — where the two visible faces of
  a box meet — so what you walk behind and what you walk around are the same
  footprint, and correcting one corrects the other
- **It walks among the layer your start point is on**, as long as there is
  something on it. Scenery on that layer sorts against it space by space;
  anything on a layer behind is always behind and anything on a layer in front
  always draws over it, which is how you get a canopy, a bridge or a doorway's
  lintel to walk under. A start point on an empty layer — or no start point at
  all — falls back to the front-most layer that does hold something, because a
  layer with nothing on it is a layer with nothing to sort against
- **Arrow keys as well as a tap**, on a top-down project. A tap walks there
  around whatever is in the way; holding an arrow nudges the character
  directly, which goes where a path cannot — half a space into a doorway, right
  up against the near edge of a building. It is for checking that what you drew
  sorts the way you meant it to. WASD does the same, and both move up, down,
  left and right on the *screen* rather than along the grid's diagonals
- A full-width header carrying the project, undo and redo, and the
  **Draw / Code / Play** toggle, with Publish, Export Assets and Project Options
  behind its menu. It insets itself out of the iPad's status bar, as the console drawer
  does out of the home indicator
- Infinite grid, two-finger zoom, tap-to-pick. The lattice is a hairline
  whatever the camera is doing: a line one *screen* pixel wide, so a project
  drawn on 8px spaces and opened at 4× gets the same thin grid as one on 64px
  spaces at 1× rather than four-pixel rules over it. The selection outlines and
  the lines an extrusion bakes into its PSD follow the same weight. Select drags a plain rectangle
  around things to pick up several images at once; press and hold instead and
  it asks for a patch of grid, in the grid's own shape, taking the ground
  rather than whatever is standing on it. Pan drags the camera, and holding
  space borrows it from wherever you are
- Press and hold to ask for a patch of grid, and get Fill, Add Image,
  Generate PSD and Extrude over it
- Fill a selection with any colour, from a full picker with recent swatches.
  It starts grey rather than in the app's accent: a fill is usually a
  block-out, and the accent is the colour the editor draws its *own* marks in
  — selection outlines, the extrude plate, a blocking boundary — so a
  block-out arriving in it was the one fill nobody could tell from chrome
- Generate PSD makes an empty file the size and shape of the selected grid
  area, already marked and anchored — somewhere to go and paint
- Extrude mode pulls a prototype solid out of the grid. The rest of the canvas
  dims, a bar along the bottom offers Apply and Cancel, and the selected
  spaces become a plate to drag: on an isometric project it stands up as a
  shaded block of cubes, on an orthogonal one it fills the spaces the way it
  was pulled. You are not stuck with the first pull — hold on the shape to
  take hold of another face and pull that one somewhere else. What you take
  hold of is a *side of a space*, not a patch of ground, and a sweep from it
  runs in that face's own plane: so a wall goes up ten, one of its side faces
  three from the bottom comes out ten sideways, five of that arm's roof tiles
  go up again, and so on. A face pushed back the way it came carves instead of
  adding, which is how a pull too far is corrected
- Backfaces turns the solid see-through so the sides facing away from the
  camera become the things a click lands on — the only way to pull the far
  wall of a box outward. It is a toggle on the bar, and holding ⌘ borrows it
  the way holding space borrows Pan. Erase, beside it, is a rubber: press or
  drag and the space under the pointer goes, on the far side too
- Apply writes the extrusion as a PSD, marked and anchored on the spaces it
  was built over, and places it where it stood. The solid goes into the
  document with it, so Apply is not a one-way door: the PSD's own layer list in
  the inspector marks the extruded layer with a cube, and clicking it opens the
  same shape back up — the flat artwork steps aside while you work on it, and
  applying again rewrites that file rather than leaving a second copy beside
  it. The artwork goes in as a **group** — `G | extrude-…` holding
  `S | lines-…`, `S | shading-…` and `S | shape-…` — so the silhouette, the
  shading that makes it read as a solid, and the lines between its spaces are
  three things you can take separately in Photoshop. Each is true on its own:
  the silhouette is solid, with no ghost of the lattice printed into it, and
  the lines are the lines you can actually see — an overhang hides the edges
  of what is behind it there exactly as it does on the canvas. The shape outlives every
  edit to the file — a re-parse, a re-import, a layer stack rewritten in the
  inspector — so the way back in is always there. And applying again
  **rewrites** the file rather than replacing it: the group's contents and both
  marks come out regenerated, each back where it was in the stack, and a layer
  painted over the greybox is still there afterwards, still lined up on the
  artwork
- Layers the app owns the name of are listed read-only and say why: the two
  orienting marks on every file the editor writes, and an extrusion's artwork.
  All three are found or regenerated by name, so renaming one is not an edit —
  it is a way to break something quietly
- Every placed PSD has a **collider**: the grid spaces it occupies as far as
  the game is concerned, in a Collider section of the inspector with Make
  blocking / Make walkable beside it. It is given a shape the moment the file
  lands, so nothing has to be visited one at a time — an isometric extrusion
  blocks the spaces its blocks actually stand on, following the same 3D logic
  the mode was pulled with, so you can walk under an arch and round its piers;
  a flat extrusion is every space of it, because every space of it is ground;
  anything else blocks the spaces under its base, which on a diamond grid is
  the bottom of the picture rather than the hillside behind it. Edit collider
  opens the shape on the grid with Add, Remove and Reset along the bottom bar
  and Apply to keep it. It rides in the config the game reads, so a character
  walks round a tower instead of through it — in Play and in a published
  export alike, because those are the same program
- Drag placed images, fills and boundaries, snapped to the grid; resize images
  from their corner handles, or freely from the inspector
- A placed PSD moves as one thing: every layer it came in with drags and
  resizes together, keeping the arrangement it was built with. Double-tap to
  open it up and move a single layer, and tap away to close it again
- Resizable sidebars and console drawer, persisted per install
- Add Image from Files, Photos or the clipboard → PSD → psd-to-json → placed,
  at half size because everything drawn on a retina machine is 2×
- Paste an image or a PSD straight onto the canvas: it is imported like any
  other file — marks and all — and lands in the middle of the view, on the
  layer you are on — ⌘V, or Paste Image in the menu. The clipboard is read
  through the shell rather than the webview, which is what makes a PSD copied
  in Files reachable at all on an iPad, where ⌘V is taken as a keyboard
  shortcut because the webview delivers no paste event over a canvas
- Drag a file onto the canvas and it lands where you let go of it, imported
  exactly as a paste is. Drag it over an image already there and that image
  lights up: dropping on it offers to put the new file behind it instead,
  which changes every placement of that PSD at once
- **A paste is cropped to the picture in it.** Copy a patch out of Photoshop
  or Procreate and what reaches the clipboard is a PNG the size of the
  *document* it came from, with the copied marks somewhere inside it and
  nothing but transparency around them. That is right for pasting back into
  the same document and wrong here: the padding became the artwork's size, so
  a thumbnail-sized sketch arrived claiming a footprint the size of somebody
  else's canvas, with its handles nowhere near the picture. The transparent
  field is taken off before the import, so what lands on the grid is what was
  copied — and nothing is thresholded away, so the soft edge of a brush stroke
  comes across intact. It applies to a drop and to Paste from clipboard, and
  deliberately **not** to replacing a PSD that is already in the project: a
  file coming back is held where it is rather than re-centred, and cropping
  one would slide the artwork out from under everything standing on it
- **Two PSDs with a same-named layer no longer collide.** psd-to-phaser keys a
  texture on the layer's own name, so two files each holding a `S | layer 1` —
  which is what New layer calls its rows, counting within each file — were the
  same key: Phaser declines a key it already holds without saying so, one file's
  artwork was drawn for the other's, and a pattern layer scattered the object
  layer's picture. Every load now names a texture after the file it came from as
  well, in the editor and in the game a publish writes. A project made before
  this keeps its own `game/` tree, so its exported game takes the fix when you
  Reset `preload` in the code panel
- Every import carries its grid space into the PSD as two marks a game never
  sees: a red dot on the space it is anchored to, and the outline of the
  selection it was dropped into. Move the dot in Photoshop and the artwork
  re-anchors to it — which is how you make something stand on its tile. A
  file that comes back **without** the dot — flattened on save, or brought
  home through Photos as a picture — is held where it is instead of being
  re-centred on its canvas, and the console says the mark has gone
- Both marks sit at the **bottom** of the stack and arrive **turned off**.
  They are the editor's rows rather than the artist's picture, and every
  program that opens a PSD draws its flattened composite — so a finished
  import used to open with a red dot and a lattice printed over the artwork
  everywhere except in the editor that wrote it, which draws neither. The eye
  is the way back: turn the grid on to line something up, and off again. It
  costs the anchor nothing, and a rewrite hands the eye back rather than
  forcing it
- **Scenes**, the way Phaser means them: a set of layers and a canvas of its
  own. A project is several places — a title screen, a cave, the overworld —
  sharing a grid, a genre and a pile of PSDs but not a single thing standing
  on them. The dropdown at the top of the left sidebar switches between them
  and holds New, Rename, Duplicate and Delete; each scene remembers where you
  were standing in it. A duplicate is a real copy, not a second name for the
  same thing
- **Three kinds of layer**, from the dropdown under the `+`. An **object**
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
  hand on every projection: a palette all anchored on one space and a stack of
  backdrops behind everything have no nearer and further for a sort to find.
  The two senses of the word stay apart: a layer here is Phaser's — draw order
  over anything at all — so a placed PSD is **one row** however many layers are
  inside the file, and the stack inside it belongs to the inspector. Select a
  layer and the inspector offers **Delete layer**, under the tally of what
  would go with it — it asks first, and the PSDs themselves stay in the
  project. A scene keeps its last layer, and the button says so rather than
  disappearing
- **A minimap**, along the bottom of that sidebar: the scene from far enough
  away to see all of it, with a frame around what the canvas is showing and
  the rest of the world dimmed behind it. There are no edges to fit, so what
  it frames is everything you have put down *together with* where you are
  standing — move about inside your own work and the picture holds still, and
  pan off the edge of it and the picture opens out until both are in view,
  which is how you get back. Tap it to stand somewhere, or drag to run the
  camera across the scene; the zoom you are at is beside its name. Fills come
  in their own colour, placed PSDs as the space they take up, boundaries and
  points as the marks they are on the canvas, and a sketch as the line it was
  drawn as — and a layer you have hidden is hidden here too. It keeps its own
  height, like every other divider in the shell. It is **Draw's**: in Code and
  Play the canvas is behind a running game, and a frame drawn around a camera
  nobody is looking through says nothing
- **Points**, from the rail: tap and a named place lands on that space, in
  the layer palette and on the canvas. Rename it in the inspector, drag it a
  space at a time, delete it. One point per scene can be its **start point** —
  the palette marks it with a flag and the canvas gives it a second ring — and
  that is where the character stands when the game opens, in Play and in an
  export alike. Naming a second point the start releases the first, because
  the scene holds the designation rather than the point. Every point reaches
  the game in `config.layers[].points`, so a door or a trigger is a matter of
  reading back the one you named
- **The tools are two columns down the left edge.** The **rail** hangs from
  the top corner and is what you do *to* the canvas: Select, Pan, Point and
  Boundary — the camera and the pointer, then the two that make something out
  of bare ground. The **drawing toolbar** stands on the bottom corner and is
  the ink: Pencil, Pattern, Shape, Slice, Lasso and Fill. They were one column with a
  gap in the middle doing the work of saying that Select and Pencil answer to
  different owners, and it grew a second column under it whenever PSD Edit
  mode was up. Which end a column hangs from carries that now — and the ink is
  at the corner a hand resting on an iPad's glass is nearest, which is the
  right way round for the thing a hand is doing most often
- **Boundary**, beside Point: sweep an outline on bare grid and it becomes a
  blocking zone, named, selected and listed under its layer. A boundary could
  only be made from strokes you had already drawn and lassoed, which is the
  right gesture when there is a sketch to promote and no gesture at all when
  there is not. Both routes meet in the middle — the same simplification, the
  same naming — so a boundary swept here and one converted from a sketch of
  the same shape are the same thing
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
- **Every brush can be turned round and used as an eraser.** Pencil, Pattern,
  Shape and Fill: what the tool *would have drawn* is what it takes out
  instead, so a Pattern brush set to erase removes exactly the lattice cells it
  would have revealed and a Shape brush takes back the tiles it would have
  stamped. Two ways in — **Use as Eraser** at the top of the tool's own panel,
  and a **long press** on its button in the toolbar — and a turned-round tool
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
- **The tool draws itself under the pointer.** The pencil, the Pattern brush
  and the Shape brush each show a faded stamp of what they are about to lay
  down, where it would land: the tip's own shape at its own size and colour,
  the pattern on the world's lattice at its own scale, the shape filling the
  space it is going to fill. It is the real mark at a lower opacity rather
  than a drawing of one, so it cannot say something the tool does not do, and
  it goes the moment you press. A tool turned round to erase previews in red,
  ringed — a tint alone is invisible over a block-out that is already that
  colour
- **Fill takes all three.** The swept shape and the tapped-out one can be a
  flat colour, a pattern revealed on the world's own lattice, or a field of a
  shape — and so can a filled run of grid spaces, where a shape fill is a
  tileset laid down in one gesture: the spaces are already there, so *a shape
  in every space* is exactly what it sounds like. It is the one tool that
  offers the choice, which is why it is the one that shows the three-way
  switch
- Hand a lassoed sketch to its layer as a PSD to flesh out elsewhere, or as
  a blocking boundary play mode walks around. The PSD carries the same
  orienting marks an import does — the anchor dot and the grid the sketch was
  drawn over — so there is a grid under the ink when you open it to paint.
  Its canvas is the ink plus the spaces the ink actually covers, not the
  larger diamond enclosing them, and the ink is the **top** layer of the
  file: it is the one row anybody would rename, and the marks are the
  editor's. The strokes are only consumed once the artwork is standing where
  they were — a conversion that is refused leaves the sketch where it is
- **The properties sidebar is three zones, always in that order: TOOL, LAYER,
  OBJECT.** It used to be one panel headed *Inspector* that showed exactly one
  thing at a time — the brush while a drawing tool held the pointer, a layer
  while a layer was selected, a placed PSD while one was — so picking a PSD
  took the layer's facts away and picking up the pencil took both away. The
  heading was the problem: *Inspector* names the furniture rather than what is
  in it, so nothing on screen ever said which of the three you were looking
  at, and there was no way to look at two. Now **TOOL** is whatever the thing
  in your hand has to set, **LAYER** is the layer the next thing you do will
  land on, and **OBJECT** is what is selected on the canvas — read down the
  column and it is the same sentence every time. A zone with nothing to say is
  not drawn at all: a tool that does one thing with one gesture gets no TOOL
  zone, because a heading over a sentence that never changes is the thing the
  single heading was doing wrong. Inside them, the sections are what they
  were — Info, Transform, the collider, the file's own layer stack. A placed
  image's title is its filename, and retyping the part before `.psd` renames
  the file, moves its assets with it, and repoints every placement on it
- **The three zones fold too, and they are marked as the ones that are not
  sections.** Each carries a small chip — a brush, a stack of sheets, a box
  with corner handles — sits on a ground a shade off the panel's, and has a
  heavier rule over it than any section boundary. Without that, a column that
  folds from top to bottom has nothing in it saying which three headings are
  the structure
- **Every named section folds away.** A placed PSD carries Info, Transform, its
  collider, its own layer stack and — on a pattern layer — the rule and its
  shapes, and most of the time only one of those is being worked on. Click a
  heading and it shuts; it stays shut for the next thing you select and for the
  next time you open the app, because closing Collider once is a statement about
  how you work rather than about that one PSD
- **A heading can say which one, as well as what.** The pencil's panel used to
  open with a heading naming the tip — *Ink* — above a section called *Brush*,
  which is one fact written twice. The section says `BRUSH : INK` now and
  changes as you pick a tip, and what it folds under is still *Brush*, so
  choosing a different one does not reopen a section you closed
- **A PSD you have just made opens on its layers.** Generate PSD, either
  Convert to PSD, an extrude Apply and a new image backdrop all end with an
  empty file standing on the grid, and the only useful next move — Open PSD,
  or draw into one of its layers — was four sections down a panel that opens
  on Info. The rest of the panel folds away and it scrolls to the file's own
  stack, so what is in front of you is the thing you just made and the way
  into it
- **Transform sits under Info, and Collider is last.** Between them Info and
  Transform are what the thing *is*; a collider is what it *stops*, which is a
  question you come to after the file and its layers rather than in the middle
  of them
- **Selecting a thing no longer selects its layer as well.** Picking a placed
  image drew its layer's whole panel above it, so one tap read as two
  selections and the thing you tapped started a screen down. The LAYER section
  is there when the layer is the subject — one selected, nothing selected, or
  a patch of grid, where it answers where the next Fill would land
- **The explanations are on the headings, not under them.** A sentence saying
  what a pattern's scale means, or what the Pattern brush does, reads once and
  is scrolled past for ever after — and four of them is most of a narrow
  column. They are tooltips now: hold the cursor over *Scale*, or over the
  TOOL heading, or over *Add shape*, and the line is there. What stays on
  screen is what is not an explanation — a count, an empty state, the reason
  a button is greyed
- Option-drag a fill or an image to copy it. Two placed PSDs on the same file
  are **instances** of it: equal objects rather than one pointing at another, so
  editing the artwork edits every one of them and deleting any leaves the rest
  as they were. The canvas outlines a selected instance with a **dashed** box,
  the inspector says how many objects an edit would reach, and **Make Unique**
  gives this one a copy of the file — every other instance keeps the original.
  Option-shift-drag asks for that up front: the copy comes out independent
- The selected PSD's own layer stack, in the inspector: drag by the grip to
  reorder it, rename in place, then Apply to rewrite the file and re-run the
  pipeline. Renaming is how a sprite becomes a tileset, so it is worth having
  without a trip to Photoshop. Groups are listed as Photoshop shows them —
  the group, then its contents indented under it, foldable away from the
  group's own second line — and a drag takes a group's contents with it,
  landing only among the things it already sits beside. A PSD with masks or
  clipping is listed read-only, because a rewrite would flatten them
- **A layer's eye, down the right of that list.** A layer you turned off in
  Photoshop stays off here — it used to be drawn anyway, which made hiding
  something in the file no way of hiding it in the game — and the column
  turns one off without opening Photoshop at all. Hidden is about *drawing*
  rather than about existing: the asset is still exported, the object is
  still made, and it simply starts turned off in the editor and in the game,
  so your own code can turn it on. It is staged like a rename — the canvas
  shows it the moment you click, and Apply writes it into the PSD, so one
  rewrite covers a handful of clicks — and a group takes its contents with
  it. A layer inside a group you have turned off keeps a lit eye of its own,
  as it does in Photoshop: what decides whether it draws is the folder it is
  in. Pulling an extruded shape again leaves the eyes where you left them
- Everything that is about the *file* rather than about this placement of it
  is **one row directly over that list**: Adjust layers, which opens the PSD
  up on the canvas so a single layer can be moved, and the two halves of the
  round trip out to Photoshop and back. They used to be three buttons in
  three different parts of the panel with the list they are all about in
  between
- **New layer**, under the list, puts an empty sprite layer on top of the
  stack — somewhere to draw, without a trip to Photoshop to make it. It is
  written into the file straight away and holds nothing but a single clear
  pixel, so it is a row to rename, reorder or draw into and nothing the game
  can see yet
- **PSD Edit mode**, from the pen on any sprite row of that list, the way the cube
  on an extrusion's row reopens the solid. The rest of the canvas dims, the
  PSD's own canvas is framed where the file stands on the grid, and the
  pencil draws inside it — the same brushes, the same pressure, the same
  smoothing as anywhere else. Apply lays the ink into that layer at the
  file's own resolution and re-parses, so it arrives as artwork rather than
  as strokes over the top of it; Cancel throws the drawing away, and ⌘Z
  brings it back if that was the wrong button. The frame is the **document**,
  not the artwork: everything this editor writes has a grid space of clear
  canvas around it, and the boundary somebody draws up against had better be
  the one Photoshop would show them
- Applying is a few seconds of real work — the file is rebuilt and re-parsed —
  and it now **says so while it happens**. The bar goes quiet, because pressing
  Apply twice used to put the same ink in twice; a line moves along the bottom
  of it; and beside that is what the pipeline is doing, in its own words. The
  editor stays live throughout, which it did not: every PSD the editor writes
  used to be written on the thread that draws the window, so the app went stiff
  until it finished — and a spinner would have sat perfectly still through the
  whole wait it was there to explain
- **Hold the pen still inside a stroke** and the rest of it comes out
  straight — a second, and the line snaps to the one between where you
  started and where you are, and stays ruled until you lift. The next stroke
  is back to whatever the slider says. Pause at the end of a wobbly line and
  it straightens; pause before you draw and everything after it is ruled. It
  is the same rule read from either end, and it is PSD Edit mode's, where a line
  drawn against the edge of a building wants to be a line
- **Erasing in here is the same erasing as everywhere else.** There was a
  **Rub** on the mode's own bar — the pencil turned round, rubbing out this
  session's ink — and it has gone. Every brush can be turned round now, which
  is four erasers in the mode rather than one, each taking out exactly what it
  would have drawn; a fifth with a button of its own and a rule of its own was
  one too many. The bar it was on is the last of what used to be a second tool
  rail that appeared and disappeared with the mode, so nothing in hand is set
  from there any more: the brush, the size, the smoothing, the colour and the
  eraser switch are all in the TOOL section of the properties column, where
  they are while drawing anywhere else
- **Erasing in PSD Edit mode reaches the artwork in the file**, not just the
  ink from this session — and you can see it happen. It did neither, and both
  were the wrong answer for a tool whose whole promise is that what it would
  draw is what it takes out. The pixels Apply sends are drawn on a clear
  ground, so a rub somewhere you had not already drawn did nothing at all; and
  the PSD is drawn underneath the ink, so even a correct cut was invisible
  until the file had been written and re-parsed. Apply now sends a second
  buffer — the coverage the erasers would have laid down — and Rust takes it
  out of the layer's own pixels before the ink goes over what is left, which is
  the order the strokes were drawn in: rub a hole, draw into it, and the new
  ink lands on bare canvas. And for as long as the mode is up, **the layer
  being drawn into moves into the drawing surface**, baked under the ink, with
  the canvas's own copy turned off. So the hole opens under the pointer as you
  drag it, and what you are looking at while you work is the composite Apply is
  going to make rather than a picture of the intention
- Convert a fill to a PSD, the same way a sketch converts. Both export at
  double resolution and place at half, so a converted block-out matches an
  imported image pixel for pixel instead of arriving at half its detail
- **Converting says so while it happens, and it is a great deal faster.** A
  sheet holds the screen from the tap, with the pipeline's own words moving
  under a bar: *drawing the strokes*, *packing the pixels*, *parsing the PSD*,
  *placing the artwork*. Before it there was nothing at all — you pressed
  Convert to PSD and the app looked asleep for ten seconds. Three things were
  taking that long, and all three are measured rather than guessed at. The
  pixels were turned into base64 as one string the size of the whole buffer,
  which for a lassoed scribble is ten megabytes of rope concatenation: **435 ms
  → 96 ms** on the same raster, encoded in pieces instead, and every import,
  paste and drop in the editor takes the same route so all of them got it. The
  file's size was read by parsing the whole PSD back, when the first
  twenty-six bytes of it are the header that says so: **17.6 ms → 0.075 ms**,
  and a multi-megabyte read off the disk goes with it. And the iPad build is a
  debug build, so every crate underneath the app — the PSD writer, the
  psd-to-json pipeline, the PNG encoder — was compiled unoptimised; they are
  optimised now while this crate stays debuggable, which on the same sketch
  takes writing the file from **2.16 s to 0.86 s** and running the pipeline
  over it from **2.34 s to 0.13 s**
- A fill or an extrusion written out as a PSD gets a **grid space of clear
  canvas** around it, so there is somewhere to paint the eaves that hang past
  the wall. It is the canvas that grows and nothing else: the artwork keeps
  its size and its place on the grid, and blocks exactly what it did. Paint
  into that room and Re-parse, and it comes back where you painted it: the
  layers inside a file keep the arrangement the file gives them, however
  Photoshop has cropped them on the way back
- Delete removes whatever is selected
- **Undo and redo**, from the two buttons beside Edit or from ⌘Z and ⇧⌘Z —
  the same keys on a Mac and on an iPad with a keyboard attached, and the
  buttons for an iPad without one. A step is a thing you did rather than a
  write the editor made: dragging an image across ten spaces is one step, and
  so is a dropped PSD however many layers came in with it. The two buttons
  follow what you are working on — put the caret in the code editor and they
  undo there instead, in that file's own history, which is the same one ⌘Z has
  always had in it, and while extrude or collider mode is up they undo *in
  that*, a pull or a rub at a time, with the document's history waiting
  untouched underneath. The code panel carried a pair of its own for when it is
  floating over the header, and they went with the bar they were on — see the
  Code section below. Undo does not reach across the things
  the editor cannot take back: renaming a PSD, or bringing an edited one home,
  moves a file on disk, and the history stops there rather than restoring a
  document that names a file which is no longer where it says
- Export a selection as a transparent PNG (save or copy), from the inspector
- Edit a placed PSD outside the app and bring it back: Open PSD hands the file
  to the system editor on macOS and to the share sheet on iPadOS, and
  **Re-parse** beside it runs the pipeline over the file again. On a Mac that
  is the whole of it, because the file never moved. On an iPad it asks which
  file first, and the answer at the top of the list is *this one* — the PSD in
  the project, as it stands. **That answer used to be missing on an iPad**,
  which left the platform this editor is mostly used on with no way to re-read
  a file at all: the button was called Re-import and offered only the three
  ways a replacement arrives — Files, the photo library or the clipboard, each
  written over the same key so every placement survives. Plenty changes a PSD
  in the store without a trip to Photoshop — Apply in PSD Edit mode, an
  extrusion, a layer stack rewritten in the inspector, a project opened out of
  a `.idlewild` file — and re-reading one is not something an iPad should have
  to go looking through Files for
- The exported game places the scene you have open, and carries the rest: the
  config holds every scene's layers and loads every scene's PSDs, so switching
  in your own code is `this.scene.start("Cave")`, under the name you gave it
- **The scaffold and your code are different files now.** A scene used to be
  one thousand-line file with the editor's machinery at the top of it, marked
  block by block and shown in a different colour, and whatever you wrote went
  in between. The machinery is in `js/shared/` — `canvas.js` puts the document
  on screen, `character.js` wires up whatever moves in it — and a scene file is
  a short one that calls six of them and is otherwise yours, with nothing in it
  marked at all. `canvas.js` is the same file for both styles; what differs
  between a game seen from above and one seen from the side is the character,
  which is what `character.js` is
- **One file per scene, named after it.** Add a scene in the sidebar and
  `js/scenes/<Name>.js` appears beside the others; rename it and the file, the
  class and the Phaser key all move together, carrying whatever you wrote in
  it; delete it and the file goes with it. A name with spaces in it becomes a
  class name — *Title Screen* is `TitleScreen.js` — because a scene's name has
  to be a filename too. `js/scenes/index.js` is the list `main.js` registers
  and the editor keeps it in step, so adding a scene is never a request to go
  and edit an import. The game opens on the scene the editor has open, which is
  three lines in `main.js` you can change
- Play runs **the project's own code**: the `game/` tree you see in the code
  modal, loaded over the local server exactly the way a published export loads
  it, in a frame over the canvas. No grid lines: the editor's light blue lattice
  is scaffolding to build on, and a game is the thing you built. Save a file while it is up and the game
  restarts on what you just wrote. Top down is a character that walks the grid
  over A*, side-on is one that runs and jumps with the arrow keys — and both
  of those are files in the project now, so they are something to change
  rather than something the editor does. A platformer reads
  the same document from the side: every non-walkable fill, blocking boundary
  and placed PSD's collider is the ground it stands on rather than an obstacle
  to route around
- **A file you change while the game is running restarts it**, the way saving
  code does: ink applied in PSD Edit mode, a layer renamed or turned off, a
  re-parse, a PSD replaced by a drop. Code runs the game beside the canvas,
  and it was holding the artwork it loaded when it started
- `js/game.config.json` — the document in the shape the project's code reads
  it — is rewritten on every save, so the file the code modal opens describes
  the canvas beside it and the game you play is the game you built
- Code is a section rather than a panel that happens to be open: the middle of
  the three at the top. **The canvas shows what Play shows** — the project's own
  game, running — and what Code keeps that Play does not is the left sidebar
  and the panel the code is in. Save a file and the thing in front of you
  restarts on it; switch scene and it restarts there. Play is then the full
  test rather than the first look
- **The left sidebar in Code is a directory of the project**, which is what
  that column is for while you are writing against it: the scenes, the Phaser
  layers in each, the PSDs standing on those, and — this is the new level —
  the **layers inside each PSD**, in the file's own order and nesting, with a
  group's contents indented under it and the category beside each name. Those
  are the names the project's own code addresses things by, and reading one
  off the file in Photoshop or out of `game.config.json` is two windows away
  from where the line is being typed. Every row is inert except its
  disclosure — tap a layer to open it, tap a placed PSD to open *that* — and
  the names can be selected and copied, which they cannot anywhere else in the
  shell. The handles are all gone with the edits: no rename, no eye, no lock,
  no grip, no `+`, and the scene dropdown offers the scenes and nothing else.
  Nothing in there had a canvas to act on anyway
- **The properties sidebar is down in Code.** It describes what is selected on
  the canvas, and in Code the canvas is behind a running game — so it was a
  column of controls for a selection nobody could reach. The **toggle that
  folds the sidebar that is left** is back, too: it was there the whole time,
  drawn underneath the running game, so the one control for getting the column
  out of the way was invisible for the whole of the mode
- The panel sits in one of **three** places, from the pin in its bar — a row
  above the console (the default: code here is code about the canvas beside
  it), a column to the right of it, where a wide screen gives a file the
  window's full height, or over the whole editor. Each remembers its own size,
  and which one you left it in is remembered too. The reference goes where
  there is room for it: beside the editor when the panel is wide, under it
  when the panel is itself a column
- **One bar of chrome, where there were three.** There was a header across the
  top carrying three placement buttons, Docs and Close; the bar naming the open
  file; and a footer carrying Save, the words ⌘S and a pair of undo buttons.
  A hundred and sixty pixels of the window on nine controls, in a section whose
  whole subject is a file taller than the screen — which on an iPad is a third
  of the panel gone before a line of code is shown. Now it is the file bar and
  nothing else: the path, whether it is saved and whatever the editor last had
  to say on the left, and right-aligned the pin, the reference and Close, as
  three icons. The pin opens a menu rather than standing its three places in a
  row, and it ticks the one you are in. The path is cut in the middle rather
  than at the end when the column is narrow, so what you can always read is the
  filename
- **The save bar is gone rather than moved.** Nothing on it did anything the
  keyboard does not — ⌘S, ⌘Z, ⇧⌘Z — and nothing typed can be lost without it:
  the panel writes a dirty file when you open another one and when you leave
  Code, and the editor's own undo and redo follow the caret into the code.
  The one thing it costs is the full-screen placement on a device with no
  keyboard, where the header is covered and there is now no button to undo with
- The project's real file tree in CodeMirror 6. New File and New Folder sit over
  the column they create into, folders fold away — and stay folded, per
  install — and a switch beside the open file's path takes the whole column off
  when the code wants the room. Rename, duplicate, delete and dragging files
  between folders are on the rows. A drag carries a **ghost** of the row under
  your finger, naming the folder it would land in, and that folder's row lights
  up as you pass it — pointer events have no drag image of their own, and a
  finger drag with nothing following it looks like nothing happening
- The editor and you do not fight over the code. A scaffolded file marks the
  runs the editor maintains — `preload`, `placeDocument` and the rest — and
  those lines come up in their own colour and refuse to be typed over. It is
  decided **line by line**, so a `console.log` dropped into the middle of one
  is yours to edit and delete while the lines around it stay locked, and every
  marked block has a **Reset** beside it that puts it back the way it came.
  When a fix to the editor adds a block your file has never had, it says so and
  offers to put it in — your `game/` tree is your copy, and nothing writes into
  it unasked. The generated config is the whole-file case: read-only, and
  re-read as you build
- Docs, along the bottom of the code modal: Phaser's concept guides, Phaser's
  own API, MDN's JavaScript, CSS and HTML reference, and psd-to-phaser's docs.
  Automatic follows the caret — put it on `this.add.sprite` and the page for it
  appears — and the MDN half follows the file, so a `.css` asks about CSS.
  Search, and a table of contents for the written guides. All of it is on the
  device, so it works on an iPad with no network. Beside the editor it is the
  same panel turned sideways — the contents list stays *beside* the page rather
  than stacking above it, and the page scrolls rather than being cut off at the
  bottom of the panel, which it was
- Console drawer in Fira Code — selectable, `%c`-aware — carrying the
  editor's own commentary, psd-to-json's progress, and the JavaScript console:
  this page's and the running game's, errors and stack traces included, so a
  `console.log` in your scene file shows up where you are looking. **App**
  and **JS** toggles on the right of its header bar, when it is open, filter
  one from the other, and **Clear** beside them empties it — which is how you
  see what the next thing you try writes rather than reading it out of an
  afternoon
- Log an object and you get an object: a disclosure triangle, a one-line
  preview, and its contents a level at a time, with keys, strings, numbers and
  nulls each shown as what they are. Classes say which class they are, a Map
  and a Set open like anything else, and a cycle says so rather than hanging
- **LOG** beside a line from your own code is a link to the line that wrote
  it: it opens the file in the code modal and puts the caret on it. Works for
  warnings and errors too, and steps over Phaser's own frames — a
  `console.log` reached through a callback still names the line you typed
- The game a project scaffolds is laid out the way you would lay one out
  yourself:

  ```text
  index.html
  styles.css
  js/main.js              registers the scenes and starts the game
  js/game.config.json     the document, generated on every save
  js/lib/                 Phaser and psd-to-phaser
  js/scenes/index.js      the scene list, written by the editor
  js/scenes/Scene1.js     one per scene, named after it — and yours
  js/shared/canvas.js     the document, drawn
  js/shared/character.js  what moves in it, and what stops it
  js/shared/grid.js       the projection, and the document's geometry
  js/shared/navigation.js A* — or physics.js, for a platformer
  js/prefabs/character.js the body, the walk and the artwork — yours
  ```

  The two files you write in are the scene and the prefab. Everything in
  `js/shared/` is the editor's: it is there to read, it has a Reset beside
  every block the editor maintains, and you can still type between them.

  `js/lib/` is the only directory that is not on your disk while you work: the
  two runtimes are 1.5 MB that would be the same in every project, so the local
  server answers for them and an export writes them in. A project made before
  this layout keeps the one it was made with — your `game/` tree is your copy —
  and plays and publishes from wherever its own `index.html` says
- Publish has two exits. **Export site** is a zip you can serve: the game, its
  processed assets and both runtimes, so the exported game opens showing what
  the editor showed. **Export project** is a `.idlewild` file — the project
  itself, source PSDs and all, with the document, the processed assets and the
  code as it was edited. A published site cannot give you back the file a
  sprite was drawn in; that is what the second one is for
- **Export Assets**, beside Publish in the menu, is the third exit and the only
  one that hands back artwork rather than a program. Tick the PSDs you want and
  say what of them: the assets the pipeline made — each file's `data.json` and
  the sprites and tiles beside it, which is what another engine can read — the
  source PSDs, which is what opens in Photoshop, or both. It lists what is in
  `psd/` rather than what the document places, because a file whose placement
  you deleted is still a file you drew
- **Open**, beside New Game on the home screen, reads a `.idlewild` back in as
  a project of its own. Everything comes with it, including the solids behind
  extruded layers — so a shape you pulled on one machine is a shape you can go
  on pulling on another

**Next**

- Hush's blit-forward re-anchor, so panning a stroke-heavy layer past the
  drawing backing's edge slides its pixels instead of re-baking them
- A flat top-down project sorts nothing on Y, so its character draws in front
  of everything. The machinery is the isometric one and the missing half is a
  reading of the row that a square grid's placements agree with
- A pattern layer on the minimap. Its placements are a palette standing
  nowhere and the pattern made of them has no edges to frame, so the map
  skips it rather than showing a heap of elements on one space
- Pattern fills rendering their PSD texture rather than a tint. (A fill made
  of a *library* pattern or shape does draw — see above. This is the other
  sense of the word: a patch whose texture comes from a PSD in the project)
- A **combination** editor, which is the one thing
  [simple-tileset-generator](https://github.com/laffan/simple-tileset-generator)
  has that this does not: a shape spanning several tiles, with a pattern per
  path. The pieces are all here — the shapes, the patterns, the lattice — and
  what is missing is the editor and a place for a multi-tile stamp to live
- Arcs in an imported SVG. `A` comes through as a straight line to its
  endpoint rather than as a curve, which is honest but lossy
- Phaser-aware autocomplete in the code modal, and the other direction of the
  canvas ↔ code binding: the canvas drives the code today, through the config
  the editor writes, and code does not yet drive the canvas
- Play starting from the camera the editor is looking through, rather than
  where the project's own scene opens
- One Phaser scene per Idlewild scene in the exported game, with transitions
  between them — today the template places the open one
- Sloped ground for the platformer: a blocking boundary is currently taken as
  its bounding box
- rsync publish targets
- Opening a `.idlewild` straight from Files or the Finder — the format is
  real, but it is not declared to the system and nothing handles a file the OS
  hands the app

## Development

```bash
npm install
npm run dev          # Vite + Tauri
npm run check        # typecheck + the 700-line file rule
cd src-tauri && cargo test --lib
```

Requires [Rust](https://rustup.rs/) and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your
platform.

### Runtime libraries

`psd-to-phaser` on `main` targets Phaser 4 but publishes no `dist/`, and the
registry copy (0.0.5) is the Phaser 3 line. `scripts/vendor-p2p.mjs` clones a
pinned ref, builds it, and drops the result into `vendor/` and
`src-tauri/vendor/`. Those builds are committed so a fresh clone works
offline; re-run the script to move the pin.

```bash
npm run vendor:p2p
```

## Where this comes from

| Source | What it contributes |
|---|---|
| [phaser-bench](https://github.com/laffan/phaser-bench) | The PSD pipeline, the local asset server, the CodeMirror editor, the console |
| [psd-to-phaser](https://github.com/laffan/psd-to-phaser) | The runtime the editor is built around, and the only non-Phaser dependency exports ship |
| [psd-to-json-rust](https://github.com/laffan/psd-to-json-rust) | PSD → game assets, in-process |
| [psd](https://github.com/laffan/psd) | Reading PSDs, and the write half that turns images and sketches into them |
| [hush](https://github.com/laffan/hush) | The drawing layer: stroke engine, infinite canvas, Apple Pencil |
| [simple-tileset-generator](https://github.com/laffan/simple-tileset-generator) | The pattern and shape libraries, and both of their editors |

The reference in the code modal carries [MDN Web Docs](https://developer.mozilla.org)
content, used under CC BY-SA 2.5, alongside Phaser's and psd-to-phaser's own
documentation.

See [README-TECHNICAL.md](README-TECHNICAL.md) for architecture.

## PSD layer naming

Layers must follow psd-to-json's pipe convention to be recognised:

| Format | Example | Result |
|---|---|---|
| `S \| name` | `S \| player` | Sprite |
| `S \| name \| animation` | `S \| hero \| animation` | Animated spritesheet |
| `S \| name \| atlas` | `S \| items \| atlas` | Texture atlas |
| `T \| name` | `T \| background` | Tileset |
| `G \| name` | `G \| enemies` | Group |
| `P \| name` | `P \| spawn` | Point |
| `Z \| name` | `Z \| boundary` | Zone |

Images converted on import are named `S | <stem>`, so they arrive as sprites.
An image background is written as `T | Background` holding `S | background`,
so the runtime loads it a tile at a time as the camera reaches each piece.

`P | anchor` is the one layer an object layer insists on: without it a file
placed on the grid has nothing to line up on when it comes home from
Photoshop, and its row says so.
