import { describe, expect, it } from "vitest";
import { DocStore } from "../../lib/doc-store";
import { Grid } from "../../lib/grid";
import { parseManifest } from "../../lib/manifest";
import { reconcilePlacements } from "../reconcile";
import type { StoredDoc, Placement } from "../../lib/types";

// `DocStore` debounces its autosave on window timers, and this runs in node.
// A stub rather than a real clock: the point here is what reconciliation
// leaves in the document, and a save that actually fired would reach for Tauri.
(globalThis as unknown as { window: unknown }).window ??= {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
};

const grid = new Grid("isometric", 64);

/** What this editor writes: the artwork, with both orienting marks over it. */
const MARKED = JSON.stringify({
  name: "extrude-abc",
  width: 128,
  height: 160,
  layers: [
    { name: "anchor", category: "point", x: 60, y: 76, width: 12, height: 12 },
    { name: "grid", category: "zone", x: 32, y: 64, width: 64, height: 32 },
    { name: "extrude-abc", category: "sprite", x: 0, y: 0, width: 128, height: 160 },
  ],
});

/** A file built in Photoshop: one group with a layer inside it. */
const GROUPED = JSON.stringify({
  name: "hut",
  width: 128,
  height: 160,
  layers: [
    {
      name: "building",
      category: "group",
      x: 0,
      y: 0,
      width: 128,
      height: 160,
      children: [
        { name: "wall", category: "sprite", x: 0, y: 0, width: 128, height: 160 },
      ],
    },
  ],
});

function placement(psdKey: string, layerPath: string): Placement {
  return {
    id: "p1",
    psdKey,
    layerPath,
    x: 0,
    y: 0,
    width: 64,
    height: 80,
    naturalWidth: 128,
    naturalHeight: 160,
    anchor: { cx: 0, cy: 0 },
    instance: "unit-1",
    order: 0,
  };
}

function store(...placements: Placement[]): DocStore {
  const doc: StoredDoc = {
    version: 1,
    projection: "isometric",
    gridSize: 64,
    layers: [
      {
        id: "l1",
        name: "Foreground",
        locked: false,
        visible: true,
        fills: [],
        placements,
        zones: [],
        strokes: [],
      },
    ],
  };
  return new DocStore("p", doc);
}

const paths = (s: DocStore) => s.layers[0].placements.map((p) => p.layerPath);

describe("re-parsing a PSD", () => {
  it("leaves an ordinary placement exactly as it found it", () => {
    const s = store(placement("extrude-abc", "extrude-abc"));
    reconcilePlacements(s, grid, "extrude-abc", parseManifest(MARKED));
    expect(paths(s)).toEqual(["extrude-abc"]);
  });

  /**
   * The bug this exists for: one re-parse, one extra row in the layer list,
   * and nothing new on the canvas.
   *
   * A placement standing on one of the orienting marks used to survive
   * revision — the mark is in the manifest, so the layer had not "gone" —
   * while adoption looked only at the layers that can be placed, saw nothing
   * standing on the artwork, and added a second placement for it. The extra
   * one drew a point, which is to say nothing.
   */
  it("does not add a second placement beside one standing on a mark", () => {
    const s = store(placement("extrude-abc", "anchor"));
    reconcilePlacements(s, grid, "extrude-abc", parseManifest(MARKED));
    expect(paths(s)).toEqual(["extrude-abc"]);
  });

  it("keeps the placement's own identity when it repoints it", () => {
    const s = store(placement("extrude-abc", "grid"));
    reconcilePlacements(s, grid, "extrude-abc", parseManifest(MARKED));
    const [p] = s.layers[0].placements;
    expect(p.id).toBe("p1");
    expect(p.instance).toBe("unit-1");
    expect(p.anchor).toEqual({ cx: 0, cy: 0 });
  });

  it("does not adopt a group whose child is already placed", () => {
    const s = store(placement("hut", "building/wall"));
    reconcilePlacements(s, grid, "hut", parseManifest(GROUPED));
    expect(paths(s)).toEqual(["building/wall"]);
  });

  it("still adopts a layer that has genuinely appeared", () => {
    const s = store(placement("hut", "building"));
    const grown = JSON.stringify({
      name: "hut",
      width: 128,
      height: 160,
      layers: [
        { name: "building", category: "sprite", x: 0, y: 0, width: 128, height: 160 },
        { name: "roof", category: "sprite", x: 16, y: 0, width: 96, height: 40 },
      ],
    });
    reconcilePlacements(s, grid, "hut", parseManifest(grown));
    expect(paths(s).sort()).toEqual(["building", "roof"]);
  });

  it("still removes a placement whose layer has gone", () => {
    const s = store(placement("hut", "chimney"));
    reconcilePlacements(s, grid, "hut", parseManifest(GROUPED));
    expect(paths(s)).toEqual([]);
  });
});

/**
 * The shape a re-parse actually arrived in: the category spelled in a way
 * this parser did not recognise, so every layer in the file counted as
 * placeable and reconciliation adopted one placed object per PSD layer.
 */
describe("a manifest whose categories are spelled differently", () => {
  const LOOSE = JSON.stringify({
    name: "extrude-abc",
    width: 128,
    height: 160,
    layers: [
      { name: "anchor", category: "Point", x: 60, y: 76, width: 12, height: 12 },
      { name: "grid", category: "Zones", x: 32, y: 64, width: 64, height: 32 },
      { name: "extrude-abc", category: "Sprite", x: 0, y: 0, width: 128, height: 160 },
    ],
  });

  it("does not turn one placed PSD into one per layer", () => {
    const s = store(placement("extrude-abc", "extrude-abc"));
    reconcilePlacements(s, grid, "extrude-abc", parseManifest(LOOSE));
    expect(paths(s)).toEqual(["extrude-abc"]);
  });

  it("is the same on a second and third re-parse", () => {
    const s = store(placement("extrude-abc", "extrude-abc"));
    for (let i = 0; i < 3; i++) {
      reconcilePlacements(s, grid, "extrude-abc", parseManifest(LOOSE));
    }
    expect(paths(s)).toEqual(["extrude-abc"]);
  });
});
