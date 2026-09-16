// The character, and what it stands on. Seen from the side.
//
// This file is the editor's, as `canvas.js` is: it holds the wiring between
// the document and whatever runs along it — where play begins, and which of
// the things in the scene are ground. The character *itself* is
// `js/prefabs/character.js`, which is yours: the body, the keyboard and the
// jump are all in there, and `shared/physics.js` is the step it takes.
//
// A scene calls two of these — `spawnCharacter` in `create` and
// `updateCharacter` in `update` — and both do nothing at all when Project
// Options has the character turned off. That is the whole of what the switch
// does: no code is written or taken away, the two calls simply answer no, and
// the scene that was scaffolded with them still runs.
//
// Lines between an `idlewild:begin` and its `idlewild:end` are the editor's,
// with a Reset beside each in the code modal.

import { createCharacter } from "../prefabs/character.js";
import { solidsFromDocument } from "./physics.js";
import { sceneOf, layersOf } from "./canvas.js";
import config from "../game.config.json" with { type: "json" };

/**
 * Where the character starts, and what runs there.
 *
 * The scene's start point is the space the editor's Point tool designated,
 * or the origin when it has none. Every point in the scene is in its
 * `layers[].points` beside it — an id, a name and a cell — so a door, a
 * trigger or a second spawn is a matter of finding the one you named and
 * reading its cell.
 *
 * `solidsFromDocument` is the other half: seen from the side, every
 * non-walkable fill, blocking boundary and placed PSD's collider is a
 * rectangle to stand on rather than an obstacle to route around.
 *
 * `config.character` is the switch in Project Options. Off, this returns null
 * and the scene runs without one — which is the same scene file either way,
 * so turning it back on is a save rather than a rewrite.
 */
// idlewild:begin spawnCharacter
export function spawnCharacter(scene) {
  if (config.character === false) return null;
  scene.solids = solidsFromDocument(scene.grid, layersOf(scene));

  const start = sceneOf(scene)?.spawn ?? config.spawn ?? { cx: 0, cy: 0 };
  scene.character = createCharacter(scene, {
    grid: scene.grid,
    start,
    solids: scene.solids,
  });
  scene.cameras.main.startFollow(scene.character.sprite, true, 0.14, 0.14);
  return scene.character;
}
// idlewild:end spawnCharacter

/** One frame of the run: gravity, the keys, and the ground under it. */
// idlewild:begin updateCharacter
export function updateCharacter(scene, delta) {
  if (!scene.character) return;
  scene.character.step(delta);
}
// idlewild:end updateCharacter

/**
 * The ground of a scene, without a character standing on it.
 *
 * A fact about the document rather than about the character, so it is here to
 * be called on its own — by a moving platform, a projectile, or whatever else
 * you write that has to know what is solid.
 */
// idlewild:begin readSolids
export function readSolids(scene) {
  scene.solids = solidsFromDocument(scene.grid, layersOf(scene));
  return scene.solids;
}
// idlewild:end readSolids
