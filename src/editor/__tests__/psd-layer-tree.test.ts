import { describe, expect, it } from "vitest";
import {
  blockLength,
  dropSlots,
  moveBlock,
  siblingSpan,
} from "../psd-layer-tree";

/**
 * The file the inspector shows for anything extrude mode wrote: the two
 * orienting marks, then the artwork group with its three parts inside it.
 *
 *   0  P | anchor
 *   1  Z | grid
 *   2  G | extrude-abc
 *   3    S | lines-abc
 *   4    S | shading-abc
 *   5    S | shape-abc
 */
const STACK = [0, 0, 0, 1, 1, 1].map((depth) => ({ depth }));

/**
 * Two groups side by side, the second holding a group of its own.
 *
 *   0  group A       3  group B          8  a layer of its own
 *   1    layer       4    layer
 *   2    layer       5    group C
 *                    6      layer
 *                    7      layer
 */
const NESTED = [0, 1, 1, 0, 1, 1, 2, 2, 0].map((depth) => ({ depth }));

describe("what a drag picks up", () => {
  it("is one row, when the row holds nothing", () => {
    expect(blockLength(STACK, 0)).toBe(1);
    expect(blockLength(STACK, 4)).toBe(1);
  });

  it("is a group and everything under it", () => {
    expect(blockLength(STACK, 2)).toBe(4);
  });

  it("takes a nested group along with the group holding it", () => {
    // Group B holds a layer and group C, and group C holds two.
    expect(blockLength(NESTED, 3)).toBe(5);
    expect(blockLength(NESTED, 5)).toBe(3);
  });

  it("is nothing at all for a row that is not there", () => {
    expect(blockLength(STACK, 9)).toBe(0);
  });
});

describe("who a row's siblings are", () => {
  it("is the whole list for a row at the top level", () => {
    expect(siblingSpan(STACK, 0)).toEqual({ from: 0, to: 6 });
    expect(siblingSpan(STACK, 2)).toEqual({ from: 0, to: 6 });
  });

  it("stops at the group's edges for a row inside one", () => {
    expect(siblingSpan(STACK, 4)).toEqual({ from: 3, to: 6 });
  });

  it("reads a nested group's contents, and not what holds it", () => {
    expect(siblingSpan(NESTED, 6)).toEqual({ from: 6, to: 8 });
  });
});

describe("where a block may be dropped", () => {
  it("is every sibling block's start, plus the end of the run", () => {
    // The marks and the group are siblings; the group's contents are not
    // slots, because a drag at the top level passes the whole group.
    expect(dropSlots(STACK, 0)).toEqual([0, 1, 2, 6]);
  });

  it("never leaves the group a row is inside", () => {
    expect(dropSlots(STACK, 3)).toEqual([3, 4, 5, 6]);
  });

  it("steps over a sibling group whole", () => {
    // Inside group A there are two plain layers and nothing else.
    expect(dropSlots(NESTED, 1)).toEqual([1, 2, 3]);
    // Inside group B, the second slot is group C — which is passed whole.
    expect(dropSlots(NESTED, 4)).toEqual([4, 5, 8]);
  });

  it("is nothing for a row that is not there", () => {
    expect(dropSlots(STACK, 9)).toEqual([]);
  });
});

describe("moving a block", () => {
  const rows = ["a", "b", "c", "d", "e"];

  it("puts a single row where the slot says", () => {
    expect(moveBlock(rows, 0, 1, 2)).toEqual(["b", "a", "c", "d", "e"]);
  });

  it("keeps a block together", () => {
    expect(moveBlock(rows, 1, 2, 4)).toEqual(["a", "d", "b", "c", "e"]);
  });

  it("counts a downward move against the list as it stands", () => {
    // Slot 5 is the end, so the block lands last rather than one short of it.
    expect(moveBlock(rows, 0, 2, 5)).toEqual(["c", "d", "e", "a", "b"]);
  });

  it("moves a block upward without an off-by-one", () => {
    expect(moveBlock(rows, 3, 2, 1)).toEqual(["a", "d", "e", "b", "c"]);
  });

  it("changes nothing when the block is already there", () => {
    expect(moveBlock(rows, 2, 2, 2)).toEqual(rows);
    expect(moveBlock(rows, 2, 0, 0)).toEqual(rows);
  });

  it("hands back a new array, so the caller can keep the old order", () => {
    const after = moveBlock(rows, 0, 1, 2);
    expect(after).not.toBe(rows);
    expect(rows).toEqual(["a", "b", "c", "d", "e"]);
  });
});

/**
 * The property that matters for the panel: a block dropped in any slot open
 * to it comes back a list of the same rows, with the block still whole and
 * every row still at the depth it had. A drag cannot re-parent anything.
 */
describe("a move through any legal slot", () => {
  it("keeps the tree a tree", () => {
    for (const stack of [STACK, NESTED]) {
      for (let at = 0; at < stack.length; at++) {
        const size = blockLength(stack, at);
        for (const to of dropSlots(stack, at)) {
          const after = moveBlock(stack, at, size, to);
          expect(after, `${at} → ${to}`).toHaveLength(stack.length);
          expect(new Set(after), `${at} → ${to} kept every row`).toEqual(
            new Set(stack),
          );
          const landed = to > at ? to - size : to;
          expect(
            after.slice(landed, landed + size),
            `block ${at} → ${to} stayed whole`,
          ).toEqual(stack.slice(at, at + size));
          // Depths are never rewritten, so the list still describes a tree
          // only if nothing has landed deeper than one step past its
          // predecessor — which is exactly what the indent claims.
          expect(after[0].depth, `${at} → ${to} starts at the top`).toBe(0);
          for (let i = 1; i < after.length; i++) {
            expect(
              after[i].depth,
              `row ${i} after ${at} → ${to}`,
            ).toBeLessThanOrEqual(after[i - 1].depth + 1);
          }
        }
      }
    }
  });
});
