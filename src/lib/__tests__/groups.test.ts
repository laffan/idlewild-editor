/**
 * Groups: the editor-only relationship, and the four rules that make it one.
 *
 * Two is the floor, a unit is in at most one group, a group is brought
 * together in the draw order, and a group that has lost its members is not a
 * group. None of those is visible when it is wrong in the ordinary way — a
 * group of one still draws a row, a stale unit id still round-trips through
 * JSON — so they are asserted rather than assumed.
 */

import { describe, expect, it } from "vitest";
import {
  groupOfUnit,
  groupPlacements,
  groupUnits,
  liveGroups,
  nextGroupName,
  pruneGroups,
  ungroupUnits,
} from "../groups";
import type { Layer, Placement } from "../types";

/** A placement, said in one line: which unit it is in and where it stands. */
function placed(id: string, unit: string, x = 0): Placement {
  return {
    id,
    psdKey: id,
    layerPath: "root",
    x,
    y: 0,
    width: 10,
    height: 10,
    anchor: { cx: 0, cy: 0 },
    instance: unit,
  };
}

function layerOf(...placements: Placement[]): Layer {
  return {
    id: "layer-1",
    name: "Foreground",
    locked: false,
    visible: true,
    fills: [],
    placements,
    points: [],
    zones: [],
    strokes: [],
  };
}

/** Four files on a layer: a wall, a roof, a door and a tree. */
const WALL = placed("wall", "u-wall", 0);
const ROOF = placed("roof", "u-roof", 10);
const DOOR = placed("door", "u-door", 20);
const TREE = placed("tree", "u-tree", 30);

describe("making a group", () => {
  it("ties two units together and names it", () => {
    const { layer, group } = groupUnits(layerOf(WALL, ROOF, TREE), [
      "u-wall",
      "u-roof",
    ]);
    expect(group?.name).toBe("Group 1");
    expect(group?.units).toEqual(["u-wall", "u-roof"]);
    expect(liveGroups(layer)).toHaveLength(1);
  });

  /**
   * A group of one names something that already has a name, so ⌘G on a single
   * file writes no document at all — which is what keeps it from pushing an
   * undo step nobody could see the effect of.
   */
  it("refuses one unit, and hands the layer back untouched", () => {
    const before = layerOf(WALL, ROOF);
    const { layer, group } = groupUnits(before, ["u-wall"]);
    expect(group).toBeNull();
    expect(layer).toBe(before);
  });

  it("ignores units that are not on the layer", () => {
    const before = layerOf(WALL, ROOF);
    expect(groupUnits(before, ["u-wall", "u-elsewhere"]).group).toBeNull();
  });

  /**
   * The members are brought together into one run of the layer's placements,
   * because the panel lists them in the order they draw — a group shown as a
   * cluster of rows whose members are scattered through that order would be a
   * list saying something the canvas does not do.
   */
  it("brings the members together where the earliest of them was", () => {
    const { layer } = groupUnits(layerOf(WALL, ROOF, DOOR, TREE), [
      "u-wall",
      "u-door",
    ]);
    expect(layer.placements.map((p) => p.id)).toEqual([
      "wall",
      "door",
      "roof",
      "tree",
    ]);
  });

  it("keeps a multi-layer file's own placements in their order", () => {
    const a1 = placed("a1", "u-a");
    const a2 = placed("a2", "u-a");
    const { layer } = groupUnits(layerOf(a1, TREE, a2), ["u-a", "u-tree"]);
    // `a2` joins `a1`, because a unit moves as the block it is.
    expect(layer.placements.map((p) => p.id)).toEqual(["a1", "a2", "tree"]);
  });

  it("numbers the next group past the ones already there", () => {
    const { layer } = groupUnits(layerOf(WALL, ROOF, DOOR, TREE), [
      "u-wall",
      "u-roof",
    ]);
    expect(nextGroupName(layer)).toBe("Group 2");
  });
});

