/**
 * Picking more than one placed PSD in the layer panel.
 *
 * The arithmetic is worth holding to account because none of it is visible
 * when it is wrong in the ordinary way: a ⇧-click whose anchor walked along
 * with it still selects *something*, and a toggle that replaced instead of
 * adding still leaves one row lit. What says so is a test that names the run
 * it expected.
 */

import { describe, expect, it } from "vitest";
import {
  heldRows,
  pickMode,
  pickUnit,
  selectionOf,
  type PickableUnit,
} from "../layer-select";
import type { Selection } from "../../lib/types";

/** Four placed files, the second of which is a three-layer PSD. */
const UNITS: PickableUnit[] = [
  { members: ["a1"] },
  { members: ["b1", "b2", "b3"] },
  { members: ["c1"] },
  { members: ["d1"] },
];

const LAYER = "layer-1";

function pick(
  current: Selection,
  index: number,
  mode: "replace" | "toggle" | "range",
  anchor: number | null = null,
) {
  return pickUnit({ current, layerId: LAYER, units: UNITS, index, anchor, mode });
}

describe("what the modifiers mean", () => {
  it("reads a plain click as a replacement", () => {
    expect(pickMode({})).toBe("replace");
  });

  it("takes ⌘ and Ctrl alike, so a keyboard without Command still works", () => {
    expect(pickMode({ metaKey: true })).toBe("toggle");
    expect(pickMode({ ctrlKey: true })).toBe("toggle");
  });

  /**
   * ⇧ wins over ⌘ when both are down: a range is the more specific ask, and
   * ⌘⇧-click in every list that has both means *add this run* — which is what
   * a range unioned with what is held already does.
   */
  it("lets ⇧ win over ⌘", () => {
    expect(pickMode({ shiftKey: true, metaKey: true })).toBe("range");
  });
});

describe("picking one row", () => {
  it("selects a single file as a placement, not a list of one", () => {
    const { selection } = pick({ kind: "none" }, 0, "replace");
    expect(selection).toEqual({
      kind: "placement",
      layerId: LAYER,
      placementId: "a1",
    });
  });

  it("names the unit's first placement, whatever else is inside it", () => {
    const { selection } = pick({ kind: "none" }, 1, "replace");
    expect(selection).toEqual({
      kind: "placement",
      layerId: LAYER,
      placementId: "b1",
    });
  });

  it("drops whatever was picked before", () => {
    const held: Selection = { kind: "placements", layerId: LAYER, ids: ["a1", "c1"] };
    expect(pick(held, 3, "replace").selection).toEqual({
      kind: "placement",
      layerId: LAYER,
      placementId: "d1",
    });
  });

  it("leaves the anchor on the row that was tapped", () => {
    expect(pick({ kind: "none" }, 2, "replace").anchor).toBe(2);
  });
});

describe("⌘-clicking, and the ⊕ that stands in for it", () => {
  it("adds a second file, carrying every placement of both", () => {
    const one: Selection = { kind: "placement", layerId: LAYER, placementId: "a1" };
    expect(pick(one, 1, "toggle").selection).toEqual({
      kind: "placements",
      layerId: LAYER,
      ids: ["a1", "b1", "b2", "b3"],
    });
  });

  it("takes one back out, and falls to a single placement when one is left", () => {
    const two: Selection = {
      kind: "placements",
      layerId: LAYER,
      ids: ["a1", "c1"],
    };
    expect(pick(two, 2, "toggle").selection).toEqual({
      kind: "placement",
      layerId: LAYER,
      placementId: "a1",
    });
  });

  /**
   * Taking the last one out clears the selection rather than leaving a list of
   * nothing behind — the inspector would otherwise be describing zero images.
   */
  it("clears the selection when the last row is taken out", () => {
    const one: Selection = { kind: "placement", layerId: LAYER, placementId: "a1" };
    expect(pick(one, 0, "toggle").selection).toEqual({ kind: "none" });
  });

  /**
   * A row is held when any of its placements is selected, because the canvas
   * selects whichever layer of a file the pointer landed on. So ⌘-clicking a
   * three-layer PSD the canvas caught by its middle layer takes the whole file
   * out, rather than adding it a second time.
   */
  it("knows a file is held when the canvas caught it by an inner layer", () => {
    const inner: Selection = {
      kind: "placement",
      layerId: LAYER,
      placementId: "b2",
    };
    expect(pick(inner, 1, "toggle").selection).toEqual({ kind: "none" });
  });

  it("starts fresh when nothing was selected", () => {
    expect(pick({ kind: "none" }, 1, "toggle").selection).toEqual({
      kind: "placement",
      layerId: LAYER,
      placementId: "b1",
    });
  });

  /**
   * A selection is one layer's worth, so a selection on another layer is not
   * a set this row can join — it is replaced rather than added to.
   */
  it("ignores a selection that belongs to another layer", () => {
    const elsewhere: Selection = {
      kind: "placements",
      layerId: "layer-2",
      ids: ["x1", "x2"],
    };
    expect(pick(elsewhere, 0, "toggle").selection).toEqual({
      kind: "placement",
      layerId: LAYER,
      placementId: "a1",
    });
  });
});

