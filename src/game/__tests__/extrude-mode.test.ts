import { afterEach, describe, expect, it, vi } from "vitest";
import type Phaser from "phaser";
import { Grid } from "../../lib/grid";
import { ExtrudeMode, type ExtrudeHost } from "../extrude-mode";

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
 * A host whose screen space *is* world space, so a test can name a point on
 * the shape by the world coordinate the geometry puts it at.
 */
function makeHost(grid: Grid): ExtrudeHost & { changes: number } {
  return {
    scene: { add: { graphics } } as unknown as Phaser.Scene,
    grid,
    zoom: () => 1,
    worldAt: (x, y) => ({ x, y }),
    clearSelection: () => {},
    changes: 0,
    onChange() {
      this.changes++;
    },
  };
}

const iso = new Grid("isometric", 64);

// Only the hold-versus-drag test wants a clock; the rest run on the real one.
afterEach(() => vi.useRealTimers());

function started(): { mode: ExtrudeMode; host: ReturnType<typeof makeHost> } {
  const host = makeHost(iso);
  const mode = new ExtrudeMode(host);
  mode.start({ cx: 0, cy: 0 }, { cx: 1, cy: 1 });
  return { mode, host };
}

describe("entering and leaving", () => {
  it("comes up holding the selected spaces, with nothing to apply yet", () => {
    const { mode } = started();
    expect(mode.active).toBe(true);
    expect(mode.shape).toBeNull();
    expect(mode.summary).toBe("nothing yet");
  });

  it("refuses a grid that does not snap", () => {
    const mode = new ExtrudeMode(makeHost(new Grid("blank", 64)));
    expect(mode.start({ cx: 0, cy: 0 }, { cx: 10, cy: 10 })).toBe(false);
    expect(mode.active).toBe(false);
  });

  it("leaves with nothing, and says so", () => {
    const { mode, host } = started();
    const before = host.changes;
    mode.stop();
    expect(mode.active).toBe(false);
    expect(mode.shape).toBeNull();
    expect(host.changes).toBe(before + 1);
  });

  it("does nothing to a canvas it is not up on", () => {
    const host = makeHost(iso);
    const mode = new ExtrudeMode(host);
    expect(mode.beginPull(0, 0)).toBe(false);
    expect(mode.beginSelect(0, 0)).toBe(false);
    expect(mode.tap(0, 0)).toBe(false);
    expect(mode.movePull(0, 0)).toBe(false);
    expect(mode.endPull()).toBe(false);
    expect(mode.endSelect()).toBe(false);
  });
});

describe("pulling", () => {
  it("takes the pointer only where it went down on the held face", () => {
    const { mode } = started();
    // The middle of cell 0,0 — one of the four spaces on the plate.
    expect(mode.beginPull(0, 0)).toBe(true);
    mode.endPull();
    // A long way off it, where a drag means a new selection instead.
    expect(mode.beginPull(900, 900)).toBe(false);
  });

  it("builds two levels over the plate from a drag of two levels", () => {
    const { mode } = started();
    mode.beginPull(0, 0);
    mode.movePull(0, -64);
    mode.endPull();
    // Four spaces, two levels each.
    expect(mode.shape?.size).toBe(8);
    expect(mode.summary).toBe("4 spaces · 2 levels");
  });

  it("previews against where the drag began, not against the last frame", () => {
    const { mode } = started();
    mode.beginPull(0, 0);
    mode.movePull(0, -64);
    mode.movePull(0, -32);
    mode.endPull();
    expect(mode.shape?.size).toBe(4);
  });

  it("goes back to the plate when the finger comes back", () => {
    const { mode } = started();
    mode.beginPull(0, 0);
    mode.movePull(0, -64);
    mode.movePull(0, 0);
    mode.endPull();
    expect(mode.shape).toBeNull();
  });
});

