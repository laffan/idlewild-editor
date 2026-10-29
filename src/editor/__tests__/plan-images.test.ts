/**
 * The colour a picture dropped on the plan is baked to — `plan-image-bake.ts`
 * — and the four numbers and an angle it is read back into after its box has
 * moved, scaled or turned it — `plan-images.ts`.
 *
 * The claim worth pinning is the one the multiply depends on: white stays
 * white, so it vanishes over whatever is under it, black comes out the plan's
 * blue, and a colour is judged only by how light it is.
 */

import { describe, expect, it } from "vitest";
import { tint } from "../plan-image-bake";
import { frameOf, transformed } from "../plan-images";
import {
  compose,
  invert,
  rotationAbout,
  scalingAbout,
  translation,
} from "../../drawing/transform";
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

describe("a plan picture moved, scaled and turned through its box", () => {
  const image = { id: "p", src: "", x: 0, y: 0, width: 200, height: 100 };

  it("turns about its middle and keeps its size", () => {
    const turned = transformed(image, rotationAbout(100, 50, Math.PI / 2));
    expect(turned.rotation).toBeCloseTo(Math.PI / 2);
    expect(turned.width).toBeCloseTo(200);
    expect(turned.height).toBeCloseTo(100);
    // The unturned rectangle keeps its middle, so it keeps its top-left too.
    expect(turned.x).toBeCloseTo(0);
    expect(turned.y).toBeCloseTo(0);
  });

  it("scales along its own sides once it is turned", () => {
    const turned = transformed(image, rotationAbout(100, 50, Math.PI / 2));
    // Doubling along the picture's own width, about its middle, as a corner
    // handle does through the frame.
    const frame = frameOf(turned);
    const local = compose(compose(invert(frame), scalingAbout(100, 50, 2, 1)), frame);
    const scaled = transformed(turned, local);
    expect(scaled.width).toBeCloseTo(400);
    expect(scaled.height).toBeCloseTo(100);
    expect(scaled.rotation).toBeCloseTo(Math.PI / 2);
  });

  it("drops the angle once it is turned back square", () => {
    const turned = transformed(image, rotationAbout(100, 50, 0.4));
    const back = transformed(turned, rotationAbout(100, 50, -0.4));
    expect(back.rotation).toBeUndefined();
    expect(back.x).toBeCloseTo(0);
  });

  it("moves without changing anything else", () => {
    const moved = transformed(image, translation(30, -20));
    expect([moved.x, moved.y, moved.width, moved.height]).toEqual([30, -20, 200, 100]);
  });
});
