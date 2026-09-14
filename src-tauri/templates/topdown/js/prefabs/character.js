import { findPath } from "../shared/navigation.js";

/**
 * The character, and how it gets about.
 *
 * A prefab rather than a method on the scene, because this is the part of the
 * template most likely to become something else: a sprite instead of a
 * rectangle, a run of animations, a party of four. The scene's job is the
 * document — what is placed where, and which spaces are blocked — and this
 * one's is whatever stands on it.
 *
 * It is also the part New Game can leave out. A project created with the
 * character controller unchecked has no `prefabs/` directory and no
 * `spawnCharacter` in its scene; everything else about the scene is the same,
 * so writing your own is a matter of adding one back.
 *
 * `isWalkable` is handed in rather than read from the config here: the scene
 * resolves the colliders once, and the search asks that question once per
 * node.
 */
export function createCharacter(scene, { grid, nav, start, isWalkable }) {
  const world = nav.cellToWorld(start.cx, start.cy);
  const sprite = scene.add
    .rectangle(world.x, world.y, grid.size * 0.3, grid.size * 0.5, 0x201e1d)
    // In front of everything, which is the right answer on a flat projection
    // and a placeholder on an isometric one: there the scene re-sorts it as it
    // walks, so it goes behind what it is standing behind. See
    // `sortCharacter` in the scene.
    .setDepth(1e6);

  return {
    sprite,

    /**
     * The space it is standing on **now**, read off the sprite.
     *
     * Not a field holding where it is walking to. The two are the same only
     * when it is not walking, and the difference is visible: a second tap
     * mid-walk would path from the destination rather than from the character,
     * so it would set off diagonally towards a route it was not on.
     */
    get cell() {
      return nav.worldToCell(sprite.x, sprite.y);
    },

    /**
     * Walk to a space, around whatever is in the way.
     *
     * A\* over the navigation lattice, then one tween per step so the walk
     * follows the path rather than sliding through the corner of a wall. A
     * second call replaces the first: the tweens are killed, not queued, and
     * the new path starts from wherever the first one had got to.
     */
    moveTo(goal) {
      const path = findPath(isWalkable, this.cell, goal);
      if (!path || path.length < 2) return;

      scene.tweens.killTweensOf(sprite);
      const steps = path.slice(1).map((step) => {
        const at = nav.cellToWorld(step.cx, step.cy);
        return { x: at.x, y: at.y, duration: 180 };
      });
      scene.tweens.chain({ targets: sprite, tweens: steps });
    },
  };
}
