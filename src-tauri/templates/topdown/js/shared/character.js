// The character, and what stops it. Seen from above.
//
// This file is the editor's, as `canvas.js` is: it holds the wiring between
// the document and whatever walks it — where play begins, which spaces are
// blocked, and where the thing standing on one belongs in the draw order. The
// character *itself* is `js/prefabs/character.js`, which is yours: the body,
// the walk and the artwork are all in there.
//
// A scene calls two of these — `spawnCharacter` in `create` and
// `updateCharacter` in `update` — and both do nothing at all when Project
// Options has the character turned off. That is the whole of what the switch
// does: no code is written or taken away, the two calls simply answer no, and
// the scene that was scaffolded with them still runs.
//
// Lines between an `idlewild:begin` and its `idlewild:end` are the editor's,
// with a Reset beside each in the code modal.

import { createGrid } from "./grid.js";
import { createCharacter } from "../prefabs/character.js";
import { sceneOf, layersOf } from "./canvas.js";
import config from "../game.config.json" with { type: "json" };

/**
 * Where the character starts, and what walks there.
 *
 * The scene's start point is the space the editor's Point tool designated,
 * or the origin when it has none. Every point in the scene is in its
 * `layers[].points` beside it — an id, a name and a cell — so a door, a
 * trigger or a second spawn is a matter of finding the one you named and
 * reading its cell.
 *
 * `config.character` is the switch in Project Options. Off, this returns null
 * and the scene runs without one — which is the same scene file either way,
 * so turning it back on is a save rather than a rewrite.
 */
// idlewild:begin spawnCharacter
export function spawnCharacter(scene) {
  if (config.character === false) return null;
  readColliders(scene);
  // A project with no lattice has nothing to path on, so it walks a square
  // one of the project's nominal unit — the grid scale chosen in New Game,
  // which is what that setting is for on a template that does not snap.
  scene.nav = scene.grid.snaps ? scene.grid : createGrid("orthogonal", config.grid);

  const start = sceneOf(scene)?.spawn ?? config.spawn ?? { cx: 0, cy: 0 };
  scene.character = createCharacter(scene, {
    grid: scene.grid,
    nav: scene.nav,
    start,
    isWalkable: (cx, cy) => isWalkable(scene, cx, cy),
  });
  scene.cameras.main.startFollow(scene.character.sprite, true, 0.12, 0.12);
  sortCharacter(scene);

  // A tap walks it there, around whatever is in the way. Holding an arrow
  // nudges it directly instead — see `step` in the prefab.
  scene.input.on("pointerup", (pointer) => {
    const world = scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    scene.character.moveTo(scene.nav.worldToCell(world.x, world.y));
  });
  return scene.character;
}
// idlewild:end spawnCharacter

/** One frame of the walk, and where it leaves the character in the stack. */
// idlewild:begin updateCharacter
export function updateCharacter(scene, delta) {
  if (!scene.character) return;
  // Held arrow keys, which move it off any path it was walking — see
  // `step` in the prefab. A tap still walks it there over A*.
  scene.character.step(delta);
  // And where it is decides what it draws in front of, so it is re-sorted
  // as it goes. A no-op on a flat projection.
  sortCharacter(scene);
}
// idlewild:end updateCharacter

/**
 * Put the character where it belongs in the isometric ordering.
 *
 * Nothing happens on a flat projection: the placements there are in the
 * order they were put down rather than in any order a position could be
 * compared against, so the character keeps the depth the prefab gave it and
 * draws in front of everything. Sorting a flat top-down game on Y is a real
 * thing to want, and it is a change to `drawOrder` as much as to this.
 *
 * `walkAmong` is what `placeDocument` left behind: the layer the character
 * sorts among, and the line each placement on it sits behind.
 */
// idlewild:begin sortCharacter
export function sortCharacter(scene) {
  if (!scene.walkAmong || !scene.character) return;
  // The bottom of its artwork, not the middle of it — see `groundOf`.
  scene.character.sprite.setDepth(
    walkDepth(scene.walkAmong, groundOf(scene.character)),
  );
}
// idlewild:end sortCharacter

/**
 * The spaces placed PSDs block, worked out once.
 *
 * A collider rides on the first placement of each unit, as offsets from the
 * space that unit hangs from — the editor stores it that way so a file can
 * be dropped twice and block the same shape both times. Resolving them here
 * rather than inside `isWalkable` matters: that runs once per node of every
 * search, and the document does not change while a published game is
 * running.
 *
 * Cells where there are cells, boxes where there are not. On a snapping
 * project the character walks the same lattice the collider was drawn on,
 * so the spaces *are* the answer — and reducing an isometric diamond to its
 * box first would block the neighbours its corners reach into.
 *
 * This and `isWalkable` are facts about the document rather than about the
 * character, so call them yourself if you write something else that walks.
 */
// idlewild:begin readColliders
export function readColliders(scene) {
  scene.blockedCells = new Set();
  scene.colliderBoxes = [];
  for (const layer of layersOf(scene)) {
    if (layer.visible === false) continue;
    for (const placement of layer.placements ?? []) {
      const collider = placement.collider;
      if (!collider || !collider.blocking) continue;
      if (scene.grid.snaps && !collider.rect) {
        for (const cell of scene.grid.colliderCells(collider, placement.anchor)) {
          scene.blockedCells.add(`${cell.cx},${cell.cy}`);
        }
      } else {
        scene.colliderBoxes.push(
          ...scene.grid.colliderBoxes(collider, placement.anchor),
        );
      }
    }
  }
}

