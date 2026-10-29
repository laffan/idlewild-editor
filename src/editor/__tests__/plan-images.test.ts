/**
 * The colour a picture dropped on the plan is baked to — `plan-images.ts`.
 *
 * The claim worth pinning is the one the multiply depends on: white stays
 * white, so it vanishes over whatever is under it, black comes out the plan's
 * blue, and a colour is judged only by how light it is.
 */

import { describe, expect, it } from "vitest";
import { tint } from "../plan-images";
import { PLAN_COLOR } from "../../lib/plan";

function one(r: number, g: number, b: number): number[] {
  const px = new Uint8ClampedArray([r, g, b, 255]);
  tint(px, PLAN_COLOR);
  return [...px];
}

describe("a picture's tones on the plan", () => {
  it("leaves white white and turns black the plan's blue", () => {
    expect(one(255, 255, 255)).toEqual([255, 255, 255, 255]);
    expect(one(0, 0, 0)).toEqual([0x0a, 0x84, 0xff, 255]);
  });

  it("judges a colour by its lightness alone", () => {
    // Pure green is far lighter than pure blue, so it comes out far paler.
    expect(one(0, 255, 0)[0]).toBeGreaterThan(one(0, 0, 255)[0]);
    // And a colour is its grey: the hue is gone before the blue goes in.
    const light = Math.round(0.2126 * 200 + 0.7152 * 60 + 0.0722 * 90);
    expect(one(200, 60, 90)).toEqual(one(light, light, light));
  });

  it("only ever runs between white and the blue", () => {
    for (const [r, g, b] of [[200, 30, 30], [10, 200, 90], [90, 90, 250]]) {
      const [tr, tg, tb] = one(r, g, b);
      expect(tr).toBeGreaterThanOrEqual(0x0a);
      expect(tg).toBeGreaterThanOrEqual(0x84);
      expect(tb).toBe(255);
    }
  });
});
