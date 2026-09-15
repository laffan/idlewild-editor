/**
 * The sweep fill's other half: a shape tapped out a corner at a time.
 *
 * What is worth pinning is the gesture, because it is the one thing in the
 * drawing engine that outlives a pointer going down and coming up again. Four
 * claims: a tap drops a corner, a tap that lands on a corner already there
 * takes hold of it instead of dropping a second one on top, a tap on the
 * *first* corner closes the shape and lays it down, and a tap on the first
 * corner before there is a shape does nothing — that last one is the tap that
 * starts a new shape, and it must not fill the nothing it landed on.
 *
 * There is no DOM in this suite, so the surface is stubbed down to what the
 * shape touches: a 2D context that records nothing, a clear, and the world
 * units one screen pixel covers — which is what every hit radius here is in.
 */

import { describe, expect, it, vi } from "vitest";
import { PointFill } from "../fill-points";
import { DEFAULT_STYLE, type StrokeStyle } from "../types";
import type { StrokeStore } from "../stroke-store";
import type { Surface } from "../surface";

/** Everything a laid-down shape hands the store. */
interface Laid {
  points: number[];
  style: StrokeStyle;
}

function fakeSurface(): Surface {
  const ctx = {
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    globalAlpha: 1,
  };
  return {
    beginLive: () => ctx,
    endLive: vi.fn(),
    clearLive: vi.fn(),
    // An erasing shape is previewed by cutting the *baked* canvas rather than
    // drawing on the live one — see `Surface.beginErase`. Nothing in this
    // suite erases, so both ends are here only to be called and do nothing.
    beginErase: () => ctx,
    endEraseFrame: vi.fn(),
    endErase: vi.fn(),
    // One world unit per screen pixel, so every radius in the shape is in the
    // same numbers the tests are written in.
    worldPerScreenPixel: 1,
  } as unknown as Surface;
}

function fakeStore(laid: Laid[]): StrokeStore {
  return {
    add: (points: number[], style: StrokeStyle) => laid.push({ points, style }),
  } as unknown as StrokeStore;
}

/** A press and release at one place, which is what a tap is. */
function tap(shape: PointFill, x: number, y: number, style: StrokeStyle): void {
  shape.begin(x, y, style).end();
}

function setup(): { shape: PointFill; laid: Laid[]; changes: () => number } {
  const laid: Laid[] = [];
  let changes = 0;
  const shape = new PointFill(fakeSurface(), fakeStore(laid), () => {
    changes += 1;
  });
  return { shape, laid, changes: () => changes };
}

const STYLE: StrokeStyle = { ...DEFAULT_STYLE, color: "#123456" };

describe("tapping a shape out", () => {
  it("drops a corner per tap", () => {
    const { shape } = setup();
    tap(shape, 0, 0, STYLE);
    tap(shape, 100, 0, STYLE);
    expect(shape.count).toBe(2);
    // Two corners are a line, and a line has no inside to fill.
    expect(shape.canFill).toBe(false);
    tap(shape, 100, 100, STYLE);
    expect(shape.canFill).toBe(true);
  });

  it("takes hold of a corner a tap lands on rather than adding another", () => {
    const { shape } = setup();
    tap(shape, 0, 0, STYLE);
    tap(shape, 100, 0, STYLE);
    // Well inside the 14-screen-pixel handle, and not the first corner — so
    // it is grabbed, and a release without movement leaves it where it was.
    tap(shape, 104, 3, STYLE);
    expect(shape.count).toBe(2);
  });

  it("moves the corner a drag took hold of", () => {
    const { shape, laid } = setup();
    tap(shape, 0, 0, STYLE);
    tap(shape, 100, 0, STYLE);
    tap(shape, 100, 100, STYLE);

    const session = shape.begin(100, 2, STYLE);
    session.move(60, 40, 1);
    session.end();
    expect(shape.count).toBe(3);

    shape.fill(STYLE);
    // x, y, pressure per point — the corner that was at (100, 0) is where the
    // drag left it.
    expect(laid[0].points.slice(3, 5)).toEqual([60, 40]);
  });
});

