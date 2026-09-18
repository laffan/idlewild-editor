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
import { OVERLAY_DEFAULTS, overlayRows, readOverlays } from "../overlays-panel";

describe("the remembered switches", () => {
  it("shows everything when there is nothing stored", () => {
    expect(readOverlays(null)).toEqual(OVERLAY_DEFAULTS);
    expect(readOverlays("")).toEqual(OVERLAY_DEFAULTS);
  });

  /**
   * Asserted against the literal answers rather than against the defaults, so
   * this says what a first-run project looks like instead of agreeing with
   * whatever the constant happens to hold. The two halves are separate
   * decisions: every mark on, because a mark off by default is a mark somebody
   * has to be told exists; the section folded, because four rows of chrome
   * over the map every session is more than switches you act on rarely earn.
   */
  it("opens a first-run project with the section folded and the marks on", () => {
    expect(readOverlays(null)).toEqual({
      grid: true,
      boundary: true,
      centre: true,
      minimap: true,
      open: false,
    });
  });

  it("reads back what was written", () => {
    const stored = {
      grid: false,
      boundary: false,
      centre: true,
      minimap: false,
      open: false,
    };
    expect(readOverlays(JSON.stringify(stored))).toEqual(stored);
  });

  /**
   * A key added later must not turn the marks off for everyone who has used
   * the app before, so a partial record keeps the defaults for what it does
   * not mention. `grid` is exactly that key — every install that used this app
   * before it existed has a stored record with no `grid` in it, and the
   * lattice had better come back on.
   */
  it("fills in what an older version did not write", () => {
    expect(readOverlays('{"boundary":false}')).toEqual({
      ...OVERLAY_DEFAULTS,
      boundary: false,
    });
    expect(
      readOverlays('{"boundary":true,"centre":true,"minimap":true,"open":true}').grid,
    ).toBe(true);
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

/**
 * Which rows a project is given.
 *
 * The blank template draws no lattice at all — its cells are single pixels and
 * `grid-renderer.ts` returns before it strokes anything — so a Grid switch
 * there would be a control over nothing. The other three are about the canvas
 * rather than about the grid, so every project has them.
 */
describe("the rows a project gets", () => {
  it("offers the lattice where there is one", () => {
    expect(overlayRows(true).map((row) => row.key)).toEqual([
      "grid",
      "boundary",
      "centre",
      "minimap",
    ]);
  });

  it("leaves it out where there is not, rather than offering a dead switch", () => {
    expect(overlayRows(false).map((row) => row.key)).toEqual([
      "boundary",
      "centre",
      "minimap",
    ]);
  });
});
