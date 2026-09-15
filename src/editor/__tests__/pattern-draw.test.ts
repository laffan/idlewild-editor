/**
 * What a gesture does to a pattern grid.
 *
 * The rule under all of it is **wrapping**: every write is taken modulo the
 * pattern's size, so a tip that hangs off an edge paints the opposite edge as
 * well. That is the whole of what makes a pattern drawn here seamless — you
 * draw across the boundary and the repeat takes care of itself, instead of
 * drawing a tile and then going back to fix its four edges.
 */

import { describe, expect, it } from "vitest";
import { brushCells, brushPreviewCells, imageToBits } from "../pattern-editor/brushes";
import {
  applyBrush,
  bitsToPattern,
  commitOffset,
  invert,
  lineInto,
  moveRegion,
  nudge,
  regionBits,
  resize,
  selectionBits,
  setSelection,
} from "../pattern-editor/draw";
import {
  createPatternState,
  redo,
  selectionBounds,
  undo,
  type PatternEditorState,
} from "../pattern-editor/state";
import { emptyPattern } from "../../lib/library";

function stateOf(size = 8): PatternEditorState {
  return createPatternState(emptyPattern(size), null, "Test");
}

const filled = (state: PatternEditorState): string[] => {
  const out: string[] = [];
  state.pattern.pixels.forEach((row, r) =>
    row.forEach((v, c) => {
      if (v === 1) out.push(`${r},${c}`);
    }),
  );
  return out.sort();
};

describe("a brush tip", () => {
  it("is one cell at size one", () => {
    const state = stateOf();
    expect(brushCells(state, 3, 3)).toEqual([{ row: 3, col: 3 }]);
  });

  it("is a filled square at a larger size", () => {
    const state = stateOf();
    state.brushSize = 3;
    expect(brushCells(state, 4, 4)).toHaveLength(9);
  });

  it("is a disc rather than a square when it is round", () => {
    const state = stateOf();
    state.brush = "round";
    state.brushSize = 4;
    const cells = brushCells(state, 5, 5);
    // The corners of the enclosing square are outside the radius.
    expect(cells).not.toContainEqual({ row: 3, col: 3 });
    expect(cells).toContainEqual({ row: 5, col: 5 });
  });

  it("sprays a different set each time, but previews as a steady disc", () => {
    const state = stateOf();
    state.brush = "airbrush";
    state.brushSize = 8;
    const a = brushPreviewCells(state, 4, 4);
    const b = brushPreviewCells(state, 4, 4);
    expect(a).toEqual(b);
  });

  it("falls back to one cell when a custom tip has nothing in it", () => {
    const state = stateOf();
    state.brush = "custom";
    expect(brushCells(state, 2, 2)).toEqual([{ row: 2, col: 2 }]);
  });
});

describe("drawing", () => {
  it("wraps a tip that hangs off the edge round to the other side", () => {
    const state = stateOf(4);
    state.brushSize = 3;
    applyBrush(state, state.pattern, 0, 0, 1);
    // The 3×3 centred on (0,0) reaches rows and columns 3, 0 and 1.
    expect(filled(state)).toEqual(
      ["3,3", "3,0", "3,1", "0,3", "0,0", "0,1", "1,3", "1,0", "1,1"].sort(),
    );
  });

  it("walks a line rather than leaving two blobs", () => {
    const state = stateOf(8);
    state.pattern = lineInto(state, state.pattern, { row: 0, col: 0 }, { row: 7, col: 7 }, 1);
    for (let i = 0; i < 8; i++) expect(state.pattern.pixels[i][i]).toBe(1);
  });

  it("erases by writing zero with the same tip", () => {
    const state = stateOf(4);
    applyBrush(state, state.pattern, 1, 1, 1);
    applyBrush(state, state.pattern, 1, 1, 0);
    expect(filled(state)).toEqual([]);
  });
});

describe("the whole grid at once", () => {
  it("inverts, and takes it back", () => {
    const state = stateOf(2);
    invert(state);
    expect(filled(state)).toHaveLength(4);
    expect(undo(state)).toBe(true);
    expect(filled(state)).toEqual([]);
    expect(redo(state)).toBe(true);
    expect(filled(state)).toHaveLength(4);
  });

  it("tiles what is drawn when it grows", () => {
    const state = stateOf(2);
    applyBrush(state, state.pattern, 0, 0, 1);
    resize(state, 4);
    expect(state.pattern.size).toBe(4);
    expect(filled(state)).toEqual(["0,0", "0,2", "2,0", "2,2"].sort());
  });

  it("wraps when it is nudged", () => {
    const state = stateOf(4);
    applyBrush(state, state.pattern, 0, 0, 1);
    nudge(state, -1, 0);
    expect(filled(state)).toEqual(["0,3"]);
  });

  it("writes a drag's offset once, on release", () => {
    const state = stateOf(4);
    applyBrush(state, state.pattern, 0, 0, 1);
    state.offset = { x: 2, y: 1 };
    commitOffset(state);
    expect(filled(state)).toEqual(["1,2"]);
    expect(state.offset).toEqual({ x: 0, y: 0 });
  });
});

