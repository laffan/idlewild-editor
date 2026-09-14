/**
 * Which bar each tool is on, and that every tool has a name.
 *
 * There is no DOM in this suite, so the class that builds the buttons is not
 * exercised — what is asserted is the table it reads, which is where the
 * layout actually lives. Two things go quietly wrong otherwise and neither
 * throws: a tool added to `ToolId` and forgotten in the table gets no button
 * anywhere and a blank label when something else puts it in your hand, and a
 * tool put on the wrong bar reads as belonging to a group it does not.
 *
 * The three groups are the whole point of the rearrangement, so they are
 * written out rather than derived: the camera's two at the top corner, the
 * two that make something out of bare ground below, and the ink under them.
 */

import { describe, expect, it } from "vitest";
import { OFF_BAR, TOOLS, toolName } from "../tool-rail";
import { TOOL_IDS, type ToolId } from "../../lib/types";

/** The ids on one bar, in the order they are drawn. */
function bar(name: "rail" | "place" | "draw"): ToolId[] {
  return TOOLS.filter((tool) => tool.bar === name).map((tool) => tool.id);
}

describe("the three bars", () => {
  it("keeps the camera's two on the rail", () => {
    expect(bar("rail")).toEqual(["select", "pan"]);
  });

  it("puts the two that make something out of bare ground together", () => {
    expect(bar("place")).toEqual(["point", "zone"]);
  });

  it("gathers the ink on the drawing toolbar", () => {
    // Pixels and Fill are here rather than inside PSD Edit mode, which is the
    // move: both work anywhere, and a rail that appeared with a mode was a
    // rail whose buttons moved under your hand.
    expect(bar("draw")).toEqual(["pencil", "pixels", "eraser", "lasso", "fill"]);
  });

  it("gives every tool exactly one home", () => {
    const seen = new Set<string>();
    for (const tool of TOOLS) {
      expect(seen.has(tool.id), `${tool.id} is on two bars`).toBe(false);
      seen.add(tool.id);
    }
    // Rub is the one with no button on any bar: it is a toggle on PSD Edit
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
