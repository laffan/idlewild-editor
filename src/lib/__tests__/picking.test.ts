import { describe, expect, it } from "vitest";
import {
  destroyPlaced,
  pickPlacement,
  pickPlacementsIn,
  pickZone,
  pointInPolygon,
} from "../../game/doc-renderer";
import { Grid } from "../grid";
import { layerItems } from "../../editor/layer-items";
import type { Layer, Placement, Zone } from "../types";

function placement(id: string, x: number, y: number): Placement {
  return {
    id,
    psdKey: id,
    layerPath: id,
    x,
    y,
    width: 100,
    height: 100,
    anchor: { cx: 0, cy: 0 },
  };
}

function layer(id: string, overrides: Partial<Layer> = {}): Layer {
  return {
    id,
    name: id,
    locked: false,
    visible: true,
    fills: [],
    placements: [],
    zones: [],
    strokes: [],
    ...overrides,
  };
}

describe("pickPlacement", () => {
  it("finds a placement under the point", () => {
    const layers = [layer("l1", { placements: [placement("a", 0, 0)] })];
    expect(pickPlacement(layers, 50, 50)?.placement.id).toBe("a");
  });

  it("misses outside the bounds", () => {
    const layers = [layer("l1", { placements: [placement("a", 0, 0)] })];
    expect(pickPlacement(layers, 150, 50)).toBeUndefined();
    expect(pickPlacement(layers, -1, 50)).toBeUndefined();
  });

  it("prefers the upper layer where two overlap", () => {
    // Layers are stored top-first, so the first entry wins.
    const layers = [
      layer("top", { placements: [placement("a", 0, 0)] }),
      layer("bottom", { placements: [placement("b", 0, 0)] }),
    ];
    expect(pickPlacement(layers, 50, 50)?.placement.id).toBe("a");
  });

  it("prefers the later placement within one layer", () => {
    // A later placement draws over an earlier one.
    const layers = [
      layer("l1", { placements: [placement("under", 0, 0), placement("over", 0, 0)] }),
    ];
    expect(pickPlacement(layers, 50, 50)?.placement.id).toBe("over");
  });

  it("treats locked and hidden layers as inert", () => {
    expect(
      pickPlacement([layer("l1", { locked: true, placements: [placement("a", 0, 0)] })], 50, 50),
    ).toBeUndefined();
    expect(
      pickPlacement([layer("l1", { visible: false, placements: [placement("a", 0, 0)] })], 50, 50),
    ).toBeUndefined();
  });

  it("falls through a locked layer to a selectable one beneath it", () => {
    const layers = [
      layer("locked", { locked: true, placements: [placement("a", 0, 0)] }),
      layer("open", { placements: [placement("b", 0, 0)] }),
    ];
    expect(pickPlacement(layers, 50, 50)?.layerId).toBe("open");
  });

  it("still finds a placement whose texture never loaded", () => {
    // Nothing here has been rendered — picking reads the document alone,
    // so a broken import stays selectable and removable.
    const layers = [layer("l1", { placements: [placement("broken", 0, 0)] })];
    expect(pickPlacement(layers, 10, 10)?.placement.id).toBe("broken");
  });
});

describe("pickZone", () => {
  const square = (id: string, x: number, y: number): Zone => ({
    id,
    name: id,
    points: [
      { x, y },
      { x: x + 100, y },
      { x: x + 100, y: y + 100 },
      { x, y: y + 100 },
    ],
    blocking: true,
  });

  it("finds a boundary containing the point", () => {
    const layers = [layer("l1", { zones: [square("wall", 0, 0)] })];
    expect(pickZone(layers, 50, 50)?.zone.id).toBe("wall");
  });

  it("misses the empty part of a concave outline", () => {
    // The point that makes a polygon test worth having: inside the bounding
    // box, outside the shape.
    const el: Zone = {
      id: "el",
      name: "el",
      blocking: true,
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 60 },
        { x: 100, y: 60 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
    };
    const layers = [layer("l1", { zones: [el] })];
    expect(pickZone(layers, 20, 80)?.zone.id).toBe("el");
    expect(pickZone(layers, 80, 20)).toBeUndefined();
  });

  it("prefers the later boundary within one layer", () => {
    const layers = [
      layer("l1", { zones: [square("under", 0, 0), square("over", 0, 0)] }),
    ];
    expect(pickZone(layers, 50, 50)?.zone.id).toBe("over");
  });

  it("treats locked and hidden layers as inert", () => {
    expect(
      pickZone([layer("l1", { locked: true, zones: [square("a", 0, 0)] })], 50, 50),
    ).toBeUndefined();
    expect(
      pickZone([layer("l1", { visible: false, zones: [square("a", 0, 0)] })], 50, 50),
    ).toBeUndefined();
  });

  it("ignores a degenerate outline", () => {
    const line: Zone = {
      id: "line",
      name: "line",
      blocking: false,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    };
    expect(pickZone([layer("l1", { zones: [line] })], 50, 0)).toBeUndefined();
    expect(pointInPolygon({ x: 50, y: 0 }, line.points)).toBe(false);
  });
});

