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
 * The split is the whole point of the rearrangement, so every column is
 * written out rather than derived: what you do *to* the canvas hangs from the
 * top, the ink stands on the bottom, and the two tools that act on strokes
 * already there stand just above it.
 */

import { describe, expect, it } from "vitest";
import {
  canErase,
  ERASABLE,
  shortcutFor,
  tileVerbOf,
  TOOL_KEYS,
  toolForKey,
  TOOLS,
  toolName,
  toolsFor,
} from "../tool-rail";
import { defaultPatternScale, stampBoxAt, stampSize } from "../stamp-box";
import { Grid } from "../../lib/grid";
import { TOOL_IDS, type ToolId } from "../../lib/types";

/** The ids in one column, in the order they are drawn. */
function bar(name: "rail" | "strokes" | "draw"): ToolId[] {
  return TOOLS.filter((tool) => tool.bar === name).map((tool) => tool.id);
}

describe("the two columns", () => {
  it("hangs what you do to the canvas from the top", () => {
    // The pointer and the camera. Point and Boundary still have a column so
    // they keep a name, but no layer offers them — see the next test.
    expect(bar("rail")).toEqual(["select", "pan", "point", "zone"]);
    expect(toolsFor("object").filter((id) => bar("rail").includes(id))).toEqual([
      "select",
      "pan",
    ]);
  });

  it("offers Point and Boundary on no layer at all", () => {
    for (const kind of ["object", "pattern", "background", "tile"] as const) {
      for (const editing of [false, true]) {
        const offered = toolsFor(kind, editing);
        expect(offered, `${kind}, editing: ${editing}`).not.toContain("point");
        expect(offered, `${kind}, editing: ${editing}`).not.toContain("zone");
      }
    }
  });

  it("stands Lasso and Slice in a group of their own, over the ink", () => {
    // Neither lays a mark down: both act on strokes that are already there.
    expect(bar("strokes")).toEqual(["lasso", "eraser"]);
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
      "fill",
      "text",
      // A tile layer's three, which stand with the ink for the same reason
      // it does: they are what a hand is doing most of the time there. No
      // column shows all ten at once — see `toolsFor`.
      "stamp",
      "sweep",
      "shapefill",
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
  it("is the seven that lay a mark down", () => {
    expect([...ERASABLE]).toEqual([
      "pencil",
      "pattern",
      "shape",
      "fill",
      // The three tile tools are the same idea on a grid of tiles: what
      // Stamp would put down it takes off, and what a fill would cover it
      // clears. That is the whole of how a tile is removed, for the reason
      // there is no separate rubber anywhere else in this editor.
      "stamp",
      "sweep",
      "shapefill",
    ]);
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
  it("offers only the ones that do something there", () => {
    // A toolbar is a list of what you can do. The first version kept the
    // Pencil and Fill and gave them a second meaning on a tile layer, which
    // is a tool nobody can learn; the second kept the whole rail, which is
    // two buttons whose result is invisible on the layer you used them on.
    expect(toolsFor("tile")).toEqual([
      "select",
      "pan",
      "stamp",
      "sweep",
      "shapefill",
    ]);
  });

  it("keeps the two that are the canvas rather than the document", () => {
    // Pan is the camera; Select catches a run of tiles there the way it
    // catches placed images elsewhere.
    expect(toolsFor("tile")).toContain("select");
    expect(toolsFor("tile")).toContain("pan");
  });

  it("offers the ordinary set on the three kinds that are not tile layers", () => {
    const left: readonly ToolId[] = ["stamp", "sweep", "shapefill", "point", "zone"];
    const ink = TOOLS.map((tool) => tool.id).filter((id) => !left.includes(id));
    expect(toolsFor("object")).toEqual(ink);
    expect(toolsFor("pattern")).toEqual(ink);
    expect(toolsFor("background")).toEqual(ink);
  });

  it("gives the ink back while a PSD is open for drawing", () => {
    // A file open in PSD Edit mode is ordinary artwork being drawn on, and
    // the layer underneath it holding tiles has nothing to do with what the
    // pointer is for. There is nowhere for a tile to go while it is up.
    const editing = toolsFor("tile", true);
    expect(editing).toContain("pencil");
    expect(editing).not.toContain("stamp");
    expect(editing).not.toContain("sweep");
    expect(editing).not.toContain("shapefill");
  });

  it("never shows the ink and the tile tools together", () => {
    // The rule said out loud, because it is the one the first two versions
    // both broke: a tile layer has its own toolbar or the ordinary one, and
    // there is no state in which a hand can reach both.
    const tileOnly: readonly ToolId[] = ["stamp", "sweep", "shapefill"];
    const ink: readonly ToolId[] = ["pencil", "pattern", "shape", "fill", "text"];
    for (const [kind, editing] of [
      ["tile", false],
      ["tile", true],
      ["object", false],
    ] as const) {
      const offered = toolsFor(kind, editing);
      const hasTile = offered.some((id) => tileOnly.includes(id));
      const hasInk = offered.some((id) => ink.includes(id));
      expect(hasTile && hasInk, `${kind}, editing: ${editing}`).toBe(false);
    }
  });

  it("names exactly three of the tools as tile tools", () => {
    expect(tileVerbOf("stamp")).toBe("stamp");
    expect(tileVerbOf("sweep")).toBe("sweep");
    expect(tileVerbOf("shapefill")).toBe("shapefill");
    // Everything else means nothing for tiles, which is what keeps a tile
    // layer selectable and pannable.
    const tileOnly: readonly ToolId[] = ["stamp", "sweep", "shapefill"];
    for (const tool of TOOLS.map((t) => t.id)) {
      if (tileOnly.includes(tool)) continue;
      expect(tileVerbOf(tool)).toBeNull();
    }
  });

  it("lets all three be turned round, which is how a tile is taken off", () => {
    expect(canErase("stamp")).toBe(true);
    expect(canErase("sweep")).toBe(true);
    expect(canErase("shapefill")).toBe(true);
  });
});

/**
 * The letters that pick a tool up, and what each tooltip says about them.
 *
 * One table feeds both, so a key the tooltip names is a key that works; what
 * is asserted is the table and the two reads of it.
 */
describe("the tool keys", () => {
  it("is the six letters asked for", () => {
    expect(Object.keys(TOOL_KEYS).sort()).toEqual(["e", "l", "p", "s", "t", "v"]);
    expect(toolForKey("v", toolsFor("object"))).toBe("select");
    expect(toolForKey("t", toolsFor("object"))).toBe("text");
    expect(toolForKey("l", toolsFor("object"))).toBe("lasso");
    expect(toolForKey("p", toolsFor("object"))).toBe("pattern");
    expect(toolForKey("e", toolsFor("object"))).toBe("eraser");
  });

  it("reads S as Stamp on a tile layer and Shape everywhere else", () => {
    expect(toolForKey("s", toolsFor("tile"))).toBe("stamp");
    expect(toolForKey("s", toolsFor("object"))).toBe("shape");
  });

  it("picks up nothing the toolbar is not showing", () => {
    // A tile layer has no Pattern brush, Text or Lasso; and with the toolbars
    // down nothing is on offer at all.
    expect(toolForKey("p", toolsFor("tile"))).toBeNull();
    expect(toolForKey("t", toolsFor("tile"))).toBeNull();
    expect(toolForKey("l", toolsFor("tile"))).toBeNull();
    expect(toolForKey("v", [])).toBeNull();
  });

  it("does not care about case, so Caps Lock does not turn the keys off", () => {
    expect(toolForKey("V", toolsFor("object"))).toBe("select");
  });

  it("puts each key on the tooltip of every tool it picks up", () => {
    for (const [key, tools] of Object.entries(TOOL_KEYS)) {
      for (const tool of tools) expect(shortcutFor(tool)).toBe(key.toUpperCase());
    }
    expect(shortcutFor("pan")).toBe("Hold Space");
    expect(shortcutFor("pencil")).toBe("");
  });
});
