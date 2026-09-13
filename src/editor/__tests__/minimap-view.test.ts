/**
 * The minimap's arithmetic.
 *
 * Two things here are load-bearing and neither shows up in a typecheck. The
 * camera has to be inside the framed world *always* — it is the union the
 * frame is fitted to, so a camera off the map is a map that has lost the one
 * thing it was drawn to show. And the frame has to hold still while the
 * camera moves about inside the work, or reading the map means reading a
 * picture that rescales under every pan.
 */

import { describe, expect, it } from "vitest";
import { Grid } from "../../lib/grid";
import type { Layer, Rect } from "../../lib/types";
import {
  cameraRect,
  contentBounds,
  miniView,
  toBox,
  toWorld,
} from "../minimap-view";

const BOX = { width: 240, height: 120 };

function layer(patch: Partial<Layer> = {}): Layer {
  return {
    id: "layer-1",
    name: "Ground",
    locked: false,
    visible: true,
    fills: [],
    placements: [],
    points: [],
    zones: [],
    strokes: [],
    ...patch,
  };
}

function placement(rect: Rect) {
  return {
    id: "place-1",
    psdKey: "tower",
    layerPath: "root",
    ...rect,
    anchor: { cx: 0, cy: 0 },
  };
}

/** Whether `inner` is inside `outer`, which is the frame's whole contract. */
function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

describe("what the minimap has to show", () => {
  const grid = new Grid("orthogonal", 64);

  it("is nothing at all, in a scene nobody has drawn in", () => {
    expect(contentBounds([layer()], grid)).toBeNull();
  });

  it("is everything on the visible layers, in one box", () => {
    const layers = [
      layer({ placements: [placement({ x: 0, y: 0, width: 64, height: 96 })] }),
      layer({
        id: "layer-2",
        fills: [
          {
            id: "fill-1",
            cells: [{ cx: 4, cy: 2 }],
            kind: "color",
            color: "#ec3013",
            walkable: true,
          },
        ],
      }),
    ];
    expect(contentBounds(layers, grid)).toEqual({
      x: 0,
      y: 0,
      width: 5 * 64,
      height: 3 * 64,
    });
  });

  it("leaves out a layer that has been turned off", () => {
    const hidden = layer({
      visible: false,
      placements: [placement({ x: 900, y: 900, width: 64, height: 64 })],
    });
    const shown = layer({
      id: "layer-2",
      placements: [placement({ x: 0, y: 0, width: 64, height: 64 })],
    });
    expect(contentBounds([hidden, shown], grid)).toEqual({
      x: 0,
      y: 0,
      width: 64,
      height: 64,
    });
  });

  it("measures an isometric fill as the diamond it is, not the square", () => {
    const iso = new Grid("isometric", 64);
    const fills = [
      {
        id: "fill-1",
        cells: [{ cx: 0, cy: 0 }],
        kind: "color" as const,
        color: "#ec3013",
        walkable: true,
      },
    ];
    // A 64px iso tile is a 2:1 diamond addressed by its centre: 64 across and
    // 32 down, around the origin.
    expect(contentBounds([layer({ fills })], iso)).toEqual({
      x: -32,
      y: -16,
      width: 64,
      height: 32,
    });
  });
});

describe("framing the map", () => {
  const camera: Rect = { x: 0, y: 0, width: 400, height: 300 };

  it("keeps the camera on the map, wherever it has wandered to", () => {
    const content: Rect = { x: 0, y: 0, width: 500, height: 500 };
    for (const at of [-4000, -300, 0, 250, 9000]) {
      const view = miniView(content, { ...camera, x: at, y: at }, BOX);
      expect(contains(view.world, { ...camera, x: at, y: at })).toBe(true);
      expect(contains(view.world, content)).toBe(true);
    }
  });

  it("holds still while the camera moves about inside the work", () => {
    const content: Rect = { x: -2000, y: -2000, width: 4000, height: 4000 };
    const first = miniView(content, camera, BOX);
    const moved = miniView(content, { ...camera, x: 600, y: -400 }, BOX);
    expect(moved).toEqual(first);
  });

  it("takes the shape of the box, so there are no strips of nothing", () => {
    const view = miniView({ x: 0, y: 0, width: 1000, height: 1000 }, camera, BOX);
    expect(view.world.width / view.world.height).toBeCloseTo(
      BOX.width / BOX.height,
      6,
    );
    expect(view.world.width * view.scale).toBeCloseTo(BOX.width, 6);
    expect(view.world.height * view.scale).toBeCloseTo(BOX.height, 6);
  });

  it("frames a scene with nothing in it around the camera alone", () => {
    const view = miniView(null, camera, BOX);
    expect(contains(view.world, camera)).toBe(true);
  });

  it("has no scale for a sidebar that has been folded away", () => {
    expect(miniView(null, camera, { width: 0, height: 0 }).scale).toBe(0);
  });

  it("maps a point onto the box and back again", () => {
    const view = miniView({ x: 0, y: 0, width: 800, height: 600 }, camera, BOX);
    const world = { x: 321, y: -87 };
    const there = toWorld(view, toBox(view, world));
    expect(there.x).toBeCloseTo(world.x, 6);
    expect(there.y).toBeCloseTo(world.y, 6);
  });
});

describe("the camera's own rectangle", () => {
  it("is the world a viewport covers, which the zoom decides", () => {
    expect(
      cameraRect({ originX: -100, originY: 40, zoom: 2, width: 800, height: 600 }),
    ).toEqual({ x: -100, y: 40, width: 400, height: 300 });
  });
});
