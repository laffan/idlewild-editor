/**
 * The pattern lattice, which is the whole of why the Pattern brush reads as
 * *revealing* an area rather than painting one.
 *
 * Everything here is about the same claim: a pattern pixel's position is a
 * function of where it is in the world and nothing else — not of where a
 * stroke started, not of which stroke it was. Two passes over the same ground
 * therefore agree, and the tests are written as that question.
 */

import { describe, expect, it } from "vitest";
import { latticeCell, patternBit, patternScaleOf, paintIsPlain } from "../paint";
import {
  emptyPattern,
  invertPattern,
  normalisePattern,
  offsetPattern,
  resizePattern,
  type PatternData,
} from "../library/types";

/** A 2×2 with one corner set, which is enough to see every wrap and flip. */
const corner: PatternData = { size: 2, pixels: [[1, 0], [0, 0]] };

describe("the lattice", () => {
  it("puts a coordinate in the same cell either side of the origin", () => {
    // Floor rather than truncation: at zero, truncation makes the cell either
    // side of it twice as wide, and the pattern shows a double column there.
    expect(latticeCell(-0.1, 4)).toBe(-1);
    expect(latticeCell(0, 4)).toBe(0);
    expect(latticeCell(3.9, 4)).toBe(0);
    expect(latticeCell(-4, 4)).toBe(-1);
    expect(latticeCell(-4.1, 4)).toBe(-2);
  });

  it("gives the same answer for a cell however far out it is", () => {
    for (const n of [0, 2, 4, -2, -4, 1000, -1000]) {
      expect(patternBit(corner, n, n === 0 ? 0 : n)).toBe(true);
    }
  });

  it("wraps negative coordinates rather than reading past the array", () => {
    expect(patternBit(corner, -1, -1)).toBe(false);
    expect(patternBit(corner, -2, -2)).toBe(true);
  });

  it("inverts", () => {
    expect(patternBit(corner, 0, 0, true)).toBe(false);
    expect(patternBit(corner, 1, 0, true)).toBe(true);
  });
});

describe("a paint", () => {
  it("has a scale even when nothing sensible was stored", () => {
    expect(patternScaleOf(undefined)).toBe(2);
    expect(patternScaleOf({ kind: "pattern", patternScale: 0 })).toBe(2);
    expect(patternScaleOf({ kind: "pattern", patternScale: Number.NaN })).toBe(2);
    expect(patternScaleOf({ kind: "pattern", patternScale: 9 })).toBe(9);
  });

  /**
   * A document can name a row this install has never had. Everything that
   * paints asks this first and falls back to the colour, which is the one
   * answer that is never wrong.
   */
  it("is plain when it names a row nothing can find", () => {
    expect(paintIsPlain(undefined)).toBe(true);
    expect(paintIsPlain({ kind: "color" })).toBe(true);
    expect(paintIsPlain({ kind: "pattern", patternId: "pattern_nope" })).toBe(true);
    expect(paintIsPlain({ kind: "shape", shapeId: "shape_nope" })).toBe(true);
    expect(paintIsPlain({ kind: "pattern", patternId: "checkerboard" })).toBe(false);
    expect(paintIsPlain({ kind: "shape", shapeId: "circle" })).toBe(false);
  });
});

describe("a pattern grid", () => {
  it("is repaired to agree with its own size", () => {
    const ragged: PatternData = { size: 3, pixels: [[1], [1, 1, 1, 1, 1]] };
    const fixed = normalisePattern(ragged);
    expect(fixed.pixels).toEqual([
      [1, 0, 0],
      [1, 1, 1],
      [0, 0, 0],
    ]);
  });

  it("tiles rather than pads when it grows", () => {
    // A pattern is a thing that repeats, so the honest way to see it at twice
    // the resolution is to see two of it.
    expect(resizePattern(corner, 4).pixels).toEqual([
      [1, 0, 1, 0],
      [0, 0, 0, 0],
      [1, 0, 1, 0],
      [0, 0, 0, 0],
    ]);
  });

  it("keeps the top-left corner when it shrinks", () => {
    const four: PatternData = {
      size: 4,
      pixels: [
        [1, 1, 0, 0],
        [1, 0, 0, 0],
        [0, 0, 1, 1],
        [0, 0, 0, 0],
      ],
    };
    expect(resizePattern(four, 2).pixels).toEqual([
      [1, 1],
      [1, 0],
    ]);
  });

  it("wraps when it is pushed around", () => {
    expect(offsetPattern(corner, 1, 0).pixels).toEqual([[0, 1], [0, 0]]);
    expect(offsetPattern(corner, -1, 0).pixels).toEqual([[0, 1], [0, 0]]);
    expect(offsetPattern(corner, 0, 1).pixels).toEqual([[0, 0], [1, 0]]);
    expect(offsetPattern(corner, 2, 2).pixels).toEqual(corner.pixels);
  });

  it("inverts every cell and nothing else", () => {
    expect(invertPattern(corner)).toEqual({ size: 2, pixels: [[0, 1], [1, 1]] });
  });

  it("starts empty at the size it was asked for", () => {
    const blank = emptyPattern(3);
    expect(blank.size).toBe(3);
    expect(blank.pixels.flat()).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
