import { describe, expect, it } from "vitest";
import {
  blockedColliderCells,
  colliderBoxes,
  colliderCells,
  defaultCollider,
  describeCollider,
  documentColliders,
  groundOffsets,
} from "../collider";
import { Grid } from "../grid";
import type { Cell, Collider, Extrusion, Layer, Placement } from "../types";

const iso = new Grid("isometric", 64);
const ortho = new Grid("orthogonal", 64);
const blank = new Grid("blank", 64);

function sorted(cells: readonly Cell[]): string[] {
  return cells.map((c) => `${c.cx},${c.cy}`).sort();
}

function placement(over: Partial<Placement> = {}): Placement {
  return {
    id: "p1",
    psdKey: "tree",
    layerPath: "tree",
    x: 0,
    y: 0,
    width: 64,
    height: 64,
    anchor: { cx: 0, cy: 0 },
    ...over,
  };
}

function layer(over: Partial<Layer> = {}): Layer {
  return {
    id: "l1",
    name: "Layer 1",
    locked: false,
    visible: true,
    fills: [],
    placements: [],
    zones: [],
    strokes: [],
    ...over,
  };
}

describe("the default a solid gets", () => {
  /** Two spaces of ground, one of them three levels tall. */
  const tower: Extrusion = {
    anchor: { cx: 0, cy: 0 },
    voxels: ["0,0,0", "1,0,0", "1,0,1", "1,0,2"],
    };

  it("blocks the spaces an isometric solid rests on, not the ones it reaches over", () => {
    const collider = defaultCollider(iso, { cx: 0, cy: 0 }, null, tower);
    expect(sorted(collider.cells)).toEqual(["0,0", "1,0"]);
    expect(collider.blocking).toBe(true);
  });

  it("blocks the whole of a flat one, because every space of it is ground", () => {
    const flat: Extrusion = {
      anchor: { cx: 0, cy: 0 },
      voxels: ["0,0,0", "1,0,0", "0,1,0", "1,1,0"],
    };
    const collider = defaultCollider(ortho, { cx: 0, cy: 0 }, null, flat);
    expect(sorted(collider.cells)).toEqual(["0,0", "0,1", "1,0", "1,1"]);
  });

  it("blocks nothing under a shape that never touches the ground", () => {
    const arch: Extrusion = { anchor: { cx: 0, cy: 0 }, voxels: ["0,0,2", "1,0,2"] };
    expect(defaultCollider(iso, { cx: 0, cy: 0 }, null, arch).cells).toEqual([]);
  });

  it("keeps a solid under its own artwork when the placement has been dragged", () => {
    // The shape was written against 0,0; the artwork now hangs from 4,2, so
    // the offsets have to be measured from where it is rather than where it
    // was — otherwise the collider stays behind on the old ground.
    const moved = groundOffsets(tower, { cx: 4, cy: 2 });
    expect(sorted(moved)).toEqual(["-3,-2", "-4,-2"]);
    expect(sorted(colliderCells({ cells: moved, blocking: true }, { cx: 4, cy: 2 })))
      .toEqual(["0,0", "1,0"]);
  });
});

describe("the default anything else gets", () => {
  it("blocks the spaces the artwork covers", () => {
    // One orthogonal space at the origin, anchored to it.
    const collider = defaultCollider(
      ortho,
      { cx: 0, cy: 0 },
      { x: 2, y: 2, width: 60, height: 60 },
    );
    expect(sorted(collider.cells)).toEqual(["0,0"]);
  });

  it("measures from the anchor, so the same file blocks the same shape anywhere", () => {
    const here = defaultCollider(ortho, { cx: 0, cy: 0 }, {
      x: 2,
      y: 2,
      width: 60,
      height: 60,
    });
    const there = defaultCollider(ortho, { cx: 5, cy: 3 }, {
      x: 5 * 64 + 2,
      y: 3 * 64 + 2,
      width: 60,
      height: 60,
    });
    expect(sorted(there.cells)).toEqual(sorted(here.cells));
  });

  it("is the box itself where the grid does not snap", () => {
    const box = { x: 100, y: 40, width: 200, height: 120 };
    const collider = defaultCollider(blank, { cx: 100, cy: 40 }, box);
    expect(collider.cells).toEqual([]);
    // Relative to the anchor, which on a blank project is a world pixel.
    expect(collider.rect).toEqual({ x: 0, y: 0, width: 200, height: 120 });
    expect(colliderBoxes(blank, collider, { cx: 100, cy: 40 })).toEqual([box]);
  });

  it("falls back to the box when the artwork covers more spaces than it is worth", () => {
    // A 400-space-wide image on a 64px grid: past the ceiling, so the shape
    // that goes in the document is the one box rather than the list.
    const collider = defaultCollider(ortho, { cx: 0, cy: 0 }, {
      x: 0,
      y: 0,
      width: 64 * 200,
      height: 64 * 200,
    });
    expect(collider.cells).toEqual([]);
    expect(collider.rect).toEqual({ x: 0, y: 0, width: 12800, height: 12800 });
  });
});

describe("reading colliders off the document", () => {
  const colliders: Record<string, Collider> = {
    tree: { cells: [{ cx: 0, cy: 0 }], blocking: true },
    path: { cells: [{ cx: 0, cy: 0 }], blocking: false },
  };

  it("counts a multi-layer PSD once rather than once per layer", () => {
    const placed = documentColliders(
      [
        layer({
          placements: [
            placement({ id: "a", instance: "u1" }),
            placement({ id: "b", instance: "u1", layerPath: "roof" }),
          ],
        }),
      ],
      colliders,
    );
    expect(placed).toHaveLength(1);
    expect(placed[0].key).toBe("tree");
  });

  it("leaves out walkable colliders, hidden layers and unknown keys", () => {
    const placed = documentColliders(
      [
        layer({ placements: [placement({ psdKey: "path", instance: "u1" })] }),
        layer({
          id: "l2",
          visible: false,
          placements: [placement({ id: "c", instance: "u2" })],
        }),
        layer({
          id: "l3",
          placements: [placement({ id: "d", psdKey: "nobody", instance: "u3" })],
        }),
      ],
      colliders,
    );
    expect(placed).toEqual([]);
  });

  it("blocks the cells where each unit actually stands", () => {
    const blocked = blockedColliderCells(
      [
        layer({
          placements: [
            placement({ id: "a", instance: "u1", anchor: { cx: 2, cy: 3 } }),
            placement({ id: "b", instance: "u2", anchor: { cx: -1, cy: 0 } }),
          ],
        }),
      ],
      colliders,
    );
    expect([...blocked].sort()).toEqual(["-1,0", "2,3"]);
  });

  it("blocks nothing at all for a document that has never been told", () => {
    expect(
      blockedColliderCells([layer({ placements: [placement()] })], undefined).size,
    ).toBe(0);
  });
});

describe("what the inspector says about one", () => {
  it("counts spaces where there are spaces, and pixels where there are not", () => {
    expect(describeCollider(ortho, { cells: [{ cx: 0, cy: 0 }], blocking: true }))
      .toBe("1 space");
    expect(
      describeCollider(blank, {
        cells: [],
        rect: { x: 0, y: 0, width: 200, height: 120 },
        blocking: true,
      }),
    ).toBe("200 × 120 px");
    expect(describeCollider(ortho, { cells: [], blocking: true })).toBe("no spaces");
  });
});
