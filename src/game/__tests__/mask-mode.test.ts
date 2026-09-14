/**
 * The pattern mask editor: what a sweep does, and the two rules that make it
 * safe to open on a shape somebody has already made.
 *
 * The mode itself is arithmetic over a set of grid spaces — what it draws is
 * not the subject here, so the scene is a stub. What is worth pinning is the
 * behaviour the old two-gesture route got wrong: that a session is a
 * transaction (Cancel leaves the layer alone), that Reset means *as this
 * opened* rather than *empty*, and that a sweep is one step of undo however
 * many spaces it covered.
 */

import { describe, expect, it } from "vitest";
import type Phaser from "phaser";
import { Grid } from "../../lib/grid";
import { MaskMode, type MaskHost, type MaskTarget } from "../mask-mode";
import type { Cell } from "../../lib/types";

/** Enough of a Graphics for the mode to draw into and be ignored. */
function graphics(): Phaser.GameObjects.Graphics {
  const g: Record<string, unknown> = {};
  const chain = () => g;
  for (const name of [
    "setScrollFactor",
    "setDepth",
    "setVisible",
    "clear",
    "fillStyle",
    "fillRect",
    "lineStyle",
    "beginPath",
    "moveTo",
    "lineTo",
    "closePath",
    "fillPath",
    "strokePath",
    "destroy",
  ]) {
    g[name] = chain;
  }
  return g as unknown as Phaser.GameObjects.Graphics;
}

const ortho = new Grid("orthogonal", 64);

/**
 * A host whose screen space *is* world space, so a test can name a space by
 * the world coordinate its middle sits at.
 */
function makeHost(grid = ortho): MaskHost & { changes: number } {
  return {
    scene: { add: { graphics } } as unknown as Phaser.Scene,
    grid,
    zoom: () => 1,
    worldAt: (x, y) => ({ x, y }),
    otherShapes: () => [],
    clearSelection: () => undefined,
    changes: 0,
    onChange() {
      this.changes++;
    },
  };
}

const target: MaskTarget = {
  layerId: "l1",
  layerName: "Pattern 1",
  shapeId: null,
  name: "Shape 1",
};

/** The middle of an orthogonal space, which is where a press is aimed. */
function at(cx: number, cy: number): [number, number] {
  const centre = ortho.cellCentre({ cx, cy });
  return [centre.x, centre.y];
}

/** Press, drag to another space, release. */
function sweep(mode: MaskMode, from: Cell, to: Cell): void {
  mode.beginSweep(...at(from.cx, from.cy));
  mode.moveSweep(...at(to.cx, to.cy));
  mode.endSweep();
}

function keysOf(mode: MaskMode): string[] {
  return mode.shape.map((c) => `${c.cx},${c.cy}`).sort();
}

describe("mask mode", () => {
  it("takes every space the sweep covered", () => {
    const mode = new MaskMode(makeHost());
    mode.start(target, []);
    sweep(mode, { cx: 0, cy: 0 }, { cx: 2, cy: 1 });
    expect(mode.shape).toHaveLength(6);
    expect(keysOf(mode)).toContain("2,1");
  });

  it("sweeps backwards as readily as forwards", () => {
    const mode = new MaskMode(makeHost());
    mode.start(target, []);
    sweep(mode, { cx: 3, cy: 3 }, { cx: 1, cy: 2 });
    expect(mode.shape).toHaveLength(6);
    expect(keysOf(mode)).toContain("1,2");
  });

  /** A press that never travels: the one space under the finger. */
  it("paints a single space on a press that does not move", () => {
    const mode = new MaskMode(makeHost());
    mode.start(target, []);
    mode.beginSweep(...at(4, 4));
    mode.endSweep();
    expect(keysOf(mode)).toEqual(["4,4"]);
  });

  it("takes spaces back out under Remove", () => {
    const mode = new MaskMode(makeHost());
    mode.start(target, []);
    sweep(mode, { cx: 0, cy: 0 }, { cx: 2, cy: 0 });
    mode.setTool("remove");
    sweep(mode, { cx: 1, cy: 0 }, { cx: 1, cy: 0 });
    expect(keysOf(mode)).toEqual(["0,0", "2,0"]);
  });

  /**
   * One step per sweep, however many spaces it covered. The alternative —
   * a step per space — makes ⌘Z walk backwards across a drag one square at a
   * time, which is what undo inside a paint tool must never do.
   */
  it("undoes a sweep in one step", () => {
    const mode = new MaskMode(makeHost());
    mode.start(target, []);
    sweep(mode, { cx: 0, cy: 0 }, { cx: 3, cy: 3 });
    expect(mode.shape).toHaveLength(16);
    mode.history.undo();
    expect(mode.shape).toHaveLength(0);
  });

  /**
   * Reset means *as this opened*, not *empty*. Opening on a shape somebody
   * made last week and pressing Reset has to give it back, or the button is a
   * delete key wearing another name — Clear is the one that empties.
   */
  it("resets to the shape it opened on, and clears to nothing", () => {
    const mode = new MaskMode(makeHost());
    const held: Cell[] = [
      { cx: 5, cy: 5 },
      { cx: 6, cy: 5 },
    ];
    mode.start({ ...target, shapeId: "s1" }, held);
    expect(mode.isOriginal).toBe(true);

    sweep(mode, { cx: 0, cy: 0 }, { cx: 1, cy: 1 });
    expect(mode.isOriginal).toBe(false);

    mode.reset();
    expect(keysOf(mode)).toEqual(["5,5", "6,5"]);
    expect(mode.isOriginal).toBe(true);

    mode.clearShape();
    expect(mode.shape).toHaveLength(0);
    expect(mode.isOriginal).toBe(false);
  });

  /**
   * Nothing here reaches the document, so leaving is dropping what is in the
   * object — and the layer the mode was opened from is the shell's business.
   * Pinned because it is the whole reason Cancel is safe.
   */
  it("keeps nothing when it stops", () => {
    const mode = new MaskMode(makeHost());
    mode.start(target, [{ cx: 1, cy: 1 }]);
    expect(mode.active).toBe(true);
    expect(mode.editing?.layerId).toBe("l1");

    mode.stop();
    expect(mode.active).toBe(false);
    expect(mode.editing).toBe(null);
    expect(mode.shape).toHaveLength(0);
  });

  /** A blank project's spaces are single pixels; there is nothing to sweep. */
  it("refuses a projection with no lattice", () => {
    const mode = new MaskMode(makeHost(new Grid("blank", 32)));
    expect(mode.start(target, [])).toBe(false);
    expect(mode.active).toBe(false);
  });

  /** The pointer belongs to the mode: nothing under the dim answers a drag. */
  it("claims every gesture while it is up", () => {
    const mode = new MaskMode(makeHost());
    expect(mode.beginSweep(0, 0)).toBe(false);
    expect(mode.tap()).toBe(false);

    mode.start(target, []);
    expect(mode.beginSweep(0, 0)).toBe(true);
    expect(mode.moveSweep(10, 10)).toBe(true);
    expect(mode.endSweep()).toBe(true);
    expect(mode.tap()).toBe(true);
  });
});
