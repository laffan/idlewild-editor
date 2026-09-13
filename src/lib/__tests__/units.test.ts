/**
 * Placed PSDs as units, and the order they draw in within a layer.
 *
 * The load-bearing claim is that a unit moves as a block. A PSD with a
 * background, a building and a roof is three placements of one thing, and a
 * reorder that interleaved them with another file's would take a composition
 * apart — which is the failure nothing downstream could report.
 */

import { describe, expect, it } from "vitest";
import { emptyLayer } from "../doc-shape";
import { reorderUnit, unitKey, unitsInDrawOrder, unitsOf } from "../units";
import type { Layer, Placement } from "../types";

function placement(id: string, instance: string, y = 0): Placement {
  return {
    id,
    psdKey: instance,
    layerPath: id,
    x: 0,
    y,
    width: 32,
    height: 32,
    anchor: { cx: 0, cy: 0 },
    instance,
  };
}

function layer(...placements: Placement[]): Layer {
  return { ...emptyLayer("Foreground"), placements };
}

const names = (units: Placement[][]) => units.map((unit) => unitKey(unit[0]));

describe("grouping placements into units", () => {
  it("keeps them in the order the layer holds them", () => {
    const grouped = unitsOf([
      placement("a1", "tower"),
      placement("b1", "tree"),
      placement("a2", "tower"),
    ]);
    expect(names(grouped)).toEqual(["tower", "tree"]);
    expect(grouped[0].map((p) => p.id)).toEqual(["a1", "a2"]);
  });

  /**
   * Documents written before units existed have no `instance`, and the scene
   * mints them on open — but nothing here may assume that has happened.
   */
  it("treats a placement with no unit as a unit of one", () => {
    const lone: Placement = { ...placement("a", "tower"), instance: undefined };
    expect(unitKey(lone)).toBe("a");
    expect(unitsOf([lone])).toHaveLength(1);
  });
});

describe("the order they draw in", () => {
  it("is the document's on a flat projection, which is what a drag writes", () => {
    const placements = [
      placement("a", "tower", 500),
      placement("b", "tree", 100),
    ];
    expect(names(unitsInDrawOrder(placements, false))).toEqual(["tower", "tree"]);
  });

  /**
   * Not a default that a manual order overrides. A thing standing nearer the
   * viewer draws in front of one behind it, which is what makes an isometric
   * scene read as a space at all — so the panel lists them this way too,
   * rather than showing an order the canvas ignores.
   */
  it("is screen Y on an isometric one, whatever the document says", () => {
    const placements = [
      placement("a", "tower", 500),
      placement("b", "tree", 100),
    ];
    expect(names(unitsInDrawOrder(placements, true))).toEqual(["tree", "tower"]);
  });

  it("takes a unit's top edge, so a roof does not sort against its own tower", () => {
    const tower = [placement("t1", "tower", 400), placement("t2", "tower", 200)];
    const tree = placement("tr", "tree", 300);
    expect(names(unitsInDrawOrder([...tower, tree], true))).toEqual(["tower", "tree"]);
  });

  it("leaves two units on the same row in the order the document has them", () => {
    const placements = [placement("a", "tower", 100), placement("b", "tree", 100)];
    expect(names(unitsInDrawOrder(placements, true))).toEqual(["tower", "tree"]);
  });
});

describe("moving a unit", () => {
  const three = () =>
    layer(
      placement("a1", "tower"),
      placement("a2", "tower"),
      placement("b", "tree"),
      placement("c", "rock"),
    );

  it("takes every placement of it, in the arrangement it had", () => {
    const moved = reorderUnit(three(), "tower", 2);
    expect(names(unitsOf(moved.placements))).toEqual(["tree", "rock", "tower"]);
    expect(moved.placements.map((p) => p.id)).toEqual(["b", "c", "a1", "a2"]);
  });

  it("moves one the other way just as well", () => {
    const moved = reorderUnit(three(), "rock", 0);
    expect(names(unitsOf(moved.placements))).toEqual(["rock", "tower", "tree"]);
  });

  it("clamps a drag that overshoots rather than refusing it", () => {
    expect(names(unitsOf(reorderUnit(three(), "tower", 99).placements))).toEqual([
      "tree",
      "rock",
      "tower",
    ]);
    expect(names(unitsOf(reorderUnit(three(), "rock", -5).placements))).toEqual([
      "rock",
      "tower",
      "tree",
    ]);
  });

  /**
   * The same object back, not an equal one. A no-op drag must not write a
   * document or push an undo step — "un-move the thing you did not move" is
   * worse than no undo.
   */
  it("answers the layer unchanged when nothing moved", () => {
    const held = three();
    expect(reorderUnit(held, "tower", 0)).toBe(held);
    expect(reorderUnit(held, "nobody", 1)).toBe(held);
  });

  /** What is on top *inside* a file is the file's business, not the list's. */
  it("leaves the stack inside the unit alone", () => {
    const held = layer(
      { ...placement("a1", "tower"), order: 1 },
      { ...placement("a2", "tower"), order: 0 },
      placement("b", "tree"),
    );
    const moved = reorderUnit(held, "tower", 1);
    const tower = moved.placements.filter((p) => p.instance === "tower");
    expect(tower.map((p) => p.order)).toEqual([1, 0]);
  });
});
