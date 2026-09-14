/**
 * The one boolean the shape editor has, checked against the cases it is
 * actually asked for: a bite out of a corner, a clip that misses, a clip that
 * swallows, and a cut that splits a shape in two.
 *
 * Area rather than vertex lists, because a correct difference can come back
 * starting at any of its corners and the algorithm is free to choose — a test
 * that pinned the order would fail on a rewrite that was right.
 */

import { describe, expect, it } from "vitest";
import { polygonDifference, signedArea } from "../polygon-ops";
import type { Point } from "../types";

const box = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const area = (rings: Point[][]): number =>
  rings.reduce((total, ring) => total + Math.abs(signedArea(ring)), 0);

describe("polygonDifference", () => {
  it("takes a bite out of a corner", () => {
    const result = polygonDifference(box(0, 0, 10, 10), box(5, 5, 15, 15));
    expect(result).toHaveLength(1);
    expect(area(result)).toBeCloseTo(75, 6);
  });

  it("leaves the subject alone when the clip misses it", () => {
    const result = polygonDifference(box(0, 0, 10, 10), box(20, 20, 30, 30));
    expect(area(result)).toBeCloseTo(100, 6);
  });

  it("returns nothing when the clip swallows the subject", () => {
    expect(polygonDifference(box(2, 2, 8, 8), box(0, 0, 10, 10))).toEqual([]);
  });

  it("cuts a strip across, leaving two pieces", () => {
    const result = polygonDifference(box(0, 0, 10, 10), box(-5, 4, 15, 6));
    expect(result).toHaveLength(2);
    expect(area(result)).toBeCloseTo(80, 6);
  });

  it("keeps a clip that only clips one edge as one ring", () => {
    const result = polygonDifference(box(0, 0, 10, 10), box(-5, -5, 5, 15));
    expect(result).toHaveLength(1);
    expect(area(result)).toBeCloseTo(50, 6);
  });
});
