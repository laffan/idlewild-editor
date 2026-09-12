import { describe, expect, it } from "vitest";
import type Phaser from "phaser";
import { Grid } from "../../lib/grid";
import { ColliderMode, type ColliderHost, type ColliderTarget } from "../collider-mode";
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

/**
 * A host whose screen space *is* world space, so a test can name a space by
 * the world coordinate its middle sits at.
 */
function makeHost(grid: Grid): ColliderHost & { changes: number } {
  return {
    scene: { add: { graphics } } as unknown as Phaser.Scene,
    grid,
    zoom: () => 1,
    worldAt: (x, y) => ({ x, y }),
    changes: 0,
    onChange() {
      this.changes++;
    },
  };
}

const ortho = new Grid("orthogonal", 64);

const target: ColliderTarget = {
  key: "tower",
  instance: "u1",
  layerId: "l1",
  anchor: { cx: 0, cy: 0 },
};

/** The middle of an orthogonal space, which is where a press is aimed. */
function at(cx: number, cy: number): [number, number] {
  const centre = ortho.cellCentre({ cx, cy });
  return [centre.x, centre.y];
}

function keys(cells: readonly Cell[]): string[] {
  return cells.map((c) => `${c.cx},${c.cy}`).sort();
}

function started(cells: Cell[] = [{ cx: 0, cy: 0 }]): {
  mode: ColliderMode;
  host: ReturnType<typeof makeHost>;
} {
  const host = makeHost(ortho);
  const mode = new ColliderMode(host);
  mode.start(target, cells, cells);
  return { mode, host };
}

describe("entering and leaving", () => {
  it("comes up holding the spaces the file already blocks", () => {
    const { mode } = started([{ cx: 0, cy: 0 }, { cx: 1, cy: 0 }]);
    expect(mode.active).toBe(true);
    expect(keys(mode.shape)).toEqual(["0,0", "1,0"]);
    expect(mode.isDefault).toBe(true);
    expect(mode.summary).toBe("2 spaces · default");
  });

  it("refuses a grid that does not snap", () => {
    const mode = new ColliderMode(makeHost(new Grid("blank", 64)));
    expect(mode.start(target, [], [])).toBe(false);
    expect(mode.active).toBe(false);
  });

  it("leaves with nothing, and says so", () => {
    const { mode, host } = started();
    const before = host.changes;
    mode.stop();
    expect(mode.active).toBe(false);
    expect(mode.editing).toBeNull();
    expect(host.changes).toBeGreaterThan(before);
  });
});

describe("painting", () => {
  it("adds the space under the pointer, and drags a run of them", () => {
    const { mode } = started([]);
    mode.beginPaint(...at(0, 0));
    mode.movePaint(...at(1, 0));
    mode.movePaint(...at(2, 0));
    mode.endPaint();
    expect(keys(mode.shape)).toEqual(["0,0", "1,0", "2,0"]);
  });

  it("takes spaces away when Remove is up", () => {
    const { mode } = started([{ cx: 0, cy: 0 }, { cx: 1, cy: 0 }]);
    mode.setTool("remove");
    mode.beginPaint(...at(1, 0));
    mode.endPaint();
    expect(keys(mode.shape)).toEqual(["0,0"]);
  });

  /**
   * The rig reports a press that never moved as a drag *and* as a tap, so
   * both tools have to be idempotent or every click would undo itself.
   */
  it("paints the same space twice as though it were once", () => {
    const { mode } = started([]);
    mode.beginPaint(...at(2, 2));
    mode.endPaint();
    mode.tap(...at(2, 2));
    expect(keys(mode.shape)).toEqual(["2,2"]);

    mode.setTool("remove");
    mode.beginPaint(...at(2, 2));
    mode.endPaint();
    mode.tap(...at(2, 2));
    expect(mode.shape).toEqual([]);
  });

  it("claims every pointer while it is up, and none once it is not", () => {
    const { mode } = started([]);
    expect(mode.beginPaint(...at(0, 0))).toBe(true);
    mode.endPaint();
    mode.stop();
    expect(mode.beginPaint(...at(0, 0))).toBe(false);
    expect(mode.tap(...at(0, 0))).toBe(false);
  });
});

