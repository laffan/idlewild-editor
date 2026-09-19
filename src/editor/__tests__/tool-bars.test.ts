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
import {
  canErase,
  ERASABLE,
  tileVerbOf,
  TOOLS,
  toolName,
  toolsFor,
} from "../tool-rail";
import { defaultPatternScale, stampBoxAt, stampSize } from "../stamp-box";
import { Grid } from "../../lib/grid";
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
    //
    // Text is last, and it is the one tool on this column that does not hand
    // the pointer to the drawing layer. It is here rather than on the rail
    // because the columns are about *ownership*: a word on the canvas is a
    // note in the margin of the artwork, and the next thing anybody does with
    // one is turn it into pixels.
    expect(bar("draw")).toEqual([
      "pencil",
      "pattern",
      "shape",
      "eraser",
      "lasso",
      "fill",
      "text",
    ]);
  });

  it("gives every tool exactly one home", () => {
    const seen = new Set<string>();
    for (const tool of TOOLS) {
      expect(seen.has(tool.id), `${tool.id} is in two columns`).toBe(false);
      seen.add(tool.id);
    }
    // And every tool has one. There used to be an exception — Rub, a toggle
    // on PSD Edit mode's own bar with no button on either column — and it
    // went when that mode started erasing with the four brushes turned round.
    // A tool in neither column gets no button anywhere and a blank label the
    // moment something puts it in your hand.
    for (const id of TOOL_IDS) {
      expect(seen.has(id), `${id} is in no column`).toBe(true);
    }
  });
});

/**
 * Which tools can be turned round to erase.
 *
 * The rule is "every tool that makes a mark", and it is written out rather
 * than derived because both ways of getting it wrong are silent: a brush left
 * out has no eraser and no way to say so, and a tool wrongly in — the Lasso,
 * say — grows a switch that changes nothing.
 */
describe("the brushes that can be turned round", () => {
  it("is the four that lay a mark down", () => {
    expect([...ERASABLE]).toEqual(["pencil", "pattern", "shape", "fill"]);
  });

  it("leaves out everything that draws nothing", () => {
    for (const tool of ["select", "pan", "point", "zone", "lasso"] as const) {
      expect(canErase(tool), `${tool} draws nothing`).toBe(false);
    }
  });

  it("leaves out Slice, which cuts strokes rather than pixels", () => {
    expect(canErase("eraser")).toBe(false);
    // And it is called Slice now: a tool called Eraser beside four brushes
    // that erase was the name doing the wrong job.
    expect(toolName("eraser")).toBe("Slice");
  });

  it("names every tool there is", () => {
    for (const id of TOOL_IDS) {
      expect(toolName(id), `${id} has no name`).not.toBe("");
    }
  });
});

/**
 * How big one Shape brush stamp is, which is the one number the drawing layer
 * takes from the projection.
 *
 * The blank case is the one worth a test. Its addressable cell is a single
 * world **pixel**, so "a grid space" read literally gives a one-pixel shape —
 * which is nothing at all on screen, and was.
 */
describe("a shape stamp", () => {
  it("is a grid space on a square project", () => {
    expect(stampSize(new Grid("orthogonal", 64))).toEqual({ width: 64, height: 64 });
  });

  it("is the 2:1 space on an isometric one, and says the space is a diamond", () => {
    const grid = new Grid("isometric", 64);
    expect(stampSize(grid)).toEqual({ width: 64, height: 32 });
    expect(stampBoxAt(grid, 0, 0).diamond).toBe(true);
  });

  it("is the nominal unit on a project with no lattice, not its one-pixel cell", () => {
    const grid = new Grid("blank", 32);
    expect(stampSize(grid)).toEqual({ width: 32, height: 32 });
    const box = stampBoxAt(grid, 70, 70);
    expect(box).toEqual({ x: 64, y: 64, width: 32, height: 32 });
    expect(box.diamond).toBeUndefined();
  });

  it("lands on the same lattice wherever inside a box it is asked about", () => {
    const grid = new Grid("blank", 32);
    for (const at of [64, 70, 80, 95]) {
      expect(stampBoxAt(grid, at, at).x).toBe(64);
    }
  });

  it("starts a pattern pixel at a sixteenth of a space", () => {
    expect(defaultPatternScale(new Grid("orthogonal", 64))).toBe(4);
    // Never below one: on an 8px grid a pattern tile *is* the tile.
    expect(defaultPatternScale(new Grid("orthogonal", 8))).toBe(1);
  });
});

/**
 * Which tools a layer offers, and what two of them mean there.
 *
 * A tile layer withdraws three and re-points two, and both halves are tables
 * rather than behaviour — so both are asserted here, where the rest of the
 * rail's tables are. What would otherwise go wrong is silent in the way this
 * file exists to catch: a Text tool on a tile layer writes a word nothing on
 * that layer can hold, and a Pencil that still handed its strokes to the
 * drawing layer would draw ink over a grid of tiles.
 */
describe("what a tile layer offers", () => {
  it("withholds the three that have nothing to do with tiles", () => {
    const offered = toolsFor("tile");
    expect(offered).not.toContain("pattern");
    expect(offered).not.toContain("shape");
    expect(offered).not.toContain("text");
    // And withholds nothing else: the rail proper is about the canvas rather
    // than about what is drawn on it, and Slice and the Lasso still reach ink
    // that is there, because a tile layer can carry strokes like any other.
    expect(offered).toEqual(
      TOOLS.map((tool) => tool.id).filter(
        (id) => id !== "pattern" && id !== "shape" && id !== "text",
      ),
    );
  });

  it("offers every tool on the three kinds that are not tile layers", () => {
    const all = TOOLS.map((tool) => tool.id);
    expect(toolsFor("object")).toEqual(all);
    expect(toolsFor("pattern")).toEqual(all);
    expect(toolsFor("background")).toEqual(all);
  });

  it("points exactly two of them at tiles", () => {
    expect(tileVerbOf("pencil")).toBe("stamp");
    expect(tileVerbOf("fill")).toBe("fill");
    // Everything else means nothing for tiles, which is what keeps a tile
    // layer selectable, pannable and pointable.
    for (const tool of TOOLS.map((t) => t.id)) {
      if (tool === "pencil" || tool === "fill") continue;
      expect(tileVerbOf(tool)).toBeNull();
    }
  });

  it("re-points only the tools that can be turned round", () => {
    // What makes "erase tiles" free rather than a fifth verb: the two tools a
    // tile layer paints with are both already erasers when they are turned
    // round, so the flag the rest of the editor uses is the one used here.
    expect(canErase("pencil")).toBe(true);
    expect(canErase("fill")).toBe(true);
  });
});