describe("taking hold of another face", () => {
  /** A 2 × 2 plate pulled two levels up: its top sits 64px above the ground. */
  function tower(): ExtrudeMode {
    const { mode } = started();
    mode.beginPull(0, 0);
    mode.movePull(0, -64);
    mode.endPull();
    return mode;
  }

  it("picks the space the user can see, not the ground under it", () => {
    const mode = tower();
    // The middle of cell 0,0's top face, two levels up. A tap there is about
    // that column — the ground at this point on the screen is elsewhere.
    mode.tap(0, -64);
    mode.beginPull(0, -64);
    mode.movePull(0, -96);
    mode.endPull();
    // One more level, on that one space of the four.
    expect(mode.shape?.size).toBe(9);
  });

  it("sweeps a range across the top and pulls the lot", () => {
    const mode = tower();
    mode.beginSelect(0, -64);
    // The top of the next column along: cell 1,0 is one diamond down-right.
    mode.extendSelect(32, -48);
    mode.endSelect();
    mode.beginPull(0, -64);
    mode.movePull(0, -96);
    mode.endPull();
    // Two of the four columns grew; the other two are as they were.
    expect(mode.shape?.size).toBe(10);
  });

  it("lets a finger held on the held face ask for spaces instead", () => {
    vi.useFakeTimers();
    const mode = tower();
    // Down on the top face, where a drag would pull — but nothing moves, so
    // by the time the hold fires this is a selection starting there.
    mode.beginPull(0, -64);
    vi.advanceTimersByTime(400);
    // The sweep runs from that space to the top of the next column along.
    mode.movePull(32, -48);
    mode.endPull();
    expect(mode.shape?.size).toBe(8);

    // And what it left behind is a face of two spaces, which pulls as one.
    mode.beginPull(0, -64);
    mode.movePull(0, -96);
    mode.endPull();
    expect(mode.shape?.size).toBe(10);
  });

  it("pushes a face back down into the solid it came out of", () => {
    const mode = tower();
    mode.tap(0, -64);
    mode.beginPull(0, -64);
    // Back the way it came: one level down, into the column under it.
    mode.movePull(0, -32);
    mode.endPull();
    expect(mode.shape?.size).toBe(7);
  });
});

/**
 * Points on the geometry of a 64px isometric grid, so a test can name a face
 * by what is drawn there. Half-width 32, half-height 16, one level 32 tall.
 */
const at = {
  /** The middle of the `+cx` wall of the voxel at (cx, cy, cz). */
  rightWall: (cx: number, cy: number, cz: number) => ({
    x: (cx - cy) * 32 + 16,
    y: (cx + cy) * 16 + 8 - (cz + 0.5) * 32,
  }),
  /** The middle of the `-cx` wall, which only X-ray mode can reach. */
  backWall: (cx: number, cy: number, cz: number) => ({
    x: (cx - cy) * 32 - 16,
    y: (cx + cy) * 16 - 8 - (cz + 0.5) * 32,
  }),
  /** The middle of the top face. */
  roof: (cx: number, cy: number, cz: number) => ({
    x: (cx - cy) * 32,
    y: (cx + cy) * 16 - (cz + 1) * 32,
  }),
};

/** A single column ten levels tall on the space at the origin. */
function tenHigh(): ExtrudeMode {
  const { mode } = started1x1();
  mode.beginPull(0, 0);
  mode.movePull(0, -320);
  mode.endPull();
  return mode;
}

function started1x1(): { mode: ExtrudeMode; host: ReturnType<typeof makeHost> } {
  const host = makeHost(iso);
  const mode = new ExtrudeMode(host);
  mode.start({ cx: 0, cy: 0 }, { cx: 0, cy: 0 });
  return { mode, host };
}

describe("building on the sides of what is already there", () => {
  it("takes hold of a wall part way up, and pulls it out sideways", () => {
    const mode = tenHigh();
    expect(mode.shape?.size).toBe(10);

    // Three levels from the bottom, on the wall rather than the roof.
    const grab = at.rightWall(0, 0, 3);
    mode.tap(grab.x, grab.y);
    mode.beginPull(grab.x, grab.y);
    // Ten spaces along +cx, which runs down-right at (32, 16) a step.
    mode.movePull(grab.x + 320, grab.y + 160);
    mode.endPull();

    expect(mode.shape?.size).toBe(20);
    expect(mode.summary).toBe("11 spaces · 10 levels");
  });

  it("then takes a run of the arm's roof and stands that up too", () => {
    const mode = tenHigh();
    const grab = at.rightWall(0, 0, 3);
    mode.tap(grab.x, grab.y);
    mode.beginPull(grab.x, grab.y);
    mode.movePull(grab.x + 320, grab.y + 160);
    mode.endPull();

    // Five spaces of the arm's roof, swept from the second to the sixth.
    const from = at.roof(2, 0, 3);
    const to = at.roof(6, 0, 3);
    mode.beginSelect(from.x, from.y);
    mode.extendSelect(to.x, to.y);
    mode.endSelect();
    mode.beginPull(from.x, from.y);
    mode.movePull(from.x, from.y - 64);
    mode.endPull();

    // Two more levels on each of the five.
    expect(mode.shape?.size).toBe(30);
  });

  it("sweeps a run of levels up one wall", () => {
    const mode = tenHigh();
    const from = at.rightWall(0, 0, 2);
    const to = at.rightWall(0, 0, 5);
    mode.beginSelect(from.x, from.y);
    mode.extendSelect(to.x, to.y);
    mode.endSelect();
    mode.beginPull(from.x, from.y);
    mode.movePull(from.x + 32, from.y + 16);
    mode.endPull();
    // Four levels of wall, each pushed one space out.
    expect(mode.shape?.size).toBe(14);
  });
});

