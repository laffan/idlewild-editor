/**
 * Corner-handle resizing for placed images.
 *
 * The maths lives here, away from the scene, so the cases that are easy to
 * get wrong — dragging past the opposite corner, the aspect lock, the
 * minimum size — are testable without a canvas.
 */

import type { Placement, Point } from "../lib/types";

/** Which corner is being dragged. */
export type Corner = "nw" | "ne" | "sw" | "se";

export const CORNERS: readonly Corner[] = ["nw", "ne", "sw", "se"];

/** Handles are drawn and hit-tested at this many screen pixels. */
export const HANDLE_SCREEN_PX = 16;

/** Smallest an image may be dragged down to, in world pixels. */
const MIN_SIZE = 8;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** World position of one corner of a box. */
export function cornerPoint(box: Box, corner: Corner): Point {
  return {
    x: corner === "nw" || corner === "sw" ? box.x : box.x + box.width,
    y: corner === "nw" || corner === "ne" ? box.y : box.y + box.height,
  };
}

/** The corner diagonally opposite — the one that stays put during a drag. */
export function oppositeCorner(corner: Corner): Corner {
  switch (corner) {
    case "nw":
      return "se";
    case "ne":
      return "sw";
    case "sw":
      return "ne";
    case "se":
      return "nw";
  }
}

/**
 * The handle under a world point, if any.
 *
 * `tolerance` is in world units — the caller divides the screen size by the
 * camera zoom so the target stays the same size to the finger at any zoom.
 */
export function handleAt(
  box: Box,
  point: Point,
  tolerance: number,
): Corner | undefined {
  const half = tolerance / 2;
  for (const corner of CORNERS) {
    const c = cornerPoint(box, corner);
    if (Math.abs(point.x - c.x) <= half && Math.abs(point.y - c.y) <= half) {
      return corner;
    }
  }
  return undefined;
}

/**
 * Resize a box by dragging one corner to `point`, keeping the opposite
 * corner fixed.
 *
 * The aspect ratio is locked to the original: a stretched sprite is almost
 * always a mistake, and the inspector's width and height fields are there
 * for the times it is not.
 */
export function resizeBox(original: Box, corner: Corner, point: Point): Box {
  const anchor = cornerPoint(original, oppositeCorner(corner));
  const aspect =
    original.height === 0 ? 1 : original.width / original.height;

  let width = Math.abs(point.x - anchor.x);
  let height = Math.abs(point.y - anchor.y);

  // Follow whichever axis the pointer pushed further, so the corner tracks
  // the finger instead of lagging on the constrained axis.
  if (height === 0 || width / height > aspect) {
    height = width / aspect;
  } else {
    width = height * aspect;
  }

  if (width < MIN_SIZE || height < MIN_SIZE) {
    if (aspect >= 1) {
      width = Math.max(MIN_SIZE, MIN_SIZE * aspect);
      height = width / aspect;
    } else {
      height = Math.max(MIN_SIZE, MIN_SIZE / aspect);
      width = height * aspect;
    }
  }

  // The dragged corner may cross the anchor; the box grows away from the
  // anchor in whichever direction the pointer actually went.
  const goesLeft = point.x < anchor.x;
  const goesUp = point.y < anchor.y;

  return {
    x: goesLeft ? anchor.x - width : anchor.x,
    y: goesUp ? anchor.y - height : anchor.y,
    width,
    height,
  };
}

/** Apply a resized box back onto a placement record. */
export function boxToPlacement(box: Box): Partial<Placement> {
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  };
}

export function placementBox(placement: Placement): Box {
  return {
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
  };
}
