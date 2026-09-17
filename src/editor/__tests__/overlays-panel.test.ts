/**
 * What the Overlays switches remember between sessions.
 *
 * The parse is the part worth holding to account. It reads something a
 * *previous version of this app* wrote, out of a store that can also hand back
 * a half-written string, another tab's JSON, or nothing at all — and the cost
 * of getting it wrong is a mark switched off that nobody asked to switch off,
 * with the switch that would explain it reading "on". So the rule is that
 * anything not plainly a boolean falls back to showing the mark.
 */

import { describe, expect, it } from "vitest";
import { OVERLAY_DEFAULTS, readOverlays } from "../overlays-panel";

describe("the remembered switches", () => {
  it("shows everything when there is nothing stored", () => {
    expect(readOverlays(null)).toEqual(OVERLAY_DEFAULTS);
    expect(readOverlays("")).toEqual(OVERLAY_DEFAULTS);
  });

  it("reads back what was written", () => {
    const stored = { boundary: false, centre: true, minimap: false, open: false };
    expect(readOverlays(JSON.stringify(stored))).toEqual(stored);
  });

  /**
   * A key added later must not turn three marks off for everyone who has used
   * the app before, so a partial record keeps the defaults for what it does
   * not mention.
   */
  it("fills in what an older version did not write", () => {
    expect(readOverlays('{"boundary":false}')).toEqual({
      ...OVERLAY_DEFAULTS,
      boundary: false,
    });
  });

  it("ignores values that are not booleans", () => {
    expect(readOverlays('{"boundary":"no","centre":0,"minimap":null}')).toEqual(
      OVERLAY_DEFAULTS,
    );
  });

  it("survives anything else under the same key", () => {
    for (const raw of ["not json", "[]", "null", "42", '"a string"']) {
      expect(readOverlays(raw)).toEqual(OVERLAY_DEFAULTS);
    }
  });

  it("hands back a copy, so a caller cannot edit the defaults", () => {
    const first = readOverlays(null);
    first.boundary = false;
    expect(readOverlays(null).boundary).toBe(true);
    expect(OVERLAY_DEFAULTS.boundary).toBe(true);
  });
});
