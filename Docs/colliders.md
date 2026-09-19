# Colliders

The grid spaces a placed PSD blocks, how they are guessed, how they are
edited, and what the exported game reads them as.

Part of [Idlewild's technical documentation](../README-TECHNICAL.md).

---

What a placed PSD stops. Until this existed the only geometry in a document
that a character could not walk through was a fill marked not-walkable or a
boundary drawn by hand, so every image on the grid was scenery and a tower was
something to walk through.

## It is a fact about the file, and it is stored as offsets

`GameDoc.colliders` is keyed by PSD key, beside `extrusions` and for the same
reason: two instances of one file are two views of the same thing, and a tree
that blocks the space it stands on blocks it wherever it is put. A copy made by
Make Unique takes the collider with it and the two part company from then on,
which is what Make Unique means everywhere else.

The spaces are **offsets from the anchor** — `{cx: 0, cy: 0}` is the space the
artwork hangs from. That is what lets a placement be dragged without anything
being rewritten, and it is what lets two placements of one file share one
record at all. `lib/collider.ts` is the arithmetic, and everything that reads
a collider goes through it: `colliderCells` for a top-down character routing
around spaces, `colliderBoxes` for a side-on one standing on rectangles.

A project whose grid does not snap has no spaces to name, so its collider is a
`rect` instead — measured from the anchor in the same units, since a cell
there is one world pixel. The same either-or `FillPatch` already carries, for
the same reason: a hundred thousand one-pixel records is not a document.

## The defaults, and why they are written rather than derived

Every placed key has a record. It is written when the PSD is placed, again
when the artwork changes under it, and backfilled on open for every document
written before this existed (`PsdPlacements.migrate`, beside the instance and
stacking migrations). Deriving it on demand instead would make a project play
differently depending on what had been looked at, and would put the same guess
in three places — the editor's two play modes and the exported game.

What the guess is depends on how the PSD was made:

- **An extrusion** is a solid whose shape is known exactly, so the default is
  the spaces its voxels rest on at **level zero** — `groundOffsets`. That is
  one rule with two readings. Under an isometric template it is the blocks
  that touch the ground, which is the 3D logic the mode was pulled with: an
  arch pulled up and over blocks its piers and not the road between them, and
  a shape hanging in the air with nothing at level zero blocks nothing, which
  is the honest reading of a shape you can walk under. Under an orthogonal one
  every voxel is at level zero already — `levelHeight` is 0 there — so the
  whole shape is a collider and nothing needed a second rule to say so.
- **Anything else** — an import, a converted sketch, a converted fill — has
  only its artwork, so the default is the spaces its **base** covers. On a
  square grid that is the whole picture: a sprite there occupies what it is
  drawn over, and a side-on project wants its full height as ground anyway.
  On a diamond grid it is the bottom tile-height of it, which is the same rule
  the extrusion gets, read for flat artwork — the projection puts *away* up
  the screen, so a 64 × 96 tower sweeps its bounding box across fourteen
  diamonds, thirteen of them the hillside behind it. Within that strip a space
  counts when its **middle** is under the artwork rather than when the two
  merely overlap, because a diamond the base clips a corner off is a space
  beside the tower, and blocking it is what makes a character stop a tile
  short of everything. The middle can miss every space — a picture smaller
  than one, dropped between four — so the space under the middle of the base
  is the floor: a collider is never empty for want of a rounding. Past
  `MAX_COLLIDER_CELLS` the whole thing falls back to the box, because a
  default derived from something somebody resized to the width of a continent
  should not be a hundred thousand records.

Blocking, in every case. A placed thing being solid is what makes the toggle
worth having — a document where nothing collides until each file has been
visited one at a time is the state this exists to end — and it is the default
a fresh fill already takes.

`edited` is what keeps the two halves apart. A default is a guess that has not
been corrected yet, so it is recomputed whenever the thing it was guessed from
changes: the artwork's footprint on a re-import, the solid's ground on a
second Apply. An edited collider is somebody's answer, and neither of those is
a reason to throw it away. Apply sets it only when the shape actually differs
from the default, so drawing a space and rubbing it out again leaves a default
that still follows its artwork.

## Collider mode

Extrude mode one dimension down, and deliberately the same shape: a scrim, a
bar along the bottom, the mode owning the pointer while it is up, and nothing
reaching the document until Apply. `game/collider-mode.ts` holds the spaces in
absolute grid coordinates because that is what the pointer hands over; Apply
turns them back into offsets.

What differs is the middle of the bar. Extrude's toggles describe the *view* —
see through the shape, rub spaces out — and these describe the *edit*: Add and
Remove are a pair with a pressed state because one of them is always true, and
Reset is a plain button because it happens once and is over. The dim is
lighter than extrude mode's, because there the solid replaces what is under it
and here the artwork *is* what you are aiming at.

Both tools are idempotent, and that is load-bearing rather than tidy: the
gesture arbiter reports a press that never moved as a drag **and** as a tap,
so a click paints the same space twice. Adding an added space or removing a
removed one has to be nothing, or every click would undo itself.

The mode is refused where the grid does not snap, as extrude mode is, and the
inspector replaces the button with the reason rather than offering it and
declining.

**`game/canvas-modes.ts` is what asks them.** Four modes that own the canvas
now, entered from places that have no reason to know about each other — the
floating action bar, a row of the inspector, a row of a PSD's layer list, a
pattern layer's own panel — so entering one leaves the others there rather than
by convention. It is also the one place the scene asks "has a mode claimed this
gesture": call sites deciding for themselves is how a mode ends up owning drags
but not taps.

## What reads it

**The game does, and nothing else.** Play runs the project's own code over
`game.config.json`, which is regenerated on every save, so there is one
implementation of what a collider means rather than one in the editor and
another in the export. `grid.js` turns a collider into spaces or boxes —
`colliderCells` and `colliderBoxes` — and the two scaffolds that write a
character read it the way each needs to: a top-down `shared/character.js` builds the blocked set once when it
spawns, because `isWalkable` runs per node of every search and the document
does not change under a running game, and `physics.js` adds the boxes to the
ground the character stands on. A Blank PSD to Phaser or a Vanilla project
carries the same colliders in its config and reads none of them, because what
would read them is the part it does not scaffold.

Spaces are taken as spaces wherever the document has them. Reducing an
isometric diamond to its bounding box first would block the neighbours its
corners reach into, so only a project whose grid does not snap goes through
boxes — and there the collider *is* a box.

`game_config.rs` decides **which** placement carries it: a collider rides on
the first placement of each unit and on none of the others, so a PSD placed as
three layers contributes its ground once rather than three times. What Rust
does not do is the arithmetic. The offsets and the anchor travel unresolved,
because adding them up needs the projection and the projection lives in
`grid.js` — resolving in Rust would mean a second copy of `cellToWorld` to
keep in step with the one the game already has.

A collider is document-level, beside the extrusions and for the same reason: a
PSD can stand in more than one scene and blocks the same spaces in each. So
the export hands every scene the same map, and the backfill on open covers
every scene's keys rather than the open scene's — a file standing somewhere
nobody has looked at this session is still in the published game.
