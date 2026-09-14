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
 *
 * **Two ways to move it**, and they are not alternatives. Tapping the ground
 * walks there over A\*, which is the game; holding an arrow key nudges it
 * directly, which is not. Free movement goes where a path cannot — half a
 * space into a doorway, right up against the edge of a building — and that is
 * what you want when you are checking whether the thing you drew sorts the way
 * you meant it to.
 */
export function createCharacter(scene, { grid, nav, start, isWalkable }) {
  const world = nav.cellToWorld(start.cx, start.cy);
  // Half a space tall and centred on the space it stands on, which is not an
  // arbitrary shape: its bottom edge then lands exactly on that space's near
  // vertex, and on an isometric map that edge is what sorts it — see
  // `groundOf` in the scene. Draw something taller from its middle and it
  // sorts as though it were standing further forward; draw it from its feet
  // and it sorts a row short. Either is fixed by putting a numeric `ground`
  // on what this returns, which `groundOf` takes over its own arithmetic.
  const sprite = scene.add
    .rectangle(world.x, world.y, grid.size * 0.3, grid.size * 0.5, 0x201e1d)
    // In front of everything, which is the right answer on a flat projection
    // and a placeholder on an isometric one: there the scene re-sorts it as it
    // walks, so it goes behind what it is standing behind. See
    // `sortCharacter` in the scene.
    .setDepth(1e6);
  const keys = bindArrows(scene);

  return {
    sprite,
    keys,

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

    /**
     * One frame of held arrow keys, in **screen** directions.
     *
     * Screen rather than grid, which is the choice worth naming. On an
     * isometric map the grid axes run diagonally, so a keyboard bound to them
     * moves the character in directions the arrows are not pointing — and the
     * thing this is for is sliding along a boundary you are looking at. Up is
     * up the screen, which on an isometric grid is also *away*, which is
     * exactly the axis the sorting turns on.
     *
     * A held key takes the character off any path it was walking, because two
     * things moving one sprite is a sprite that jitters between them.
     *
     * Each axis is committed separately and only onto walkable ground, so a
     * character pushed into a wall slides along it instead of stopping dead —
     * and can be parked anywhere inside a space rather than on its middle,
     * which is the whole point.
     *
     * `delta` is clamped because a tab left in the background hands back one
     * enormous frame, and a step taken by it crosses the map.
     */
    step(delta) {
      const dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      const dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
      if (dx === 0 && dy === 0) return;

      scene.tweens.killTweensOf(sprite);
      // Normalised, so a diagonal is not half again as fast as a straight line.
      const length = Math.hypot(dx, dy) || 1;
      const travel = (NUDGE_SPACES * grid.size * Math.min(delta, 50)) / 1000;
      const stepX = (dx / length) * travel;
      const stepY = (dy / length) * travel;

      const open = (x, y) => {
        const cell = nav.worldToCell(x, y);
        return isWalkable(cell.cx, cell.cy);
      };
      if (stepX !== 0 && open(sprite.x + stepX, sprite.y)) sprite.x += stepX;
      if (stepY !== 0 && open(sprite.x, sprite.y + stepY)) sprite.y += stepY;
    },
  };
}

/** How many grid spaces a second a held arrow moves the character. */
const NUDGE_SPACES = 3;

/**
 * The four arrows, and WASD beside them.
 *
 * A set of flags read once a frame rather than a callback that moves anything:
 * what a key means is the character's business, and a keyboard that wrote
 * positions directly would fight the tween a tap starts.
 */
function bindArrows(scene) {
  const keys = { left: false, right: false, up: false, down: false };
  const map = {
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right",
    ArrowUp: "up",
    KeyW: "up",
    ArrowDown: "down",
    KeyS: "down",
  };

  scene.input.keyboard.on("keydown", (event) => {
    const action = map[event.code];
    if (!action) return;
    event.preventDefault();
    keys[action] = true;
  });
  scene.input.keyboard.on("keyup", (event) => {
    const action = map[event.code];
    if (!action) return;
    keys[action] = false;
  });

  return keys;
}
