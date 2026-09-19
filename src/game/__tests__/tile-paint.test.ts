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

import { afterEach, describe, expect, it, vi } from "vitest";
import { DocStore } from "../../lib/doc-store";
import { Grid } from "../../lib/grid";
import { addTileset, tileLayer } from "../../lib/tile-layers";
import { tileAt, tileCount } from "../../lib/tiled/chunks";
import { TilePaint } from "../tile-paint";
import { EMPTY_HAND, type TileHand, type TileVerb } from "../../lib/tile-tools";
import type { GameDoc, LayerKind } from "../../lib/types";

vi.mock("../../lib/ipc", () => ({
  doc: { read: vi.fn(), write: vi.fn(async () => undefined) },
}));

(globalThis as unknown as { window: unknown }).window ??= {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
};

afterEach(() => vi.restoreAllMocks());

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

  const state: TileHand & { changed: number; preview: number[] } = {
    ...EMPTY_HAND,
    verb: "stamp" as TileVerb,
    stamp: { firstgid: set.firstgid, col: 0, row: 0, cols: 1, rows: 1 },
    changed: 0,
    preview: [],
  };
  const paint = new TilePaint({
    store,
    grid: GRID,
    activeLayerId: () => "layer-1",
    // A world point is a cell times the grid on an orthogonal project, and
    // this host is the whole of what the gesture knows about the screen.
    worldAt: (x, y) => ({ x, y }),
    hand: () => state,
    onPreview: (tiles) => {
      state.preview = tiles.map((tile) => tile.gid);
    },
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

describe("a sweep", () => {
  /** Drag a closed loop round a 3 x 3 patch and let go. */
  function loop(paint: TilePaint, from: [number, number], to: [number, number]) {
    const corners: [number, number][] = [
      [from[0], from[1]],
      [to[0], from[1]],
      [to[0], to[1]],
      [from[0], to[1]],
      [from[0], from[1]],
    ];
    const first = at(corners[0][0], corners[0][1]);
    paint.begin(first.x - 16, first.y - 16);
    for (const [cx, cy] of corners.slice(1)) {
      const step = at(cx, cy);
      paint.move(step.x - 16, step.y - 16);
    }
    paint.end();
  }

  it("fills every space the outline encloses", () => {
    const { paint, store, state } = fixture();
    state.verb = "sweep";
    loop(paint, [0, 0], [3, 3]);
    // The loop runs along the corners of a 3 x 3 patch of spaces, so that is
    // what its inside is.
    expect(tileCount(store.layer("layer-1")?.tiles)).toBe(9);
    expect(tileAt(tileLayer(store.layer("layer-1")), 1, 1)).toBe(1);
    expect(tileAt(tileLayer(store.layer("layer-1")), 4, 4)).toBe(0);
  });

  it("writes nothing until the release", () => {
    const { paint, store, state } = fixture();
    state.verb = "sweep";
    const first = at(0, 0);
    paint.begin(first.x, first.y);
    const step = at(3, 0);
    paint.move(step.x, step.y);
    // Until the shape is closed there is no inside to fill.
    expect(tileCount(store.layer("layer-1")?.tiles)).toBe(0);
    paint.end();
  });

  it("puts one tile down for a sweep that never travelled", () => {
    // A press that goes nowhere is a tap, and a tap on this tool should still
    // do something rather than nothing at all.
    const { paint, store, state } = fixture();
    state.verb = "sweep";
    const start = at(2, 2);
    paint.begin(start.x, start.y);
    paint.end();
    expect(tileCount(store.layer("layer-1")?.tiles)).toBe(1);
  });

  it("is one step of undo for the whole shape", () => {
    const { paint, store, state } = fixture();
    state.verb = "sweep";
    loop(paint, [0, 0], [3, 3]);
    store.history.undo();
    expect(tileCount(store.layer("layer-1")?.tiles)).toBe(0);
  });

  it("tells the canvas to redraw, because a tile moves no camera", () => {
    const { paint, state } = fixture();
    paint.tap(at(0, 0));
    expect(state.changed).toBeGreaterThan(0);
  });
});

describe("a shape fill", () => {
  it("fills the box that was dragged", () => {
    const { paint, store, state } = fixture();
    state.verb = "shapefill";
    const from = at(1, 1);
    const to = at(3, 2);
    paint.begin(from.x, from.y);
    paint.move(to.x, to.y);
    paint.end();
    // Three across, two down, inclusive of both corners.
    expect(tileCount(store.layer("layer-1")?.tiles)).toBe(6);
    expect(tileAt(tileLayer(store.layer("layer-1")), 3, 2)).toBe(1);
  });

  it("takes the corners off when it is set to a circle", () => {
    const { paint, store, state } = fixture();
    state.verb = "shapefill";
    state.shape = "circle";
    const from = at(0, 0);
    const to = at(4, 4);
    paint.begin(from.x, from.y);
    paint.move(to.x, to.y);
    paint.end();
    const tiles = tileLayer(store.layer("layer-1"));
    expect(tileAt(tiles, 0, 0)).toBe(0);
    expect(tileAt(tiles, 2, 2)).toBe(1);
    expect(tileCount(store.layer("layer-1")?.tiles)).toBeLessThan(25);
  });

  it("writes nothing until the release, and shows what would land", () => {
    const { paint, store, state } = fixture();
    state.verb = "shapefill";
    const from = at(0, 0);
    const to = at(1, 1);
    paint.begin(from.x, from.y);
    paint.move(to.x, to.y);
    // The size is settled before anything is written, which is the whole
    // reason the ghost is worth drawing on this tool.
    expect(tileCount(store.layer("layer-1")?.tiles)).toBe(0);
    expect(state.preview).toHaveLength(4);
    paint.end();
    expect(tileCount(store.layer("layer-1")?.tiles)).toBe(4);
  });

  it("puts one tile down for a drag that never travelled", () => {
    const { paint, store, state } = fixture();
    state.verb = "shapefill";
    const only = at(2, 2);
    paint.begin(only.x, only.y);
    paint.end();
    expect(tileCount(store.layer("layer-1")?.tiles)).toBe(1);
  });

  it("is one step of undo, however big the shape", () => {
    const { paint, store, state } = fixture();
    state.verb = "shapefill";
    const from = at(0, 0);
    const to = at(5, 5);
    paint.begin(from.x, from.y);
    paint.move(to.x, to.y);
    paint.end();
    expect(tileCount(store.layer("layer-1")?.tiles)).toBe(36);
    store.history.undo();
    expect(tileCount(store.layer("layer-1")?.tiles)).toBe(0);
  });

  it("thins out when it is scattering", () => {
    const { paint, store, state } = fixture();
    state.verb = "shapefill";
    state.random = true;
    state.density = 50;
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const from = at(0, 0);
    const to = at(3, 3);
    paint.begin(from.x, from.y);
    paint.move(to.x, to.y);
    paint.end();
    // Every roll comes back above the density, so no space takes a tile.
    expect(tileCount(store.layer("layer-1")?.tiles)).toBe(0);
  });
});

describe("the ghost under the pointer", () => {
  it("shows exactly what a press would put down", () => {
    const { paint, state } = fixture();
    const over = at(2, 2);
    paint.hover(over.x, over.y);
    expect(state.preview).toEqual([1]);
  });

  it("shows the tile a random stamp is about to take, and then takes it", () => {
    // The whole of "the cursor shows the next thing to be stamped": the ghost
    // peeks at the sequence and the placement takes from it, so the tile you
    // were shown is the tile you get.
    const { paint, store, state, set } = fixture();
    state.random = true;
    state.stamp = { firstgid: set.firstgid, col: 0, row: 0, cols: 3, rows: 2 };
    const over = at(1, 1);
    paint.hover(over.x, over.y);
    const shown = state.preview[0];
    expect(shown).toBeGreaterThan(0);

    paint.tap(over);
    expect(tileAt(tileLayer(store.layer("layer-1")), 1, 1)).toBe(shown);
  });

  it("shows nothing once the pointer has left the canvas", () => {
    const { paint, state } = fixture();
    const over = at(0, 0);
    paint.hover(over.x, over.y);
    expect(state.preview).toHaveLength(1);
    paint.clearHover();
    expect(state.preview).toHaveLength(0);
  });

  it("moves the sequence on for every space a drag crosses", () => {
    // The bug this exists for: `consume` and `announce` were one flag, so a
    // drag's moves said "do not announce" and were heard as "do not take
    // from the sequence" — and a dragged random stamp laid the same tile on
    // every space it crossed.
    const { paint, store, state, set } = fixture();
    state.random = true;
    state.stamp = { firstgid: set.firstgid, col: 0, row: 0, cols: 3, rows: 2 };
    // A sequence that *walks* the run rather than a random one, so a space
    // that reused the previous pick is visible as a repeat rather than as
    // bad luck. The six-tile run gives four distinct tiles over four spaces.
    let roll = 0;
    vi.spyOn(Math, "random").mockImplementation(() => {
      roll += 1;
      return (roll % 6) / 6;
    });

    const start = at(0, 0);
    paint.begin(start.x, start.y);
    for (const cx of [1, 2, 3]) {
      const step = at(cx, 0);
      paint.move(step.x, step.y);
    }
    paint.end();

    const tiles = tileLayer(store.layer("layer-1"));
    const laid = [0, 1, 2, 3].map((cx) => tileAt(tiles, cx, 0));
    expect(laid.every((gid) => gid > 0)).toBe(true);
    // Every space its own tile. With the two flags conflated the drag's
    // three moves all peeked at the same pick, and this came back as
    // [2, 3, 3, 3] — which "more than one distinct tile" would have passed.
    expect(new Set(laid).size).toBe(laid.length);
  });

  it("shows nothing for a tool that is not a tile tool", () => {
    const { paint, state } = fixture();
    state.verb = null;
    const over = at(0, 0);
    paint.hover(over.x, over.y);
    expect(state.preview).toHaveLength(0);
  });
});

describe("what a run of more than one tile does", () => {
  it("lands whole on a single tap", () => {
    // A stamp is the run, not a tile of it. Four tiles from one tap.
    const { paint, store, set, state } = fixture();
    state.stamp = { firstgid: set.firstgid, col: 0, row: 0, cols: 2, rows: 2 };
    paint.tap(at(4, 4));

    const tiles = tileLayer(store.layer("layer-1"));
    expect(tileCount(store.layer("layer-1")?.tiles)).toBe(4);
    expect(tileAt(tiles, 4, 4)).toBe(1);
    expect(tileAt(tiles, 5, 4)).toBe(2);
    expect(tileAt(tiles, 4, 5)).toBe(4);
    expect(tileAt(tiles, 5, 5)).toBe(5);
  });

  it("tiles seamlessly along a drag", () => {
    const { paint, store, set, state } = fixture();
    state.stamp = { firstgid: set.firstgid, col: 0, row: 0, cols: 2, rows: 1 };

    const start = at(0, 0);
    paint.begin(start.x, start.y);
    for (const cx of [1, 2, 3]) {
      const step = at(cx, 0);
      paint.move(step.x, step.y);
    }
    paint.end();

    // 1, 2, 1, 2 — the blocks meet exactly, because each press snaps the
    // block's corner to the run's own lattice from where the drag began.
    const tiles = tileLayer(store.layer("layer-1"));
    expect([0, 1, 2, 3].map((cx) => tileAt(tiles, cx, 0))).toEqual([1, 2, 1, 2]);
  });

  it("shows the whole run under the pointer, not a tile of it", () => {
    const { paint, state, set } = fixture();
    state.stamp = { firstgid: set.firstgid, col: 0, row: 0, cols: 2, rows: 2 };
    const over = at(1, 1);
    paint.hover(over.x, over.y);
    expect(state.preview).toEqual([1, 2, 4, 5]);
  });

  it("stays one sampled tile when the stamp is set to random", () => {
    // "Randomly samples from the selection" is one tile, by definition —
    // a block of four random tiles is a different tool.
    const { paint, store, set, state } = fixture();
    state.random = true;
    state.stamp = { firstgid: set.firstgid, col: 0, row: 0, cols: 2, rows: 2 };
    paint.tap(at(7, 7));
    expect(tileCount(store.layer("layer-1")?.tiles)).toBe(1);
  });
});
