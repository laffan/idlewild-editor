/**
 * The three kinds of layer: what each one holds, and what absent means.
 *
 * The load-bearing claim is the last one. Every layer written before there
 * was more than one kind has no `kind` field, and every one of them is an
 * object layer — so the migration is a default rather than a rewrite, and a
 * document opened by an older build still reads.
 */

import { describe, expect, it, vi } from "vitest";
import { DocStore } from "../doc-store";
import { emptyLayer } from "../doc-shape";
import { Grid } from "../grid";
import {
  addBackground,
  addPatternShapeCells,
  addPatternShapePoints,
  backgroundsOf,
  layerKind,
  nextLayerName,
  PATTERN_DEFAULTS,
  patternSpec,
  removeBackground,
  removePatternShape,
  setPatternDensity,
  setPatternRepeat,
  setPatternType,
  shufflePattern,
  updateBackground,
} from "../layer-kinds";
import type { GameDoc } from "../types";

// The store writes through `ipc.doc.write`, which wants Tauri, and debounces
// that write on window timers, where this runs in node. The same two stubs
// `scenes.test.ts` uses, for the same reason: nothing here is about saving.
vi.mock("../ipc", () => ({
  doc: { read: vi.fn(), write: vi.fn(async () => undefined) },
}));

(globalThis as unknown as { window: unknown }).window ??= {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
};

function store(): DocStore {
  const doc: GameDoc = {
    version: 2,
    projection: "orthogonal",
    gridSize: 64,
    activeSceneId: "scene-main",
    scenes: [{ id: "scene-main", name: "Main", layers: [emptyLayer("Terrain")] }],
  };
  return new DocStore("test", doc);
}

describe("what a layer is for", () => {
  it("is object when the document does not say, which every old layer is", () => {
    expect(layerKind(emptyLayer("Terrain"))).toBe("object");
    expect(layerKind(undefined)).toBe("object");
  });

  it("is written out on a layer made now, so old and deliberate differ", () => {
    const s = store();
    expect(s.addLayer(undefined, "object").kind).toBe("object");
    expect(s.addLayer(undefined, "pattern").kind).toBe("pattern");
    expect(s.addLayer(undefined, "background").kind).toBe("background");
  });

  it("names a new layer after its kind", () => {
    const s = store();
    expect(s.addLayer(undefined, "pattern").name).toBe("Pattern 1");
    expect(s.addLayer(undefined, "background").name).toBe("Background 1");
  });

  /**
   * Counting and adding one is not enough, for the reason `nextPointName`
   * walks: delete Pattern 1 of two and the next one made would be Pattern 2
   * again, and two layers with one name is the thing a name is for avoiding.
   */
  it("walks past a name already taken rather than repeating it", () => {
    const layers = [
      { ...emptyLayer("x", "Pattern 1"), kind: "pattern" as const },
      { ...emptyLayer("x", "Pattern 3"), kind: "pattern" as const },
    ];
    expect(nextLayerName(layers, "pattern")).toBe("Pattern 2");
  });
});

describe("a pattern's rule", () => {
  it("is a random scatter at the random defaults until it is touched", () => {
    const spec = patternSpec(emptyLayer("Terrain"));
    expect(spec.type).toBe("random");
    expect(spec.repeat).toEqual(PATTERN_DEFAULTS.random.repeat);
    expect(spec.density).toBe(PATTERN_DEFAULTS.random.density);
    expect(spec.shapes).toEqual([]);
  });

  it("is written out in full the first time one field is edited", () => {
    const s = store();
    const layer = s.addLayer(undefined, "pattern");
    setPatternDensity(s, layer.id, 12);
    const written = s.layer(layer.id)?.pattern;
    expect(written?.density).toBe(12);
    expect(written?.repeat).toEqual(PATTERN_DEFAULTS.random.repeat);
    expect(written?.type).toBe("random");
  });

  /**
   * The same distinction a collider draws between a guess and an answer.
   * 20 × 20 is what a random pattern arrives with rather than a number
   * anybody chose, so switching to grid should bring grid's own — but a
   * repeat somebody typed is theirs.
   */
  it("brings the new type's defaults when the old ones were still defaults", () => {
    const s = store();
    const layer = s.addLayer(undefined, "pattern");
    setPatternType(s, layer.id, "grid");
    expect(s.layer(layer.id)?.pattern?.repeat).toEqual(PATTERN_DEFAULTS.grid.repeat);
    expect(s.layer(layer.id)?.pattern?.density).toBe(PATTERN_DEFAULTS.grid.density);
  });

  it("keeps a repeat somebody typed when the type changes under it", () => {
    const s = store();
    const layer = s.addLayer(undefined, "pattern");
    setPatternRepeat(s, layer.id, 7, 3);
    setPatternType(s, layer.id, "grid");
    expect(s.layer(layer.id)?.pattern?.repeat).toEqual({ cols: 7, rows: 3 });
  });

  it("refuses a density or a repeat that would ask the canvas for the impossible", () => {
    const s = store();
    const layer = s.addLayer(undefined, "pattern");
    setPatternDensity(s, layer.id, 0);
    expect(s.layer(layer.id)?.pattern?.density).toBe(1);
    setPatternDensity(s, layer.id, Number.NaN);
    expect(s.layer(layer.id)?.pattern?.density).toBe(1);
    setPatternRepeat(s, layer.id, 0, 9_999);
    expect(s.layer(layer.id)?.pattern?.repeat).toEqual({ cols: 1, rows: 500 });
  });

  it("moves the whole arrangement and nothing else when it is shuffled", () => {
    const s = store();
    const layer = s.addLayer(undefined, "pattern");
    setPatternDensity(s, layer.id, 5);
    const before = s.layer(layer.id)?.pattern;
    shufflePattern(s, layer.id);
    const after = s.layer(layer.id)?.pattern;
    expect(after?.seed).not.toBe(before?.seed);
    expect(after?.density).toBe(5);
    expect(after?.repeat).toEqual(before?.repeat);
  });
});

