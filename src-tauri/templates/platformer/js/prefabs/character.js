import { createBody, stepBody } from "../shared/physics.js";

/**
 * The character, and what the keyboard does to it.
 *
 * A prefab rather than a method on the scene, because this is the part of the
 * template most likely to become something else: a sprite instead of a
 * rectangle, a double jump, a dash. The scene's job is the document — what is
 * placed where, and which of it is ground — and this one's is whatever runs
 * along it.
 *
 * It is also the part New Game can leave out. A project created with the
 * character controller unchecked has no `prefabs/` directory and no
 * `spawnCharacter` in its scene; the document still reaches the scene the same
 * way, so writing your own is a matter of adding one back.
 *
 * `solids` is the ground the scene read out of the document, handed in once:
 * it does not change while the game is running, and the body is swept against
 * every box of it on every frame.
 */
export function createCharacter(scene, { grid, start, solids }) {
  const width = grid.size * 0.4;
  const height = grid.size * 0.8;
  const world = grid.cellCentre(start.cx, start.cy);

  const body = createBody(world.x, world.y, width, height);
  const sprite = scene.add
    .rectangle(body.x, body.y, width, height, 0x201e1d)
    .setDepth(1e6);
  const keys = bindControls(scene);

  return {
    sprite,
    body,
    keys,

    /**
     * One frame of running and jumping.
     *
     * `delta` is clamped because a tab left in the background hands back one
     * enormous frame, and a body stepped by it teleports through the floor.
     */
    step(delta) {
      stepBody(body, solids, keys, Math.min(delta, 50) / 1000);
      sprite.setPosition(body.x, body.y);
    },
  };
}

/**
 * Arrow keys and WASD.
 *
 * The keyboard and nothing else. There were three buttons pinned to the
 * viewport here for a touchscreen, and they were a guess at a game nobody has
 * written yet: a template's job is to run, not to decide what the controls of
 * your platformer look like. Adding them back is
 * `scene.add.rectangle(...).setScrollFactor(0).setInteractive()` and a pair of
 * `held.add` / `held.delete` handlers on the set below.
 */
function bindControls(scene) {
  const keys = { left: false, right: false, jump: false };
  const held = new Set();
  const map = {
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right",
    ArrowUp: "jump",
    KeyW: "jump",
    Space: "jump",
  };
  const apply = () => {
    keys.left = held.has("left");
    keys.right = held.has("right");
    keys.jump = held.has("jump");
  };

  scene.input.keyboard.on("keydown", (event) => {
    const action = map[event.code];
    if (!action) return;
    event.preventDefault();
    held.add(action);
    apply();
  });
  scene.input.keyboard.on("keyup", (event) => {
    const action = map[event.code];
    if (!action) return;
    held.delete(action);
    apply();
  });

  return keys;
}
