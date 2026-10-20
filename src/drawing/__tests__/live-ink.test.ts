/**
 * A stroke drawn a frame at a time has to come out as the stroke drawn all at
 * once — the same stamps, at the same places, turned the same way — or the
 * line under the pen is not the line that lands. That is the claim pinned
 * here, along with the two that make it cheap: a frame lays only what it has
 * to, and a translucent stroke is no longer flattened to get there.
 *
 * No DOM. The surface is faked down to what `live-ink.ts` calls, and a
 * context records each stamp as the transform it was laid under.
 */

import { describe, expect, it } from "vitest";
import { liveInk, paintsIncrementally } from "../live-ink";
import { stampStream, STREAMLINE } from "../render";
import { streamlinePoints, type InkPoint } from "../geometry";
import { DEFAULT_STYLE, type StrokeStyle } from "../types";
import type { Surface } from "../surface";
import type { AtlasCache } from "../atlas";

type Stamp = [number, number, number, number];

interface Recorder {
  ctx: CanvasRenderingContext2D;
  stamps: Stamp[];
  /** The composite each stamp went down with. */
  composites: string[];
}

function recorder(): Recorder {
  const stamps: Stamp[] = [];
  const composites: string[] = [];
  let m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const stack: string[] = [];
  const ctx = {
    globalCompositeOperation: "source-over",
    getTransform: () => ({ ...m }),
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
      m = { a, b, c, d, e, f };
    },
    drawImage: () => {
      // Where the stamp's centre went, and which way it was turned.
      stamps.push([m.e, m.f, m.a, m.b]);
      composites.push(ctx.globalCompositeOperation);
    },
    save: () => void stack.push(ctx.globalCompositeOperation),
    restore: () => {
      ctx.globalCompositeOperation = stack.pop() ?? "source-over";
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, stamps, composites };
}

function fakeSurface() {
  const live = recorder();
  const done = recorder();
  let tail = recorder();
  const state = {
    live,
    done,
    get tail() {
      return tail;
    },
    generation: 0,
    opacity: 1,
    clears: 0,
    tails: 0,
  };
  const surface = {
    get generation() {
      return state.generation;
    },
    setInkOpacity: (o: number) => void (state.opacity = o),
    beginLive: () => {
      state.clears++;
      live.stamps.length = 0;
      return live.ctx;
    },
    continueLive: () => live.ctx,
    endLive: () => undefined,
    beginTail: (box: unknown) => {
      // A fresh canvas each frame is what clearing the tail amounts to.
      tail = recorder();
      if (!box) return null;
      state.tails++;
      return tail.ctx;
    },
    continueDone: () => done.ctx,
    endEraseFrame: () => undefined,
  };
  return { surface: surface as unknown as Surface, state };
}

const atlas = {
  get: () => ({ atlas: {} as CanvasImageSource, cell: 128, variants: 4 }),
} as unknown as AtlasCache;

/** A quick scribble, as samples. */
function samples(count: number): InkPoint[] {
  const out: InkPoint[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: 40 + i * 7 + 12 * Math.sin(i / 2),
      y: 60 + 30 * Math.sin(i / 5),
      pressure: 0.4 + 0.3 * Math.sin(i / 3),
    });
  }
  return out;
}

/** The stamps the whole-stroke walk lays for these samples. */
function whole(points: InkPoint[], size: number): Stamp[] {
  const r = recorder();
  stampStream(r.ctx, streamlinePoints(points, STREAMLINE), size, atlas.get(1, "#000000"));
  return r.stamps;
}

function style(patch: Partial<StrokeStyle> = {}): StrokeStyle {
  return { ...DEFAULT_STYLE, size: 8, ...patch };
}

/** Draw `points` a few samples a frame, the way a Pencil hands them over. */
function draw(ink: ReturnType<typeof liveInk>, points: InkPoint[], perFrame = 4) {
  const held: InkPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    held.push(points[i]);
    if (held.length === 1 || i % perFrame === perFrame - 1 || i === points.length - 1) {
      ink.paint(held);
    }
  }
}

