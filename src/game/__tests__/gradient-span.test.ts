/**
 * A print project's gradient spans its artboards — see `game/gradient-span.ts`.
 */

import { describe, expect, it } from "vitest";
import { gradientAt, gradientCells, spanOf } from "../gradient-span";
import { gradientCorners } from "../background-render";

describe("spanOf", () => {
  it("is the box round every artboard", () => {
    expect(spanOf([
      { x: 0, y: 0, width: 612, height: 792 },
      { x: 684, y: 0, width: 612, height: 792 },
    ])).toEqual({ x: 0, y: 0, width: 1296, height: 792 });
    expect(spanOf([])).toBeNull();
  });
});

describe("gradientAt", () => {
  const span = { x: 0, y: 0, width: 1296, height: 792 };

  it("gives each of two side-by-side artboards its own part of a left-to-right sky", () => {
    const at = gradientAt(90, span);
    expect(at(0, 400)).toBe(0);
    expect(at(612, 400)).toBeCloseTo(612 / 1296);
    expect(at(684, 400)).toBeCloseTo(684 / 1296);
    expect(at(1296, 400)).toBe(1);
  });

  it("holds the end colours past the span", () => {
    const at = gradientAt(90, span);
    expect(at(-500, 0)).toBe(0);
    expect(at(5000, 0)).toBe(1);
  });

  it("agrees with the four-corner fill at the span's own corners, at any angle", () => {
    for (const angle of [0, 30, 90, 135, 200]) {
      const at = gradientAt(angle, span);
      const corners = [at(0, 0), at(1296, 0), at(0, 792), at(1296, 792)];
      const black = "#000000";
      const white = "#ffffff";
      const fill = gradientCorners(black, white, angle).map((c) => (c & 0xff) / 255);
      corners.forEach((t, i) => expect(t).toBeCloseTo(fill[i], 2));
    }
  });
});

describe("gradientCells", () => {
  it("cuts the view along the span's edges, span first", () => {
    const cells = gradientCells({ x: -100, y: -50, width: 1500, height: 900 }, { x: 0, y: 0, width: 1296, height: 792 });
    expect(cells[0]).toEqual({ x: 0, y: 0, width: 1296, height: 792 });
    expect(cells).toHaveLength(9);
    const area = cells.reduce((sum, c) => sum + c.width * c.height, 0);
    expect(area).toBe(1500 * 900);
  });

  it("is the view alone when the view sits inside the span", () => {
    expect(gradientCells({ x: 10, y: 10, width: 50, height: 50 }, { x: 0, y: 0, width: 100, height: 100 })).toEqual([
      { x: 10, y: 10, width: 50, height: 50 },
    ]);
  });
});
