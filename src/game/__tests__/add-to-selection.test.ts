/**
 * ⌘ and ⇧ on the canvas: *and this one as well*.
 *
 * The same gesture as ⌘-clicking a row in the layer panel, and deliberately
 * the same arithmetic — `lib/unit-select.ts` — so the two surfaces cannot
 * disagree about what a toggle leaves behind. What is worth asserting here is
 * the half that is *not* shared: which hits a modifier applies to, and what
 * happens on the ones it does not.
 *
 * Every one of those is silent when it is wrong. A ⌘-tap on bare ground that
 * cleared the selection looks exactly like a mis-aimed click; a ⌘-tap on a
 * fill that quietly did nothing looks like the modifier not being registered.
 */

import { describe, expect, it, vi } from "vitest";
import { DocStore } from "../../lib/doc-store";
import { addToSelection } from "../adjusting";
import type { GameDoc, Placement, Selection } from "../../lib/types";

vi.mock("../../lib/ipc", () => ({
  doc: { read: vi.fn(), write: vi.fn(async () => undefined) },
}));
(globalThis as unknown as { window: unknown }).window ??= {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
};

/** A placement standing in unit `unit`. */
function placed(id: string, unit: string): Placement {
  return {
    id,
    psdKey: id,
    layerPath: id,
    x: 0,
    y: 0,
    width: 32,
    height: 32,
    anchor: { cx: 0, cy: 0 },
    instance: unit,
  };
}

/** A tower of two layers, a tree, and a fill to miss with. */
function store(): DocStore {
  const doc: GameDoc = {
    version: 2,
    projection: "orthogonal",
    gridSize: 32,
    activeSceneId: "scene-1",
    scenes: [
      {
        id: "scene-1",
        name: "Main",
        layers: [
          {
            id: "layer-1",
            name: "Foreground",
            locked: false,
            visible: true,
            fills: [{ id: "f1", cells: [], kind: "color", walkable: true }],
            placements: [
              placed("tower-base", "u-tower"),
              placed("tower-top", "u-tower"),
              placed("tree", "u-tree"),
            ],
            points: [],
            zones: [],
            strokes: [],
          },
        ],
      },
    ],
  };
  return new DocStore("project-1", doc);
}

const TOWER: Selection = {
  kind: "placement",
  layerId: "layer-1",
  placementId: "tower-base",
};
const TREE: Selection = {
  kind: "placement",
  layerId: "layer-1",
  placementId: "tree",
};

describe("adding a placed PSD on the canvas", () => {
  it("adds a second file, carrying every layer of both", () => {
    expect(addToSelection(store(), TOWER, TREE)).toEqual({
      kind: "placements",
      layerId: "layer-1",
      ids: ["tower-base", "tower-top", "tree"],
    });
  });

  /**
   * The whole file, not the layer under the pointer. A placed PSD is one thing
   * on the canvas, so ⌘-tapping its roof adds the building — otherwise the
   * selection would hold half a tower and a drag would tear it apart.
   */
  it("takes the whole unit even when the tap landed on one of its layers", () => {
    const top: Selection = {
      kind: "placement",
      layerId: "layer-1",
      placementId: "tower-top",
    };
    expect(addToSelection(store(), TREE, top)).toEqual({
      kind: "placements",
      layerId: "layer-1",
      ids: ["tower-base", "tower-top", "tree"],
    });
  });

  it("takes one back out, and falls to a single file when one is left", () => {
    const both: Selection = {
      kind: "placements",
      layerId: "layer-1",
      ids: ["tower-base", "tower-top", "tree"],
    };
    expect(addToSelection(store(), both, TREE)).toEqual({
      kind: "placement",
      layerId: "layer-1",
      placementId: "tower-base",
    });
  });

  it("clears the selection when the last one is taken out", () => {
    expect(addToSelection(store(), TREE, TREE)).toEqual({ kind: "none" });
  });

  it("starts a selection when there was none", () => {
    expect(addToSelection(store(), { kind: "none" }, TREE)).toEqual({
      kind: "placement",
      layerId: "layer-1",
      placementId: "tree",
    });
  });
});

describe("what a modifier does not apply to", () => {
  /**
   * A miss is not a request to throw the rest away. The modifier says *as well
   * as*, and clearing on a ⌘-tap that landed on nothing is the one outcome
   * nobody could have meant — it is also indistinguishable from a mis-aim.
   */
  it("keeps the selection when the tap landed on bare ground", () => {
    const held: Selection = {
      kind: "placements",
      layerId: "layer-1",
      ids: ["tower-base", "tree"],
    };
    expect(addToSelection(store(), held, { kind: "none" })).toBe(held);
  });

  /**
   * `placements` is the one multi-selection the document has, so a fill, a
   * boundary, a point or a note ⌘-tapped is read as a plain tap: it selects
   * that thing, because there is nothing it could be added to.
   */
  it("reads a ⌘-tap on anything that is not a placed PSD as a plain tap", () => {
    const fill: Selection = { kind: "fill", layerId: "layer-1", fillId: "f1" };
    expect(addToSelection(store(), TREE, fill)).toBe(fill);
  });

  /** A placement the document no longer holds cannot join anything. */
  it("falls back to the hit when the placement is not on that layer", () => {
    const gone: Selection = {
      kind: "placement",
      layerId: "layer-1",
      placementId: "deleted",
    };
    expect(addToSelection(store(), TREE, gone)).toBe(gone);
  });
});
