/**
 * What the badge at the head of the tool rail says, and what a tap on it asks
 * for.
 *
 * The label is the whole of the readout, so it is asserted at the zooms that
 * actually occur rather than at round numbers: the camera arrives from the
 * document at whatever a pinch left it at, and the clamp at either end of
 * `scene-camera.ts` is where the interesting answers are.
 *
 * There is no DOM in this suite, as in `tool-bars.test.ts`, so the class that
 * builds the button is not exercised — what is asserted is the function that
 * decides what it says, which is where the behaviour actually lives.
 */

import { describe, expect, it } from "vitest";
import { zoomLabel } from "../zoom-badge";

describe("the label", () => {
  it("says a whole per cent at the zooms anybody works at", () => {
    expect(zoomLabel(1)).toBe("100%");
    expect(zoomLabel(4)).toBe("400%");
    expect(zoomLabel(0.5)).toBe("50%");
    // A pinch lands on numbers nobody typed, and the badge is a readout
    // rather than a field: a rounded one is what somebody can compare against
    // the 100% they are aiming for.
    expect(zoomLabel(1.0374)).toBe("104%");
  });

  /**
   * Below 1× the camera spends most of its range between a tenth and a
   * quarter, and a badge reading 10% over four separate zooms has stopped
   * being a readout. The tenth is dropped again the moment it is a zero, so
   * the ordinary case is still three characters.
   */
  it("keeps a tenth where the range is tight, and drops a trailing zero", () => {
    expect(zoomLabel(0.1)).toBe("10%");
    expect(zoomLabel(0.125)).toBe("12.5%");
    expect(zoomLabel(0.099)).toBe("9.9%");
  });

  it("answers 100% for a zoom that is not a number", () => {
    // A scene that has not booted answers for its camera with whatever the
    // caller had; nothing on screen should read "NaN%".
    expect(zoomLabel(Number.NaN)).toBe("100%");
    expect(zoomLabel(0)).toBe("100%");
  });
});