describe("laying it down", () => {
  it("closes on a tap on the first corner, as a fill-mode stroke", () => {
    const { shape, laid } = setup();
    tap(shape, 0, 0, STYLE);
    tap(shape, 100, 0, STYLE);
    tap(shape, 100, 100, STYLE);
    tap(shape, 2, 2, STYLE);

    expect(laid).toHaveLength(1);
    expect(laid[0].style.mode).toBe("fill");
    expect(laid[0].style.color).toBe("#123456");
    // And the shape starts again empty, ready for the next one.
    expect(shape.count).toBe(0);
  });

  it("does not close on the tap that started the shape", () => {
    const { shape, laid } = setup();
    tap(shape, 0, 0, STYLE);
    tap(shape, 1, 1, STYLE);
    // The second tap landed on the first corner, but there is no shape to
    // close — so it grabbed that corner and nothing was laid down.
    expect(laid).toHaveLength(0);
    expect(shape.count).toBe(1);
  });

  it("refuses a shape that encloses nothing", () => {
    const { shape, laid } = setup();
    tap(shape, 0, 0, STYLE);
    tap(shape, 100, 0, STYLE);
    expect(shape.fill(STYLE)).toBe(false);
    expect(laid).toHaveLength(0);
    // And the two corners are still there to add a third to.
    expect(shape.count).toBe(2);
  });
});

/**
 * The box the bar floating over the shape stands on.
 *
 * The corners and nothing else: the handles are drawn at a fixed *screen*
 * size, so counting them in would make the bar drift away from the shape as
 * you zoom out, which is the one thing a bar that is meant to stand beside
 * something must not do.
 */
describe("where the shape is", () => {
  it("is the corners' own box, with no room left for the handles", () => {
    const { shape } = setup();
    tap(shape, 10, 20, STYLE);
    tap(shape, 110, 20, STYLE);
    tap(shape, 110, 70, STYLE);
    expect(shape.box()).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it("has none before the first corner is down", () => {
    const { shape } = setup();
    expect(shape.box()).toBeNull();
  });
});

/**
 * What lands is what was on screen.
 *
 * The corners go into the document exactly as they were tapped out: no
 * smoothing, no streamline, no simplification. That is asserted here because
 * the failure is silent and looks like a different feature — the renderer
 * used to streamline a stored fill, which is a lag filter over the path a
 * brush is stamped *along*, and on a four-corner shape it moved every
 * interior corner most of the way towards the one before it. The shape that
 * appeared when you pressed Fill was not the shape you had drawn.
 */
describe("what lands", () => {
  it("is the corners themselves, in the order they were tapped", () => {
    const { shape, laid } = setup();
    const corners = [
      [0, 0],
      [100, 10],
      [90, 80],
      [10, 70],
    ];
    for (const [x, y] of corners) tap(shape, x, y, STYLE);
    expect(shape.fill(STYLE)).toBe(true);
    // Flat: x, y, pressure per corner.
    expect(laid[0].points).toEqual([
      0, 0, 1, 100, 10, 1, 90, 80, 1, 10, 70, 1,
    ]);
  });
});

describe("taking it back", () => {
  it("drops the last corner, and says so", () => {
    const { shape, changes } = setup();
    tap(shape, 0, 0, STYLE);
    tap(shape, 100, 0, STYLE);
    const before = changes();
    shape.undoPoint(STYLE);
    expect(shape.count).toBe(1);
    expect(changes()).toBe(before + 1);
  });

  it("clears the lot, and only reports a clear that did something", () => {
    const { shape, changes } = setup();
    tap(shape, 0, 0, STYLE);
    shape.clear();
    expect(shape.count).toBe(0);
    const quiet = changes();
    shape.clear();
    expect(changes()).toBe(quiet);
  });
});
