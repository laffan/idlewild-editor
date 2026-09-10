import { describe, expect, it } from "vitest";
import { destroyPlaced, pickPlacement } from "../../game/doc-renderer";
import { layerItems } from "../../editor/layer-items";
import type { Layer, Placement } from "../types";

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