describe("⇧-clicking a run", () => {
  it("takes everything between the anchor and the row", () => {
    const from: Selection = { kind: "placement", layerId: LAYER, placementId: "a1" };
    expect(pick(from, 2, "range", 0).selection).toEqual({
      kind: "placements",
      layerId: LAYER,
      ids: ["a1", "b1", "b2", "b3", "c1"],
    });
  });

  it("runs upwards as readily as down", () => {
    const from: Selection = { kind: "placement", layerId: LAYER, placementId: "d1" };
    expect(pick(from, 2, "range", 3).selection).toEqual({
      kind: "placements",
      layerId: LAYER,
      ids: ["c1", "d1"],
    });
  });

  /**
   * The anchor stays where it was, so a run can be stretched and shrunk from
   * the same end. Walking it along with the click is the bug you only notice
   * after you have lost the selection you were adjusting.
   */
  it("leaves the anchor alone", () => {
    expect(pick({ kind: "none" }, 3, "range", 1).anchor).toBe(1);
  });

  it("keeps what a ⌘-click had already added", () => {
    const held: Selection = { kind: "placements", layerId: LAYER, ids: ["a1", "c1"] };
    expect(pick(held, 3, "range", 2).selection).toEqual({
      kind: "placements",
      layerId: LAYER,
      ids: ["a1", "c1", "d1"],
    });
  });

  it("behaves as a plain pick when there is no anchor to count from", () => {
    expect(pick({ kind: "none" }, 2, "range", null).selection).toEqual({
      kind: "placement",
      layerId: LAYER,
      placementId: "c1",
    });
  });

  /** A layer that has lost rows since the anchor was set must not throw. */
  it("ignores an anchor past the end of the list", () => {
    expect(pick({ kind: "none" }, 1, "range", 9).selection).toEqual({
      kind: "placement",
      layerId: LAYER,
      placementId: "b1",
    });
  });
});

describe("reading the rows back", () => {
  it("finds nothing in a selection that is not about placements", () => {
    expect(heldRows({ kind: "none" }, LAYER, UNITS).size).toBe(0);
    expect(heldRows({ kind: "layer", layerId: LAYER }, LAYER, UNITS).size).toBe(0);
  });

  it("lists the rows a multi-selection covers", () => {
    const held: Selection = {
      kind: "placements",
      layerId: LAYER,
      ids: ["b3", "d1"],
    };
    expect([...heldRows(held, LAYER, UNITS)].sort()).toEqual([1, 3]);
  });

  it("keeps the ids in the order the rows are listed in", () => {
    const rows = new Set([3, 0, 2]);
    expect(selectionOf(LAYER, UNITS, rows)).toEqual({
      kind: "placements",
      layerId: LAYER,
      ids: ["a1", "c1", "d1"],
    });
  });

  it("answers none for an empty set, and for rows that are no longer there", () => {
    expect(selectionOf(LAYER, UNITS, new Set())).toEqual({ kind: "none" });
    expect(selectionOf(LAYER, UNITS, new Set([9]))).toEqual({ kind: "none" });
  });
});
