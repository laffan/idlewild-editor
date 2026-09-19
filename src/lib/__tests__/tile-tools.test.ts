/**
 * The two tile tools' arithmetic.
 *
 * What is asserted here is the part of each tool that is a function — which
 * gids a run holds, what the next random pick is, how thin a scatter comes
 * out — because that is the part that can be wrong without anything on screen
 * looking wrong. The gestures that use it are in
 * `game/__tests__/tile-paint.test.ts`.
 *
 * Randomness is pinned by stubbing `Math.random` rather than by running the
 * thing a thousand times and asserting a distribution: what matters about a
 * scatter here is not that it is well distributed but that it *asks once per
 * space* and that the answer it shows is the answer it uses.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DENSITY_RANGE,
  EMPTY_HAND,
  gidsInStamp,
  scattered,
  shapeCells,
  TilePicks,
} from "../tile-tools";
import type { TiledTileset } from "../tiled/types";

/** Six tiles, three across — gids 1 to 6. */
const TILESET: TiledTileset = {
  firstgid: 1,
  name: "ground",
  image: "assets/ground/sprites/ground.png",
  imagewidth: 96,
  imageheight: 64,
  tilewidth: 32,
  tileheight: 32,
  spacing: 0,
  margin: 0,
  columns: 3,
  tilecount: 6,
};

afterEach(() => vi.restoreAllMocks());

describe("what a run holds", () => {
  it("reads across then down, which is how it was picked", () => {
    const run = gidsInStamp([TILESET], {
      firstgid: 1,
      col: 0,
      row: 0,
      cols: 2,
      rows: 2,
    });
    expect(run).toEqual([1, 2, 4, 5]);
  });

  it("leaves the holes out rather than carrying them as zeroes", () => {
    // A run dragged past the end of a palette should scatter the tiles it
    // caught, not gaps — a zero laid down is a space cleared.
    const run = gidsInStamp([TILESET], {
      firstgid: 1,
      col: 2,
      row: 1,
      cols: 2,
      rows: 1,
    });
    expect(run).toEqual([6]);
  });

  it("is empty when there is nothing picked, or nothing to pick from", () => {
    expect(gidsInStamp([TILESET], null)).toEqual([]);
    expect(gidsInStamp([], { firstgid: 1, col: 0, row: 0, cols: 1, rows: 1 })).toEqual(
      [],
    );
  });
});

describe("the random sequence", () => {
  it("hands over exactly what it showed", () => {
    // The whole of "the cursor shows the next thing to be stamped". A peek
    // that re-rolled would show one tile and lay another, every time.
    const picks = new TilePicks();
    picks.aim([1, 2, 3, 4]);
    const shown = picks.peek();
    expect(picks.peek()).toBe(shown);
    expect(picks.take()).toBe(shown);
  });

  it("moves on once a tile has landed, and not before", () => {
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0.5);
    const picks = new TilePicks();
    picks.aim([10, 20]);
    expect(picks.peek()).toBe(10);
    expect(picks.take()).toBe(10);
    expect(picks.peek()).toBe(20);
  });

  it("leaves a run it is already on running", () => {
    // Re-aiming on every hover would re-roll the tile under the cursor on
    // every pointer move, which is a cursor nobody could read.
    const picks = new TilePicks();
    picks.aim([1, 2, 3]);
    const shown = picks.peek();
    picks.aim([1, 2, 3]);
    expect(picks.peek()).toBe(shown);
  });

  it("re-aims when the run really changed", () => {
    const picks = new TilePicks();
    picks.aim([1]);
    expect(picks.peek()).toBe(1);
    picks.aim([7]);
    expect(picks.peek()).toBe(7);
  });

  it("hands over nothing when there is nothing to draw from", () => {
    const picks = new TilePicks();
    picks.aim([]);
    expect(picks.peek()).toBe(0);
    expect(picks.take()).toBe(0);
  });
});