describe("the far side of the shape", () => {
  /** Take hold at a point and pull one space along -cx, up-left on screen. */
  function pullBack(mode: ExtrudeMode, from: { x: number; y: number }): void {
    mode.tap(from.x, from.y);
    mode.beginPull(from.x, from.y);
    mode.movePull(from.x - 32, from.y - 16);
    mode.endPull();
  }

  it("is out of reach until backfaces are asked for", () => {
    const mode = tenHigh();
    // Nothing of the tower is drawn over its own far wall, so this reaches
    // past it to the bare grid behind — which starts a plate of its own
    // rather than taking hold of the wall.
    pullBack(mode, at.backWall(0, 0, 3));
    expect(mode.shape?.has("-1,0,3")).toBe(false);
  });

  it("pulls a back wall outward, away from the camera", () => {
    const mode = tenHigh();
    mode.setBackfaces(true);
    expect(mode.xray).toBe(true);
    pullBack(mode, at.backWall(0, 0, 3));
    expect(mode.shape?.has("-1,0,3")).toBe(true);
    expect(mode.shape?.size).toBe(11);
  });

  it("is borrowed by the modifier key for as long as it is held", () => {
    const mode = tenHigh();
    mode.setPeek(true);
    expect(mode.xray).toBe(true);
    mode.setPeek(false);
    expect(mode.xray).toBe(false);
  });

  it("has nothing to offer where the spaces have no sides", () => {
    const host = makeHost(new Grid("orthogonal", 64));
    const mode = new ExtrudeMode(host);
    mode.start({ cx: 0, cy: 0 }, { cx: 1, cy: 1 });
    expect(mode.hasBackfaces).toBe(false);
    mode.setBackfaces(true);
    expect(mode.xray).toBe(false);
  });
});

describe("erasing", () => {
  it("takes the space under the pointer, one at a time", () => {
    const mode = tenHigh();
    mode.setTool("erase");
    expect(mode.erasing).toBe(true);

    const roof = at.roof(0, 0, 9);
    mode.beginPull(roof.x, roof.y);
    mode.endPull();
    expect(mode.shape?.size).toBe(9);
  });

  it("does not take a second space on the tap that follows the press", () => {
    const mode = tenHigh();
    mode.setTool("erase");
    const roof = at.roof(0, 0, 9);
    mode.beginPull(roof.x, roof.y);
    mode.endPull();
    // The rig reports a drag that never moved as a tap; it must not erase
    // the space that has just been uncovered.
    mode.tap(roof.x, roof.y);
    expect(mode.shape?.size).toBe(9);
  });

  it("reaches the far side too, once backfaces are on", () => {
    const mode = tenHigh();
    mode.setBackfaces(true);
    mode.setTool("erase");
    const behind = at.backWall(0, 0, 4);
    mode.beginPull(behind.x, behind.y);
    mode.endPull();
    expect(mode.shape?.size).toBe(9);
  });

  it("trims a plate that has not been pulled yet", () => {
    const { mode } = started();
    mode.setTool("erase");
    expect(mode.summary).toBe("nothing yet");
    // The plate is four spaces; the middle of cell 0,0 is one of them.
    mode.beginPull(0, 0);
    mode.endPull();
    mode.beginPull(0, 0);
    mode.movePull(0, -320);
    mode.endPull();
    // Erasing is still the tool, so nothing was pulled — and had the space
    // been left on the plate, pulling would have raised four columns.
    expect(mode.shape).toBeNull();
    mode.setTool("pull");
    mode.beginPull(32, 16);
    mode.movePull(32, 16 - 32);
    mode.endPull();
    expect(mode.shape?.size).toBe(3);
  });
});
