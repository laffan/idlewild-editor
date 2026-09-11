import { describe, expect, it } from "vitest";
import { Grid } from "../grid";
import {
  axesFor,
  axisStep,
  describeShape,
  extrude,
  faceOf,
  facePatch,
  groundPatch,
  isRear,
  levelHeight,
  MAX_VOXELS,
  patchFaces,
  pickPull,
  shadeFor,
  shapeBounds,
  shapeCells,
  shapeFaces,
  surfacePatch,
  translateShape,
  voxelKey,
  type AxisId,
  type ExtrudeState,
  type Voxel,
} from "../extrude";
import type { Cell } from "../types";

const iso = new Grid("isometric", 64);
const ortho = new Grid("orthogonal", 64);

function plate(...cells: Cell[]): ExtrudeState {
  return { shape: new Set(), patch: groundPatch(cells) };
}

function keys(state: ExtrudeState): string[] {
  return [...state.shape].sort();
}

function voxels(...list: Array<[number, number, number]>): string[] {
  return list.map(([cx, cy, cz]) => voxelKey({ cx, cy, cz })).sort();
}

describe("levelHeight", () => {
  it("is half a tile's width on an isometric grid, so a voxel is a cube", () => {
    expect(levelHeight(iso)).toBe(32);
    // One cube fills a square box: 64 wide by 32 of diamond plus 32 of wall.
    expect(shapeBounds(iso, new Set([voxelKey({ cx: 0, cy: 0, cz: 0 })]))).toEqual({
      x: -32,
      y: -48,
      width: 64,
      height: 64,
    });
  });

  it("is nothing on a flat grid, where an extrusion stays on the ground", () => {
    expect(levelHeight(ortho)).toBe(0);
    expect(axesFor(ortho)).not.toContain("+z");
    expect(axesFor(iso)).toContain("+z");
  });
});

describe("extrude, from the plate a selection starts as", () => {
  it("lays the selected spaces down as it is pulled up", () => {
    const out = extrude(plate({ cx: 0, cy: 0 }, { cx: 1, cy: 0 }), "+z", 3);
    expect(keys(out)).toEqual(
      voxels([0, 0, 0], [0, 0, 1], [0, 0, 2], [1, 0, 0], [1, 0, 1], [1, 0, 2]),
    );
  });

  it("goes the other way down, from the same ground level", () => {
    const out = extrude(plate({ cx: 0, cy: 0 }), "-z", 3);
    expect(keys(out)).toEqual(voxels([0, 0, 0], [0, 0, -1], [0, 0, -2]));
  });

  it("fills the run of spaces when it is pulled sideways", () => {
    const out = extrude(plate({ cx: 0, cy: 0 }), "+cx", 3);
    expect(keys(out)).toEqual(voxels([0, 0, 0], [1, 0, 0], [2, 0, 0]));
  });

  it("hands back the far end of the sweep to pull again", () => {
    const out = extrude(plate({ cx: 0, cy: 0 }), "+z", 3);
    expect(out.patch.virtual).toBe(false);
    expect(out.patch.facing).toBe("+z");
    expect(out.patch.voxels).toEqual([{ cx: 0, cy: 0, cz: 2 }]);
  });

  it("stops at the ceiling however far the finger went", () => {
    const out = extrude(plate({ cx: 0, cy: 0 }), "+z", 1_000_000);
    expect(out.shape.size).toBe(MAX_VOXELS);
  });
});

