/**
 * Moving, scaling and turning strokes — see `drawing/transform.ts` and the box
 * that drives it, `drawing/transform-box.ts`.
 */

import { describe, expect, it } from "vitest";
import {
  applyPoint,
  compose,
  IDENTITY,
  invert,
  rotationAbout,
  scalingAbout,
  transformSome,
  transformStroke,
  translation,
} from "../transform";
import { scaleFrom } from "../transform-box";
import type { Stroke } from "../../lib/types";

function stroke(id: string, points: number[], extra: Partial<Stroke> = {}): Stroke {
  return { id, points, brushId: 0, size: 4, color: "#000", mode: "ink", createdAt: 0, ...extra };
}

const near = (p: { x: number; y: number }) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 });

describe("the matrices", () => {
  it("turn a quarter clockwise about a point, on a y-down screen", () => {
    expect(near(applyPoint(rotationAbout(10, 10, Math.PI / 2), 20, 10))).toEqual({ x: 10, y: 20 });
  });

  it("scale with the pivot staying put", () => {
    const m = scalingAbout(100, 50, 2, 3);
    expect(applyPoint(m, 100, 50)).toEqual({ x: 100, y: 50 });
    expect(applyPoint(m, 110, 60)).toEqual({ x: 120, y: 80 });
  });

  it("compose in the order given", () => {
    const m = compose(translation(10, 0), scalingAbout(0, 0, 2, 2));
    expect(applyPoint(m, 1, 1)).toEqual({ x: 22, y: 2 });
  });
});

describe("transformStroke", () => {
  it("moves the points and leaves the pressure, keeping the id", () => {
    const moved = transformStroke(stroke("a", [0, 0, 0.3, 10, 0, 0.9]), translation(5, 7));
    expect(moved.id).toBe("a");
    expect(moved.points).toEqual([5, 7, 0.3, 15, 7, 0.9]);
    expect(moved.size).toBe(4);
  });

  it("draws a stroke scaled up heavier, and scales a shape stamp's box", () => {
    const scaled = transformStroke(
      stroke("s", [0, 0, 1], { mode: "shape", stamp: { width: 32, height: 16 } }),
      scalingAbout(0, 0, 2, 2),
    );
    expect(scaled.size).toBe(8);
    expect(scaled.stamp).toEqual({ width: 64, height: 32 });
  });

  it("is a new list touching only what was selected", () => {
    const list = [stroke("a", [0, 0, 1]), stroke("b", [1, 1, 1])];
    const next = transformSome(list, new Set(["b"]), translation(1, 0));
    expect(next[0]).toBe(list[0]);
    expect(next[1]).not.toBe(list[1]);
    expect(next[1].points).toEqual([2, 1, 1]);
  });
});

describe("scaleFrom", () => {
  const box = { x: 0, y: 0, width: 100, height: 50 };

  it("scales in proportion about the opposite corner", () => {
    const m = scaleFrom(box, "se", { x: 200, y: 60 }, false);
    expect(applyPoint(m, 0, 0)).toEqual({ x: 0, y: 0 });
    // The drag projected onto the diagonal: (200·100 + 60·50) / (100² + 50²).
    const s = (200 * 100 + 60 * 50) / (100 * 100 + 50 * 50);
    expect(near(applyPoint(m, 100, 50))).toEqual(near({ x: 100 * s, y: 50 * s }));
  });

  it("lets each axis go its own way when free, and never turns inside out", () => {
    const free = scaleFrom(box, "nw", { x: 50, y: -50 }, true);
    expect(applyPoint(free, 100, 50)).toEqual({ x: 100, y: 50 });
    expect(near(applyPoint(free, 0, 0))).toEqual({ x: 50, y: -50 });
    const flipped = scaleFrom(box, "se", { x: -500, y: -500 }, false);
    expect(applyPoint(flipped, 100, 50).x).toBeGreaterThan(0);
  });
});

describe("invert", () => {
  it("undoes a turn, a scale and a move together", () => {
    const m = compose(compose(rotationAbout(10, 20, 0.7), scalingAbout(0, 0, 2, 3)), translation(5, -8));
    const back = compose(m, invert(m));
    back.forEach((v, i) => expect(v).toBeCloseTo(IDENTITY[i]));
  });

  it("gives the identity for a matrix with no area, rather than infinities", () => {
    expect(invert([0, 0, 0, 0, 3, 4])).toEqual(IDENTITY);
  });
});

describe("freeStampBox", () => {
  it("is a square a grid space wide, centred on the pen — what the preview and the stroke both use", async () => {
    const { freeStampBox } = await import("../tools-stamp");
    const style = { stamp: { width: 64, height: 32, diamond: true } } as Parameters<typeof freeStampBox>[0];
    expect(freeStampBox(style, 100, 50)).toEqual({ x: 68, y: 18, width: 64, height: 64 });
  });
});