describe("what Apply is told", () => {
  it("stops calling the shape a default once it differs", () => {
    const { mode } = started([{ cx: 0, cy: 0 }]);
    mode.beginPaint(...at(1, 1));
    mode.endPaint();
    expect(mode.isDefault).toBe(false);
    expect(mode.summary).toBe("2 spaces");
  });

  it("calls it a default again when it comes back to one", () => {
    const { mode } = started([{ cx: 0, cy: 0 }]);
    mode.beginPaint(...at(1, 1));
    mode.endPaint();
    mode.setTool("remove");
    mode.beginPaint(...at(1, 1));
    mode.endPaint();
    expect(mode.isDefault).toBe(true);
  });

  it("puts the default back on Reset, whatever has been drawn", () => {
    const { mode } = started([{ cx: 0, cy: 0 }]);
    mode.setTool("remove");
    mode.beginPaint(...at(0, 0));
    mode.endPaint();
    mode.setTool("add");
    mode.beginPaint(...at(5, 5));
    mode.endPaint();
    expect(keys(mode.shape)).toEqual(["5,5"]);

    mode.reset();
    expect(keys(mode.shape)).toEqual(["0,0"]);
    expect(mode.isDefault).toBe(true);
  });
});

describe("undo inside a session", () => {
  it("has nothing to go back to before anything is painted", () => {
    const { mode } = started();
    expect(mode.history.canUndo).toBe(false);
    expect(mode.history.undo()).toBe(false);
  });

  it("takes back a stroke whole, however many spaces it crossed", () => {
    const { mode } = started();
    mode.beginPaint(...at(1, 0));
    mode.movePaint(...at(2, 0));
    mode.movePaint(...at(3, 0));
    mode.endPaint();
    expect(keys(mode.shape)).toEqual(["0,0", "1,0", "2,0", "3,0"]);
    expect(mode.history.depths).toEqual({ undo: 1, redo: 0 });

    mode.history.undo();
    expect(keys(mode.shape)).toEqual(["0,0"]);
    mode.history.redo();
    expect(keys(mode.shape)).toEqual(["0,0", "1,0", "2,0", "3,0"]);
  });

  it("counts Remove the same way, and Reset as a step of its own", () => {
    const { mode } = started([{ cx: 0, cy: 0 }, { cx: 1, cy: 0 }]);
    mode.setTool("remove");
    mode.beginPaint(...at(1, 0));
    mode.endPaint();
    expect(keys(mode.shape)).toEqual(["0,0"]);

    mode.reset();
    expect(keys(mode.shape)).toEqual(["0,0", "1,0"]);
    expect(mode.history.depths.undo).toBe(2);

    mode.history.undo();
    expect(keys(mode.shape)).toEqual(["0,0"]);
    mode.history.undo();
    expect(keys(mode.shape)).toEqual(["0,0", "1,0"]);
  });

  it("leaves no step for a press on a space already painted", () => {
    const { mode } = started();
    mode.beginPaint(...at(0, 0));
    mode.endPaint();
    expect(mode.history.canUndo).toBe(false);
  });

  it("does not let the spaces it remembers be written through", () => {
    const { mode } = started();
    mode.beginPaint(...at(1, 0));
    mode.endPaint();
    mode.beginPaint(...at(2, 0));
    mode.endPaint();

    mode.history.undo();
    // Two spaces, not three: the snapshot the second stroke took describes
    // the spaces as they were rather than the set the first one is still on.
    expect(keys(mode.shape)).toEqual(["0,0", "1,0"]);
  });

  it("forgets the lot on the way out, and on the way back in", () => {
    const { mode } = started();
    mode.beginPaint(...at(1, 0));
    mode.endPaint();
    expect(mode.history.canUndo).toBe(true);

    mode.stop();
    expect(mode.history.canUndo).toBe(false);

    mode.start(target, [{ cx: 0, cy: 0 }], [{ cx: 0, cy: 0 }]);
    expect(mode.history.canUndo).toBe(false);
  });
});
