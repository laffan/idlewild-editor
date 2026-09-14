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
  canvas: { width: number; height: number };
  [key: string]: unknown;
}

function fakeContext(canvas: { width: number; height: number }): FakeCtx {
  const ctx: FakeCtx = {
    draws: 0,
    composites: [],
    alphas: [],
    fills: [],
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
  };
  contexts.push(ctx);
  return ctx;
}

function fakeCanvas(width = 512, height = 512) {
  const el = { width, height, getContext: () => null as unknown };
  el.getContext = () => fakeContext(el);
  return el;
}

beforeEach(() => {
  contexts.length = 0;
  (globalThis as Record<string, unknown>).document = {
    createElement: () => fakeCanvas(),
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
    const scratch = contexts[contexts.length - 1];
    expect(scratch).not.toBe(ctx);
    expect(scratch.draws).toBeGreaterThan(10);
    expect(new Set(scratch.alphas)).toEqual(new Set([1]));
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
});
