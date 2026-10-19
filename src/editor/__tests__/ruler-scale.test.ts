/**
 * An artboard's ruler at a zoom — see `editor/ruler-scale.ts`.
 */

import { describe, expect, it } from "vitest";
import { guideLabel, pointAt, rulerScale, tickLabel } from "../ruler-scale";

describe("rulerScale", () => {
  it("numbers every inch at 1×, in eighths between", () => {
    const scale = rulerScale("in", 1);
    expect(scale.majorUnits).toBe(1);
    expect(scale.majorPt).toBe(72);
    expect(scale.minorPt).toBe(9);
  });

  it("numbers further apart as the camera pulls back, and never closer than it can read", () => {
    const far = rulerScale("in", 0.1);
    expect(far.majorPt * 0.1).toBeGreaterThanOrEqual(56);
    expect(far.minorPt * 0.1).toBeGreaterThanOrEqual(6);
  });

  it("numbers fractions of an inch close up", () => {
    expect(rulerScale("in", 8).majorUnits).toBe(0.125);
  });

  it("counts centimetres in millimetres once they are far enough apart", () => {
    const close = rulerScale("cm", 3);
    expect(close.majorUnits).toBe(1);
    expect(close.majorPt / close.minorPt).toBe(10);
    // At 2× a millimetre is under six pixels, so the half centimetres go alone.
    expect(rulerScale("cm", 2).majorPt / rulerScale("cm", 2).minorPt).toBe(5);
  });
});

describe("labels", () => {
  it("say the unit on a guide and not on a tick", () => {
    expect(tickLabel(108, "in")).toBe("1.5");
    expect(guideLabel(108, "in")).toBe("1.5 in");
    expect(guideLabel(72 / 2.54, "cm")).toBe("1 cm");
  });
});

describe("pointAt", () => {
  it("lands on a whole point at any zoom", () => {
    expect(pointAt(150, 2)).toBe(75);
    expect(pointAt(151, 2)).toBe(76);
    expect(pointAt(10, 0)).toBe(10);
  });
});