describe("how thick a scatter is", () => {
  const cells = [0, 1, 2, 3].map((cx) => ({ cx, cy: 0 }));

  it("leaves nothing out at a hundred per cent", () => {
    // The only value that never leaves a gap, which is what makes it the
    // default: at full density the difference between a scatter and a tiling
    // is *which* tile lands, not how many.
    expect(scattered(cells, DENSITY_RANGE.max)).toEqual(cells);
  });

  it("asks once per space", () => {
    const roll = vi
      .spyOn(Math, "random")
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0.2)
      .mockReturnValueOnce(0.8);
    const some = scattered(cells, 50);
    expect(roll).toHaveBeenCalledTimes(4);
    expect(some.map((c) => c.cx)).toEqual([0, 2]);
  });

  it("holds a density typed outside the range to the range", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    expect(scattered(cells, 1000)).toEqual(cells);
    expect(scattered(cells, -5)).toEqual([]);
  });
});

describe("the shape a drag describes", () => {
  const spread = (cells: { cx: number; cy: number }[]) =>
    cells.map((c) => `${c.cx},${c.cy}`).sort();

  it("fills the box that was dragged", () => {
    expect(shapeCells("rect", { cx: 0, cy: 0 }, { cx: 2, cy: 1 })).toHaveLength(6);
  });

  it("reads the box the same from either corner", () => {
    // The least surprising thing a shape can do: dragging a box from its
    // bottom-right is the same box as dragging it from its top-left.
    const one = shapeCells("rect", { cx: 3, cy: 3 }, { cx: 0, cy: 0 });
    const other = shapeCells("rect", { cx: 0, cy: 0 }, { cx: 3, cy: 3 });
    expect(spread(one)).toEqual(spread(other));
  });

  it("is one space for a drag that never left its own", () => {
    // Which is what makes a tap on this tool put a tile down rather than
    // nothing at all.
    expect(shapeCells("rect", { cx: 4, cy: 4 }, { cx: 4, cy: 4 })).toEqual([
      { cx: 4, cy: 4 },
    ]);
    expect(shapeCells("circle", { cx: 4, cy: 4 }, { cx: 4, cy: 4 })).toEqual([
      { cx: 4, cy: 4 },
    ]);
  });

  it("takes the corners off a circle and keeps its edges", () => {
    // A 5 x 5 box: the four corners fall outside the inscribed ellipse and
    // the four edge midpoints fall inside it, which is the whole of what
    // makes a circle read as a circle at this size.
    const round = spread(shapeCells("circle", { cx: 0, cy: 0 }, { cx: 4, cy: 4 }));
    expect(round).not.toContain("0,0");
    expect(round).not.toContain("4,4");
    expect(round).toContain("2,0");
    expect(round).toContain("0,2");
    expect(round).toContain("2,2");
    // And it is a subset of the box it was inscribed in.
    expect(round.length).toBeLessThan(25);
  });

  it("is an oval when the drag is not square", () => {
    // A circle inscribed in a box is what every drawing program draws for a
    // dragged ellipse, and it needs no second gesture to say how wide.
    const wide = shapeCells("circle", { cx: 0, cy: 0 }, { cx: 8, cy: 2 });
    const xs = wide.map((c) => c.cx);
    const ys = wide.map((c) => c.cy);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(
      Math.max(...ys) - Math.min(...ys),
    );
  });
});

describe("a hand with nothing in it", () => {
  it("is a tool that refuses every gesture", () => {
    // What a scene built by a test gets, and what every layer that is not a
    // tile layer reports — `verb` of null is the whole of the refusal.
    expect(EMPTY_HAND.verb).toBeNull();
    expect(EMPTY_HAND.stamp).toBeNull();
    expect(EMPTY_HAND.random).toBe(false);
    expect(EMPTY_HAND.density).toBe(DENSITY_RANGE.max);
    expect(EMPTY_HAND.shape).toBe("rect");
  });
});