describe("a unit is in at most one group", () => {
  it("absorbs a unit out of the group it was in", () => {
    const first = groupUnits(layerOf(WALL, ROOF, DOOR, TREE), [
      "u-wall",
      "u-roof",
      "u-door",
    ]).layer;
    const second = groupUnits(first, ["u-door", "u-tree"]).layer;

    expect(groupOfUnit(second, "u-door")?.units).toEqual(["u-door", "u-tree"]);
    expect(groupOfUnit(second, "u-wall")?.units).toEqual(["u-wall", "u-roof"]);
    expect(liveGroups(second)).toHaveLength(2);
  });

  /** A group the new one has left holding one member has nothing left to say. */
  it("drops a group the new one has emptied down to one", () => {
    const first = groupUnits(layerOf(WALL, ROOF, TREE), [
      "u-wall",
      "u-roof",
    ]).layer;
    const second = groupUnits(first, ["u-roof", "u-tree"]).layer;
    expect(liveGroups(second)).toHaveLength(1);
    expect(groupOfUnit(second, "u-wall")).toBeUndefined();
  });
});

describe("letting a group go", () => {
  it("takes the named units out", () => {
    const grouped = groupUnits(layerOf(WALL, ROOF, DOOR), [
      "u-wall",
      "u-roof",
      "u-door",
    ]).layer;
    const after = ungroupUnits(grouped, ["u-door"]);
    expect(groupOfUnit(after, "u-door")).toBeUndefined();
    expect(groupOfUnit(after, "u-wall")?.units).toEqual(["u-wall", "u-roof"]);
  });

  it("drops the whole group when it would be left with one", () => {
    const grouped = groupUnits(layerOf(WALL, ROOF), ["u-wall", "u-roof"]).layer;
    const after = ungroupUnits(grouped, ["u-roof"]);
    expect(liveGroups(after)).toHaveLength(0);
    // The field goes rather than being left as an empty list, so a document
    // ungrouped back to nothing is the document it was before grouping.
    expect(after.groups).toBeUndefined();
  });

  /** No write for an ungroup of things that were not in a group. */
  it("hands the layer back untouched when nothing was grouped", () => {
    const before = layerOf(WALL, ROOF);
    expect(ungroupUnits(before, ["u-wall", "u-roof"])).toBe(before);
  });
});

describe("what happens when a member goes", () => {
  it("stops being a group once only one member is left on the layer", () => {
    const grouped = groupUnits(layerOf(WALL, ROOF), ["u-wall", "u-roof"]).layer;
    const gone = { ...grouped, placements: [WALL] };
    expect(liveGroups(gone)).toHaveLength(0);
    expect(groupOfUnit(gone, "u-wall")).toBeUndefined();
  });

  it("still holds the ones that are there", () => {
    const grouped = groupUnits(layerOf(WALL, ROOF, DOOR), [
      "u-wall",
      "u-roof",
      "u-door",
    ]).layer;
    const gone = { ...grouped, placements: [WALL, ROOF] };
    expect(liveGroups(gone)[0]?.units).toEqual(["u-wall", "u-roof"]);
    expect(groupPlacements(gone, liveGroups(gone)[0]).map((p) => p.id)).toEqual([
      "wall",
      "roof",
    ]);
  });

  it("writes that answer back when there is an edit to hang it on", () => {
    const grouped = groupUnits(layerOf(WALL, ROOF, DOOR), [
      "u-wall",
      "u-roof",
      "u-door",
    ]).layer;
    const pruned = pruneGroups({ ...grouped, placements: [WALL, ROOF] });
    expect(pruned.groups?.[0]?.units).toEqual(["u-wall", "u-roof"]);
  });

  /** And says nothing when there is nothing stale, so it is never a step. */
  it("hands the layer back untouched when nothing is stale", () => {
    const grouped = groupUnits(layerOf(WALL, ROOF), ["u-wall", "u-roof"]).layer;
    expect(pruneGroups(grouped)).toBe(grouped);
    const plain = layerOf(WALL, ROOF);
    expect(pruneGroups(plain)).toBe(plain);
  });
});
