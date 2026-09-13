/**
 * Instances: the placed PSDs that share a file.
 *
 * The number this answers is what the inspector says out loud and what decides
 * whether the canvas outlines a selection dashed or solid, so getting it wrong
 * is either a warning about nothing or silence about an edit that reaches five
 * objects. Two things used to make it wrong.
 *
 * It counted **placements**, matching both the PSD key and the layer path. For
 * the copies an option-drag makes that comes to the same number as counting
 * objects, which is why it went unnoticed; for anything else it is a different
 * question. A PSD with a wall and a roof placed once is *one* thing standing on
 * the grid, not two.
 *
 * And it has to be asked of **every scene**. `psd/` is one directory per
 * project, so "would editing this file change something else?" is not a question
 * about the canvas you happen to be looking at.
 */

import { describe, expect, it } from "vitest";
import { instanceCount, isInstance, unitsOfKey } from "../instances";
import type { Layer, Placement } from "../../lib/types";

function placement(over: Partial<Placement> = {}): Placement {
  return {
    id: "p1",
    psdKey: "tower",
    layerPath: "tower",
    x: 0,
    y: 0,
    width: 64,
    height: 96,
    anchor: { cx: 0, cy: 0 },
    ...over,
  };
}

function layer(id: string, placements: Placement[]): Layer {
  return {
    id,
    name: id,
    locked: false,
    visible: true,
    fills: [],
    placements,
    points: [],
    zones: [],
    strokes: [],
  };
}

describe("how many objects share a PSD", () => {
  it("is one for a file placed once", () => {
    const layers = [layer("l1", [placement({ instance: "u1" })])];
    expect(instanceCount(layers, "tower")).toBe(1);
    expect(isInstance(layers, placement({ instance: "u1" }))).toBe(false);
  });

  /** The bug: a multi-layer PSD is one object, however many rows it has. */
  it("is one for a multi-layer file placed once", () => {
    const layers = [
      layer("l1", [
        placement({ id: "a", instance: "u1", layerPath: "wall" }),
        placement({ id: "b", instance: "u1", layerPath: "roof" }),
      ]),
    ];
    expect(instanceCount(layers, "tower")).toBe(1);
  });

  it("counts the copy an option-drag makes", () => {
    const layers = [
      layer("l1", [
        placement({ id: "a", instance: "u1" }),
        placement({ id: "b", instance: "u2" }),
      ]),
    ];
    expect(instanceCount(layers, "tower")).toBe(2);
    expect(isInstance(layers, placement({ id: "a", instance: "u1" }))).toBe(true);
  });

  it("counts one on each of two document layers", () => {
    const layers = [
      layer("l1", [placement({ id: "a", instance: "u1" })]),
      layer("l2", [placement({ id: "b", instance: "u2" })]),
    ];
    expect(instanceCount(layers, "tower")).toBe(2);
  });

  /**
   * A unit id is only unique within the layer it was made on, and a placement
   * carried to another layer by the panel's drag keeps the id it had. Two units
   * that happen to share one are still two objects.
   */
  it("counts a unit per layer, even when the ids collide", () => {
    const layers = [
      layer("l1", [placement({ id: "a", instance: "u1" })]),
      layer("l2", [placement({ id: "b", instance: "u1" })]),
    ];
    expect(instanceCount(layers, "tower")).toBe(2);
  });

  it("says nothing about another file", () => {
    const layers = [
      layer("l1", [
        placement({ id: "a", instance: "u1" }),
        placement({ id: "b", psdKey: "tree", instance: "u2" }),
        placement({ id: "c", psdKey: "tree", instance: "u3" }),
      ]),
    ];
    expect(instanceCount(layers, "tower")).toBe(1);
    expect(instanceCount(layers, "tree")).toBe(2);
    expect(instanceCount(layers, "nobody")).toBe(0);
  });

  /**
   * Documents written before units existed carry no unit id, and such a
   * placement is a unit of one — so two of them are two objects rather than a
   * heap the count cannot tell apart.
   */
  it("takes a placement with no unit as a unit of its own", () => {
    const layers = [
      layer("l1", [placement({ id: "a" }), placement({ id: "b" })]),
    ];
    expect(instanceCount(layers, "tower")).toBe(2);
  });
});

describe("where the objects are", () => {
  it("names the layer and the unit of each, once", () => {
    const layers = [
      layer("l1", [
        placement({ id: "a", instance: "u1", layerPath: "wall" }),
        placement({ id: "b", instance: "u1", layerPath: "roof" }),
        placement({ id: "c", instance: "u2" }),
      ]),
      layer("l2", [placement({ id: "d", instance: "u3" })]),
    ];
    expect(unitsOfKey(layers, "tower")).toEqual([
      { layerId: "l1", unit: "u1" },
      { layerId: "l1", unit: "u2" },
      { layerId: "l2", unit: "u3" },
    ]);
  });
});
