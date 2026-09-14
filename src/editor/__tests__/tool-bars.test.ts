/**
 * Which column each tool is in, and that every tool has a name.
 *
 * There is no DOM in this suite, so the class that builds the buttons is not
 * exercised — what is asserted is the table it reads, which is where the
 * layout actually lives. Two things go quietly wrong otherwise and neither
 * throws: a tool added to `ToolId` and forgotten in the table gets no button
 * anywhere and a blank label when something else puts it in your hand, and a
 * tool put in the wrong column reads as belonging to a group it does not.
 *
 * The split is the whole point of the rearrangement, so both halves are
 * written out rather than derived: what you do *to* the canvas hangs from the
 * top, and the ink stands on the bottom.
 */

import { describe, expect, it } from "vitest";
import { OFF_BAR, TOOLS, toolName } from "../tool-rail";
import { TOOL_IDS, type ToolId } from "../../lib/types";

/** The ids in one column, in the order they are drawn. */
function bar(name: "rail" | "draw"): ToolId[] {
  return TOOLS.filter((tool) => tool.bar === name).map((tool) => tool.id);
}

describe("the two columns", () => {
  it("hangs what you do to the canvas from the top", () => {
    // The camera's two, then the two that make something out of bare ground —
    // nothing already on the canvas can be promoted into either.
    expect(bar("rail")).toEqual(["select", "pan", "point", "zone"]);
  });

  it("stands the ink on the bottom", () => {
    // Pattern and Fill are here rather than inside PSD Edit mode, which is the
    // move: both work anywhere, and a rail that appeared with a mode was a
    // rail whose buttons moved under your hand. Pattern and Shape sit beside
    // the Pencil because all three are things that lay a mark down — what
    // differs is what the mark is made of.
    expect(bar("draw")).toEqual([
      "pencil",
      "pattern",
      "shape",
      "eraser",
      "lasso",
      "fill",
    ]);
  });

  it("gives every tool exactly one home", () => {
    const seen = new Set<string>();
    for (const tool of TOOLS) {
      expect(seen.has(tool.id), `${tool.id} is in two columns`).toBe(false);
      seen.add(tool.id);
    }
    // Rub is the one with no button in either: it is a toggle on PSD Edit
    // mode's own bar, because it means nothing outside that mode.
    expect(Object.keys(OFF_BAR)).toEqual(["rub"]);
    expect(seen.has("rub")).toBe(false);
  });

  it("names every tool there is", () => {
    for (const id of TOOL_IDS) {
      expect(toolName(id), `${id} has no name`).not.toBe("");
    }
  });
});