describe("a pattern's shapes", () => {
  const grid = new Grid("orthogonal", 64);

  it("take a run of grid spaces from the selection tool", () => {
    const s = store();
    const layer = s.addLayer(undefined, "pattern");
    const shape = addPatternShapeCells(s, layer.id, [
      { cx: 1, cy: 1 },
      { cx: 2, cy: 1 },
    ]);
    expect(shape?.cells).toHaveLength(2);
    expect(patternSpec(s.layer(layer.id)).shapes).toHaveLength(1);
  });

  it("refuse an empty selection rather than storing a shape that is nowhere", () => {
    const s = store();
    const layer = s.addLayer(undefined, "pattern");
    expect(addPatternShapeCells(s, layer.id, [])).toBeNull();
    expect(patternSpec(s.layer(layer.id)).shapes).toEqual([]);
  });

  /**
   * A drawn shape is baked down to the spaces it covers when it is made, and
   * keeps its outline beside them — so the canvas can draw the line somebody
   * drew and the pattern can ask a set rather than walking a polygon per
   * element per frame.
   */
  it("bake a drawn outline down to spaces, and keep the line", () => {
    const s = store();
    const layer = s.addLayer(undefined, "pattern");
    const shape = addPatternShapePoints(s, layer.id, grid, [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ]);
    expect(shape?.points).toHaveLength(4);
    expect(shape?.cells?.length).toBeGreaterThan(0);
  });

  it("refuse an outline covering no whole space", () => {
    const s = store();
    const layer = s.addLayer(undefined, "pattern");
    expect(
      addPatternShapePoints(s, layer.id, grid, [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
      ]),
    ).toBeNull();
  });

  it("go away one at a time", () => {
    const s = store();
    const layer = s.addLayer(undefined, "pattern");
    const first = addPatternShapeCells(s, layer.id, [{ cx: 0, cy: 0 }]);
    addPatternShapeCells(s, layer.id, [{ cx: 1, cy: 0 }]);
    removePatternShape(s, layer.id, first?.id ?? "");
    const left = patternSpec(s.layer(layer.id)).shapes;
    expect(left).toHaveLength(1);
    expect(left[0].cells).toEqual([{ cx: 1, cy: 0 }]);
  });
});

describe("a background layer's backdrops", () => {
  it("start empty, and a colour arrives with one", () => {
    const s = store();
    const layer = s.addLayer(undefined, "background");
    expect(backgroundsOf(s.layer(layer.id))).toEqual([]);
    const made = addBackground(s, layer.id, "color");
    expect(made.kind).toBe("color");
    expect(made.color).toBeTruthy();
    expect(made.gradient).toBeUndefined();
  });

  it("give a gradient two stops and a direction", () => {
    const s = store();
    const layer = s.addLayer(undefined, "background");
    const made = addBackground(s, layer.id, "gradient");
    expect(made.gradient?.from).toBeTruthy();
    expect(made.gradient?.to).toBeTruthy();
    expect(made.gradient?.angle).toBe(0);
    expect(made.color).toBeUndefined();
  });

  it("are edited and removed by id", () => {
    const s = store();
    const layer = s.addLayer(undefined, "background");
    const one = addBackground(s, layer.id, "color");
    const two = addBackground(s, layer.id, "gradient");
    updateBackground(s, layer.id, one.id, { color: "#123456" });
    expect(backgroundsOf(s.layer(layer.id))[0].color).toBe("#123456");
    removeBackground(s, layer.id, one.id);
    expect(backgroundsOf(s.layer(layer.id)).map((b) => b.id)).toEqual([two.id]);
  });
});
