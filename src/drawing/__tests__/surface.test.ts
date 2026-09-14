/**
 * What the backing does when the ink changes — which is the difference
 * between a drawing layer that stays quick and one that does not.
 *
 * Three claims, and all three were false before: an edit that is not about
 * ink costs nothing; a stroke *added* is stamped rather than the layer being
 * re-laid; and anything else is a re-bake. The first two are what "it lags
 * badly after the first few strokes" was — every completed stroke re-laid
 * every stroke on the layer, and every unrelated document edit did too.
 *
 * There is no DOM in this suite, so one is stubbed down to what `Surface`
 * touches: a canvas with a width, a 2D context that records nothing but its
 * calls, and a `devicePixelRatio`. Nothing here asserts on pixels. What it
 * counts is how many strokes were handed to the renderer, which is the whole
 * of the cost being managed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Stroke } from "../../lib/types";

/** Every stroke handed to the renderer, in order, across the whole test. */
const drawn: Stroke[] = [];

vi.mock("../render", () => ({
  STREAMLINE: 0.42,
  renderStroke: (_ctx: unknown, stroke: Stroke) => {
    drawn.push(stroke);
  },
  renderLive: () => undefined,
}));

const { Surface } = await import("../surface");

/** A 2D context with the handful of methods the surface calls. */
function fakeContext(): Record<string, unknown> {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    canvas: null,
  };
}

function fakeCanvas(): Record<string, unknown> {
  const ctx = fakeContext();
  const el = {
    className: "",
    width: 1,
    height: 1,
    style: {} as Record<string, string>,
    getContext: () => ctx,
  };
  ctx.canvas = el;
  return el;
}

function fakeDiv(): Record<string, unknown> {
  return {
    className: "",
    style: {} as Record<string, string>,
    classList: { toggle: vi.fn() },
    append: vi.fn(),
    appendChild: vi.fn(),
    remove: vi.fn(),
  };
}

beforeEach(() => {
  drawn.length = 0;
  (globalThis as Record<string, unknown>).document = {
    createElement: (tag: string) => (tag === "canvas" ? fakeCanvas() : fakeDiv()),
  };
  (globalThis as Record<string, unknown>).window = { devicePixelRatio: 2 };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).document;
  delete (globalThis as Record<string, unknown>).window;
});

function stroke(id: string): Stroke {
  return {
    id,
    points: [0, 0, 0.5, 10, 10, 0.5],
    brushId: 1,
    size: 4,
    color: "#000000",
    mode: "ink",
    createdAt: 1,
  };
}

const atlas = {
  get: () => ({ atlas: {} as CanvasImageSource, cell: 128, variants: 4 }),
  onLoad: () => () => undefined,
  destroy: () => undefined,
};

const view = { originX: 0, originY: 0, zoom: 1, width: 800, height: 600 };

/** A surface with a backing, and the bake that anchoring it cost forgotten. */
function ready(strokes: readonly Stroke[] = []) {
  const surface = new Surface(atlas);
  surface.sync(view, strokes);
  drawn.length = 0;
  return surface;
}

describe("the backing, when the ink changes", () => {
  it("does nothing at all for a change that is not about ink", () => {
    const held = [stroke("a"), stroke("b")];
    const surface = ready(held);
    // The same array: a placement moved, a density typed, a layer renamed.
    surface.apply(held);
    expect(drawn).toEqual([]);
  });

  /**
   * The one that makes drawing scale. Finishing a stroke gives the old list
   * with one more on the end, and only that one is stamped — over ink that is
   * already on the backing.
   */
  it("stamps only what was added", () => {
    const a = stroke("a");
    const b = stroke("b");
    const surface = ready([a, b]);

    const c = stroke("c");
    surface.apply([a, b, c]);
    expect(drawn.map((s) => s.id)).toEqual(["c"]);

    const d = stroke("d");
    surface.apply([a, b, c, d]);
    expect(drawn.map((s) => s.id)).toEqual(["c", "d"]);
  });

  /** A list that merely re-wraps the same strokes — what an erase commits. */
  it("stamps nothing for a list of the same strokes in a new array", () => {
    const a = stroke("a");
    const b = stroke("b");
    const surface = ready([a, b]);
    surface.apply([a, b]);
    expect(drawn).toEqual([]);
  });

  /**
   * Anything that is not an append is a re-bake, because the backing holds
   * ink that has to come off it: an erase, an undo, a stroke restyled.
   */
  it("re-lays everything when a stroke goes", () => {
    const a = stroke("a");
    const b = stroke("b");
    const c = stroke("c");
    const surface = ready([a, b, c]);

    surface.apply([a, c]);
    expect(drawn.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("re-lays everything when a stroke is replaced in place", () => {
    const a = stroke("a");
    const b = stroke("b");
    const surface = ready([a, b]);

    const restyled = { ...b, color: "#ff0000" };
    surface.apply([a, restyled]);
    expect(drawn.map((s) => s.id)).toEqual(["a", "b"]);
  });

  /** And an explicit repaint always means all of it — a brush PNG landing. */
  it("re-lays everything when asked to outright", () => {
    const held = [stroke("a"), stroke("b")];
    const surface = ready(held);
    surface.repaint(held);
    expect(drawn.map((s) => s.id)).toEqual(["a", "b"]);
  });
});