describe("a stroke drawn a frame at a time", () => {
  it("lays the stamps the whole-stroke walk lays, settled and tail together", () => {
    const { surface, state } = fakeSurface();
    const points = samples(60);
    draw(liveInk(surface, atlas, style()), points);

    const laid = [...state.live.stamps, ...state.tail.stamps];
    const expected = whole(points, 8);
    expect(laid.length).toBe(expected.length);
    laid.forEach((stamp, i) => {
      stamp.forEach((v, k) => expect(v).toBeCloseTo(expected[i][k], 9));
    });
  });

  it("stamps each settled stamp once, however many frames it took", () => {
    const { surface, state } = fakeSurface();
    const points = samples(80);
    draw(liveInk(surface, atlas, style()), points, 1);
    // One sample a frame is the worst case for re-laying, and the settled
    // canvas still holds each stamp exactly once.
    const expected = whole(points, 8);
    expect(state.live.stamps.length + state.tail.stamps.length).toBe(expected.length);
    expect(state.clears).toBe(1);
  });

  it("lays itself again from the start when the backing is re-baked under it", () => {
    const { surface, state } = fakeSurface();
    const points = samples(40);
    const ink = liveInk(surface, atlas, style());
    ink.paint(points.slice(0, 20));
    state.generation++;
    ink.paint(points);

    expect(state.clears).toBe(2);
    const laid = [...state.live.stamps, ...state.tail.stamps];
    expect(laid.length).toBe(whole(points, 8).length);
  });

  it("is a dot on the tail until the pen moves", () => {
    const { surface, state } = fakeSurface();
    liveInk(surface, atlas, style()).paint(samples(1));
    expect(state.live.stamps).toHaveLength(0);
    expect(state.tail.stamps).toHaveLength(1);
  });
});

describe("a translucent stroke in flight", () => {
  it("is stamped opaque and shown through the ink's opacity", () => {
    const { surface, state } = fakeSurface();
    const ink = liveInk(surface, atlas, style({ color: "#0a84ff80" }));
    draw(ink, samples(20));
    expect(state.opacity).toBeCloseTo(128 / 255, 5);
    expect(new Set(state.live.composites)).toEqual(new Set(["source-over"]));

    ink.end(samples(20));
    expect(state.opacity).toBe(1);
  });

  it("shows a highlighter at half its colour's alpha", () => {
    const { surface, state } = fakeSurface();
    liveInk(surface, atlas, style({ mode: "highlight" })).paint(samples(3));
    expect(state.opacity).toBe(0.5);
  });
});

describe("an opaque eraser in flight", () => {
  it("cuts its settled stamps straight into the baked canvas, and nothing live", () => {
    const { surface, state } = fakeSurface();
    const points = samples(50);
    const ink = liveInk(surface, atlas, style({ erase: true, size: 20 }));
    draw(ink, points);

    expect(state.live.stamps).toHaveLength(0);
    expect(state.tails).toBe(0);
    expect(new Set(state.done.composites)).toEqual(new Set(["destination-out"]));
  });

  it("cuts the rest when the pen comes up, and says the mark is in", () => {
    const { surface, state } = fakeSurface();
    const points = samples(50);
    const ink = liveInk(surface, atlas, style({ erase: true, size: 20 }));
    draw(ink, points.slice(0, 47));
    expect(ink.end(points)).toBe(true);

    const expected = whole(points, 20);
    expect(state.done.stamps.length).toBe(expected.length);
    state.done.stamps.forEach((stamp, i) => {
      stamp.forEach((v, k) => expect(v).toBeCloseTo(expected[i][k], 9));
    });
  });

  it("needs the done canvas laid again when it is handed to the whole-stroke path", () => {
    const { surface } = fakeSurface();
    const ink = liveInk(surface, atlas, style({ erase: true }));
    draw(ink, samples(20));
    expect(ink.abandon()).toBe(true);
  });
});

describe("which strokes are drawn a frame at a time", () => {
  it("takes plain ink, a translucent colour, the highlighter and an opaque eraser", () => {
    expect(paintsIncrementally(style())).toBe(true);
    expect(paintsIncrementally(style({ color: "#0a84ffe6" }))).toBe(true);
    expect(paintsIncrementally(style({ mode: "highlight" }))).toBe(true);
    expect(paintsIncrementally(style({ erase: true }))).toBe(true);
  });

  /** Smoothing moves every point as the pointer moves; nothing is settled. */
  it("leaves smoothing, a translucent eraser and the Pattern brush whole", () => {
    expect(paintsIncrementally(style({ smoothing: 10 }))).toBe(false);
    expect(paintsIncrementally(style({ erase: true, color: "#00000080" }))).toBe(false);
    expect(
      paintsIncrementally(
        style({ paint: { kind: "pattern" } as unknown as StrokeStyle["paint"] }),
      ),
    ).toBe(false);
  });
});
