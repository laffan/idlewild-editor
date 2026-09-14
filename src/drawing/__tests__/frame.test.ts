/**
 * One repaint per frame, however many samples arrived in it.
 *
 * The claim is small and the consequence is not: a 120 Hz Pencil against a
 * 60 Hz frame hands a tool its samples several at a time through
 * `getCoalescedEvents`, and a repaint of an in-flight stroke costs a
 * smoothing pass over every sample so far plus one stamp per step along it.
 * Painting per sample did that work four or eight times inside a frame and
 * showed one of them.
 *
 * So what is pinned here is that requests coalesce, that nothing is lost when
 * they do, and that the two escapes — a flush for the moment a frame is too
 * late, a cancel for a session that is over — do what they say.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onFrame } from "../frame";

/** A hand-cranked `requestAnimationFrame`: nothing runs until `tick`. */
function stubFrames() {
  const queue: Array<() => void> = [];
  const g = globalThis as Record<string, unknown>;
  g.requestAnimationFrame = (fn: () => void) => {
    queue.push(fn);
    return queue.length;
  };
  g.cancelAnimationFrame = (id: number) => {
    queue[id - 1] = () => undefined;
  };
  return {
    tick() {
      const held = [...queue];
      queue.length = 0;
      for (const fn of held) fn();
    },
  };
}

let frames: ReturnType<typeof stubFrames>;

beforeEach(() => {
  frames = stubFrames();
});

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.requestAnimationFrame;
  delete g.cancelAnimationFrame;
});

describe("a frame-paced repaint", () => {
  it("paints once for a burst of requests", () => {
    const paint = vi.fn();
    const frame = onFrame(paint);

    frame.request();
    frame.request();
    frame.request();
    expect(paint).not.toHaveBeenCalled();

    frames.tick();
    expect(paint).toHaveBeenCalledTimes(1);
  });

  it("paints again on the next frame that asks", () => {
    const paint = vi.fn();
    const frame = onFrame(paint);

    frame.request();
    frames.tick();
    frame.request();
    frames.tick();
    expect(paint).toHaveBeenCalledTimes(2);
  });

  /** A frame nobody asked for paints nothing — a pan is not a redraw. */
  it("paints nothing on a frame with no request behind it", () => {
    const paint = vi.fn();
    onFrame(paint);
    frames.tick();
    expect(paint).not.toHaveBeenCalled();
  });

  /**
   * The hold that straightens a stroke fires when nothing is moving, and a
   * gesture that ends has to leave the canvas as the document is about to be
   * given it. Both are moments a frame is too late.
   */
  it("flushes a pending repaint on demand, and only once", () => {
    const paint = vi.fn();
    const frame = onFrame(paint);

    frame.request();
    frame.flush();
    expect(paint).toHaveBeenCalledTimes(1);

    frames.tick();
    frame.flush();
    expect(paint).toHaveBeenCalledTimes(1);
  });

  it("drops a pending repaint when the session is over", () => {
    const paint = vi.fn();
    const frame = onFrame(paint);

    frame.request();
    frame.cancel();
    frames.tick();
    expect(paint).not.toHaveBeenCalled();
  });

  /** Without rAF — which is a test environment, not any browser — inline. */
  it("paints inline where there are no frames to wait for", () => {
    const g = globalThis as Record<string, unknown>;
    delete g.requestAnimationFrame;

    const paint = vi.fn();
    const frame = onFrame(paint);
    frame.request();
    expect(paint).toHaveBeenCalledTimes(1);
  });
});
