# Projects

The home screen, what the New Project sheet asks, and the choices on it that
cannot be changed later.

Part of [the Idlewild manual](README.md).

---

## The project list

- Project list with thumbnails, long-press rename / duplicate / delete
- **Select**, beside Import, turns the grid into a set of choices: a tap picks a
  card instead of opening it, each one carries a box in the corner of its
  thumbnail, and the row above them offers All, None, Duplicate and Delete. A
  bulk delete asks **once**, naming the projects while the list is short enough
  to read and counting them when it is not. There is no ⌘-click on an iPad and
  no rubber band over a grid of cards, so the mode is the honest shape; the
  card's own menu is untouched, and stays the only way to Rename

## Making one

- New Project: template (isometric, orthogonal, blank), style (top down,
  platformer) and grid scale (8–256 px — 8 and 16 are there for pixel art,
  where a space is a sprite rather than a room). Blank has no lattice: a
  selection is the exact rectangle it was dragged across, and a fill on it is
  one rectangle rather than a run of spaces
- **The sheet is a settings page, and is drawn as one.** It used to be a column
  of labels each with a grey paragraph under it; it is the same rows the Logins
  sheet is built from now — the vocabulary Publish introduced, which this is the
  second page to use and the first to need *controls* rather than reports. Every
  explanation is still there, behind a **?** beside its row, which opens to a
  tap as well as to a hover, because an iPad has no pointer to rest on anything.
  The one that changes with the template says the right thing either way. There
  is no *New Project* heading across the top: the button that opened it says so
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

## A character, or not

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
