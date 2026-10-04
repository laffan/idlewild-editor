import { describe, expect, it } from "vitest";
import {
  carryPixelScale,
  pixelScaleOf,
  readCustomScale,
  rememberPixelScale,
  rescaledAbout,
} from "../psd-pixel-scale";
import { setOpenProject } from "../../lib/print";
import type { Placement, ProjectMeta } from "../../lib/types";

const meta = (): ProjectMeta => ({
  id: "p",
  name: "P",
  projection: "blank",
  genre: "p2p",
  gridSize: 16,
  createdAt: 0,
  updatedAt: 0,
  layerCount: 1,
});

describe("pixel art rescale", () => {
  it("reads a typed factor as a whole number from 2 to 16", () => {
    expect(readCustomScale("6")).toBe(6);
    expect(readCustomScale(" 8× ")).toBe(8);
    expect(readCustomScale("8x")).toBe(8);
    expect(readCustomScale("1")).toBeNull();
    expect(readCustomScale("2.5")).toBeNull();
    expect(readCustomScale("17")).toBeNull();
    expect(readCustomScale("big")).toBeNull();
  });

  it("keeps the open project's factors, and carries them with a file", () => {
    setOpenProject(meta());
    expect(pixelScaleOf("hero")).toBe(1);
    rememberPixelScale("hero", 4);
    expect(pixelScaleOf("hero")).toBe(4);
    carryPixelScale("hero", "hero-copy", false);
    carryPixelScale("hero", "knight", true);
    expect([pixelScaleOf("hero"), pixelScaleOf("hero-copy"), pixelScaleOf("knight")]).toEqual([1, 4, 4]);
    rememberPixelScale("knight", 1);
    expect(pixelScaleOf("knight")).toBe(1);
    setOpenProject(null);
  });

  it("shrinks a placement about the point its mark stands on", () => {
    // Drawn at half size against a manifest four times the file, its mark 8
    // file pixels in from the corner: the mark is at 100 - 8 * 0.5 = 96.
    const placement: Placement = {
      id: "a",
      psdKey: "hero",
      layerPath: "hero",
      x: 100,
      y: 50,
      width: 64,
      height: 32,
      naturalWidth: 128,
      naturalHeight: 64,
      anchor: { cx: 0, cy: 0 },
      fromAnchor: { x: 8, y: 4 },
    };
    const next = rescaledAbout(placement, 1 / 4, { x: 0, y: 0 });
    expect(next).toEqual({ x: 97, y: 48.5, width: 16, height: 8 });
    // The mark has not moved: x - fromAnchor * new scale.
    expect(next.x! - 8 * (16 / 128)).toBe(96);
  });
});
