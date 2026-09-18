# Placing, moving and grouping

What a placed PSD is on the grid, how it moves, what it blocks, and what
happens when several of them are treated as one thing.

Part of [the Idlewild manual](README.md).

---

## Colliders

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

## Moving things

- Drag placed images, fills and boundaries, snapped to the grid; resize images
  from their corner handles, or freely from the inspector
- A placed PSD moves as one thing: every layer it came in with drags and
  resizes together, keeping the arrangement it was built with. Double-tap to
  open it up and move a single layer, and tap away to close it again
- **And a way back from that.** A layer moved while a PSD is open is no longer
  where the file puts it, and nothing on the canvas can say so — a roof dragged
  half a space sideways looks exactly like a roof drawn half a space sideways.
  So **Reset Layer Position** appears directly over the file's layer list when
  any of its layers have wandered, and its being there at all is the notice. It
  asks first, because it throws the moves away, and names what goes; one undo
  step puts them back if the answer was wrong. A re-parse does not do this and
  never did: reconciliation puts each layer back where *its own* grid space
  says, which is the thing the move changed
- Option-drag a fill or an image to copy it. Two placed PSDs on the same file
  are **instances** of it: equal objects rather than one pointing at another, so
  editing the artwork edits every one of them and deleting any leaves the rest
  as they were. The canvas outlines a selected instance with a **dashed** box,
  the inspector says how many objects an edit would reach, and **Make Unique**
  gives this one a copy of the file — every other instance keeps the original.
  Option-shift-drag asks for that up front: the copy comes out independent

## Several at once

- **Several PSDs at once, with ⌘ and ⇧.** A marquee on the canvas has always
  caught more than one image, but it asks where things are standing — and three
  trees in a wood are not a rectangle. So ⌘-click adds or removes one, on the
  **canvas and in the layer panel alike**, and ⇧-click in the panel takes the
  run between the last plain click and this one. On the canvas ⇧ does what ⌘
  does, because there is no order between two towers for a run to be measured
  along. ⌘-clicking a tower's roof takes the whole building, and ⌘-clicking
  bare ground keeps what you have rather than clearing it. It is one layer's
  worth, like the marquee's, because that is what drags, groups and merges
  together
- **⌘G puts placed PSDs together, and ⇧⌘G lets them go.** A wall, a roof and
  a door become one thing to work on: tapping any of them picks up the lot, a
  drag moves all of them, and the layer panel lists them under a row of their
  own with their names indented beneath it. To reach one file inside a group,
  pick it there — the canvas always means the group, because a double tap is
  already how a PSD opens up into its own layers. Group and Ungroup are
  buttons in the inspector too, since an iPad has no ⌘. **The game is never
  told.** It is the first thing in the document that is not a fact about what
  runs — it says how somebody is working — so a grouped project exports exactly
  the game an ungrouped one does. It is saved all the same: a group travels in
  a `.idlewild`, comes back on another machine, and undoes with everything else
- **And merge them into one PSD.** With several selected, **Merge** writes a
  single file holding all of them in the places they were standing and in the
  order they drew — a wood drawn as nine PSDs becomes `wood.psd`, and stays a
  wood. It is every other conversion backwards: the rest of them turn one thing
  into one file, and this takes files already on the grid and writes the
  arrangement. A file somebody resized on the grid arrives at the size it
  actually looked, and a PSD with a wall and a roof in it stays two layers
  rather than one flattened picture. Every layer is renamed for where it came
  from — the hut's wall is `S | wall-hut`, and an animation keeps its
  attributes as `S | hero-guy | animation` — which says what each part is in a
  file that is no longer either of them, and means two files that each call a
  layer `layer 1` cannot collide. The new file is anchored at its own centre.
  What goes is the *placements*: the source PSDs stay in the project, because
  another scene may be drawing them
