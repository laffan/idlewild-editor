/**
 * The pattern generator.
 *
 * The arithmetic here is load-bearing twice over: the editor draws from it,
 * and the copy written into every project's `WorldScene.js` has to agree with
 * it exactly, or Play shows a different world from the one you built. So what
 * is pinned is the *contract* both depend on — determinism, the repeat, where
 * the shapes cut, and the ceiling — rather than a screenshot of the numbers.
 */

import { describe, expect, it } from "vitest";
import {
  hash,
  patternInstances,
  tileInstances,
  type PatternElement,
} from "../pattern";
import type { Cell, PatternShape, PatternSpec } from "../types";

const tree: PatternElement = {
  path: "tree",
  psdKey: "tree",
  width: 64,
  height: 64,
  scaleX: 1,
  scaleY: 1,
  offsetX: 0,
  offsetY: 0,
};
const rock: PatternElement = { ...tree, path: "rock", psdKey: "rock" };

function spec(patch: Partial<PatternSpec> = {}): PatternSpec {
  return {
    type: "random",
    density: 4,
    repeat: { cols: 10, rows: 10 },
    seed: 1,
    shapes: [],
    ...patch,
  };
}

const everywhere = { from: { cx: 0, cy: 0 }, to: { cx: 9, cy: 9 } };

describe("a repeat tile", () => {
  it("holds exactly the density asked for", () => {
    expect(tileInstances(spec({ density: 7 }), [tree], 0, 0)).toHaveLength(7);
  });

  it("keeps every element inside the tile it belongs to", () => {
    for (const made of tileInstances(spec({ density: 20 }), [tree], 3, -2)) {
      expect(made.cell.cx).toBeGreaterThanOrEqual(30);
      expect(made.cell.cx).toBeLessThan(40);
      expect(made.cell.cy).toBeGreaterThanOrEqual(-20);
      expect(made.cell.cy).toBeLessThan(-10);
    }
  });

  it("answers the same way every time it is asked", () => {
    const once = tileInstances(spec(), [tree, rock], 4, 7);
    const again = tileInstances(spec(), [tree, rock], 4, 7);
    expect(again).toEqual(once);
  });

  it("answers differently for a different tile, which is what makes it a scatter", () => {
    const here = tileInstances(spec({ density: 8 }), [tree], 0, 0);
    const there = tileInstances(spec({ density: 8 }), [tree], 1, 0);
    const local = (list: typeof here) =>
      list.map((m) => `${m.cell.cx % 10},${m.cell.cy % 10}`).join(" ");
    expect(local(there)).not.toBe(local(here));
  });

  it("moves the whole arrangement when the seed does — what Shuffle is", () => {
    const before = tileInstances(spec({ seed: 1 }), [tree], 0, 0);
    const after = tileInstances(spec({ seed: 2 }), [tree], 0, 0);
    expect(after).not.toEqual(before);
  });

  /**
   * The one thing a grid pattern promises: the same arrangement in every
   * tile. Which element stands where still varies, so only the positions are
   * compared.
   */
  it("lays a grid pattern out identically in every tile", () => {
    const grid = spec({ type: "grid", density: 4 });
    const here = tileInstances(grid, [tree, rock], 0, 0);
    const there = tileInstances(grid, [tree, rock], 5, -3);
    expect(there.map((m) => ({ cx: m.cell.cx - 50, cy: m.cell.cy + 30 }))).toEqual(
      here.map((m) => m.cell),
    );
  });

  it("insets a grid pattern from the tile's edges, so neighbours do not pair up", () => {
    const made = tileInstances(spec({ type: "grid", density: 4 }), [tree], 0, 0);
    for (const { cell } of made) {
      expect(cell.cx).toBeGreaterThan(0);
      expect(cell.cy).toBeGreaterThan(0);
      expect(cell.cx).toBeLessThan(9);
      expect(cell.cy).toBeLessThan(9);
    }
  });
});

