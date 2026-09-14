import { describe, expect, it } from "vitest";
import {
  alphaOf,
  contrastInk,
  hexToHsv,
  hexToNumber,
  hexToRgb,
  hsvToHex,
  isValidHex,
  normaliseHex,
  opaqueHex,
  rgbToHex,
  withAlpha,
} from "../color";

describe("colour conversion", () => {
  it("round-trips hex through HSV", () => {
    for (const hex of ["#ec3013", "#201e1d", "#ffffff", "#000000", "#3a7bd5"]) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  it("expands shorthand hex", () => {
    expect(hexToRgb("#f00")).toEqual({ r: 255, g: 0, b: 0 });
    expect(normaliseHex("0f8")).toBe("#00ff88");
  });

  it("clamps out-of-range channels rather than wrapping them", () => {
    expect(rgbToHex({ r: 300, g: -20, b: 128 })).toBe("#ff0080");
  });

  it("keeps greys at zero saturation", () => {
    expect(hexToHsv("#808080").s).toBe(0);
  });

  it("validates hex input", () => {
    expect(isValidHex("#abc")).toBe(true);
    expect(isValidHex("abcdef")).toBe(true);
    // Four digits is CSS's `rgba` shorthand, which the opacity slider made
    // meaningful: `#abcd` is `#aabbccdd`.
    expect(isValidHex("#abcd")).toBe(true);
    expect(isValidHex("#aabbccdd")).toBe(true);
    expect(isValidHex("#abcde")).toBe(false);
    expect(isValidHex("nope")).toBe(false);
  });

  it("picks readable ink for a swatch label", () => {
    expect(contrastInk("#ffffff")).toBe("#201e1d");
    expect(contrastInk("#201e1d")).toBe("#f3f2f2");
    expect(contrastInk("#ec3013")).toBe("#f3f2f2");
  });
});

/**
 * Opacity rides in the colour, as the eighth and ninth characters of a hex.
 *
 * The load-bearing half is what it does *not* do: a colour at full opacity is
 * written with six digits, exactly as it always was. Every document already on
 * disk, every reader in the exported game and every older build of the editor
 * keep working, and a project where nobody touched the slider has an empty
 * diff.
 */
describe("opacity", () => {
  it("reads a colour that does not mention it as opaque", () => {
    expect(alphaOf("#ec3013")).toBe(1);
    expect(alphaOf("#e31")).toBe(1);
    expect(alphaOf("")).toBe(1);
  });

  it("reads the pair a colour does carry", () => {
    expect(alphaOf("#ec301300")).toBe(0);
    expect(alphaOf("#ec3013ff")).toBe(1);
    expect(alphaOf("#ec301380")).toBeCloseTo(128 / 255, 5);
    // Four digits is the shorthand: the last one doubles.
    expect(alphaOf("#e318")).toBeCloseTo(0x88 / 255, 5);
  });

  it("writes six digits at full opacity and eight below it", () => {
    expect(withAlpha("#ec3013", 1)).toBe("#ec3013");
    expect(withAlpha("#ec301380", 1)).toBe("#ec3013");
    expect(withAlpha("#ec3013", 0)).toBe("#ec301300");
    expect(withAlpha("#ec3013", 0.5)).toBe("#ec301380");
  });

  it("round-trips, so a slider dragged twice lands where it was", () => {
    for (const a of [0, 0.25, 0.5, 0.75, 1]) {
      const hex = withAlpha("#3a7bd5", a);
      expect(alphaOf(hex)).toBeCloseTo(Math.round(a * 255) / 255, 5);
      expect(opaqueHex(hex)).toBe("#3a7bd5");
    }
  });

  it("leaves the colour alone when it takes the opacity off", () => {
    expect(hexToRgb("#ec301380")).toEqual(hexToRgb("#ec3013"));
    expect(hexToNumber("#ec301380")).toBe(0xec3013);
    expect(hexToHsv("#ec301380")).toEqual(hexToHsv("#ec3013"));
  });

  it("carries opacity through a normalise", () => {
    expect(normaliseHex("EC301380")).toBe("#ec301380");
    expect(normaliseHex("#e318")).toBe("#ee331188");
    expect(normaliseHex("#e31")).toBe("#ee3311");
  });

  /** Only a hand-edited document can hold one, and it should be visible. */
  it("paints the accent for a colour it cannot read", () => {
    expect(hexToNumber("not a colour")).toBe(0xec3013);
  });
});
