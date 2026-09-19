/**
 * Carrying a run of selected tiles.
 *
 * Two things here can be wrong without anything looking wrong until much
 * later. A move whose source and destination **overlap** — which every drag
 * of one space is — eats its own tiles unless the gids are lifted before
 * anything is cleared. And a selection left behind on the ground the tiles
 * used to be on is an outline round nothing, whose next drag picks up
 * whatever has since been put there.
 *
 * Driven through the host, like the paint gesture: nothing in a move needs
 * Phaser, a camera or a texture.
 */

import { describe, expect, it, vi } from "vitest";
import { DocStore } from "../../lib/doc-store";
import { Grid } from "../../lib/grid";
import { addTileset, paintTiles, tileLayer } from "../../lib/tile-layers";
import { tileAt, tileCount } from "../../lib/tiled/chunks";
import { TileMove } from "../tile-move";
import type { GameDoc, Selection } from "../../lib/types";

vi.mock("../../lib/ipc", () => ({
  doc: { read: vi.fn(), write: vi.fn(async () => undefined) },
}));

(globalThis as unknown as { window: unknown }).window ??= {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
};

const GRID = new Grid("orthogonal", 32);

function fixture(locked = false) {
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
            kind: "tile",
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

  // Three tiles in a row, gids 1, 2, 3.
  paintTiles(store, "layer-1", [
    { x: 0, y: 0, gid: set.firstgid },
    { x: 1, y: 0, gid: set.firstgid + 1 },
    { x: 2, y: 0, gid: set.firstgid + 2 },
  ]);

  const state = {
    selection: {
      kind: "tiles",
      layerId: "layer-1",
      cells: [
        { cx: 0, cy: 0 },
        { cx: 1, cy: 0 },
        { cx: 2, cy: 0 },
      ],
    } as Selection,
    preview: [] as number[],
    changed: 0,
  };
  const move = new TileMove({
    store,
    grid: GRID,
    worldAt: (x, y) => ({ x, y }),
    selection: () => state.selection,
    setSelection: (next) => {
      state.selection = next;
    },
    onPreview: (tiles) => {
      state.preview = tiles.map((t) => t.gid);
    },
    onChanged: () => {
      state.changed += 1;
    },
  });
  return { store, move, state };
}

/** The world point at the middle of a space. */
function at(cx: number, cy: number): { x: number; y: number } {
  return { x: cx * 32 + 16, y: cy * 32 + 16 };
}

describe("taking the gesture", () => {
  it("takes a press inside the run", () => {
    const { move } = fixture();
    const inside = at(1, 0);
    expect(move.begin(inside.x, inside.y)).toBe(true);
    expect(move.active).toBe(true);
  });

  it("leaves a press outside it alone, so a fresh marquee can start", () => {
    // Outside the run is how a selection is replaced rather than dragged.
    const { move } = fixture();
    const outside = at(5, 5);
    expect(move.begin(outside.x, outside.y)).toBe(false);
    expect(move.active).toBe(false);
  });

  it("leaves everything alone when nothing is selected", () => {
    const { move, state } = fixture();
    state.selection = { kind: "none" };
    const inside = at(0, 0);
    expect(move.begin(inside.x, inside.y)).toBe(false);
  });

  it("refuses a locked layer", () => {
    const { move } = fixture(true);
    const inside = at(0, 0);
    expect(move.begin(inside.x, inside.y)).toBe(false);
  });

  it("answers a move and an end only while it is holding one", () => {
    const { move } = fixture();
    expect(move.move(0, 0)).toBe(false);
    expect(move.end()).toBe(false);
  });
});

describe("the drag itself", () => {
  it("writes nothing until the release", () => {
    const { move, store } = fixture();
    const from = at(0, 0);
    const to = at(4, 2);
    move.begin(from.x, from.y);
    move.move(to.x, to.y);

    // What moves during the drag is a ghost. Writing on every pointer step
    // would be a hundred documents for one gesture.
    expect(tileAt(tileLayer(store.layer("layer-1")), 0, 0)).toBe(1);
    expect(tileAt(tileLayer(store.layer("layer-1")), 4, 2)).toBe(0);
    move.end();
  });

  it("shows the run it is carrying, at the offset so far", () => {
    const { move, state } = fixture();
    const from = at(1, 0);
    const to = at(3, 1);
    move.begin(from.x, from.y);
    move.move(to.x, to.y);
    expect(state.preview).toEqual([1, 2, 3]);
    move.end();
  });

  it("carries the tiles on the release", () => {
    const { move, store } = fixture();
    const from = at(0, 0);
    const to = at(0, 3);
    move.begin(from.x, from.y);
    move.move(to.x, to.y);
    move.end();

    const tiles = tileLayer(store.layer("layer-1"));
    expect(tileCount(store.layer("layer-1")?.tiles)).toBe(3);
    expect([0, 1, 2].map((cx) => tileAt(tiles, cx, 3))).toEqual([1, 2, 3]);
    expect([0, 1, 2].map((cx) => tileAt(tiles, cx, 0))).toEqual([0, 0, 0]);
  });

  it("does not eat itself when the move overlaps where it came from", () => {
    // Every drag of one space overlaps. Clearing before lifting would take a
    // bite out of the run — the tile written at 1 would be cleared again as
    // the source space 1 was processed.
    const { move, store } = fixture();
    const from = at(0, 0);
    const to = at(1, 0);
    move.begin(from.x, from.y);
    move.move(to.x, to.y);
    move.end();

    const tiles = tileLayer(store.layer("layer-1"));
    expect(tileCount(store.layer("layer-1")?.tiles)).toBe(3);
    expect([1, 2, 3].map((cx) => tileAt(tiles, cx, 0))).toEqual([1, 2, 3]);
    expect(tileAt(tiles, 0, 0)).toBe(0);
  });

  it("takes the selection with it", () => {
    const { move, state } = fixture();
    const from = at(0, 0);
    const to = at(2, 2);
    move.begin(from.x, from.y);
    move.move(to.x, to.y);
    move.end();

    // A run left behind would be an outline round the ground the tiles used
    // to be on, and the next drag inside it would pick up whatever has since
    // been put there.
    expect(state.selection).toEqual({
      kind: "tiles",
      layerId: "layer-1",
      cells: [
        { cx: 2, cy: 2 },
        { cx: 3, cy: 2 },
        { cx: 4, cy: 2 },
      ],
    });
  });

  it("writes nothing for a drag that came back to where it started", () => {
    const { move, store, state } = fixture();
    const before = store.doc;
    const from = at(1, 0);
    move.begin(from.x, from.y);
    const away = at(4, 4);
    move.move(away.x, away.y);
    move.move(from.x, from.y);
    move.end();
    expect(store.doc).toBe(before);
    expect(state.preview).toHaveLength(0);
  });

  it("is one step of undo, however far it went", () => {
    const { move, store } = fixture();
    const from = at(0, 0);
    const to = at(0, 5);
    move.begin(from.x, from.y);
    move.move(to.x, to.y);
    move.end();

    store.history.undo();
    const tiles = tileLayer(store.layer("layer-1"));
    expect([0, 1, 2].map((cx) => tileAt(tiles, cx, 0))).toEqual([1, 2, 3]);
  });
});
