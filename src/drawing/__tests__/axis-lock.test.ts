/**
 * Shift keeps a stroke to one axis — see `drawing/axis-lock.ts`.
 */

import { describe, expect, it } from "vitest";
import { AxisLock } from "../axis-lock";

describe("AxisLock", () => {
  it("holds the row the pointer first moved along", () => {
    const lock = new AxisLock(10, 20);
    expect(lock.apply(30, 23, true)).toEqual({ x: 30, y: 20 });
    expect(lock.locked).toBe("x");
    // A later swerve does not change the axis.
    expect(lock.apply(35, 80, true)).toEqual({ x: 35, y: 20 });
  });

  it("holds the column when the first move is mostly down", () => {
    const lock = new AxisLock(0, 0);
    expect(lock.apply(2, 9, true)).toEqual({ x: 0, y: 9 });
    expect(lock.locked).toBe("y");
  });

  it("waits for a move big enough to say which way, staying put meanwhile", () => {
    const lock = new AxisLock(5, 5);
    expect(lock.apply(6, 7, true)).toEqual({ x: 5, y: 5 });
    expect(lock.locked).toBeNull();
  });

  it("lets go with Shift, and decides afresh from there when it comes back", () => {
    const lock = new AxisLock(0, 0);
    lock.apply(20, 1, true);
    expect(lock.apply(40, 30, false)).toEqual({ x: 40, y: 30 });
    expect(lock.locked).toBeNull();
    expect(lock.apply(41, 60, true)).toEqual({ x: 40, y: 60 });
    expect(lock.locked).toBe("y");
  });
});
