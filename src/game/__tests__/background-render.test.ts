/**
 * A gradient's four corner colours.
 *
 * Phaser's graphics take one colour per corner and interpolate between them,
 * so an angled gradient is each corner sampled off the gradient's own axis.
 * The arithmetic is duplicated in every project's own `WorldScene.js` as a
 * marked block, which is what makes it worth pinning: a sky that runs the
 * wrong way in the editor and the right way in the game, or the other way
 * round, is a bug nobody would look for here.
 */

import { describe, expect, it } from "vitest";
import { gradientCorners } from "../background-render";

const BLACK = "#000000";
const WHITE = "#ffffff";

/** `[topLeft, topRight, bottomLeft, bottomRight]`, as Phaser takes them. */
const at = (angle: number) => gradientCorners(BLACK, WHITE, angle);

describe("a gradient's corners", () => {
  it("runs top to bottom at zero, with the first stop at the top", () => {
    const [tl, tr, bl, br] = at(0);
    expect([tl, tr]).toEqual([0x000000, 0x000000]);
    expect([bl, br]).toEqual([0xffffff, 0xffffff]);
  });

  it("runs left to right at ninety", () => {
    const [tl, tr, bl, br] = at(90);
    expect([tl, bl]).toEqual([0x000000, 0x000000]);
    expect([tr, br]).toEqual([0xffffff, 0xffffff]);
  });

  it("turns over at a hundred and eighty", () => {
    const [tl, tr, bl, br] = at(180);
    expect([bl, br]).toEqual([0x000000, 0x000000]);
    expect([tl, tr]).toEqual([0xffffff, 0xffffff]);
  });

  it("runs corner to corner on a diagonal, with the other two half way", () => {
    const [tl, tr, bl, br] = at(45);
    expect(tl).toBe(0x000000);
    expect(br).toBe(0xffffff);
    expect(tr).toBe(bl);
    expect(tr).toBeGreaterThan(0x000000);
    expect(tr).toBeLessThan(0xffffff);
  });

  it("mixes channel by channel rather than on the packed number", () => {
    // Halfway between #ff0000 and #0000ff is #800080, not the average of the
    // two 24-bit integers, which would be #7f8080.
    const [, , , mid] = gradientCorners("#ff0000", "#0000ff", 90);
    const [tl] = gradientCorners("#ff0000", "#0000ff", 90);
    expect(tl).toBe(0xff0000);
    expect(mid).toBe(0x0000ff);
    const [, half] = gradientCorners("#ff0000", "#0000ff", 45);
    expect(half & 0x00ff00).toBe(0);
  });

  it("falls back to the accent for a colour it cannot read", () => {
    expect(gradientCorners("not a colour", "not a colour", 0)[0]).toBe(0xec3013);
  });
});
