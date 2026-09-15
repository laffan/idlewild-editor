/**
 * Which tools show you what they are about to lay down.
 *
 * There is no DOM in this suite, so the painting itself is not exercised —
 * what is worth pinning is the membership, because it is the thing a new tool
 * silently gets wrong. A tool added to `DrawingTool` and forgotten here gets
 * no preview and nothing says so; a tool wrongly included paints a mark on the
 * live canvas that its session never clears, because the session that would
 * have cleared it is not the one that runs.
 */

import { describe, expect, it } from "vitest";
import { hasToolCursor } from "../cursor";
import type { DrawingTool } from "../types";

const ALL: DrawingTool[] = [
  "pencil",
  "pattern",
  "shape",
  "eraser",
  "lasso",
  "fill",
  "zone",
];

describe("the tools that preview themselves", () => {
  it("is the three that put a mark down under the pointer", () => {
    expect(ALL.filter(hasToolCursor)).toEqual(["pencil", "pattern", "shape"]);
  });

  /**
   * A sweep and a lasso are a *path*, and a path has nothing at the pointer to
   * show: what either lays down is decided on release, by where the whole
   * gesture went. The Boundary sweep is the same shape of thing.
   */
  it("leaves out the three whose mark is the gesture rather than the tip", () => {
    expect(hasToolCursor("fill")).toBe(false);
    expect(hasToolCursor("lasso")).toBe(false);
    expect(hasToolCursor("zone")).toBe(false);
  });

  /**
   * Slice is the exception that keeps its own painter. It takes ink *away*, so
   * there is no mark to preview — `drawEraserCursor` paints the disc it cuts
   * with instead, and it has done since before this existed.
   */
  it("leaves out Slice, which has a disc of its own", () => {
    expect(hasToolCursor("eraser")).toBe(false);
  });
});
