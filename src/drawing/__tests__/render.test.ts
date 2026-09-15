/**
 * How a stroke reaches the canvas when it is not simply opaque ink.
 *
 * A brush lays stamps at a fifteenth of its width apart, so seven of them land
 * on any given pixel. Anything that composites *per stamp* — a colour with an
 * opacity, a highlighter's multiply, a soft-edged eraser — therefore compounds
 * down the middle of the stroke and is honest only at the tips: a 50 % line
 * comes out nearly solid, a highlighter darkens wherever it crosses itself,
 * and a rub eats further every time it passes. The answer is Hush's: stamp
 * somewhere else at full strength and lay the result down once.
 *
 * So what is counted here is *how many times the target was composited into*.
 * One `drawImage` on the target and a pile of them on the scratch is the
 * flatten path working; a pile on the target is the bug.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stroke } from "../../lib/types";

/** Every context made, newest last: the target, then the scratch. */
const contexts: FakeCtx[] = [];

interface FakeCtx {
  draws: number;
  composites: string[];
  alphas: number[];
  fills: string[];
  /** What each `fill()` was composited as — how a shape's holes are cut. */
  fillComposites: string[];
  /** The vertices a filled region's path was walked through. */
  path: number[][];
  canvas: { width: number; height: number };
  [key: string]: unknown;
}

function fakeContext(canvas: { width: number; height: number }): FakeCtx {
  const ctx: FakeCtx = {
    draws: 0,
    composites: [],
    alphas: [],
    fills: [],
    fillComposites: [],
    path: [],
    canvas,
    globalCompositeOperation: "source-over",
    globalAlpha: 1,
    fillStyle: "",
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    clearRect: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    closePath: () => undefined,
    fill: () => undefined,
    bezierCurveTo: () => undefined,
    transform: () => undefined,
    clip: () => undefined,
    setTransform: () => undefined,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    drawImage: () => undefined,
  };
  ctx.drawImage = () => {
    ctx.draws++;
    ctx.composites.push(ctx.globalCompositeOperation as string);
    ctx.alphas.push(ctx.globalAlpha as number);
  };
  ctx.fill = () => {
    ctx.fills.push(ctx.fillStyle as string);
    ctx.fillComposites.push(ctx.globalCompositeOperation as string);
  };
  // Where a filled region's outline actually went, which is the whole of what
  // a fill draws — see the corners test below.
  ctx.moveTo = (x: number, y: number) => void (ctx.path as number[][]).push([x, y]);
  ctx.lineTo = (x: number, y: number) => void (ctx.path as number[][]).push([x, y]);
  contexts.push(ctx);
  return ctx;
}

/**
 * The scratch the renderer flattens into.
 *
 * Captured on its way out of `document.createElement` rather than looked for
 * in `contexts`, because the renderer makes it **once** and keeps it for the
 * life of the module — deliberately, since assigning `canvas.width`
 * reallocates a backing store. So it is absent from every test but the first
 * one that needs it, and what is cleared between tests is its tally.
 */
let scratch: FakeCtx | null = null;

function fakeCanvas(width = 512, height = 512, asScratch = false) {
  const el = { width, height, getContext: () => null as unknown };
  el.getContext = () => {
    const ctx = fakeContext(el);
    if (asScratch) scratch = ctx;
    return ctx;
  };
  return el;
}

beforeEach(() => {
  contexts.length = 0;
  if (scratch) {
    scratch.draws = 0;
    scratch.composites.length = 0;
    scratch.alphas.length = 0;
    scratch.fills.length = 0;
    scratch.fillComposites.length = 0;
  }
  (globalThis as Record<string, unknown>).document = {
    createElement: () => fakeCanvas(512, 512, true),
  };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).document;
});

const { renderStroke } = await import("../render");

/** A tinted atlas that is not an image — nothing here reads its pixels. */
const atlas = {
  get: () => ({ atlas: {} as CanvasImageSource, cell: 128, variants: 4 }),
  onLoad: () => () => undefined,
  destroy: () => undefined,
};

