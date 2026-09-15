/**
 * The box a pasted raster is cropped to.
 *
 * The decode and the re-encode are the browser's and are not exercised here —
 * there is no DOM in this suite — so what is pinned is the arithmetic, which
 * is the half that can be wrong without anything throwing. Three ways it
 * goes wrong quietly: an off-by-one that shaves the last row of ink off every
 * paste, a threshold that eats a soft edge, and a buffer with nothing in it
 * cropped to 0 × 0 instead of being left alone.
 */

import { describe, expect, it } from "vitest";
import { opaqueBounds } from "../trim-alpha";

/**
 * An RGBA buffer of `width` × `height` with the given boxes filled in.
 *
 * Alpha is what this is about, so that is all a box carries.
 */
function pixels(
  width: number,
  height: number,
  boxes: Array<{ x: number; y: number; width: number; height: number; a?: number }>,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const box of boxes) {
    for (let y = box.y; y < box.y + box.height; y++) {
      for (let x = box.x; x < box.x + box.width; x++) {
        data[(y * width + x) * 4 + 3] = box.a ?? 255;
      }
    }
  }
  return data;
}

describe("the box a paste is cropped to", () => {
  it("is the ink, not the document it was copied out of", () => {
    // The shape of the actual complaint: a small patch somewhere inside a
    // field of transparency the size of somebody else's canvas.
    const data = pixels(100, 80, [{ x: 30, y: 20, width: 10, height: 5 }]);
    expect(opaqueBounds(data, 100, 80)).toEqual({
      x: 30,
      y: 20,
      width: 10,
      height: 5,
    });
  });

  it("keeps the last row and column of it", () => {
    // Inclusive bounds. Off by one here takes a pixel off the right and the
    // bottom of every paste, which nobody would ever report and everybody
    // would eventually notice.
    const data = pixels(4, 4, [{ x: 0, y: 0, width: 4, height: 4 }]);
    expect(opaqueBounds(data, 4, 4)).toEqual({ x: 0, y: 0, width: 4, height: 4 });
  });

  it("holds every scattered mark, not just the first", () => {
    const data = pixels(20, 20, [
      { x: 2, y: 3, width: 1, height: 1 },
      { x: 15, y: 11, width: 1, height: 1 },
    ]);
    expect(opaqueBounds(data, 20, 20)).toEqual({
      x: 2,
      y: 3,
      width: 14,
      height: 9,
    });
  });

  it("counts a barely-there pixel as ink", () => {
    // The feathered edge of a brush stroke is alpha 1 at its outermost, and a
    // threshold would crop it off every pasted stroke.
    const data = pixels(10, 10, [{ x: 4, y: 4, width: 2, height: 2, a: 1 }]);
    expect(opaqueBounds(data, 10, 10)).toEqual({ x: 4, y: 4, width: 2, height: 2 });
  });

  it("answers null for a buffer with nothing in it", () => {
    // Which is what stops an empty copy being cropped to nothing at all: the
    // caller leaves the file exactly as it arrived.
    expect(opaqueBounds(pixels(8, 8, []), 8, 8)).toBeNull();
  });

  it("answers the whole picture when nothing is transparent", () => {
    // The caller's fast path: bounds that cover the image mean there is
    // nothing to take off, so it hands the original file back unencoded.
    const data = pixels(6, 3, [{ x: 0, y: 0, width: 6, height: 3 }]);
    expect(opaqueBounds(data, 6, 3)).toEqual({ x: 0, y: 0, width: 6, height: 3 });
  });
});
