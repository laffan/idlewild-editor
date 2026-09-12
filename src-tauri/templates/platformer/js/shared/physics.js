// Side-on physics. The project's own copy, and the only one: Play runs this
// file rather than a second implementation in the editor, so a project plays
// the same way inside the editor and out of it by construction.
//
// Hand-rolled rather than taken from Arcade: what a platformer needs from a
// body is an AABB swept against a list of rectangles, and keeping it in a
// file of the project's own makes it something to change rather than a plugin
// to configure around.

export const GRAVITY = 2200;
export const MOVE_SPEED = 260;
export const JUMP_SPEED = 720;
export const MAX_FALL = 1400;
export const FALL_LIMIT = 4000;
/**
 * The hair of clearance a resolved collision leaves.
 *
 * Landing exactly flush puts the body's edge on the solid's edge, and
 * `192 - 25.6 + 25.6` is not reliably 192 — so on the next frame the body is
 * a billionth of a pixel inside the floor it is standing on, the horizontal
 * pass finds an overlap, and a character standing still is fired out of the
 * side of the ground.
 */
const SKIN = 0.001;

/** A character. x/y are its centre, which is where Phaser draws a rect. */
export function createBody(x, y, width, height) {
  return {
    x,
    y,
    width,
    height,
    vx: 0,
    vy: 0,
    onGround: false,
    spawnX: x,
    spawnY: y,
  };
}

/**
 * The ground, read out of the document.
 *
 * A fill marked not-walkable, a boundary marked blocking and a placed PSD's
 * collider are the three things a top-down project routes *around*; side-on
 * they are what you stand on. A boundary is reduced to its bounding box, and
 * so is each space of a collider — collisions here are boxes, and a sloped
 * polygon or an isometric diamond resolved as a box is at least predictable.
 *
 * A collider rides on the first placement of each unit, so a PSD placed as
 * three layers contributes its ground once rather than three times.
 */
export function solidsFromDocument(grid, layers) {
  const solids = [];
  for (const layer of layers ?? []) {
    if (layer.visible === false) continue;

    for (const fill of layer.fills ?? []) {
      if (fill.walkable) continue;
      for (const box of grid.fillBoxes(fill)) solids.push(box);
    }

    for (const placement of layer.placements ?? []) {
      const collider = placement.collider;
      if (!collider || !collider.blocking) continue;
      for (const box of grid.colliderBoxes(collider, placement.anchor)) {
        solids.push(box);
      }
    }

    for (const zone of layer.zones ?? []) {
      if (!zone.blocking || (zone.points ?? []).length < 3) continue;
      solids.push(polygonBounds(zone.points));
    }
  }
  return solids;
}

function polygonBounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Advance the body by `dt` seconds.
 *
 * The two axes are moved and resolved separately, which is what stops a body
 * sliding along a wall from catching on the seam between two boxes.
 */
export function stepBody(body, solids, input, dt) {
  const direction = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  body.vx = direction * MOVE_SPEED;
  if (input.jump && body.onGround) body.vy = -JUMP_SPEED;
  body.vy = Math.min(body.vy + GRAVITY * dt, MAX_FALL);

  // Skipped when nothing moved horizontally: with no direction to push out
  // *along*, "which side of this solid am I on" has no answer, and a body
  // resting on a wide floor would be sent to one end of it.
  if (body.vx !== 0) {
    body.x += body.vx * dt;
    for (const solid of solids) {
      if (!overlaps(body, solid)) continue;
      body.x =
        body.vx > 0
          ? solid.x - body.width / 2 - SKIN
          : solid.x + solid.width + body.width / 2 + SKIN;
      body.vx = 0;
    }
  }

  body.onGround = false;
  body.y += body.vy * dt;
  for (const solid of solids) {
    if (!overlaps(body, solid)) continue;
    if (body.vy > 0) {
      body.y = solid.y - body.height / 2 - SKIN;
      body.onGround = true;
    } else {
      body.y = solid.y + solid.height + body.height / 2 + SKIN;
    }
    body.vy = 0;
  }

  // A project with nothing under the spawn drops for ever otherwise, which
  // reads as the play button having done nothing.
  if (body.y - body.spawnY > FALL_LIMIT) respawn(body);
}

export function respawn(body) {
  body.x = body.spawnX;
  body.y = body.spawnY;
  body.vx = 0;
  body.vy = 0;
  body.onGround = false;
}

function overlaps(body, solid) {
  return (
    body.x + body.width / 2 > solid.x &&
    body.x - body.width / 2 < solid.x + solid.width &&
    body.y + body.height / 2 > solid.y &&
    body.y - body.height / 2 < solid.y + solid.height
  );
}
