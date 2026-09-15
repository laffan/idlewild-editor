/**
 * What a patterned stroke covers, and where a field of shapes goes.
 *
 * Nothing here draws. What is asserted is the geometry the painters walk —
 * the set of lattice cells a tip passed over, and the two lattices a shape
 * fill can tile. Both are the difference between a mark that lines up with
 * the one beside it and one that does not, and neither is visible in a
 * screenshot until it is already wrong.
 */

import { describe, expect, it } from "vitest";
import { cellsUnderStroke, stampsOver } from "../paint-render";
import { strokeBox, type StreamPoint } from "../geometry";

const stream = (points: [number, number][]): StreamPoint[] =>
  points.map(([x, y]) => ({ point: [x, y], pressure: 1 }));

describe("the cells a stroke reveals", () => {
  it("is nothing for a stroke with no samples", () => {
    expect(cellsUnderStroke([], 10, 4).size).toBe(0);
  });

  it("covers the cells a tip of that width actually reaches", () => {
    // One sample, radius 4, cells 4 wide: the disc around (0,0) reaches the
    // four cells meeting at the origin and the four beyond them on the axes.
    const cells = cellsUnderStroke(stream([[0, 0]]), 4, 4);
    expect(cells.has("-1,-1")).toBe(true);
    expect(cells.has("0,0")).toBe(true);
    // ...and not the diagonal ones past the corner, which the disc misses.
    expect(cells.has("1,1")).toBe(false);
  });

  /**
   * The claim the whole tool rests on: what a stroke covers is a fact about
   * the world, not about the stroke. A pass drawn the other way round, or
   * broken into pieces, covers the same cells.
   */
  it("is the same set whichever way the stroke was drawn", () => {
    const forward = cellsUnderStroke(stream([[0, 0], [40, 0], [40, 40]]), 6, 4);
    const backward = cellsUnderStroke(stream([[40, 40], [40, 0], [0, 0]]), 6, 4);
    expect([...forward].sort()).toEqual([...backward].sort());
  });

  it("joins up two passes that meet, with nothing missed between them", () => {
    const whole = cellsUnderStroke(stream([[0, 0], [80, 0]]), 6, 4);
    const first = cellsUnderStroke(stream([[0, 0], [40, 0]]), 6, 4);
    const second = cellsUnderStroke(stream([[40, 0], [80, 0]]), 6, 4);
    expect([...whole].sort()).toEqual([...new Set([...first, ...second])].sort());
  });

  it("does not skip cells on a long fast flick", () => {
    // Two samples a long way apart, with a tip narrower than the gap: the
    // walk is what stops the stroke coming out as two blobs.
    const cells = cellsUnderStroke(stream([[0, 0], [400, 0]]), 4, 4);
    for (let cx = 0; cx < 100; cx++) expect(cells.has(`${cx},0`)).toBe(true);
  });

  it("costs what the stroke covers, not what its box encloses", () => {
    // Scribbled back and forth over one patch: the answer is that patch once.
    const there = stream([[0, 0], [40, 0]]);
    const back = stream([[0, 0], [40, 0], [0, 0], [40, 0], [0, 0], [40, 0]]);
    expect(cellsUnderStroke(back, 6, 4).size).toBe(cellsUnderStroke(there, 6, 4).size);
  });
});

describe("where a field of shapes goes", () => {
  const box = { x: 0, y: 0, width: 64, height: 64 };

  it("is a plain division on a square grid", () => {
    const at = stampsOver(box, { width: 32, height: 32 });
    expect(at).toContainEqual({ x: 0, y: 0 });
    expect(at).toContainEqual({ x: 32, y: 32 });
    expect(at).toContainEqual({ x: 64, y: 64 });
  });

  it("starts from the lattice rather than from the box", () => {
    // The box begins mid-cell, and the stamps still land on whole cells — so
    // two fills over the same ground agree about where the tiles are.
    const at = stampsOver({ x: 10, y: 10, width: 40, height: 40 }, { width: 32, height: 32 });
    for (const p of at) {
      expect(p.x % 32).toBe(0);
      expect(p.y % 32).toBe(0);
    }
  });

  /**
   * The isometric lattice: `(cx − cy)` across and `(cx + cy)` down, which is
   * `Grid.cellToWorld` rebuilt from the tile's own size, because the drawing
   * layer has no grid to ask.
   */
  it("walks the diamond lattice on an isometric grid", () => {
    const stamp = { width: 64, height: 32, diamond: true };
    const at = stampsOver({ x: -1, y: -1, width: 2, height: 2 }, stamp);
    // The space at the origin: its box hangs half a tile up and left of the
    // diamond's centre, which is the world origin.
    expect(at).toContainEqual({ x: -32, y: -16 });
    // Its four neighbours, each half a tile away in one of the two diagonals.
    expect(at).toContainEqual({ x: 0, y: 0 });
    expect(at).toContainEqual({ x: -64, y: 0 });
    expect(at).toContainEqual({ x: 0, y: -32 });
    expect(at).toContainEqual({ x: -64, y: -32 });
  });

  it("covers a whole box on either lattice", () => {
    for (const stamp of [
      { width: 64, height: 64 },
      { width: 64, height: 32, diamond: true },
    ]) {
      const at = stampsOver({ x: 100, y: 100, width: 200, height: 200 }, stamp);
      const xs = at.map((p) => p.x);
      const ys = at.map((p) => p.y);
      expect(Math.min(...xs)).toBeLessThanOrEqual(100);
      expect(Math.max(...xs) + stamp.width).toBeGreaterThanOrEqual(300);
      expect(Math.min(...ys)).toBeLessThanOrEqual(100);
      expect(Math.max(...ys) + stamp.height).toBeGreaterThanOrEqual(300);
    }
  });
});

describe("the box a stroke covers", () => {
  it("reaches a whole stamp past a shape stroke's last point", () => {
    // The points are the *corners* of the boxes that were filled, and a box
    // hangs down and right from its corner. Without that, a run of tiles
    // converted to a PSD comes back with its right and bottom edges cropped.
    const shape = strokeBox({
      id: "s",
      points: [0, 0, 1, 64, 32, 1],
      brushId: 1,
      size: 6,
      color: "#000",
      mode: "shape",
      stamp: { width: 64, height: 32 },
      createdAt: 0,
    });
    expect(shape).not.toBeNull();
    expect(shape!.x + shape!.width).toBeGreaterThanOrEqual(64 + 64);
    expect(shape!.y + shape!.height).toBeGreaterThanOrEqual(32 + 32);
  });

  it("reaches a lattice cell past a pattern stroke", () => {
    const flat = strokeBox({
      id: "a",
      points: [0, 0, 1, 10, 0, 1],
      brushId: 1,
      size: 6,
      color: "#000",
      mode: "ink",
      createdAt: 0,
    });
    const patterned = strokeBox({
      id: "b",
      points: [0, 0, 1, 10, 0, 1],
      brushId: 1,
      size: 6,
      color: "#000",
      mode: "ink",
      paint: { kind: "pattern", patternId: "checkerboard", patternScale: 8 },
      createdAt: 0,
    });
    expect(patterned!.width).toBe(flat!.width + 16);
  });
});
