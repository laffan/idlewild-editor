import { describe, expect, it } from "vitest";
import {
  instanceMembers,
  instanceOf,
  placementRect,
  scaleWithin,
  unionRect,
} from "../instance";
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
    naturalWidth: 128,
    naturalHeight: 192,
    anchor: { cx: 0, cy: 0 },
    ...over,
  };
}

function layer(placements: Placement[]): Layer {
  return {
    id: "l1",
    name: "l1",
    locked: false,
    visible: true,
    fills: [],
    placements,
    points: [],
    zones: [],
    strokes: [],
  };
}

describe("instanceOf", () => {
  it("reads the shared id when there is one", () => {
    expect(instanceOf(placement({ instance: "psd-1" }))).toBe("psd-1");
  });

  it("falls back to the placement's own id, making it a unit of one", () => {
    // Documents written before instances existed have none, and a placement
    // that is alone must still be draggable rather than inert.
    expect(instanceOf(placement({ id: "p9" }))).toBe("p9");
  });
});

describe("instanceMembers", () => {
  const tower = placement({ id: "a", instance: "psd-1" });
  const roof = placement({ id: "b", instance: "psd-1", layerPath: "roof" });
  const other = placement({ id: "c", instance: "psd-2" });

  it("collects every placement sharing the instance", () => {
    const members = instanceMembers([layer([tower, roof, other])], "l1", "psd-1");
    expect(members.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("is empty for a layer that is not there", () => {
    expect(instanceMembers([layer([tower])], "nope", "psd-1")).toEqual([]);
  });
});

describe("unionRect", () => {
  it("boxes every member, including one hanging off the top", () => {
    const box = unionRect([
      placement({ x: 0, y: 0, width: 64, height: 96 }),
      placement({ x: 16, y: -24, width: 32, height: 24 }),
    ]);
    expect(box).toEqual({ x: 0, y: -24, width: 64, height: 120 });
  });

  it("has nothing to say about no placements", () => {
    expect(unionRect([])).toBeNull();
  });

  it("is the placement itself when there is only one", () => {
    const one = placement({ x: 5, y: 7, width: 10, height: 20 });
    expect(unionRect([one])).toEqual(placementRect(one));
  });
});

describe("scaleWithin", () => {
  const before = { x: 0, y: -24, width: 64, height: 120 };
  const after = { x: 0, y: -24, width: 128, height: 240 };

  it("scales a member's size and its offset inside the unit by the same factor", () => {
    // The composition is what has to survive: a roof sitting 16 across and 24
    // up from the tower's corner must still sit there once both have doubled.
    const roof = placement({ x: 16, y: -24, width: 32, height: 24 });
    expect(scaleWithin(roof, before, after)).toEqual({
      x: 32,
      y: -24,
      width: 64,
      height: 48,
    });
  });

  it("carries the whole unit when the box moves as well as grows", () => {
    // Dragging the top-left handle moves the box's origin; a member's place
    // inside it is measured from that origin, not from the world.
    const moved = { x: -64, y: -144, width: 128, height: 240 };
    const tower = placement({ x: 0, y: 0, width: 64, height: 96 });
    expect(scaleWithin(tower, before, moved)).toEqual({
      x: -64,
      y: -96,
      width: 128,
      height: 192,
    });
  });

  it("leaves a unit with no width alone rather than dividing by zero", () => {
    const flat = { x: 0, y: 0, width: 0, height: 0 };
    const one = placement({ x: 0, y: 0, width: 10, height: 10 });
    expect(scaleWithin(one, flat, { x: 5, y: 5, width: 0, height: 0 })).toEqual({
      x: 5,
      y: 5,
      width: 10,
      height: 10,
    });
  });
});