/** A straight line long enough to lay down a good many stamps. */
function stroke(over: Partial<Stroke> = {}): Stroke {
  const points: number[] = [];
  for (let x = 0; x <= 200; x += 2) points.push(x, 0, 0.5);
  return {
    id: "s1",
    points,
    brushId: 1,
    size: 6,
    color: "#201e1d",
    mode: "ink",
    createdAt: 1,
    ...over,
  };
}

function target(): FakeCtx {
  return fakeContext(fakeCanvas());
}

describe("a stroke that is plain opaque ink", () => {
  it("stamps straight onto the target", () => {
    const ctx = target();
    renderStroke(ctx as unknown as CanvasRenderingContext2D, stroke(), atlas);
    // Many stamps, all of them on the target and none of them composited.
    expect(ctx.draws).toBeGreaterThan(10);
    expect(new Set(ctx.composites)).toEqual(new Set(["source-over"]));
    expect(new Set(ctx.alphas)).toEqual(new Set([1]));
    // And no scratch was ever asked for.
    expect(contexts).toHaveLength(1);
  });
});

describe("a stroke that has to composite", () => {
  /**
   * The one the opacity slider is for. Every stamp at 50 % would give a solid
   * core; one image at 50 % gives a line that is 50 % everywhere.
   */
  it("lands on the target once, whatever its length, when it is translucent", () => {
    const ctx = target();
    renderStroke(
      ctx as unknown as CanvasRenderingContext2D,
      stroke({ color: "#201e1d80" }),
      atlas,
    );
    expect(ctx.draws).toBe(1);
    expect(ctx.composites).toEqual(["source-over"]);
    expect(ctx.alphas[0]).toBeCloseTo(128 / 255, 5);

    // The stamps went somewhere: the scratch took all of them.
    expect(scratch).not.toBeNull();
    expect(scratch?.draws).toBeGreaterThan(10);
    expect(new Set(scratch?.alphas)).toEqual(new Set([1]));
  });

  it("multiplies a highlight once rather than per stamp", () => {
    const ctx = target();
    renderStroke(
      ctx as unknown as CanvasRenderingContext2D,
      stroke({ mode: "highlight" }),
      atlas,
    );
    expect(ctx.draws).toBe(1);
    expect(ctx.composites).toEqual(["multiply"]);
    expect(ctx.alphas[0]).toBeCloseTo(0.5, 5);
  });

  it("takes a highlight's own opacity into the one composite", () => {
    const ctx = target();
    renderStroke(
      ctx as unknown as CanvasRenderingContext2D,
      stroke({ mode: "highlight", color: "#ffcc0080" }),
      atlas,
    );
    expect(ctx.draws).toBe(1);
    expect(ctx.alphas[0]).toBeCloseTo(0.5 * (128 / 255), 5);
  });

  /** A soft tip that cleared more the more it overlapped itself. */
  it("clears once for a rub, so its soft edge is even", () => {
    const ctx = target();
    renderStroke(
      ctx as unknown as CanvasRenderingContext2D,
      stroke({ mode: "erase" }),
      atlas,
    );
    expect(ctx.draws).toBe(1);
    expect(ctx.composites).toEqual(["destination-out"]);
  });
});

describe("a fill", () => {
  /**
   * Not stamped at all — its points are a closed outline and what is drawn is
   * the inside of it — and a 2D context reads `#rrggbbaa` as a `fillStyle` on
   * its own, so opacity needs nothing said about it.
   */
  it("goes in as a path in the colour it was given, opacity and all", () => {
    const ctx = target();
    renderStroke(
      ctx as unknown as CanvasRenderingContext2D,
      stroke({ mode: "fill", color: "#3a7bd540" }),
      atlas,
    );
    expect(ctx.draws).toBe(0);
    expect(ctx.fills).toEqual(["#3a7bd540"]);
  });

  /**
   * And it goes in at the corners it was given.
   *
   * The streamline is a lag filter over the path a brush is stamped *along*:
   * it drags every interior sample most of the way towards the one before it,
   * which is what stops a hand's jitter from becoming a row of stamps at
   * slightly wrong angles. A filled region has no stamping and no path — it
   * has corners. Running it over a shape tapped out corner by corner moved
   * every one of them, so the shape that appeared the moment you pressed Fill
   * was not the shape on screen; on a swept outline of several hundred
   * samples a pixel apart the same bug was invisible, which is how it lasted.
   */
  it("keeps the corners exactly where they were, unstreamlined", () => {
    const ctx = target();
    const corners = [0, 0, 1, 100, 10, 1, 90, 80, 1, 10, 70, 1];
    renderStroke(
      ctx as unknown as CanvasRenderingContext2D,
      stroke({ mode: "fill", points: corners }),
      atlas,
    );
    expect(ctx.path).toEqual([
      [0, 0],
      [100, 10],
      [90, 80],
      [10, 70],
    ]);
  });
});

