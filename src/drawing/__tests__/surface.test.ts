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
    calls.push(`stroke:${stroke.id}`);
  },
  renderLive: () => undefined,
}));

const { Surface } = await import("../surface");

/**
 * Everything drawn anywhere, in order, so a test can say what happened before
 * what — which is the whole of what the backdrop and the erase preview are
 * about. Entries are `"stroke:<id>"`, `"image"` and `"clear"`.
 */
const calls: string[] = [];

/** A 2D context with the handful of methods the surface calls. */
function fakeContext(): Record<string, unknown> {
  return {
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    globalCompositeOperation: "source-over",
    clearRect: vi.fn(() => void calls.push("clear")),
    drawImage: vi.fn(() => void calls.push("image")),
    imageSmoothingEnabled: true,
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
    classList: { add: vi.fn(), remove: vi.fn(), toggle: vi.fn() },
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
  calls.length = 0;
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
  calls.length = 0;
  return surface;
}

/** Artwork to put under the ink — PSD Edit mode's layer, as far as this goes. */
const backdrop = {
  image: {} as CanvasImageSource,
  box: { x: 0, y: 0, width: 64, height: 64 },
  smooth: true,
};

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

/**
 * Artwork baked under the ink, which is how an eraser in PSD Edit mode has
 * anything to erase. See `Surface.backdrop`.
 */
describe("a backdrop", () => {
  it("goes down before the ink, so the ink is over it", () => {
    const held = [stroke("a")];
    const surface = ready(held);
    surface.setBackdrop(backdrop, held);
    // The clear, the picture, then the stroke — in that order and once each.
    expect(calls).toEqual(["clear", "image", "stroke:a"]);
  });

  it("stays down across a re-bake, and goes when it is taken away", () => {
    const held = [stroke("a")];
    const surface = ready(held);
    surface.setBackdrop(backdrop, held);
    calls.length = 0;
    surface.repaint(held);
    expect(calls).toEqual(["clear", "image", "stroke:a"]);

    calls.length = 0;
    surface.setBackdrop(null, held);
    expect(calls).toEqual(["clear", "stroke:a"]);
  });

  /** Pushed on every document change while the mode is up — see `psd-edit.ts`. */
  it("costs nothing when it is the one already down", () => {
    const held = [stroke("a")];
    const surface = ready(held);
    surface.setBackdrop(backdrop, held);
    calls.length = 0;
    surface.setBackdrop(backdrop, held);
    expect(calls).toEqual([]);
  });
});

/**
 * An in-flight erase is previewed on the **baked** canvas rather than the live
 * one, because a hole in a layer above only reveals the layer below. What it
 * takes has to go back before the stroke itself lands, or the same pixels come
 * out twice.
 */
describe("an erase in flight", () => {
  const box = { x: 0, y: 0, width: 32, height: 32 };

  it("keeps a copy of what it is about to take, and puts it back", () => {
    const surface = ready([stroke("a")]);
    surface.beginErase(box);
    // The copy out of the baked canvas and into the backup.
    expect(calls).toEqual(["clear", "image"]);

    calls.length = 0;
    surface.endErase();
    // And back the other way: the rectangle cleared, then the copy over it.
    expect(calls).toEqual(["clear", "image"]);
  });

  it("restores before it re-lays, so re-laying every frame is free of history", () => {
    const surface = ready([stroke("a")]);
    surface.beginErase(box);
    calls.length = 0;
    surface.beginErase(box);
    // Restore (clear + image), then snapshot again (clear + image).
    expect(calls).toEqual(["clear", "image", "clear", "image"]);
  });

  /**
   * A re-bake writes the baked state from the strokes themselves, so a backup
   * taken before it describes nothing — putting it back would restore ink that
   * has gone.
   */
  it("drops the copy when the backing is re-baked under it", () => {
    const held = [stroke("a")];
    const surface = ready(held);
    surface.beginErase(box);
    surface.repaint(held);
    calls.length = 0;
    surface.endErase();
    expect(calls).toEqual([]);
  });

  it("is over when there was nothing in flight", () => {
    const surface = ready([stroke("a")]);
    surface.endErase();
    expect(calls).toEqual([]);
  });
});

/**
 * An opaque eraser drawn a frame at a time (`live-ink.ts`) has cut its whole
 * mark into the baked canvas by the time it lands. Cutting it again on the
 * way in would bite deeper into every soft edge.
 */
describe("a stroke that lands already cut", () => {
  it("is recorded as painted rather than stamped again", () => {
    const a = stroke("a");
    const b = stroke("b");
    const surface = ready([a]);
    surface.adoptAppend(() => surface.apply([a, b]), () => [a, b]);
    expect(drawn).toEqual([]);

    // Only that one: the next append is stamped as usual.
    const c = stroke("c");
    surface.apply([a, b, c]);
    expect(drawn.map((s) => s.id)).toEqual(["c"]);
  });

  /** A locked layer turns the stroke away, and the cut has to come back out. */
  it("re-bakes when nothing was appended after all", () => {
    const a = stroke("a");
    const surface = ready([a]);
    surface.adoptAppend(() => undefined, () => [a]);
    expect(drawn.map((s) => s.id)).toEqual(["a"]);
  });

  /** What a stroke keeping its own pixels between frames watches for. */
  it("counts every re-bake, and nothing else", () => {
    const a = stroke("a");
    const surface = ready([a]);
    const before = surface.generation;
    surface.apply([a, stroke("b")]);
    expect(surface.generation).toBe(before);
    surface.repaint([a]);
    expect(surface.generation).toBe(before + 1);
  });
});

/**
 * A pan that nears the backing's edge re-centres it. That used to re-bake
 * every stroke in view, which with a few hundred strokes froze the canvas for
 * as long as it took; a pan now slides the baked pixels and stamps only what
 * reaches into the strips the slide uncovered. See `backing-slide.ts`.
 *
 * At this view the backing is 2560 pixels covering 1280 world units from
 * x = -240, and a pan to x = 200 re-centres it 200 units to the right.
 */
describe("a pan past the backing's edge", () => {
  function at(id: string, x: number): Stroke {
    return { ...stroke(id), points: [x, 0, 0.5, x + 10, 10, 0.5] };
  }
  const panned = { ...view, originX: 200 };

  it("slides, and stamps only the strokes in the uncovered strip", () => {
    const held = [at("near", 0), at("far", 1100)];
    const surface = ready(held);
    const before = surface.generation;
    surface.sync(panned, held);
    expect(drawn.map((s) => s.id)).toEqual(["far"]);
    // What a stroke in flight watches for, since its pixels moved too.
    expect(surface.generation).toBe(before + 1);
  });

  it("re-bakes when the zoom changed rather than the place", () => {
    const held = [at("near", 0), at("far", 1100)];
    const surface = ready(held);
    surface.sync({ ...view, zoom: 2 }, held);
    // "near" never leaves the middle, so only a re-bake lays it again; "far"
    // is out of what half the world covers at twice the zoom.
    expect(drawn.map((s) => s.id)).toEqual(["near"]);
  });

  /** The canvas holds a cut the strokes do not, so only a re-bake is true. */
  it("re-bakes while an eraser has cut into the canvas mid-stroke", () => {
    const held = [at("near", 0), at("far", 1100)];
    const surface = ready(held);
    surface.continueDone();
    surface.endEraseFrame();
    surface.sync(panned, held);
    expect(drawn.map((s) => s.id)).toEqual(["near", "far"]);
  });

  it("re-bakes when the canvas holds other strokes than the ones it is given", () => {
    const held = [at("near", 0), at("far", 1100)];
    const surface = ready(held);
    surface.sync(panned, [held[0]]);
    expect(drawn.map((s) => s.id)).toEqual(["near"]);
  });
});

/**
 * WebKit's cost model, from Hush's measurements on an iPad (its deltas #28,
 * #29 and #31): a full-surface write to a *visible* canvas is a quarter of a
 * second of upload at commit, and a canvas drawn onto itself is a
 * quarter-second readback. Neither may happen on a pan or a re-bake.
 */
describe("what a re-anchor costs the canvas on screen", () => {
  type Ctx = { canvas: unknown; clearRect: { mock: { calls: unknown[] } }; drawImage: { mock: { calls: unknown[][] } } };
  const pairOf = (surface: InstanceType<typeof Surface>) =>
    (surface as unknown as { pair: { ctx: Ctx } }).pair;
  function at(id: string, x: number): Stroke {
    return { ...stroke(id), points: [x, 0, 0.5, x + 10, 10, 0.5] };
  }

  it("slides by copying across to the spare, never the canvas onto itself", () => {
    const held = [at("near", 0), at("far", 1100)];
    const surface = ready(held);
    const shown = pairOf(surface).ctx;
    surface.sync({ ...view, originX: 200 }, held);
    const now = pairOf(surface).ctx;
    expect(now).not.toBe(shown);
    // The copy: the spare drew the old canvas, at an offset.
    const copy = now.drawImage.mock.calls[0];
    expect(copy[0]).toBe(shown.canvas);
    expect(shown.drawImage.mock.calls.every((c) => c[0] !== shown.canvas)).toBe(true);
  });

  it("re-bakes into the spare and swaps, leaving the canvas on screen unwritten", () => {
    const held = [at("near", 0)];
    const surface = ready(held);
    const shown = pairOf(surface).ctx;
    const clears = shown.clearRect.mock.calls.length;
    surface.repaint(held);
    expect(shown.clearRect.mock.calls.length).toBe(clears);
    expect(pairOf(surface).ctx).not.toBe(shown);
  });

  /** A plan nobody drew, a layer with no ink: a pan should cost nothing. */
  it("does nothing to a canvas with nothing on it", () => {
    const surface = ready([]);
    surface.sync({ ...view, originX: 200 }, []);
    surface.sync({ ...view, zoom: 2 }, []);
    surface.repaint([]);
    expect(calls).toEqual([]);
  });

  it("does not clear a live canvas that holds nothing", () => {
    const surface = ready([]);
    surface.setInteractive(true);
    surface.clearLive();
    surface.beginLive();
    expect(calls).toEqual([]);
    surface.endLive({ x: 0, y: 0, width: 10, height: 10 });
    surface.clearLive();
    expect(calls).toEqual(["clear"]);
  });
});
