import { describe, expect, it } from "vitest";
import {
  colliderCells,
  defaultCollider,
  describeCollider,
  groundOffsets,
  resolveCollider,
  unitOfKey,
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

  it("takes the base of an isometric picture, not the ground behind it", () => {
    // A 64 x 96 tower standing on the tile at the origin: its bounding box
    // sweeps up the screen across a dozen diamonds, and all but the one it
    // rests on are the hillside behind it.
    const tower = { x: -32, y: -80, width: 64, height: 96 };
    expect(sorted(defaultCollider(iso, { cx: 0, cy: 0 }, tower).cells)).toEqual([
      "0,0",
    ]);
  });

  it("stands a wide isometric picture on every space under its base", () => {
    // Three tiles of frontage, one tile deep.
    const wall = { x: -96, y: -80, width: 192, height: 96 };
    const cells = sorted(defaultCollider(iso, { cx: 0, cy: 0 }, wall).cells);
    expect(cells.length).toBeGreaterThan(1);
    expect(cells).toContain("0,0");
  });

  it("gives a small isometric picture the space under its middle", () => {
    // Smaller than a tile and dropped between four of them: no space has its
    // middle under the base, and a collider of nothing would read as broken.
    const icon = { x: -5, y: -5, width: 10, height: 10 };
    expect(defaultCollider(iso, { cx: 0, cy: 0 }, icon).cells).toHaveLength(1);
  });

  it("keeps the whole picture on a square grid, where up the screen is not away", () => {
    const tower = { x: 0, y: 0, width: 64, height: 192 };
    expect(sorted(defaultCollider(ortho, { cx: 0, cy: 0 }, tower).cells)).toEqual([
      "0,0",
      "0,1",
      "0,2",
    ]);
  });

  it("is the box itself where the grid does not snap", () => {
    const box = { x: 100, y: 40, width: 200, height: 120 };
    const collider = defaultCollider(blank, { cx: 100, cy: 40 }, box);
    expect(collider.cells).toEqual([]);
    // Relative to the anchor, which on a blank project is a world pixel.
    expect(collider.rect).toEqual({ x: 0, y: 0, width: 200, height: 120 });
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
    tree: { cells: [{ cx: 0, cy: 0 }], blocking: true, edited: true },
  };

  it("finds the unit a key is placed as, in whichever scene it stands", () => {
    const unit = unitOfKey(
      [
        layer({ id: "l1" }),
        layer({
          id: "l2",
          placements: [
            placement({ id: "a", instance: "u1", anchor: { cx: 2, cy: 3 } }),
            placement({ id: "b", instance: "u1", layerPath: "roof" }),
            placement({ id: "c", instance: "u2", psdKey: "other" }),
          ],
        }),
      ],
      "tree",
    );
    expect(unit?.anchor).toEqual({ cx: 2, cy: 3 });
    expect(unit?.placements.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("hands back what the document holds, rather than guessing again", () => {
    const held = resolveCollider(ortho, [layer()], colliders, "tree");
    expect(held).toBe(colliders.tree);
  });

  it("answers for a key the document has not been told about", () => {
    const derived = resolveCollider(
      ortho,
      [layer({ placements: [placement()] })],
      undefined,
      "tree",
    );
    expect(derived.blocking).toBe(true);
    expect(derived.edited).toBeUndefined();
    expect(sorted(derived.cells)).toEqual(["0,0"]);
  });

  it("puts a collider where its placement stands", () => {
    expect(
      sorted(colliderCells(colliders.tree, { cx: 2, cy: 3 })),
    ).toEqual(["2,3"]);
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
