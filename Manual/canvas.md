# The canvas

The infinite grid you build on, the camera over it, the frame showing where
the game's screen falls, and the map of everything you have made so far.

Part of [the Idlewild manual](README.md).

---

## The window

- A full-width header carrying the project, undo and redo, and the
  **Draw / Code / Play** toggle, with Publish, Export, Import Assets and
  Project Options behind its menu — and Copy PSD and Paste Image, which are
  there because an iPad has no ⌘. It insets itself out of the iPad's status bar, as the console drawer
  does out of the home indicator
- Resizable sidebars and console drawer, persisted per install

## The grid

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

## Where the game's screen is

- **Where the game's screen is**, on the canvas you draw on. The grid is
  effectively infinite and there is nothing on it to measure from, so two
  things about the *game* were invisible the whole time you were building for
  it: where world 0,0 is, and how much of the world a player actually sees. In
  Draw there is now a red crosshair on the origin and a dashed red boundary
  around the screen the game opens at. The project's scale mode is
  `Phaser.Scale.RESIZE`, so that screen is the window — the boundary is drawn
  at the size the game will get in Play, with both sidebars down, divided by
  the project's default zoom. At that zoom the two cancel and the box is the
  game's window life size on the canvas; at any other zoom it grows and
  shrinks with the camera, and stays centred on the crosshair. It is Draw's
  alone — in Code and Play the real screen is the thing in front of you
- **Overlays**, a folded section above the minimap, switches those two marks,
  the minimap itself and **the grid** on and off one at a time. A boundary is
  what you lay a building against and then want out of the way; the map is
  worth a third of the sidebar right up until you are working close in; and the
  lattice is the mark you want gone when a scene has enough artwork in it to
  judge on its own — it is drawn about the document rather than being part of
  it, exactly like the other three, and it is nowhere in the game. It is first
  in the list, because it is the ground the others are marks on. A blank
  project has no lattice to switch and gets no row rather than a dead one. It
  arrives folded, with everything showing — the switches are for the times a mark is in the way, and
  a row of them standing over the map the rest of the time costs more than it
  saves. What is switched, and whether the section is open, is remembered per
  install rather than saved into the project, the way a sidebar's width is

## The minimap

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

## Points and boundaries

- **Points**, from the rail: tap and a named place lands on that space, in
  the layer palette and on the canvas. Rename it in the inspector, drag it a
  space at a time, delete it. One point per scene can be its **start point** —
  the palette marks it with a flag and the canvas gives it a second ring — and
  that is where the character stands when the game opens, in Play and in an
  export alike. Naming a second point the start releases the first, because
  the scene holds the designation rather than the point. Every point reaches
  the game in `config.layers[].points`, so a door or a trigger is a matter of
  reading back the one you named
- **Boundary**, beside Point: sweep an outline on bare grid and it becomes a
  blocking zone, named, selected and listed under its layer. A boundary could
  only be made from strokes you had already drawn and lassoed, which is the
  right gesture when there is a sketch to promote and no gesture at all when
  there is not. Both routes meet in the middle — the same simplification, the
  same naming — so a boundary swept here and one converted from a sketch of
  the same shape are the same thing

## Undo, delete, and a PNG of what you have got

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
