import { describe, expect, it } from "vitest";
import {
  destroyPlaced,
  drawOrder,
  pickPlacement,
  pickPlacementsIn,
  pickPoint,
  pickZone,
  pointInPolygon,
} from "../../game/doc-renderer";
import { Grid } from "../grid";
import { isSelected, layerItems } from "../../editor/layer-items";
import type { Layer, MapPoint, Placement, Zone } from "../types";

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
    points: [],
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

  /**
   * The two senses of "layer" must not meet. A *document* layer is Phaser's —
   * draw order over anything at all — and the panel that lists them is about
   * the canvas; a *PSD* layer is Photoshop's, and belongs to the inspector.
   * Placing a PSD makes one placement per placeable layer in the file, so a
   * list of placements put three rows under Foreground for one tower.
   */
  it("lists a placed PSD as one row, whatever is inside it", () => {
    const members = ["tower", "roof", "sign"].map((path) => ({
      ...placement("tower", 0, 0),
      id: path,
      layerPath: path,
      instance: "unit-1",
    }));
    const items = layerItems(layer("l1", { placements: members }));

    expect(items).toHaveLength(1);
    expect(items[0].label).toBe("tower.psd");
    expect(items[0].detail).toBe("3 layers");
    expect(items[0].members).toEqual(["tower", "roof", "sign"]);
  });

  it("still lists two placements of one file as two things", () => {
    const items = layerItems(
      layer("l1", {
        placements: [
          { ...placement("tower", 0, 0), id: "a", instance: "unit-1" },
          { ...placement("tower", 200, 0), id: "b", instance: "unit-2" },
        ],
      }),
    );
    expect(items.map((i) => i.members)).toEqual([["a"], ["b"]]);
  });

  it("lights the row for whichever layer of the file the canvas selected", () => {
    const [item] = layerItems(
      layer("l1", {
        placements: [
          { ...placement("tower", 0, 0), id: "a", instance: "unit-1" },
          { ...placement("tower", 0, 0), id: "b", instance: "unit-1" },
        ],
      }),
    );
    // The canvas selects whichever member the pointer landed on, and the row
    // is about the file rather than about that member.
    expect(
      isSelected(item, { kind: "placement", layerId: "l1", placementId: "b" }),
    ).toBe(true);
    expect(
      isSelected(item, { kind: "placements", layerId: "l1", ids: ["b"] }),
    ).toBe(true);
    expect(
      isSelected(item, { kind: "placement", layerId: "l1", placementId: "z" }),
    ).toBe(false);
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

/**
 * What is drawn over what, on one document layer.
 *
 * The bug this pins: every placement on a layer was given the same depth, so
 * a placed PSD's stacking fell to the order Phaser was handed its objects in
 * — and that order was the manifest's, which is top-first. Every multi-layer
 * PSD was drawn upside down, with its background over its foreground.
 */
describe("drawOrder", () => {
  /** One PSD's worth: ground at the back, then walls, then the roof. */
  function unit(id: string, y: number): Placement[] {
    return [
      { ...placement(`${id}-roof`, 0, y), instance: id, order: 2 },
      { ...placement(`${id}-walls`, 0, y + 30), instance: id, order: 1 },
      { ...placement(`${id}-ground`, 0, y + 70), instance: id, order: 0 },
    ];
  }

  it("draws a PSD's layers in the order its author stacked them", () => {
    const hut = unit("hut", 0);
    expect(drawOrder(hut, false).map((p) => p.id)).toEqual([
      "hut-ground",
      "hut-walls",
      "hut-roof",
    ]);
  });

  it("keeps a unit together rather than sorting its layers against each other", () => {
    // Isometric sorts on screen Y, and a roof sits higher up the screen than
    // the tower under it — sorting the two would put the roof behind it.
    const hut = unit("hut", 0);
    expect(drawOrder(hut, true).map((p) => p.id)).toEqual([
      "hut-ground",
      "hut-walls",
      "hut-roof",
    ]);
  });

  it("sorts separate PSDs on their own Y, nearer in front", () => {
    const far = unit("far", 0);
    const near = unit("near", 200);
    const order = drawOrder([...near, ...far], true).map((p) => p.id);
    expect(order.slice(0, 3)).toEqual(["far-ground", "far-walls", "far-roof"]);
    expect(order.slice(3)).toEqual(["near-ground", "near-walls", "near-roof"]);
  });

  it("leaves separate PSDs in the order they were placed where nothing snaps", () => {
    const first = unit("first", 300);
    const second = unit("second", 0);
    const order = drawOrder([...first, ...second], false).map((p) => p.id);
    expect(order[0]).toBe("first-ground");
    expect(order[3]).toBe("second-ground");
  });

  it("takes a placement with no recorded stack as the back of its own", () => {
    // A document written before the stack was recorded, opened before the
    // scene's migration has run over it.
    const loose = [placement("a", 0, 0), placement("b", 0, 0)];
    expect(drawOrder(loose, false)).toHaveLength(2);
  });
});

describe("pickPoint", () => {
  const grid = new Grid("orthogonal", 64);
  const at = (id: string, cx: number, cy: number): MapPoint => ({
    id,
    name: id,
    cell: { cx, cy },
  });

  it("finds the point whose space the finger is on", () => {
    const layers = [layer("l1", { points: [at("a", 0, 0), at("b", 3, 0)] })];
    // The middle of space 3,0 — a point is drawn on the middle of its space.
    expect(pickPoint(grid, layers, 3 * 64 + 32, 32)?.point.id).toBe("b");
  });

  it("misses when the finger is more than a marker away", () => {
    const layers = [layer("l1", { points: [at("a", 0, 0)] })];
    // Two spaces off: well past the marker, which reaches about a third of
    // one. A point is small on purpose, so it never swallows a tap meant for
    // the ground it is standing on.
    expect(pickPoint(grid, layers, 32 + 128, 32)).toBeUndefined();
  });

  it("takes the nearest rather than the front-most", () => {
    // Two markers a finger lands between. Every other picker here answers
    // front-most, which for two dots is whichever happens to be listed first.
    const layers = [
      layer("top", { points: [at("far", 1, 0)] }),
      layer("bottom", { points: [at("near", 0, 0)] }),
    ];
    expect(pickPoint(grid, layers, 40, 32)?.point.id).toBe("near");
  });

  it("ignores locked and hidden layers, as every other pick does", () => {
    const locked = [layer("l1", { locked: true, points: [at("a", 0, 0)] })];
    const hidden = [layer("l1", { visible: false, points: [at("a", 0, 0)] })];
    expect(pickPoint(grid, locked, 32, 32)).toBeUndefined();
    expect(pickPoint(grid, hidden, 32, 32)).toBeUndefined();
  });
});

describe("a point in the layer list", () => {
  const point: MapPoint = { id: "p1", name: "Cave mouth", cell: { cx: 2, cy: -1 } };

  it("says where it is", () => {
    const [row] = layerItems(layer("l1", { points: [point] }));
    expect(row.label).toBe("Cave mouth");
    expect(row.detail).toBe("2, -1");
  });

  it("says so instead when it is the scene's start", () => {
    const [row] = layerItems(layer("l1", { points: [point] }), "p1");
    expect(row.detail).toBe("start");
  });

  it("lights up when the canvas selects it", () => {
    const [row] = layerItems(layer("l1", { points: [point] }));
    expect(
      isSelected(row, { kind: "point", layerId: "l1", pointId: "p1" }),
    ).toBe(true);
    expect(
      isSelected(row, { kind: "point", layerId: "l1", pointId: "other" }),
    ).toBe(false);
  });
});