describe("extrude, from a face of the solid", () => {
  const column = extrude(plate({ cx: 0, cy: 0 }), "+z", 3);

  it("adds ahead of a face pulled away from the solid", () => {
    const out = extrude(column, "+z", 2);
    expect(keys(out)).toEqual(
      voxels([0, 0, 0], [0, 0, 1], [0, 0, 2], [0, 0, 3], [0, 0, 4]),
    );
    expect(out.patch.voxels).toEqual([{ cx: 0, cy: 0, cz: 4 }]);
  });

  it("takes away from a face pushed back into it", () => {
    const out = extrude(column, "-z", 2);
    expect(keys(out)).toEqual(voxels([0, 0, 0]));
    expect(out.patch.voxels).toEqual([{ cx: 0, cy: 0, cz: 0 }]);
  });

  it("leaves the user on the bare ground when a carve goes right through", () => {
    const out = extrude(column, "-z", 9);
    expect(out.shape.size).toBe(0);
    expect(out.patch.virtual).toBe(true);
  });

  it("grows a block pulled sideways off its own edge rather than carving it", () => {
    // Both spaces are filled and the top of both is held: the space beyond the
    // right-hand one is empty, so this is somebody widening the block.
    const block: ExtrudeState = {
      shape: new Set(voxels([0, 0, 0], [1, 0, 0])),
      patch: {
        voxels: [
          { cx: 0, cy: 0, cz: 0 },
          { cx: 1, cy: 0, cz: 0 },
        ],
        virtual: false,
        facing: "+z",
      },
    };
    const out = extrude(block, "+cx", 1);
    expect(keys(out)).toEqual(voxels([0, 0, 0], [1, 0, 0], [2, 0, 0]));
  });

  it("does nothing for a pull of no steps", () => {
    expect(extrude(column, "+z", 0)).toBe(column);
  });
});

describe("surfacePatch", () => {
  const stepped: ReadonlySet<string> = new Set(
    voxels([0, 0, 0], [0, 0, 1], [1, 0, 0]),
  );

  it("takes the topmost space of each selected column", () => {
    const patch = surfacePatch(stepped, [
      { cx: 0, cy: 0 },
      { cx: 1, cy: 0 },
    ]);
    expect(patch.virtual).toBe(false);
    expect(patch.voxels).toEqual([
      { cx: 0, cy: 0, cz: 1 },
      { cx: 1, cy: 0, cz: 0 },
    ]);
  });

  it("ignores the spaces with nothing standing on them", () => {
    const patch = surfacePatch(stepped, [
      { cx: 0, cy: 0 },
      { cx: 9, cy: 9 },
    ]);
    expect(patch.voxels).toEqual([{ cx: 0, cy: 0, cz: 1 }]);
  });

  it("is a fresh plate where the selection is all bare grid", () => {
    const patch = surfacePatch(stepped, [{ cx: 9, cy: 9 }]);
    expect(patch.virtual).toBe(true);
    expect(patch.voxels).toEqual([{ cx: 9, cy: 9, cz: 0 }]);
  });
});

describe("pickPull", () => {
  it("reads a drag straight up as height, two levels of it", () => {
    expect(pickPull(iso, { x: 0, y: -64 }, 1)).toEqual({ axis: "+z", steps: 2 });
  });

  it("tells the two screen diagonals apart from straight down", () => {
    // +cy runs down-left on a 2:1 diamond; -z runs straight down.
    expect(pickPull(iso, { x: -64, y: 32 }, 1)?.axis).toBe("+cy");
    expect(pickPull(iso, { x: 64, y: 32 }, 1)?.axis).toBe("+cx");
    expect(pickPull(iso, { x: 0, y: 64 }, 1)?.axis).toBe("-z");
  });

  it("counts spaces rather than pixels, however far the camera is out", () => {
    expect(pickPull(iso, { x: 0, y: -128 }, 2)).toEqual({ axis: "+z", steps: 2 });
  });

  it("has no height to offer on a flat grid", () => {
    expect(pickPull(ortho, { x: 0, y: -128 }, 1)).toEqual({ axis: "-cy", steps: 2 });
    expect(pickPull(ortho, { x: 192, y: 0 }, 1)).toEqual({ axis: "+cx", steps: 3 });
  });

  it("is nothing at all until the finger has gone a space", () => {
    expect(pickPull(iso, { x: 0, y: -4 }, 1)).toBeNull();
  });

  it("puts one step where one step of world went", () => {
    const step = axisStep(iso, "+cx");
    expect(pickPull(iso, step, 1)).toEqual({ axis: "+cx", steps: 1 });
  });
});

