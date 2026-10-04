import { describe, expect, it } from "vitest";
import { Grid } from "../../lib/grid";
import { cellsCovering, PREVIEW_GROUND, PREVIEW_LINE } from "../grid-preview";
import { GRID_LINE_COLOR } from "../../game/grid-renderer";
import tokens from "../../styles/tokens.css?raw";

describe("the New Project grid preview", () => {
  it("draws in the editor's own ground and line colours", () => {
    expect(PREVIEW_LINE).toBe(`#${GRID_LINE_COLOR.toString(16).padStart(6, "0")}`);
    expect(tokens).toContain(`--canvas-bg: ${PREVIEW_GROUND};`);
  });

  it("covers the whole strip, edges included", () => {
    const grid = new Grid("orthogonal", 64);
    const cells = cellsCovering(grid, { x: -280, y: -66, width: 560, height: 132 });
    const keys = new Set(cells.map((c) => `${c.cx},${c.cy}`));
    for (const corner of [
      grid.worldToCell({ x: -280, y: -66 }),
      grid.worldToCell({ x: 280, y: 66 }),
    ]) {
      expect(keys.has(`${corner.cx},${corner.cy}`)).toBe(true);
    }
    // Fewer spaces the bigger they are.
    const big = cellsCovering(new Grid("orthogonal", 256), { x: -280, y: -66, width: 560, height: 132 });
    expect(big.length).toBeLessThan(cells.length);
  });
});
