/**
 * What a shape covers, and what moving it does to its handles.
 *
 * The curve half is the interesting one. A bezier handle is stored as an
 * *offset* from its vertex, so a translation must leave it alone and a scale
 * must take it — and the whole of `Crop` is those two applied together. Get it
 * the other way round and a cropped circle comes out as a diamond with four
 * dents in it, which is a bug you can only see by drawing.
 */

import { describe, expect, it } from "vitest";
import {
  cropShape,
  cubicAt,
  shapeBounds,
  subPathPolygon,
  transformShape,
} from "../shape-path";
import { DEFAULT_SHAPES } from "../library/shape-defs";
import type { ShapeData } from "../library/types";

const byId = (id: string): ShapeData => {
  const found = DEFAULT_SHAPES.find((s) => s.id === id);
  if (!found) throw new Error(`no shape ${id}`);
  return found;
};

const UNIT = { x: 0, y: 0, width: 1, height: 1 };

describe("what a shape covers", () => {
  it("is the whole tile for a square", () => {
    expect(shapeBounds(byId("square"))).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  /**
   * Walked rather than measured off the control points. A circle's handles
   * sit outside the curve they bend, so a bounds taken from them would be
   * about 1.1 across instead of 1.
   */
  it("is the curve for a circle, not its handles", () => {
    const box = shapeBounds(byId("circle"), 24);
    expect(box.x).toBeCloseTo(0, 2);
    expect(box.y).toBeCloseTo(0, 2);
    expect(box.width).toBeCloseTo(1, 2);
    expect(box.height).toBeCloseTo(1, 2);
  });

  it("is the bottom half for a shape that only uses it", () => {
    const box = shapeBounds(byId("bottomTriangle"));
    expect(box).toEqual({ x: 0, y: 0.5, width: 1, height: 0.5 });
  });
});

describe("moving a shape", () => {
  it("leaves a handle alone under a pure translation", () => {
    const moved = transformShape(byId("circle"), 1, 1, 0.25, 0);
    const first = moved.paths?.[0].vertices[0];
    expect(first?.x).toBeCloseTo(0.75, 6);
    // The handle is an offset, so it is the same offset after a move.
    expect(first?.ctrlRight?.x).toBeCloseTo(
      byId("circle").paths?.[0].vertices[0].ctrlRight?.x ?? 0,
      9,
    );
  });

  it("scales a handle with its vertex", () => {
    const scaled = transformShape(byId("circle"), 0.5, 0.5, 0, 0);
    const before = byId("circle").paths?.[0].vertices[0].ctrlRight?.x ?? 0;
    expect(scaled.paths?.[0].vertices[0].ctrlRight?.x).toBeCloseTo(before / 2, 9);
  });

  it("brings a small shape back out to fill the tile", () => {
    const small = transformShape(byId("smallCircle"), 1, 1, 0, 0);
    const box = shapeBounds(cropShape(small), 24);
    expect(box.x).toBeCloseTo(0, 2);
    expect(box.y).toBeCloseTo(0, 2);
    expect(box.width).toBeCloseTo(1, 2);
    expect(box.height).toBeCloseTo(1, 2);
  });

  it("leaves a shape that already fills the tile where it is", () => {
    expect(cropShape(byId("square"))).toEqual(
      transformShape(byId("square"), 1, 1, 0, 0),
    );
  });
});

describe("walking a path", () => {
  it("closes a polygon without repeating its first point", () => {
    const points = subPathPolygon(
      { vertices: byId("triangle").vertices ?? [], closed: true },
      UNIT,
    );
    expect(points).toHaveLength(3);
  });

  it("samples a curve rather than cutting the corner", () => {
    const points = subPathPolygon(byId("circle").paths?.[0] ?? { vertices: [] }, UNIT, 8);
    expect(points.length).toBeGreaterThan(24);
    // Every sample is on the unit circle, to the accuracy a cubic gives.
    for (const p of points) {
      expect(Math.hypot(p.x - 0.5, p.y - 0.5)).toBeCloseTo(0.5, 2);
    }
  });

  it("leaves an open path open", () => {
    const open = subPathPolygon({ vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: false }, UNIT);
    expect(open).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });
});

describe("a cubic", () => {
  it("is its endpoints at nought and one", () => {
    const a = { x: 0, y: 0 };
    const d = { x: 1, y: 1 };
    expect(cubicAt(a, { x: 0, y: 1 }, { x: 1, y: 0 }, d, 0)).toEqual(a);
    expect(cubicAt(a, { x: 0, y: 1 }, { x: 1, y: 0 }, d, 1)).toEqual(d);
  });
});

describe("the shapes that ship", () => {
  it("are all inside their own tile", () => {
    for (const shape of DEFAULT_SHAPES) {
      const box = shapeBounds(shape, 16);
      expect(box.x, shape.id).toBeGreaterThanOrEqual(-0.001);
      expect(box.y, shape.id).toBeGreaterThanOrEqual(-0.001);
      expect(box.x + box.width, shape.id).toBeLessThanOrEqual(1.001);
      expect(box.y + box.height, shape.id).toBeLessThanOrEqual(1.001);
    }
  });

  it("all have something to draw", () => {
    for (const shape of DEFAULT_SHAPES) {
      const box = shapeBounds(shape, 12);
      expect(box.width * box.height, shape.id).toBeGreaterThan(0.01);
    }
  });

  it("have unique ids", () => {
    const ids = DEFAULT_SHAPES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
