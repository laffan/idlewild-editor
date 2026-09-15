/**
 * What a raster carries out of the drawing layer, and the second buffer that
 * only PSD Edit mode asks for.
 *
 * The ink buffer has always been enough on its own, because everything it was
 * ever used for draws on a **clear ground**: an erasing stroke rendered into a
 * transparent canvas takes out the ink laid before it and there is nothing
 * else in there to take. PSD Edit mode is the case that breaks it — those
 * pixels are composited onto a layer that already has artwork in it, so an
 * eraser that reaches no further than the session's own ink does visibly
 * nothing at all, which is exactly what it did.
 *
 * So what is pinned here is the shape of the answer: a second buffer holding
 * only the erasing strokes, laid **on** rather than taken out, so Rust has a
 * coverage to subtract. See `psd_paint::cut`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Stroke } from "../../lib/types";

interface FakeCtx {
  composites: string[];
  stamps: number;
  /** Whether this canvas was ever read back — see `targets`. */
  read: boolean;
  canvas: { width: number; height: number };
  [key: string]: unknown;
}

/** Every context made, in the order the canvases were created. */
const contexts: FakeCtx[] = [];

function fakeContext(canvas: { width: number; height: number }): FakeCtx {
  const ctx: FakeCtx = {
    composites: [],
    stamps: 0,
    read: false,
    canvas,
    globalCompositeOperation: "source-over",
    globalAlpha: 1,
    fillStyle: "",
    save: () => undefined,
    restore: () => undefined,
    scale: () => undefined,
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
    getImageData: (_x: number, _y: number, w: number, h: number) => {
      ctx.read = true;
      return { data: new Uint8ClampedArray(w * h * 4) };
    },
  };
  ctx.drawImage = () => {
    ctx.stamps++;
    ctx.composites.push(ctx.globalCompositeOperation as string);
  };
  contexts.push(ctx);
  return ctx;
}

beforeEach(() => {
  contexts.length = 0;
  (globalThis as Record<string, unknown>).document = {
    createElement: () => {
      const el = { width: 1, height: 1, getContext: () => null as unknown };
      el.getContext = () => fakeContext(el);
      return el;
    },
  };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).document;
});

const { rasteriseStrokes } = await import("../rasterise");

const atlas = {
  get: () => ({ atlas: {} as CanvasImageSource, cell: 128, variants: 4 }),
  onLoad: () => () => undefined,
  destroy: () => undefined,
};

function stroke(id: string, over: Partial<Stroke> = {}): Stroke {
  const points: number[] = [];
  for (let x = 0; x <= 60; x += 2) points.push(x, 20, 0.5);
  return {
    id,
    points,
    brushId: 1,
    size: 6,
    color: "#201e1d",
    mode: "ink",
    createdAt: 1,
    ...over,
  };
}

/**
 * The two canvases the raster made, in the order it made them: the ink, then
 * the mask.
 *
 * Told apart from the renderer's own scratch by being **read back** — the
 * scratch is only ever blitted from. Identifying them by size would not do:
 * the scratch grows to cover the target, and it is kept for the life of the
 * module, so which test creates it is an accident of ordering.
 */
function targets(): FakeCtx[] {
  return contexts.filter((c) => c.read);
}

describe("a raster with no erase mask asked for", () => {
  it("has none, even when the session erased", () => {
    const out = rasteriseStrokes([stroke("a"), stroke("b", { erase: true })], atlas);
    expect(out).not.toBeNull();
    expect(out?.erase).toBeUndefined();
  });
});

describe("a raster asked for the mask", () => {
  it("still leaves it out when nothing erased", () => {
    const out = rasteriseStrokes([stroke("a")], atlas, 1, { eraseMask: true });
    expect(out?.erase).toBeUndefined();
  });

  it("gives one the size of the ink, so both land on the same rectangle", () => {
    const out = rasteriseStrokes(
      [stroke("a"), stroke("b", { erase: true })],
      atlas,
      1,
      { eraseMask: true },
    );
    expect(out?.erase).toBeInstanceOf(Uint8ClampedArray);
    expect(out?.erase?.length).toBe(out?.rgba.length);
  });

  /**
   * The mask is the coverage, which means it is *drawn* rather than
   * subtracted — a mask made by erasing into an empty canvas would be empty,
   * which is the same do-nothing this whole buffer exists to fix.
   */
  it("lays the erasing strokes on rather than taking them out", () => {
    rasteriseStrokes([stroke("a"), stroke("b", { erase: true })], atlas, 1, {
      eraseMask: true,
    });
    const [ink, mask] = targets();
    expect(targets()).toHaveLength(2);
    expect(ink.composites).toContain("destination-out");
    expect(mask.stamps).toBeGreaterThan(0);
    expect(mask.composites).not.toContain("destination-out");
  });

  /** And only those: ink that was drawn is not coverage to take away. */
  it("holds only the strokes that erase", () => {
    rasteriseStrokes([stroke("a"), stroke("b", { erase: true })], atlas, 1, {
      eraseMask: true,
    });
    const [ink, mask] = targets();
    // One stroke against two, stamped at the same size along the same path.
    expect(mask.stamps).toBeGreaterThan(0);
    expect(mask.stamps).toBeLessThan(ink.stamps);
  });

  /** A stroke stored under the legacy "erase" mode is one of them. */
  it("counts a legacy erase-mode stroke", () => {
    const out = rasteriseStrokes([stroke("a", { mode: "erase" })], atlas, 1, {
      eraseMask: true,
    });
    expect(out?.erase).toBeInstanceOf(Uint8ClampedArray);
  });
});
