/**
 * Loose strokes, by the tool that drew them — see `editor/strokes-tray.ts`.
 */

import { describe, expect, it } from "vitest";
import { strokeGroups, strokeTool } from "../strokes-tray";
import type { Layer, Stroke } from "../../lib/types";

function stroke(id: string, extra: Partial<Stroke> = {}): Stroke {
  return { id, points: [0, 0, 1], brushId: 0, size: 4, color: "#000", mode: "ink", createdAt: 0, ...extra };
}

function layer(id: string, strokes: Stroke[]): Layer {
  return { id, name: id, locked: false, visible: true, fills: [], placements: [], zones: [], strokes } as unknown as Layer;
}

describe("strokeTool", () => {
  it("reads the tool off what the stroke is", () => {
    expect(strokeTool(stroke("a"))).toBe("pen");
    expect(strokeTool(stroke("b", { mode: "highlight" }))).toBe("pen");
    expect(strokeTool(stroke("c", { paint: { kind: "pattern", patternId: "p" } }))).toBe("pattern");
    expect(strokeTool(stroke("d", { mode: "shape", paint: { kind: "shape", shapeId: "s" } }))).toBe("shape");
    expect(strokeTool(stroke("e", { mode: "fill" }))).toBe("fill");
  });

  it("counts anything that takes away as an eraser, whatever made it", () => {
    expect(strokeTool(stroke("f", { erase: true, paint: { kind: "pattern" } }))).toBe("eraser");
    expect(strokeTool(stroke("g", { mode: "erase" }))).toBe("eraser");
  });
});

describe("strokeGroups", () => {
  it("groups by tool first, then by layer from the top", () => {
    const groups = strokeGroups([
      layer("top", [stroke("1"), stroke("2", { mode: "fill" }), stroke("3")]),
      layer("under", [stroke("4", { paint: { kind: "pattern" } }), stroke("5")]),
      layer("empty", []),
    ]);
    expect(groups.map((g) => [g.tool, g.layerId, g.ids])).toEqual([
      ["pen", "top", ["1", "3"]],
      ["pen", "under", ["5"]],
      ["pattern", "under", ["4"]],
      ["fill", "top", ["2"]],
    ]);
  });

  it("is empty for a scene with no loose strokes", () => {
    expect(strokeGroups([layer("a", [])])).toEqual([]);
  });
});
