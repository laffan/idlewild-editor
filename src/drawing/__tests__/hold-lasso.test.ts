/**
 * The hold that turns a still pen or finger into a lasso — `hold-lasso.ts`.
 *
 * What is worth pinning is the edge of "still": it fires only for the pointer
 * it was armed on, only once the time is up, and not at all once that pointer
 * has strayed past its slop — a pen that has begun a line is drawing, and a
 * finger that has moved is panning.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hold } from "../hold-lasso";

function at(pointerId: number, clientX: number, clientY: number): PointerEvent {
  return { pointerId, clientX, clientY } as PointerEvent;
}

describe("a still hold", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as unknown as { window: unknown }).window = globalThis;
  });
  afterEach(() => vi.useRealTimers());

  it("fires once the time is up, for a pointer that stayed within its slop", () => {
    const hold = new Hold();
    const fire = vi.fn();
    hold.arm(at(1, 100, 100), 500, 4, fire);
    hold.move(at(1, 103, 101));
    vi.advanceTimersByTime(499);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledOnce();
    expect(hold.waiting(1)).toBe(false);
  });

  it("does not fire once the pointer has strayed, even if it comes back", () => {
    const hold = new Hold();
    const fire = vi.fn();
    hold.arm(at(1, 100, 100), 500, 4, fire);
    hold.move(at(1, 110, 100));
    hold.move(at(1, 100, 100));
    vi.advanceTimersByTime(1000);
    expect(fire).not.toHaveBeenCalled();
  });

  it("ignores every other pointer", () => {
    const hold = new Hold();
    const fire = vi.fn();
    hold.arm(at(1, 100, 100), 400, 8, fire);
    hold.move(at(2, 400, 400));
    expect(hold.waiting(1)).toBe(true);
    expect(hold.waiting(2)).toBe(false);
    vi.advanceTimersByTime(400);
    expect(fire).toHaveBeenCalledOnce();
  });

  it("is let go of by disarming", () => {
    const hold = new Hold();
    const fire = vi.fn();
    hold.arm(at(1, 0, 0), 400, 8, fire);
    hold.disarm();
    vi.advanceTimersByTime(1000);
    expect(fire).not.toHaveBeenCalled();
  });
});
