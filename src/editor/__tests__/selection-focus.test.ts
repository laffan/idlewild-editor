/**
 * Where the canvas goes when a row in the left sidebar is picked: the middle
 * of the box the selection overlay draws for that kind — a placed PSD as the
 * whole file, a run of strokes as the box round their ink — and nowhere for a
 * backdrop, which is camera-locked and fills the view wherever it stands.
 */

import { describe, expect, it } from "vitest";
import { Grid } from "../../lib/grid";
import type { DocStore } from "../../lib/doc-store";
import type { Layer } from "../../lib/types";
import { selectionCentre } from "../selection-focus";

const layer = {
  id: "l",
  name: "Layer",
  locked: false,
  visible: true,
  fills: [],
  zones: [],
  points: [{ id: "pt", cell: { cx: 2, cy: 0 } }],
  // Two layers of one file, sharing an instance — picked as the file.
  placements: [
    { id: "a", instance: "psd", x: 0, y: 0, width: 40, height: 20 },
    { id: "b", instance: "psd", x: 40, y: 20, width: 40, height: 20 },
  ],
  strokes: [
    { id: "s1", points: [100, 100, 1, 140, 100, 1], brushId: 1, size: 0, color: "#000", mode: "ink" },
  ],
} as unknown as Layer;

const store = {
  layers: [layer],
  layer: (id: string) => (id === "l" ? layer : undefined),
} as unknown as DocStore;
const grid = new Grid("orthogonal", 32);

describe("where a picked selection is", () => {
  it("is the middle of a placed PSD's whole file", () => {
    expect(selectionCentre({ kind: "placement", layerId: "l", placementId: "a" }, store, grid))
      .toEqual({ x: 40, y: 20 });
  });

  it("is the middle of a run of strokes", () => {
    const at = selectionCentre({ kind: "strokes", layerId: "l", ids: ["s1"] }, store, grid);
    expect(at?.x).toBeCloseTo(120);
    expect(at?.y).toBeCloseTo(100);
  });

  it("is a point's space", () => {
    expect(selectionCentre({ kind: "point", layerId: "l", pointId: "pt" }, store, grid))
      .toEqual(grid.cellCentre({ cx: 2, cy: 0 }));
  });

  it("is nowhere for a backdrop, a layer, or something gone", () => {
    expect(selectionCentre({ kind: "background", layerId: "l", backgroundId: "bg" }, store, grid)).toBeNull();
    expect(selectionCentre({ kind: "layer", layerId: "l" }, store, grid)).toBeNull();
    expect(selectionCentre({ kind: "placement", layerId: "l", placementId: "zz" }, store, grid)).toBeNull();
  });
});