describe("a selection", () => {
  it("reads its corners in either order", () => {
    const state = stateOf(8);
    state.selection = { r0: 5, c0: 6, r1: 2, c1: 1 };
    expect(selectionBounds(state)).toEqual({ r0: 2, c0: 1, r1: 5, c1: 6 });
  });

  it("fills and clears what it covers, and nothing else", () => {
    const state = stateOf(4);
    state.selection = { r0: 1, c0: 1, r1: 2, c1: 2 };
    setSelection(state, 1);
    expect(filled(state)).toEqual(["1,1", "1,2", "2,1", "2,2"].sort());
    setSelection(state, 0);
    expect(filled(state)).toEqual([]);
  });

  it("becomes a tip only when there is something in it", () => {
    const state = stateOf(4);
    state.selection = { r0: 0, c0: 0, r1: 1, c1: 1 };
    expect(selectionBits(state)).toBeNull();
    applyBrush(state, state.pattern, 0, 1, 1);
    expect(selectionBits(state)).toEqual([
      [0, 1],
      [0, 0],
    ]);
  });
});

describe("a grid of bits", () => {
  it("becomes a square pattern with the marks centred in it", () => {
    const pattern = bitsToPattern([[1, 1, 1]]);
    expect(pattern.size).toBe(3);
    expect(pattern.pixels[1]).toEqual([1, 1, 1]);
    expect(pattern.pixels[0]).toEqual([0, 0, 0]);
  });
});

describe("reading an image", () => {
  it("takes dark and opaque as a mark", () => {
    // A 2×2: black opaque, white opaque, black transparent, mid-grey.
    const rgba = [
      0, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 0, 0,
      200, 200, 200, 255,
    ];
    const image = fakeImage(2, rgba);
    expect(imageToBits(image, 32)).toEqual([
      [1, 0],
      [0, 0],
    ]);
  });
});

/**
 * An `HTMLImageElement` and the canvas it is read through, stubbed.
 *
 * `imageToBits` is the one piece of the brush code that touches the DOM, and
 * what it actually needs is a size and a buffer — so the suite supplies those
 * rather than a browser.
 */
function fakeImage(size: number, rgba: number[]): HTMLImageElement {
  const ctx = {
    drawImage: () => {},
    getImageData: () => ({ data: rgba }),
  };
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ctx,
    }),
  };
  return { width: size, height: size } as unknown as HTMLImageElement;
}


describe("moving what a selection holds", () => {
  const box = { r0: 0, c0: 0, r1: 1, c1: 1 };

  it("reads a box including its empty cells", () => {
    const state = stateOf(4);
    applyBrush(state, state.pattern, 0, 0, 1);
    // `selectionBits` refuses an empty box; this one is about the cells
    // themselves, because moving a box has to take its holes with it.
    expect(regionBits(state.pattern, box)).toEqual([
      [1, 0],
      [0, 0],
    ]);
  });

  it("lifts the cells out and puts them down somewhere else", () => {
    const state = stateOf(4);
    applyBrush(state, state.pattern, 0, 0, 1);
    applyBrush(state, state.pattern, 1, 1, 1);
    const bits = regionBits(state.pattern, box);
    state.pattern = moveRegion(state.pattern, box, bits, 2, 2);
    expect(filled(state)).toEqual(["2,2", "3,3"].sort());
  });

  it("wraps off one edge and back on the other", () => {
    const state = stateOf(4);
    applyBrush(state, state.pattern, 0, 0, 1);
    const bits = regionBits(state.pattern, box);
    state.pattern = moveRegion(state.pattern, box, bits, 0, 3);
    expect(filled(state)).toEqual(["0,3"]);
  });

  it("repeats what it holds over a larger box", () => {
    // Dragging the corner tiles the motif rather than stretching it, which is
    // how a mark drawn once becomes a row of itself.
    const state = stateOf(4);
    applyBrush(state, state.pattern, 0, 0, 1);
    const bits = regionBits(state.pattern, box);
    state.pattern = moveRegion(state.pattern, box, bits, 0, 0, { width: 4, height: 4 });
    expect(filled(state)).toEqual(["0,0", "0,2", "2,0", "2,2"].sort());
  });
});


describe("a box that runs past an edge", () => {
  it("reads the cells that wrapped round to the other side", () => {
    // A box is a window on the pattern, and the pattern repeats — so a box
    // dragged off the right edge carries on rather than reading zeroes.
    const state = stateOf(4);
    applyBrush(state, state.pattern, 0, 0, 1);
    expect(regionBits(state.pattern, { r0: 0, c0: 3, r1: 0, c1: 4 })).toEqual([[0, 1]]);
  });

  it("fills through the wrap as well", () => {
    const state = stateOf(4);
    state.selection = { r0: 0, c0: 3, r1: 0, c1: 4 };
    setSelection(state, 1);
    expect(filled(state)).toEqual(["0,0", "0,3"].sort());
  });
});
