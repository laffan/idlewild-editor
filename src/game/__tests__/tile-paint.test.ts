/**
 * Putting tiles down, as a gesture.
 *
 * `TilePaint` is the one piece of this feature whose correctness is about
 * *when* rather than about what: it has to refuse every gesture that is not
 * its own, take the ones that are, and leave exactly one step of undo behind
 * per sweep. All three are things that go wrong silently — a gesture wrongly
 * refused is a marquee where a tile should have been, one wrongly taken is a
 * selection nobody can make, and a bracket left open swallows whatever the
 * user does next.
 *
 * Driven through a host object rather than a scene, which is what the host
 * exists for: nothing here needs Phaser, a camera or a texture.
 */

import { describe, expect, it, vi } from "vitest";
import { DocStore } from "../../lib/doc-store";
import { Grid } from "../../lib/grid";
import { addTileset, tileLayer } from "../../lib/tile-layers";
import { tileAt, tileCount } from "../../lib/tiled/chunks";
import { TilePaint, type TileVerb } from "../tile-paint";
import type { GameDoc, LayerKind } from "../../lib/types";

vi.mock("../../lib/ipc", () => ({
  doc: { read: vi.fn(), write: vi.fn(async () => undefined) },
}));

(globalThis as unknown as { window: unknown }).window ??= {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
};

const GRID = new Grid("orthogonal", 32);

function fixture(kind: LayerKind = "tile", locked = false) {
  const doc: GameDoc = {
    version: 2,
    projection: "orthogonal",
    gridSize: 32,
    scenes: [
      {
        id: "scene-main",
        name: "Main",
        layers: [
          {
            id: "layer-1",
            name: "Ground",
            kind,
            locked,
            visible: true,
            fills: [],
            placements: [],
            points: [],
            zones: [],
            strokes: [],
          },
        ],
      },
    ],
    activeSceneId: "scene-main",
  };
  const store = new DocStore("p1", doc);
  const set = addTileset(store, GRID, {
    psdKey: "ground",
    layerPath: "S | ground",
    name: "ground",
    image: "assets/ground/sprites/ground.png",
    imagewidth: 96,
    imageheight: 64,
  });

  const state = {
    verb: "stamp" as TileVerb,
    erasing: false,
    stamp: { firstgid: set.firstgid, col: 0, row: 0, cols: 1, rows: 1 },
    changed: 0,
  };
  const paint = new TilePaint({
    store,
    grid: GRID,
    activeLayerId: () => "layer-1",
    // A world point is a cell times the grid on an orthogonal project, and
    // this host is the whole of what the gesture knows about the screen.
    worldAt: (x, y) => ({ x, y }),
    verb: () => state.verb,
    erasing: () => state.erasing,
    stamp: () => state.stamp,
    visible: () => ({ from: { cx: 0, cy: 0 }, to: { cx: 4, cy: 4 } }),
    onChanged: () => {
      state.changed += 1;
    },
  });
  return { store, paint, state, set };
}

/** The world point at the middle of a space, in this fixture's terms. */
function at(cx: number, cy: number): { x: number; y: number } {
  return { x: cx * 32 + 16, y: cy * 32 + 16 };
}

describe("refusing what is not its gesture", () => {
  it("takes nothing on a layer that is not a tile layer", () => {
    const { paint, store } = fixture("object");
    expect(paint.begin(0, 0)).toBe(false);
    expect(paint.tap({ x: 0, y: 0 })).toBe(false);
    expect(paint.move(10, 10)).toBe(false);
    expect(paint.end()).toBe(false);
    expect(tileCount(store.layer("layer-1")?.tiles)).toBe(0);
  });

  it("takes nothing when no tile tool is in hand", () => {
    const { paint, state } = fixture();
    state.verb = null;
    expect(paint.begin(0, 0)).toBe(false);
    expect(paint.tap({ x: 0, y: 0 })).toBe(false);
  });

  it("takes nothing on a locked layer", () => {
    // The same refusal every other write to a locked layer makes.
    const { paint } = fixture("tile", true);
    expect(paint.begin(0, 0)).toBe(false);
  });

  it("answers a move and an end only while it is holding a gesture", () => {
    // What keeps the drag controller reachable: a move this object did not
    // begin has to fall through to whatever did.
    const { paint } = fixture();
    expect(paint.move(0, 0)).toBe(false);
    expect(paint.end()).toBe(false);
    const start = at(0, 0);
    const step = at(1, 0);
    expect(paint.begin(start.x, start.y)).toBe(true);
    expect(paint.move(step.x, step.y)).toBe(true);
    expect(paint.end()).toBe(true);
    expect(paint.end()).toBe(false);
  });
});