describe("a range of spaces", () => {
  it("is empty until something has been placed on the layer", () => {
    expect(patternInstances(spec(), [], everywhere)).toEqual([]);
  });

  it("returns only what falls inside it", () => {
    const made = patternInstances(spec({ density: 30 }), [tree], {
      from: { cx: 2, cy: 2 },
      to: { cx: 4, cy: 4 },
    });
    for (const { cell } of made) {
      expect(cell.cx).toBeGreaterThanOrEqual(2);
      expect(cell.cx).toBeLessThanOrEqual(4);
      expect(cell.cy).toBeGreaterThanOrEqual(2);
      expect(cell.cy).toBeLessThanOrEqual(4);
    }
  });

  /**
   * The whole reason the rule is evaluated a tile at a time. A space has to
   * answer the same way whether the camera arrived at it from the left or
   * from the right, or panning would re-roll the pattern under you.
   */
  it("gives a space the same answer whatever range it is asked about", () => {
    const wide = patternInstances(spec({ density: 12 }), [tree, rock], {
      from: { cx: -20, cy: -20 },
      to: { cx: 20, cy: 20 },
    });
    const narrow = patternInstances(spec({ density: 12 }), [tree, rock], {
      from: { cx: 0, cy: 0 },
      to: { cx: 5, cy: 5 },
    });
    const inside = wide.filter(
      (m) => m.cell.cx >= 0 && m.cell.cx <= 5 && m.cell.cy >= 0 && m.cell.cy <= 5,
    );
    expect(narrow).toEqual(inside);
  });

  it("stops at the ceiling rather than making thousands of objects", () => {
    const made = patternInstances(
      spec({ density: 200 }),
      [tree],
      { from: { cx: -50, cy: -50 }, to: { cx: 50, cy: 50 } },
      20,
    );
    expect(made).toHaveLength(20);
  });

  it("has a ceiling by default, for a density nobody meant to type", () => {
    const made = patternInstances(spec({ density: 200 }), [tree], {
      from: { cx: -50, cy: -50 },
      to: { cx: 50, cy: 50 },
    });
    expect(made).toHaveLength(1200);
  });

  it("gives every copy an id of its own, so the renderer can key on it", () => {
    const made = patternInstances(spec({ density: 6 }), [tree], {
      from: { cx: -10, cy: -10 },
      to: { cx: 19, cy: 19 },
    });
    expect(new Set(made.map((m) => m.id)).size).toBe(made.length);
  });
});

describe("shapes", () => {
  const shape = (cells: Cell[]): PatternShape => ({ id: "s1", name: "Shape 1", cells });

  it("go on for ever when there are none, which is the default", () => {
    const made = patternInstances(spec({ density: 4 }), [tree], everywhere);
    expect(made.length).toBeGreaterThan(0);
  });

  it("confine the pattern to the spaces they cover", () => {
    const only = { cx: 3, cy: 4 };
    const made = patternInstances(
      spec({ density: 100, shapes: [shape([only])] }),
      [tree],
      everywhere,
    );
    expect(made.length).toBeGreaterThan(0);
    for (const { cell } of made) expect(cell).toEqual(only);
  });

  it("are a union: a space inside any of them is inside", () => {
    const made = patternInstances(
      spec({
        density: 100,
        shapes: [shape([{ cx: 1, cy: 1 }]), shape([{ cx: 8, cy: 8 }])],
      }),
      [tree],
      everywhere,
    );
    const seen = new Set(made.map((m) => `${m.cell.cx},${m.cell.cy}`));
    expect(seen).toEqual(new Set(["1,1", "8,8"]));
  });

  /**
   * A shape carrying only an outline is one a hand-edited document could
   * hold: the editor bakes a drawn shape down to spaces when it is made. It
   * confines the pattern to nothing rather than silently confining it to
   * everything, which is the failure that would look like no shape at all.
   */
  it("confine the pattern to nothing when they name no spaces", () => {
    const outline: PatternShape = {
      id: "s1",
      name: "Shape 1",
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    };
    expect(
      patternInstances(spec({ density: 20, shapes: [outline] }), [tree], everywhere),
    ).toEqual([]);
  });
});

describe("the hash", () => {
  it("is a pure function of what it is given", () => {
    expect(hash(1, 2, 3, 4, 5)).toBe(hash(1, 2, 3, 4, 5));
  });

  it("separates its channels, so x and y are not the same number", () => {
    expect(hash(1, 0, 0, 0, 1)).not.toBe(hash(1, 0, 0, 0, 2));
  });

  it("stays a 32-bit unsigned integer, which is what the modulo counts on", () => {
    for (const tile of [-1_000_000, -1, 0, 1, 1_000_000]) {
      const h = hash(7, tile, tile, 3, 1);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
