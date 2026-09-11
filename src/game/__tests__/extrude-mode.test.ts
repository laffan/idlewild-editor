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