describe("a sweep", () => {
  it("lays a tile on every space it crosses", () => {
    const { paint, store } = fixture();
    const start = at(0, 0);
    paint.begin(start.x, start.y);
    for (const cx of [1, 2, 3]) {
      const step = at(cx, 0);
      paint.move(step.x, step.y);
    }
    paint.end();

    const tiles = tileLayer(store.layer("layer-1"));
    expect(tileCount(store.layer("layer-1")?.tiles)).toBe(4);
    expect(tileAt(tiles, 3, 0)).toBe(1);
  });

  it("is one step of undo, however many spaces it covered", () => {
    const { paint, store } = fixture();
    const start = at(0, 0);
    paint.begin(start.x, start.y);
    for (const cx of [1, 2, 3]) {
      const step = at(cx, 0);
      paint.move(step.x, step.y);
    }
    paint.end();
    expect(tileCount(store.layer("layer-1")?.tiles)).toBe(4);

    store.history.undo();
    // All four, not the last one: a history of the loop rather than of the
    // act is what a bracket per pointer move would have given.
    expect(tileCount(store.layer("layer-1")?.tiles)).toBe(0);
  });

  it("leaves no step behind when it crossed only ground it had covered", () => {
    const { paint, store } = fixture();
    const start = at(2, 2);
    paint.begin(start.x, start.y);
    paint.end();
    const after = store.doc;

    // Straight back over the same space with the same tile in hand.
    paint.begin(start.x, start.y);
    paint.move(start.x + 2, start.y + 2);
    paint.end();
    expect(store.doc).toBe(after);
  });

  it("puts nothing down with an empty palette, and says so once", () => {
    const { paint, store, state } = fixture();
    state.stamp = null as never;
    const start = at(0, 0);
    paint.begin(start.x, start.y);
    paint.move(start.x + 32, start.y);
    paint.end();
    expect(tileCount(store.layer("layer-1")?.tiles)).toBe(0);
  });
});

describe("turned round", () => {
  it("takes tiles off the spaces it crosses", () => {
    const { paint, store, state } = fixture();
    const start = at(1, 1);
    paint.begin(start.x, start.y);
    paint.end();
    expect(tileCount(store.layer("layer-1")?.tiles)).toBe(1);

    state.erasing = true;
    paint.begin(start.x, start.y);
    paint.end();
    expect(tileCount(store.layer("layer-1")?.tiles)).toBe(0);
  });
});

describe("a pour", () => {
  it("fills the ground in view and stops at its edge", () => {
    const { paint, store, state } = fixture();
    state.verb = "fill";
    const start = at(2, 2);
    paint.tap(start);
    // The window this fixture reports is five spaces square.
    expect(tileCount(store.layer("layer-1")?.tiles)).toBe(25);
    expect(tileAt(tileLayer(store.layer("layer-1")), 5, 5)).toBe(0);
  });

  it("spreads over like ground only", () => {
    const { paint, store, state, set } = fixture();
    // A wall of a second tile down the middle.
    const wall = { firstgid: set.firstgid, col: 1, row: 0, cols: 1, rows: 1 };
    state.stamp = wall;
    for (const cy of [0, 1, 2, 3, 4]) {
      const step = at(2, cy);
      paint.tap(step);
    }

    state.verb = "fill";
    state.stamp = { firstgid: set.firstgid, col: 2, row: 0, cols: 1, rows: 1 };
    paint.tap(at(0, 0));

    const tiles = tileLayer(store.layer("layer-1"));
    expect(tileAt(tiles, 0, 0)).toBe(3);
    // The wall is untouched, and so is the room on the other side of it.
    expect(tileAt(tiles, 2, 0)).toBe(2);
    expect(tileAt(tiles, 3, 0)).toBe(0);
  });

  it("tells the canvas to redraw, because a tile moves no camera", () => {
    const { paint, state } = fixture();
    paint.tap(at(0, 0));
    expect(state.changed).toBe(1);
  });
});

describe("what a run of more than one tile does", () => {
  it("lays itself out from where the gesture started", () => {
    const { paint, store, set, state } = fixture();
    state.stamp = { firstgid: set.firstgid, col: 0, row: 0, cols: 2, rows: 1 };

    const start = at(0, 0);
    paint.begin(start.x, start.y);
    for (const cx of [1, 2, 3]) {
      const step = at(cx, 0);
      paint.move(step.x, step.y);
    }
    paint.end();

    // 1, 2, 1, 2 — a continuous pattern rather than the same pair over and
    // over, which is what laying out from each space would have given.
    const tiles = tileLayer(store.layer("layer-1"));
    expect([0, 1, 2, 3].map((cx) => tileAt(tiles, cx, 0))).toEqual([1, 2, 1, 2]);
  });
});