describe("layerItems", () => {
  it("lists placements, fills and zones in draw order", () => {
    const items = layerItems(
      layer("l1", {
        placements: [placement("tower", 0, 0)],
        fills: [
          { id: "f1", cells: [{ cx: 0, cy: 0 }], kind: "color", color: "#ec3013", walkable: true },
        ],
        zones: [{ id: "z1", name: "Dock edge", points: [], blocking: true }],
      }),
    );

    expect(items.map((i) => i.label)).toEqual([
      "tower.psd",
      "Colour fill",
      "Dock edge",
    ]);
    expect(items[0].selection).toEqual({
      kind: "placement",
      layerId: "l1",
      placementId: "tower",
    });
    expect(items[1].swatch).toBe("#ec3013");
    expect(items[1].detail).toBe("1 space");
    expect(items[2].detail).toBe("blocking");
  });

  it("shows a placement's size when its path just repeats the key", () => {
    const items = layerItems(layer("l1", { placements: [placement("tower", 0, 0)] }));
    expect(items[0].detail).toBe("100×100");
  });

  it("shows the layer path when it says something the key does not", () => {
    const nested = { ...placement("level", 0, 0), layerPath: "structures/tower" };
    const items = layerItems(layer("l1", { placements: [nested] }));
    expect(items[0].detail).toBe("structures/tower");
  });

  it("is empty for an empty layer", () => {
    expect(layerItems(layer("l1"))).toEqual([]);
  });
});

describe("destroyPlaced", () => {
  /**
   * `place()` returns a Phaser Group, which is not a display container: its
   * children live on the scene's own display list. `Group.destroy()` defaults
   * to `destroyChildren = false`, so destroying the group alone removed the
   * record but left the sprite on screen.
   */
  it("takes a group's children down with it", () => {
    const calls: unknown[][] = [];
    const group = {
      setPosition: () => {},
      setScale: () => {},
      setDepth: () => {},
      setVisible: () => {},
      getChildren: () => [{}],
      destroy: (...args: unknown[]) => calls.push(args),
    };
    destroyPlaced(group);
    expect(calls).toEqual([[true]]);
  });

  it("passes nothing to a plain game object", () => {
    // GameObject.destroy(fromScene) reads its first argument completely
    // differently; passing true there would skip the display-list removal.
    const calls: unknown[][] = [];
    const sprite = {
      setPosition: () => {},
      setScale: () => {},
      setDepth: () => {},
      setVisible: () => {},
      destroy: (...args: unknown[]) => calls.push(args),
    };
    destroyPlaced(sprite);
    expect(calls).toEqual([[]]);
  });
});

describe("pickPlacementsIn", () => {
  /** A box, as the four points a marquee hands over. */
  function box(x: number, y: number, width: number, height: number) {
    return [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ];
  }

  it("catches every placement the marquee overlaps", () => {
    const layers = [
      layer("l1", {
        placements: [placement("a", 0, 0), placement("b", 200, 0), placement("c", 400, 0)],
      }),
    ];
    // Reaching into the first two and stopping short of the third.
    expect(pickPlacementsIn(layers, box(-20, -20, 260, 60))?.ids).toEqual(["a", "b"]);
  });

  it("catches a placement it only clips, not just ones it swallows", () => {
    // Dragging a box that contains everything whole is the fiddly half of
    // every marquee, and nothing here is small enough to catch by accident.
    const layers = [layer("l1", { placements: [placement("a", 0, 0)] })];
    expect(pickPlacementsIn(layers, box(90, 90, 40, 40))?.ids).toEqual(["a"]);
    expect(pickPlacementsIn(layers, box(101, 101, 40, 40))).toBeNull();
  });

  it("takes the front-most layer that has anything, and only that one", () => {
    // The same rule a tap follows: layers are top-first, so a marquee over a
    // stack picks the layer you would have hit by tapping.
    const layers = [
      layer("front", { placements: [placement("a", 0, 0)] }),
      layer("behind", { placements: [placement("b", 10, 10)] }),
    ];
    const caught = pickPlacementsIn(layers, box(-50, -50, 300, 300));
    expect(caught?.layerId).toBe("front");
    expect(caught?.ids).toEqual(["a"]);
  });

  it("ignores locked and hidden layers", () => {
    expect(
      pickPlacementsIn(
        [layer("l1", { locked: true, placements: [placement("a", 0, 0)] })],
        box(-50, -50, 300, 300),
      ),
    ).toBeNull();
    expect(
      pickPlacementsIn(
        [layer("l1", { visible: false, placements: [placement("a", 0, 0)] })],
        box(-50, -50, 300, 300),
      ),
    ).toBeNull();
  });

  it("uses the marquee's own shape, not the box around it", () => {
    // The bug this pins: under an isometric template a marquee is a diamond,
    // and the box around that diamond reaches a long way past what was
    // dragged — so a marquee in one corner picked up images in another.
    const grid = new Grid("isometric", 64);
    const outline = grid.rangePolygon({ cx: 0, cy: 0 }, { cx: 2, cy: 2 });

    const inside = outline.reduce(
      (acc, p) => ({ x: acc.x + p.x / outline.length, y: acc.y + p.y / outline.length }),
      { x: 0, y: 0 },
    );
    const corner = {
      x: Math.min(...outline.map((p) => p.x)),
      y: Math.min(...outline.map((p) => p.y)),
    };

    const middle = [layer("l1", { placements: [placement("a", inside.x - 4, inside.y - 4)] })];
    expect(pickPlacementsIn(middle, outline)?.ids).toEqual(["a"]);

    // Inside the bounding box, outside the diamond: the top-left corner of
    // the box is a long way off the top vertex of the diamond.
    const outside = [
      layer("l1", { placements: [placement("a", corner.x - 90, corner.y - 90)] }),
    ];
    expect(pickPlacementsIn(outside, outline)).toBeNull();
  });
});