/**
 * Every brush can be turned round: what it would have drawn is what it takes
 * out. See `editor/tool-rail.ts` for which ones, and `lib/types.ts` for why
 * it is a flag on the stroke rather than a mode.
 *
 * What is guarded here is that the subtraction is **one composite over the
 * finished mark**. Every one of these marks is several draws that overlap —
 * seven stamps on a pixel, a shape that cuts its own holes, a fill under a
 * clip — so a `destination-out` per draw would bite deeper wherever the mark
 * crossed itself and would take a donut's hole out along with its body.
 */
describe("a brush turned round to erase", () => {
  it("subtracts a stamped stroke once, however long it is", () => {
    const ctx = target();
    renderStroke(
      ctx as unknown as CanvasRenderingContext2D,
      stroke({ erase: true }),
      atlas,
    );
    expect(ctx.draws).toBe(1);
    expect(ctx.composites).toEqual(["destination-out"]);
    expect(ctx.alphas[0]).toBe(1);

    // The stamps went to the scratch, at full strength and laid on normally.
    expect(scratch?.draws).toBeGreaterThan(10);
    expect(new Set(scratch?.composites)).toEqual(new Set(["source-over"]));
  });

  /**
   * A colour's opacity is a *soft* eraser, and it belongs on the one
   * composite. Per stamp it would have been an uneven one — solid down the
   * spine of the stroke and honest only at the tips.
   */
  it("takes the colour's opacity into that one composite", () => {
    const ctx = target();
    renderStroke(
      ctx as unknown as CanvasRenderingContext2D,
      stroke({ erase: true, color: "#201e1d80" }),
      atlas,
    );
    expect(ctx.draws).toBe(1);
    expect(ctx.alphas[0]).toBeCloseTo(128 / 255, 5);
    // And the mark itself went down opaque, or the alpha would land twice.
    expect(new Set(scratch?.alphas)).toEqual(new Set([1]));
  });

  it("subtracts a fill as one image rather than as a path", () => {
    const ctx = target();
    renderStroke(
      ctx as unknown as CanvasRenderingContext2D,
      stroke({ mode: "fill", erase: true, points: [0, 0, 1, 80, 0, 1, 80, 60, 1] }),
      atlas,
    );
    expect(ctx.draws).toBe(1);
    expect(ctx.composites).toEqual(["destination-out"]);
    // Nothing was filled on the target: the outline went into the scratch.
    expect(ctx.fills).toEqual([]);
    expect(scratch?.fills).toEqual(["#201e1d"]);
  });

  /**
   * The donut, which is the case the one-composite rule exists for: its hole
   * is cut out of its own body with `destination-out`, so that cut has to
   * happen *inside* the scratch. Subtracting stamp by stamp would have taken
   * the hole out of the canvas as well, leaving a solid disc of nothing.
   */
  it("cuts a shape's hole inside the scratch, not out of the canvas", () => {
    const ctx = target();
    renderStroke(
      ctx as unknown as CanvasRenderingContext2D,
      stroke({
        mode: "shape",
        erase: true,
        points: [0, 0, 1, 32, 0, 1],
        stamp: { width: 32, height: 32 },
        paint: { kind: "shape", shapeId: "donut" },
      }),
      atlas,
    );
    expect(ctx.draws).toBe(1);
    expect(ctx.composites).toEqual(["destination-out"]);

    // Two stamps, each a body and a hole, and the holes were cut in there.
    expect(scratch?.fillComposites).toEqual([
      "source-over",
      "destination-out",
      "source-over",
      "destination-out",
    ]);
  });
});
