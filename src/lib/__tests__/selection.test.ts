/**
 * Whether a selection still names something.
 *
 * The case this exists for is undo: a step taken back can remove the object
 * the selection was made on, and nothing else in the editor is watching for
 * that — the inspector would keep describing a placement that is not on the
 * canvas any more.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocStore } from "../doc-store";
import { selectionAlive } from "../selection";
import type { Selection, StoredDoc } from "../types";

vi.mock("../ipc", () => ({
  doc: { read: vi.fn(), write: vi.fn(async () => undefined) },
}));

(globalThis as unknown as { window: unknown }).window ??= {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
};

const BLANK: StoredDoc = {
  version: 2,
  projection: "orthogonal",
  gridSize: 32,
  scenes: [
    {
      id: "s1",
      name: "Main",
      layers: [
        {
          id: "l1",
          name: "Terrain",
          locked: false,
          visible: true,
          fills: [],
          placements: [],
          points: [],
          zones: [],
          strokes: [],
        },
      ],
    },
  ],
  activeSceneId: "s1",
};

let store: DocStore;

beforeEach(() => {
  store = new DocStore("p", structuredClone(BLANK));
});

describe("selections with nothing to lose", () => {
  it("keeps none and a dragged region", () => {
    expect(selectionAlive(store, { kind: "none" })).toBe(true);
    expect(
      selectionAlive(store, {
        kind: "region",
        from: { cx: 0, cy: 0 },
        to: { cx: 2, cy: 2 },
      }),
    ).toBe(true);
  });
});

describe("selections that name something", () => {
  it("survives while the thing is there, and not after", () => {
    const fill = store.addFill("l1", {
      cells: [{ cx: 0, cy: 0 }],
      kind: "color",
      color: "#fff",
      walkable: true,
    });
    const selection = { kind: "fill", layerId: "l1", fillId: fill.id } as const;
    expect(selectionAlive(store, selection)).toBe(true);

    store.removeFill("l1", fill.id);
    expect(selectionAlive(store, selection)).toBe(false);
  });

  it("dies with the layer it was on", () => {
    store.addLayer("Second");
    const point = store.addPoint("l1", { cx: 1, cy: 1 });
    const selection = {
      kind: "point",
      layerId: "l1",
      pointId: point.id,
    } as const;
    expect(selectionAlive(store, selection)).toBe(true);

    store.removeLayer("l1");
    expect(selectionAlive(store, selection)).toBe(false);
  });

  it("needs every member of a marquee, not just one", () => {
    const one = store.addPlacement("l1", place());
    const two = store.addPlacement("l1", place());
    const selection: Selection = {
      kind: "placements",
      layerId: "l1",
      ids: [one.id, two.id],
    };
    expect(selectionAlive(store, selection)).toBe(true);

    store.removePlacement("l1", two.id);
    expect(selectionAlive(store, selection)).toBe(false);
  });

  it("comes back when an undo puts the object back", () => {
    const placement = store.addPlacement("l1", place());
    const selection = {
      kind: "placement",
      layerId: "l1",
      placementId: placement.id,
    } as const;

    store.removePlacement("l1", placement.id);
    expect(selectionAlive(store, selection)).toBe(false);

    store.history.undo();
    expect(selectionAlive(store, selection)).toBe(true);
  });
});

function place() {
  return {
    psdKey: "tower",
    layerPath: "tower",
    x: 0,
    y: 0,
    width: 32,
    height: 32,
    anchor: { cx: 0, cy: 0 },
  };
}
