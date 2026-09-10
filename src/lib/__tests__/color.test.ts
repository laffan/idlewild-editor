import { describe, expect, it } from "vitest";
import {
  contrastInk,
  hexToHsv,
  hexToRgb,
  hsvToHex,
  isValidHex,
  normaliseHex,
  rgbToHex,
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
    expect(isValidHex("#abcd")).toBe(false);
    expect(isValidHex("nope")).toBe(false);
  });

  it("picks readable ink for a swatch label", () => {
    expect(contrastInk("#ffffff")).toBe("#201e1d");
    expect(contrastInk("#201e1d")).toBe("#f3f2f2");
    expect(contrastInk("#ec3013")).toBe("#f3f2f2");
  });
});
