/**
 * A pattern's spacing, worked out from what it is a pattern of — see
 * `fitPattern` in `layer-kinds.ts`.
 *
 * The claim worth pinning is the one the grid size used to break: the same
 * element arrives with about the same gap round it whatever the project's
 * grid is, and the gap follows the element rather than a fixed count of
 * spaces. And the other half — a number somebody typed is theirs.
 */

import { describe, expect, it, vi } from "vitest";
import { DocStore } from "../doc-store";
import { emptyLayer } from "../doc-shape";
import { Grid } from "../grid";
import {
  fittedSpacing,
  PATTERN_GAP,
  patternSpec,
  setPatternDensity,
  setPatternRepeat,
  setPatternType,
} from "../layer-kinds";
import type { GameDoc, Layer, Placement, Projection } from "../types";

vi.mock("../ipc", () => ({
  doc: { read: vi.fn(), write: vi.fn(async () => undefined) },
}));

(globalThis as unknown as { window: unknown }).window ??= {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
};

function store(projection: Projection = "orthogonal", gridSize = 64): DocStore {
  const doc: GameDoc = {
    version: 2,
    projection,
    gridSize,
    activeSceneId: "scene-main",
    scenes: [
      {
        id: "scene-main",
        name: "Main",
        layers: [{ ...emptyLayer("Pattern 1"), id: "p", kind: "pattern" }],
      },
    ],
  };
  return new DocStore("test", doc);
}

function placement(size: number): Omit<Placement, "id"> {
  return {
    psdKey: "tree",
    layerPath: "root",
    x: 0,
    y: 0,
    width: size,
    height: size,
    anchor: { cx: 0, cy: 0 },
  };
}

/** Centre to centre, in world pixels, of a grid pattern's neighbours. */
function gridPitch(layer: Layer, grid: Grid): number {
  const spec = patternSpec(layer);
  const side = Math.ceil(Math.sqrt(spec.density));
  return (spec.repeat.cols / side) * grid.cell;
}

describe("a pattern's spacing, from its elements", () => {
  it("is worked out when the first element lands, and marked as worked out", () => {
    const s = store();
    s.addPlacement("p", placement(80));
    const spec = patternSpec(s.layer("p"));
    expect(spec.fitted).toBe(true);
    expect(spec.repeat).not.toEqual({ cols: 20, rows: 20 });
  });

  it("leaves about the gap between copies, whatever the grid is", () => {
    for (const size of [16, 64, 128]) {
      const s = store("orthogonal", size);
      s.addPlacement("p", placement(80));
      setPatternType(s, "p", "grid");
      const pitch = gridPitch(s.layer("p")!, new Grid("orthogonal", size));
      // Within a space of the aim, which is the finest a repeat can be set.
      expect(Math.abs(pitch - (80 + PATTERN_GAP))).toBeLessThanOrEqual(size);
    }
  });

  it("follows the element: a larger one gets a larger tile", () => {
    const grid = new Grid("isometric", 64);
    const small = { ...emptyLayer("x"), kind: "pattern" as const, placements: [{ ...placement(40), id: "a" }] };
    const large = { ...small, placements: [{ ...placement(400), id: "b" }] };
    const a = fittedSpacing("random", small, grid);
    const b = fittedSpacing("random", large, grid);
    expect(b.repeat.cols).toBeGreaterThan(a.repeat.cols);
  });

  it("works out again for a second element while nobody has set it", () => {
    const s = store();
    s.addPlacement("p", placement(40));
    const first = patternSpec(s.layer("p")).repeat.cols;
    s.addPlacement("p", placement(300));
    expect(patternSpec(s.layer("p")).repeat.cols).toBeGreaterThan(first);
  });

  it("keeps a number somebody typed", () => {
    const s = store();
    s.addPlacement("p", placement(40));
    setPatternRepeat(s, "p", 7, 9);
    expect(patternSpec(s.layer("p")).fitted).toBeUndefined();
    s.addPlacement("p", placement(300));
    expect(patternSpec(s.layer("p")).repeat).toEqual({ cols: 7, rows: 9 });

    const t = store();
    t.addPlacement("p", placement(40));
    setPatternDensity(t, "p", 3);
    t.addPlacement("p", placement(300));
    expect(patternSpec(t.layer("p")).density).toBe(3);
    expect(patternSpec(t.layer("p")).fitted).toBeUndefined();
  });

  it("stays inside what the inspector accepts, on a blank project's pixel spaces", () => {
    const grid = new Grid("blank", 64);
    const layer = { ...emptyLayer("x"), kind: "pattern" as const, placements: [{ ...placement(900), id: "a" }] };
    for (const type of ["random", "grid"] as const) {
      const { repeat, density } = fittedSpacing(type, layer, grid);
      expect(repeat.cols).toBeLessThanOrEqual(500);
      expect(repeat.rows).toBeLessThanOrEqual(500);
      expect(density).toBeGreaterThanOrEqual(1);
    }
  });

  it("leaves an object layer alone", () => {
    const s = store();
    const object = s.addLayer("Things");
    s.addPlacement(object.id, placement(80));
    expect(s.layer(object.id)?.pattern).toBeUndefined();
  });
});