describe("shapeFaces", () => {
  it("draws the three sides of a cube that can be seen, and no more", () => {
    const faces = shapeFaces(iso, new Set(voxels([0, 0, 0])));
    expect(faces.map((f) => f.shade).sort()).toEqual(["left", "right", "top"]);
  });

  it("leaves out the face a neighbour is against", () => {
    const column = shapeFaces(iso, new Set(voxels([0, 0, 0], [0, 0, 1])));
    // Two walls each, and one top — the lower cube's is covered.
    expect(column).toHaveLength(5);
    expect(column.filter((f) => f.shade === "top")).toHaveLength(1);
  });

  it("is a patch of ground on a flat grid, one face per space", () => {
    const faces = shapeFaces(ortho, new Set(voxels([0, 0, 0], [1, 0, 0])));
    expect(faces.map((f) => f.shade)).toEqual(["top", "top"]);
  });

  it("sorts back to front, so what is nearer draws over what is not", () => {
    const faces = shapeFaces(iso, new Set(voxels([1, 1, 0], [0, 0, 0])));
    const order = faces.map((f) => f.voxel.cx + f.voxel.cy);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("carries the voxel each face belongs to, which is what picking reads", () => {
    const [face] = shapeFaces(iso, new Set(voxels([2, 3, 1])));
    expect(face.voxel).toEqual({ cx: 2, cy: 3, cz: 1 });
  });
});

describe("faces on the grid", () => {
  it("puts a voxel's top one level above the space it stands on", () => {
    const v: Voxel = { cx: 0, cy: 0, cz: 0 };
    const top = faceOf(iso, v, "+z");
    expect(top).toEqual(
      iso.cellPolygon(v).map((p) => ({ x: p.x, y: p.y - 32 })),
    );
  });

  it("draws a plate on the ground it was selected on", () => {
    const [face] = patchFaces(iso, groundPatch([{ cx: 0, cy: 0 }]));
    expect(face).toEqual(iso.cellPolygon({ cx: 0, cy: 0 }));
  });

  it("has no walls to draw on a flat grid", () => {
    const v: Voxel = { cx: 0, cy: 0, cz: 0 };
    expect(faceOf(ortho, v, "+cx")).toEqual(ortho.cellPolygon(v));
  });
});

describe("what a shape says about itself", () => {
  const tower = new Set(voxels([0, 0, 0], [0, 0, 1], [0, 0, 2], [1, 0, 0]));

  it("stands on each space once, however tall it is there", () => {
    expect(shapeCells(tower)).toEqual([
      { cx: 0, cy: 0 },
      { cx: 1, cy: 0 },
    ]);
  });

  it("counts spaces and levels where there are levels", () => {
    expect(describeShape(iso, tower)).toBe("2 spaces · 3 levels");
    expect(describeShape(ortho, new Set(voxels([0, 0, 0])))).toBe("1 space");
    expect(describeShape(iso, new Set())).toBe("nothing yet");
  });
});

describe("facePatch — a sweep in the plane of the face it started on", () => {
  /** A single column ten levels tall on the space at the origin. */
  const tower: ReadonlySet<string> = new Set(
    Array.from({ length: 10 }, (_, cz) => voxelKey({ cx: 0, cy: 0, cz })),
  );

  it("takes a run of levels up the side of a tower", () => {
    const patch = facePatch(
      tower,
      "+cx",
      { cx: 0, cy: 0, cz: 3 },
      { cx: 0, cy: 0, cz: 6 },
    );
    expect(patch.facing).toBe("+cx");
    expect(patch.voxels.map((v) => v.cz)).toEqual([3, 4, 5, 6]);
  });

  it("takes a patch of spaces across the top of one", () => {
    const roof = facePatch(
      tower,
      "+z",
      { cx: 0, cy: 0, cz: 9 },
      { cx: 0, cy: 0, cz: 9 },
    );
    expect(roof.voxels).toEqual([{ cx: 0, cy: 0, cz: 9 }]);
  });

  it("is the block that sticks out furthest, not the one that was clicked", () => {
    // A tower with one space jutting out to the right half way up: a sweep
    // down its +cx side takes the jutting block at that level and the tower
    // face above and below it.
    const stepped = new Set([...tower, voxelKey({ cx: 1, cy: 0, cz: 5 })]);
    const patch = facePatch(
      stepped,
      "+cx",
      { cx: 0, cy: 0, cz: 4 },
      { cx: 0, cy: 0, cz: 6 },
    );
    expect(patch.voxels).toEqual([
      { cx: 0, cy: 0, cz: 4 },
      { cx: 1, cy: 0, cz: 5 },
      { cx: 0, cy: 0, cz: 6 },
    ]);
  });

  it("leaves out the spots in the rectangle with nothing behind them", () => {
    const patch = facePatch(
      tower,
      "+cx",
      { cx: 0, cy: 0, cz: 8 },
      { cx: 0, cy: 3, cz: 11 },
    );
    // Levels 8 and 9 of the one column the tower has, and nothing else.
    expect(patch.voxels).toEqual([
      { cx: 0, cy: 0, cz: 8 },
      { cx: 0, cy: 0, cz: 9 },
    ]);
  });

  it("reads the far side from the other end", () => {
    const wide = new Set(
      [0, 1, 2].map((cx) => voxelKey({ cx, cy: 0, cz: 0 })),
    );
    expect(facePatch(wide, "+cx", { cx: 0, cy: 0, cz: 0 }, { cx: 0, cy: 0, cz: 0 }))
      .toMatchObject({ voxels: [{ cx: 2, cy: 0, cz: 0 }] });
    expect(facePatch(wide, "-cx", { cx: 2, cy: 0, cz: 0 }, { cx: 2, cy: 0, cz: 0 }))
      .toMatchObject({ voxels: [{ cx: 0, cy: 0, cz: 0 }] });
  });
});

describe("the far side of the solid", () => {
  const cube = new Set(voxels([0, 0, 0]));

  it("names the three sides that face away from this camera", () => {
    const axes: AxisId[] = ["+cx", "-cx", "+cy", "-cy", "+z", "-z"];
    expect(axes.filter(isRear)).toEqual(["-cx", "-cy", "-z"]);
  });

  it("shades a wall and its opposite the same, so a shape reads as one", () => {
    expect(shadeFor("-cx")).toBe(shadeFor("+cx"));
    expect(shadeFor("-cy")).toBe(shadeFor("+cy"));
    expect(shadeFor("-z")).toBe("top");
  });

  it("is left out of the ordinary view, which is what Apply rasterises", () => {
    expect(shapeFaces(iso, cube).some((f) => f.rear)).toBe(false);
    expect(shapeFaces(iso, cube)).toHaveLength(3);
  });

  it("is all six sides of a lone cube once it is asked for", () => {
    const faces = shapeFaces(iso, cube, true);
    expect(faces).toHaveLength(6);
    expect(faces.map((f) => f.axis).sort()).toEqual(
      ["+cx", "+cy", "+z", "-cx", "-cy", "-z"].sort(),
    );
  });

  it("draws the far side first, so the near side can be laid over it", () => {
    const faces = shapeFaces(iso, cube, true);
    const lastRear = faces.map((f) => f.rear).lastIndexOf(true);
    const firstFront = faces.map((f) => f.rear).indexOf(false);
    expect(lastRear).toBeLessThan(firstFront);
  });

  it("has nothing to add on a flat grid, whose spaces have no sides", () => {
    expect(shapeFaces(ortho, cube, true)).toEqual(shapeFaces(ortho, cube));
  });
});

describe("translateShape", () => {
  it("carries the whole solid across the grid, keeping its levels", () => {
    const moved = translateShape(new Set(voxels([0, 0, 0], [1, 0, 3])), {
      cx: 4,
      cy: -2,
    });
    expect([...moved].sort()).toEqual(voxels([4, -2, 0], [5, -2, 3]));
  });

  it("is what puts a reopened shape back under artwork that was dragged", () => {
    const shape = new Set(voxels([0, 0, 0], [0, 0, 1]));
    const there = translateShape(shape, { cx: 3, cy: 3 });
    expect([...translateShape(there, { cx: -3, cy: -3 })].sort()).toEqual(
      [...shape].sort(),
    );
  });
});
