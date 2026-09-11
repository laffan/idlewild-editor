import { describe, expect, it } from "vitest";
import type Phaser from "phaser";
import { Grid } from "../../lib/grid";
import { Marquee, between, rectPoints } from "../marquee";
import type { Layer, Placement } from "../../lib/types";

/** Enough of a Graphics for the band to draw into and be ignored. */
function graphics(): Phaser.GameObjects.Graphics {
  const noop = () => {};
  return {
    setDepth: noop,
    clear: noop,
    fillStyle: noop,
    fillRect: noop,
    lineStyle: noop,
    strokeRect: noop,
    destroy: noop,
  } as unknown as Phaser.GameObjects.Graphics;
}

function placement(id: string, x: number, y: number, size = 20): Placement {
  return {
    id,
    psdKey: id,
    layerPath: id,
    x,
    y,
    width: size,
    height: size,
    anchor: { cx: 0, cy: 0 },
  };
}

function layers(...placements: Placement[]): Layer[] {
  return [
    {
      id: "l1",
      name: "l1",
      locked: false,
      visible: true,
      fills: [],
      placements,
      points: [],
      zones: [],
      strokes: [],
    },
  ];
}

describe("between", () => {
  it("normalises whichever corner the drag started from", () => {
    const box = { x: 10, y: 20, width: 30, height: 40 };
    expect(between({ x: 10, y: 20 }, { x: 40, y: 60 })).toEqual(box);
    expect(between({ x: 40, y: 60 }, { x: 10, y: 20 })).toEqual(box);
    expect(between({ x: 40, y: 20 }, { x: 10, y: 60 })).toEqual(box);
    expect(between({ x: 10, y: 60 }, { x: 40, y: 20 })).toEqual(box);
  });

  it("is a point when the drag never went anywhere", () => {
    expect(between({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 0,
    });
  });
});

describe("rectPoints", () => {
  it("gives the four corners, clockwise from the top left", () => {
    expect(rectPoints({ x: 0, y: 0, width: 10, height: 4 })).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 0, y: 4 },
    ]);
  });
});

/**
 * The two Select gestures, over the same two points, on an isometric grid.
 *
 * This is the whole difference: a drag is the rectangle it was dragged and
 * catches what is inside *that*, where a hold is a patch of grid — a diamond
 * reaching a long way past the corner it started from — and catches nothing
 * at all, because the space is what it was asked for.
 */
describe("Marquee", () => {
  const grid = new Grid("isometric", 64);
  const start = { x: 0, y: 0 };
  const finish = { x: 100, y: 100 };

  /** Inside the dragged rectangle, and inside the held diamond as well. */
  const middle = placement("middle", 40, 40);
  /**
   * Outside the rectangle — well to the right of it — but inside the diamond
   * the same two points describe in cell space.
   */
  const beyond = placement("beyond", 150, 60);

  it("a drag catches what its rectangle overlaps, and nothing else", () => {
    const marquee = new Marquee(graphics(), grid);
    expect(marquee.begin(start, false)).toEqual({ kind: "none" });
    // The band is drawn rather than selected: nothing is chosen until the
    // finger comes up, so the inspector is not rebuilt on every frame.
    expect(marquee.extend(finish)).toBeNull();
    expect(marquee.end(layers(middle, beyond))).toEqual({
      kind: "placements",
      layerId: "l1",
      ids: ["middle"],
    });
  });

  it("a hold over the same two points is the grid patch they cover", () => {
    const marquee = new Marquee(graphics(), grid);
    expect(marquee.begin(start, true)).toEqual({
      kind: "region",
      from: { cx: 0, cy: 0 },
      to: { cx: 0, cy: 0 },
    });
    const extended = marquee.extend(finish);
    expect(extended).toEqual({
      kind: "region",
      from: { cx: 0, cy: 0 },
      to: grid.worldToCell(finish),
    });
  });

  it("a drag that caught nothing selects nothing", () => {
    const marquee = new Marquee(graphics(), grid);
    marquee.begin(start, false);
    marquee.extend({ x: 10, y: 10 });
    expect(marquee.end(layers(beyond))).toEqual({ kind: "none" });
  });

  it("a hold leaves its patch of grid standing, whatever is on it", () => {
    // Null means "leave the selection alone", and the selection is the
    // region `extend` already handed over. Holding over a building to fill
    // the ground under it is the ordinary reason to hold, so the building is
    // not what comes back — there is another gesture for picking things up.
    const marquee = new Marquee(graphics(), grid);
    marquee.begin(start, true);
    marquee.extend(finish);
    expect(marquee.end(layers(middle, beyond))).toBeNull();

    const empty = new Marquee(graphics(), grid);
    empty.begin(start, true);
    empty.extend(finish);
    expect(empty.end(layers())).toBeNull();
  });

  it("remembers which gesture it was, for the floating action bar", () => {
    const marquee = new Marquee(graphics(), grid);
    marquee.begin(start, false);
    expect(marquee.held).toBe(false);
    marquee.begin(start, true);
    expect(marquee.held).toBe(true);
  });

  it("has nothing to extend or end when no gesture is up", () => {
    const marquee = new Marquee(graphics(), grid);
    expect(marquee.extend(finish)).toBeNull();
    expect(marquee.end(layers(middle))).toBeNull();
  });
});
