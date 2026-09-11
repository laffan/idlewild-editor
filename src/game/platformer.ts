/**
 * Side-on physics: one body, a list of solids, and a step.
 *
 * Kept pure and free of Phaser so the awkward parts — landing on a ledge,
 * walking into a wall, catching a corner between two boxes — are tested
 * without a canvas, the same bargain `game/resize.ts` makes.
 *
 * Hand-rolled rather than taken from Arcade physics. The editor's scene reads
 * the document every frame and owns its own gesture arbiter; adding a physics
 * world would mean keeping a body in step with every fill and boundary as
 * they are dragged around. What a platformer actually needs is an AABB swept
 * against a list of rectangles, which is this file.
 *
 * `src-tauri/templates/platformer/js/physics.js` is the same maths for the
 * exported game. Keep the two in step.
 */

import { colliderBoxes, documentColliders } from "../lib/collider";
import type { Grid } from "../lib/grid";
import type { Collider, Layer, Rect } from "../lib/types";

/** Pixels per second squared. Tuned against a 64px grid. */
export const GRAVITY = 2200;
export const MOVE_SPEED = 260;
export const JUMP_SPEED = 720;
/** Terminal velocity, so a long fall stays resolvable against thin ground. */
export const MAX_FALL = 1400;
/** How far past the spawn a fall goes before the character is put back. */
export const FALL_LIMIT = 4000;
/**
 * The hair of clearance a resolved collision leaves.
 *
 * Landing exactly flush puts the body's edge on the solid's edge, and
 * `192 - 25.6 + 25.6` is not reliably 192 — so on the next frame the body is
 * a billionth of a pixel inside the floor it is standing on, the horizontal
 * pass finds an overlap, and a character standing still is fired out of the
 * side of the ground. Landing a thousandth of a pixel clear costs nothing
 * anyone can see and removes the whole class of it.
 */
const SKIN = 0.001;

/** Held movement. The editor's play pad and the keyboard both write this. */
export interface PlayInput {
  left: boolean;
  right: boolean;
  jump: boolean;
}

/** A character. `x`/`y` are its centre, which is where Phaser draws a rect. */
export interface Body {
  x: number;
  y: number;
  width: number;
  height: number;
  vx: number;
  vy: number;
  onGround: boolean;
  spawnX: number;
  spawnY: number;
}

export function createBody(
  x: number,
  y: number,
  width: number,
  height: number,
): Body {
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
 * they are what you stand on. One document, read as a floor plan or as a
 * cross-section — which is the whole of what the genre changes.
 *
 * A boundary is reduced to its bounding box, and so is each space of a
 * collider. A platformer's collisions are boxes, and a sloped polygon — or an
 * isometric diamond — resolved as a box is at least predictable; resolving
 * against the shape itself is a different feature.
 *
 * `colliders` is the document's own map, keyed by PSD key. The exported
 * game's copy of this function takes them off each placement instead, because
 * `game_config.json` resolves them at export time — see `game_config.rs`.
 */
export function solidsFromDocument(
  grid: Grid,
  layers: readonly Layer[],
  colliders?: Record<string, Collider>,
): Rect[] {
  const solids: Rect[] = [];
  for (const layer of layers) {
    if (!layer.visible) continue;

    for (const fill of layer.fills) {
      if (fill.walkable) continue;
      if (fill.rect) {
        solids.push(fill.rect);
        continue;
      }
      for (const cell of fill.cells) solids.push(polygonBounds(grid.cellPolygon(cell)));
    }

    for (const zone of layer.zones) {
      if (!zone.blocking || zone.points.length < 3) continue;
      solids.push(polygonBounds(zone.points));
    }
  }

  // One unit at a time rather than one placement: a PSD placed as three
  // layers is three rectangles in the document and one thing on the grid.
  for (const placed of documentColliders(layers, colliders)) {
    solids.push(...colliderBoxes(grid, placed.collider, placed.anchor));
  }
  return solids;
}

function polygonBounds(points: readonly { x: number; y: number }[]): Rect {
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
 * sliding along a wall from catching on the seam between two boxes: by the
 * time the vertical move is resolved the horizontal one has already been
 * pushed clear, so there is no diagonal overlap left to guess about.
 */
export function stepBody(
  body: Body,
  solids: readonly Rect[],
  input: PlayInput,
  dt: number,
): void {
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

export function respawn(body: Body): void {
  body.x = body.spawnX;
  body.y = body.spawnY;
  body.vx = 0;
  body.vy = 0;
  body.onGround = false;
}

function overlaps(body: Body, solid: Rect): boolean {
  return (
    body.x + body.width / 2 > solid.x &&
    body.x - body.width / 2 < solid.x + solid.width &&
    body.y + body.height / 2 > solid.y &&
    body.y - body.height / 2 < solid.y + solid.height
  );
}