export function isWalkable(scene, cx, cy) {
  const span = config.gridSpan ?? 24;
  if (Math.abs(cx) > span || Math.abs(cy) > span) return false;
  if (scene.blockedCells.has(`${cx},${cy}`)) return false;

  const centre = scene.nav.cellCentre(cx, cy);
  for (const box of scene.colliderBoxes) {
    if (contains(box, centre)) return false;
  }
  for (const layer of layersOf(scene)) {
    for (const fill of layer.fills ?? []) {
      if (fill.walkable) continue;
      for (const box of scene.grid.fillBoxes(fill)) {
        if (contains(box, centre)) return false;
      }
    }
  }
  return true;
}

function contains(box, p) {
  // Half-open, so a point on a shared edge belongs to one box rather than to
  // both — otherwise a run of adjacent fills blocks a cell either side of it.
  return (
    p.x >= box.x &&
    p.x < box.x + box.width &&
    p.y >= box.y &&
    p.y < box.y + box.height
  );
}
// idlewild:end readColliders

/**
 * Where something standing at screen `y` sorts among a layer's placements.
 *
 * Everything on that layer is already in a list ordered by its **nearest
 * ground point** — the bottom of its artwork, which is the corner of its
 * footprint closest to the camera, and the line straight up from that corner
 * is where passing it stops meaning behind and starts meaning in front. See
 * `drawOrder` in `canvas.js`. `placeDocument` keeps those numbers as it
 * places, so finding a character's place in the order is finding where its
 * own ground point belongs among them.
 *
 * Plain world Y on both sides, which is what makes it one comparison rather
 * than a projection. An object's is the bottom of what it drew; a character's
 * is where it is standing — `sprite.y`, which for the template's centred
 * rectangle is the middle of the space it is on, and for a sprite given its
 * feet as an origin is the feet. Both are the point it touches the ground at,
 * which is the only thing being compared.
 *
 * **The position comes off the sprite, not off a cell.** A character's `cell`
 * is as much where it is walking *to* as where it is, and one taking its depth
 * from its destination would pop behind the tree it is about to pass the
 * moment you tapped. The sprite's own Y moves with the tween, so it slides
 * through the ordering rather than snapping through it a space at a time.
 *
 * A binary search rather than a scan, because this runs every frame and the
 * list is everything on the layer. `<=` counts a placement level with the
 * character as behind it, which is the right way round: level means beside,
 * and the thing you are beside is the thing you have drawn past.
 *
 * The sliver it is nudged down by keeps it out of anybody else's slot, and it
 * has to be a sliver rather than a half. Placement `k` sits at `base + k`, and
 * `applyDepth` spaces the parts of a multi-layer PSD across the *whole*
 * interval above it — `(rank + 1) / (parts + 1)`, which for a three-layer
 * building is 0.25, 0.5 and 0.75. So half a step down from `base + k` is not
 * the gap between two placements, it is the gap between somebody's walls and
 * their roof, and a character put there is drawn inside the building. A
 * thousandth clears the highest part any PSD short of a thousand layers can
 * have, and at `k = 0` it lands just under `base`, which is why a fill sits a
 * whole step below at `base - 1`.
 */
// idlewild:begin walkDepth
/**
 * Where a thing that walks touches the ground: the bottom of its artwork.
 *
 * Not `sprite.y`, which for anything drawn from its middle is half its height
 * up the screen — and half the template's character is exactly one isometric
 * row, because the rectangle is half a space tall and a row is half a tile.
 * Sorted on its middle the character reads as standing a row further from the
 * camera than it is, so it stays behind things it has already walked past,
 * which at a glance looks like it is behind everything.
 *
 * The number it is compared against is the near vertex of the outermost space
 * a unit's collider covers — the bottom of that footprint — so the character's
 * has to be the bottom of its own. The template's rectangle is drawn centred
 * on the space it stands on and is half a space tall, so its bottom edge lands
 * exactly on that space's near vertex. That is what makes the two comparable
 * at all, and it is the thing to preserve when the rectangle is replaced.
 *
 * A prefab that draws something else says so with a numeric `ground`, which
 * wins. Two cases want it: artwork with empty space under the feet, which
 * sorts late by however much of it there is, and a sprite given its *feet* as
 * its origin — whose bottom edge is the middle of the space rather than the
 * near vertex of it, which is a row short.
 */
export function groundOf(character) {
  if (typeof character.ground === "number") return character.ground;
  const sprite = character.sprite;
  const height = sprite.displayHeight ?? 0;
  const originY = sprite.originY ?? 0.5;
  return sprite.y + height * (1 - originY);
}

export function walkDepth(among, y) {
  const near = among.near;
  let low = 0;
  let high = near.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (near[mid] <= y) low = mid + 1;
    else high = mid;
  }
  // Just under the placement it goes behind, which is just over everything of
  // the placement it goes in front of.
  return among.base + low - 0.001;
}
// idlewild:end walkDepth
