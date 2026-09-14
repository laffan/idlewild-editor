/**
 * Where a character sorts among the things it is walking through.
 *
 * On an isometric grid the object further down the screen is the object nearer
 * the camera, so a character standing behind a tree has to draw behind it and
 * standing in front has to draw in front — and the depth it needs is not a
 * constant, it is a place in the same ordering everything on its layer is
 * already in. `walkDepth` is that lookup, and it lives in the scaffolded
 * scene, so it is tested the way `drawOrder` is: pulled out of the template by
 * its markers and run.
 *
 * The arithmetic that matters is the sliver it is nudged down by. Placement
 * `k` sits at `base + k`, and `applyDepth` spaces the parts of a multi-layer
 * PSD across the *whole* interval above it — 0.25, 0.5 and 0.75 for a
 * three-layer building. So a depth landing on an integer, or anywhere but the
 * very top of that interval, puts the character between somebody's walls and
 * their roof. Half a step, which is the obvious number, is the worst one.
 */

import { describe, expect, it } from "vitest";
import topdownSource from "../../../src-tauri/templates/topdown/js/scenes/WorldScene.js?raw";

interface Among {
  base: number;
  rows: number[];
}

type WalkDepth = (among: Among, y: number, halfTile: number) => number;

const walkDepth = blockFrom<WalkDepth>(topdownSource, "walkDepth");

/** A layer whose placements stand on rows 0, 2, 2 and 7. */
const among: Among = { base: 4000, rows: [0, 2, 2, 7] };
/** Half a tile, which is what a row is worth in screen pixels. */
const HALF = 16;

/** The depth of a character standing on a given isometric row. */
function at(row: number): number {
  return walkDepth(among, row * HALF, HALF);
}

/**
 * How far into a placement's own interval its topmost layer sits.
 *
 * `applyDepth`'s spacing, quoted here rather than imported: the point of the
 * assertion is that the two agree, and a test that took the number from the
 * thing it is checking would agree with anything.
 */
function partOf(parts: number): number {
  return parts / (parts + 1);
}

describe("a character's place in the ordering", () => {
  it("goes behind everything when it is further from the camera than all of it", () => {
    // Row −3 is behind the first placement, which is at base + 0.
    expect(at(-3)).toBeCloseTo(3999.999, 6);
    expect(at(-3)).toBeLessThan(among.base);
  });

  it("goes in front of everything when it is nearer than all of it", () => {
    // Four placements, so in front of the last means above the whole of
    // placement 3's own interval — its parts reach up towards base + 4.
    expect(at(99)).toBeCloseTo(4003.999, 6);
    expect(at(99)).toBeGreaterThan(among.base + 3 + partOf(50));
  });

  it("walks through the ordering a placement at a time", () => {
    // Row 1 is past the first placement and short of the two on row 2.
    expect(at(1)).toBeCloseTo(4000.999, 6);
    // Row 3 is past all three of those and short of the one on row 7.
    expect(at(3)).toBeCloseTo(4002.999, 6);
  });

  /**
   * Standing *on* a thing's own space is standing in front of it: you are at
   * that space, not behind it. Both placements on row 2 are behind.
   */
  it("draws in front of whatever shares its row", () => {
    expect(at(2)).toBeCloseTo(4002.999, 6);
  });

  /**
   * The one this exists to get right, and the one a half step gets wrong.
   * A placement's own depth is an integer and `applyDepth` fills the interval
   * above it with that PSD's layers, so a character has to land above every
   * one of them and below the next integer.
   */
  it("never lands among the layers of a placed PSD", () => {
    for (let row = -10; row <= 20; row++) {
      const fraction = at(row) - Math.floor(at(row));
      // Above the topmost layer even of a fifty-layer file.
      expect(fraction).toBeGreaterThan(partOf(50));
      expect(fraction).toBeLessThan(1);
    }
  });

  /** A layer with nothing on it: still a valid depth, still above its fill. */
  it("has an answer for a layer holding nothing", () => {
    const empty = walkDepth({ base: 4000, rows: [] }, 50, HALF);
    expect(empty).toBeCloseTo(3999.999, 6);
    // Above the fill, which sits a whole step under the layer's own slot.
    expect(empty).toBeGreaterThan(4000 - 1);
  });

  /**
   * The position is continuous, so the depth moves with the tween rather than
   * snapping a space at a time — and half way between two rows is still a
   * well-defined place in the order.
   */
  it("takes a position between two spaces", () => {
    expect(walkDepth(among, 1.5 * HALF, HALF)).toBe(at(1));
    expect(walkDepth(among, 2.5 * HALF, HALF)).toBe(at(2));
  });

  /** A grid with no height is a blank projection; it must not divide by zero. */
  it("survives a projection with no tile to measure", () => {
    expect(Number.isFinite(walkDepth(among, 400, 0))).toBe(true);
  });
});

function blockFrom<T>(source: string, id: string): T {
  const lines = source.split("\n");
  const from = lines.findIndex((line) => line.trim() === `// idlewild:begin ${id}`);
  const to = lines.findIndex((line) => line.trim() === `// idlewild:end ${id}`);
  if (from < 0 || to < 0) throw new Error(`no ${id} block in the template`);
  return new Function(
    `${lines.slice(from + 1, to).join("\n")}\nreturn ${id};`,
  )() as T;
}
