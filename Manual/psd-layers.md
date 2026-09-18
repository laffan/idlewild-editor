# A PSD's own layers

The stack inside a placed file, edited without leaving the app — and the mode
that reaches the artwork rather than the placement.

Part of [the Idlewild manual](README.md).

---

## The stack, in the inspector

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

## PSD Edit mode

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

## Erasing in here

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
