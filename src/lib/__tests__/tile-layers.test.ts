/**
 * What a tile layer holds, and the edits that put something on one.
 *
 * Three claims carry the feature and all three are here. A palette is cut on
 * the **project's own grid**, so what is picked up in the sidebar is what is
 * put down on the ground. A `firstgid` handed out is **permanent** for as
 * long as anything stands on it, because a gid means the nth tile across
 * every tileset in the map. And a bucket fill on a canvas with no edge is
 * bounded by **what you can see**, because there is nothing else to stop it.
 */

import { describe, expect, it, vi } from "vitest";
import { DocStore } from "../doc-store";
import { Grid } from "../grid";
import {
  addTileset,
  blockCorner,
  cutIntoTileset,
  syncTilesets,
  tilesetArt,
  nextFirstGid,
  paintTiles,
  propertyOf,
  eraseTiles,
  moveTiles,
  stampRange,
  stampWrites,
  tiledCells,
  tileLayer,
  tilesUnderBox,
  tileLayersAllowed,
  tilesetForPsd,
  tilesetsOf,
  describeTiles,
} from "../tile-layers";
import { tileAt, tileCount } from "../tiled/chunks";
import { PSD_PROPERTY } from "../tiled/types";
import type { GameDoc } from "../types";

// The store writes through `ipc.doc.write`, which wants Tauri, and debounces
// that write on window timers, where this runs in node. The same two stubs
// `layer-kinds.test.ts` uses, for the same reason: nothing here is about
// saving.
vi.mock("../ipc", () => ({
  doc: { read: vi.fn(), write: vi.fn(async () => undefined) },
}));

(globalThis as unknown as { window: unknown }).window ??= {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
};

function store(): DocStore {
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
            locked: false,
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
  return new DocStore("p1", doc);
}

const GRID = new Grid("orthogonal", 32);

/** A palette 96 x 64 on a 32px grid: three across, two down. */
function palette(held: DocStore, key = "ground") {
  return addTileset(held, GRID, {
    psdKey: key,
    layerPath: "S | ground",
    name: key,
    image: `assets/${key}/sprites/ground.png`,
    imagewidth: 96,
    imageheight: 64,
  });
}

describe("which projects can have one", () => {
  it("offers the two that have a lattice and withholds the one that has not", () => {
    // A tileset is a picture cut into equal spaces, and a blank project's
    // cells are single world pixels — every tile would be one pixel square.
    expect(tileLayersAllowed("orthogonal")).toBe(true);
    expect(tileLayersAllowed("isometric")).toBe(true);
    expect(tileLayersAllowed("blank")).toBe(false);
  });
});

describe("cutting a PSD into a palette", () => {
  it("divides it on the project's own grid boundaries", () => {
    const held = store();
    const made = palette(held);
    expect(made.tilewidth).toBe(32);
    expect(made.tileheight).toBe(32);
    expect(made.columns).toBe(3);
    expect(made.tilecount).toBe(6);
    expect(made.firstgid).toBe(1);
    // Which PSD it is cannot be recovered from a path, so it rides in an
    // ordinary Tiled custom property and survives a trip through Tiled.
    expect(propertyOf(made, PSD_PROPERTY)).toBe("ground");
  });

  it("cuts an isometric palette on the diamond's bounding box", () => {
    const held = store();
    const made = addTileset(held, new Grid("isometric", 64), {
      psdKey: "iso",
      layerPath: "S | iso",
      name: "iso",
      image: "assets/iso/sprites/iso.png",
      imagewidth: 128,
      imageheight: 64,
    });
    // 64 wide, 32 tall: a picture is cut into rectangles whatever shape is
    // drawn inside them, and Tiled cuts an isometric tileset the same way.
    expect(made.tilewidth).toBe(64);
    expect(made.tileheight).toBe(32);
    expect(made.columns).toBe(2);
    expect(made.tilecount).toBe(4);
  });

  it("hands back the set already there rather than cutting a second", () => {
    const held = store();
    const first = palette(held);
    const again = palette(held);
    // A second set would take the next block of gids, and every tile standing
    // on the first would be pointing at the wrong picture.
    expect(again).toBe(first);
    expect(tilesetsOf(held)).toHaveLength(1);
    expect(tilesetForPsd(held, "ground")?.firstgid).toBe(1);
  });

  it("gives the next palette the block after the last one", () => {
    const held = store();
    palette(held);
    const second = palette(held, "walls");
    // One past the last tile of the last set: the numbers a set has been
    // given are permanent for as long as anything stands on them.
    expect(second.firstgid).toBe(7);
    expect(nextFirstGid(tilesetsOf(held))).toBe(13);
  });

  it("says nothing about a placement with no artwork to cut", () => {
    const held = store();
    const layer = held.layer("layer-1");
    const placement = { psdKey: "ground", width: 96, naturalWidth: 96 };
    expect(cutIntoTileset(held, GRID, layer!, placement, undefined)).toBeNull();
    expect(tilesetsOf(held)).toHaveLength(0);
  });
});

describe("cutting at the pitch the artwork is shown at", () => {
  it("gives a retina PSD one tile per grid space, not four", () => {
    // Everything this editor writes is painted at twice the size it is shown
    // at, so a PSD covering three spaces by two is 192 x 128 pixels. Cutting
    // that at the grid's own 32px pitch would divide each space into four —
    // which is what the first version did, and the reason a palette came out
    // with four times as many tiles as anybody could see.
    const held = store();
    const made = addTileset(held, GRID, {
      psdKey: "fill",
      layerPath: "S | fill",
      name: "fill",
      image: "assets/fill/sprites/fill.png",
      imagewidth: 192,
      imageheight: 128,
      scale: 0.5,
    });
    expect(made.tilewidth).toBe(64);
    expect(made.tileheight).toBe(64);
    expect(made.columns).toBe(3);
    expect(made.tilecount).toBe(6);
  });

  it("reads the scale off the placement, which is where the answer is", () => {
    const held = store();
    const layer = held.layer("layer-1")!;
    const made = cutIntoTileset(
      held,
      GRID,
      layer,
      // The ratio a placement already carries: shown at half its own pixels.
      { psdKey: "fill", width: 96, naturalWidth: 192 },
      { path: "S | fill", filePath: "sprites/fill.png", width: 192, height: 128 },
    );
    expect(made?.tilewidth).toBe(64);
    expect(made?.columns).toBe(3);
    // And the image names the artwork psd-to-json exported, so a .tmj written
    // beside the project points at a real picture.
    expect(made?.image).toBe("assets/fill/sprites/fill.png");
  });

  it("leaves a 1:1 palette alone, which is what a Tiled map brings", () => {
    const held = store();
    const made = addTileset(held, GRID, {
      psdKey: "ground",
      layerPath: "S | ground",
      name: "ground",
      image: "assets/ground/sprites/ground.png",
      imagewidth: 96,
      imageheight: 64,
    });
    expect(made.tilewidth).toBe(32);
    expect(made.columns).toBe(3);
  });
});

describe("the sweep that cuts palettes", () => {
  /** A placement of `key` on the one layer, as a carry would leave it. */
  function carry(held: DocStore, key: string, layerPath = "S | art") {
    held.editLayer("layer-1", (layer) => ({
      ...layer,
      placements: [
        ...layer.placements,
        {
          id: `p-${key}`,
          psdKey: key,
          layerPath,
          x: 0,
          y: 0,
          width: 96,
          height: 64,
          naturalWidth: 192,
          naturalHeight: 128,
          anchor: { cx: 0, cy: 0 },
        },
      ],
    }));
  }

  const art = (path: string) => [
    {
      path,
      filePath: "sprites/art.png",
      width: 192,
      height: 128,
      category: "sprite",
    },
  ];

  it("cuts a palette for a PSD that arrived by a route place never sees", () => {
    // The bug this exists for: carrying a file onto a tile layer from the
    // layer panel goes through `movePlacements` and never near `place`, so
    // the PSD vanished — the canvas refuses to draw a tile layer's
    // placements and there was no palette to show instead.
    const held = store();
    carry(held, "art");
    expect(tilesetsOf(held)).toHaveLength(0);

    expect(syncTilesets(held, GRID, (_key, path) => tilesetArt(art(path), path))).toBe(
      true,
    );
    expect(tilesetsOf(held)).toHaveLength(1);
    expect(tilesetsOf(held)[0].columns).toBe(3);
  });

  it("does nothing the second time, so a change handler can call it freely", () => {
    const held = store();
    carry(held, "art");
    const find = (_key: string, path: string) => tilesetArt(art(path), path);
    syncTilesets(held, GRID, find);
    const after = held.doc;
    expect(syncTilesets(held, GRID, find)).toBe(false);
    expect(held.doc).toBe(after);
  });

  it("waits rather than guessing when the file has not loaded", () => {
    // A key nobody has loaded answers with an empty list, and a palette cut
    // from a guess would be a palette with the wrong number of tiles in it.
    const held = store();
    carry(held, "art");
    expect(syncTilesets(held, GRID, () => undefined)).toBe(false);
    expect(tilesetsOf(held)).toHaveLength(0);
  });

  it("leaves the other three kinds of layer alone", () => {
    const held = store();
    held.editLayer("layer-1", (layer) => ({ ...layer, kind: "object" }));
    carry(held, "art");
    expect(syncTilesets(held, GRID, (_k, p) => tilesetArt(art(p), p))).toBe(false);
    expect(tilesetsOf(held)).toHaveLength(0);
  });

  it("falls back to the file's first picture when the path has moved", () => {
    // A placement made on an object layer names the one layer of the file it
    // stood for, and a file re-parsed since may not have that path any more.
    const layers = art("S | art");
    expect(tilesetArt(layers, "S | art")?.path).toBe("S | art");
    expect(tilesetArt(layers, "gone")?.path).toBe("S | art");
    expect(tilesetArt([], "S | art")).toBeUndefined();
  });
});

describe("a stamp", () => {
  it("lays the whole run, not a tile of it", () => {
    // What the word means: a 2 x 2 pick tapped once puts four tiles down,
    // their top-left corner on the space under the pointer. The first
    // version laid one tile and wrapped through the run as the pointer
    // crossed the ground, so a tap put down a quarter of what was in hand.
    const held = store();
    const set = palette(held);
    const stamp = { firstgid: set.firstgid, col: 0, row: 0, cols: 2, rows: 2 };
    const at = { cx: 5, cy: 5 };
    expect(stampWrites(tilesetsOf(held), stamp, at, at)).toEqual([
      { x: 5, y: 5, gid: 1 },
      { x: 6, y: 5, gid: 2 },
      { x: 5, y: 6, gid: 4 },
      { x: 6, y: 6, gid: 5 },
    ]);
  });

  it("snaps to the run's own lattice so a drag tiles seamlessly", () => {
    const held = store();
    const set = palette(held);
    const stamp = { firstgid: set.firstgid, col: 0, row: 0, cols: 2, rows: 2 };
    const origin = { cx: 0, cy: 0 };
    const corner = (cx: number, cy: number) =>
      blockCorner(stamp, origin, { cx, cy });

    // Every space inside a block lands the same block, so crossing ground
    // twice writes the same thing; the next block over meets it exactly.
    expect(corner(0, 0)).toEqual({ cx: 0, cy: 0 });
    expect(corner(1, 1)).toEqual({ cx: 0, cy: 0 });
    expect(corner(2, 0)).toEqual({ cx: 2, cy: 0 });
    // And ground left of and above the origin snaps the same way. A
    // truncating divide would put two blocks over each other there.
    expect(corner(-1, -1)).toEqual({ cx: -2, cy: -2 });
    expect(corner(-2, -2)).toEqual({ cx: -2, cy: -2 });
  });

  it("leaves the holes out rather than punching them", () => {
    // A run dragged past the edge of a palette stamps the tiles it caught.
    const held = store();
    const set = palette(held);
    const stamp = { firstgid: set.firstgid, col: 2, row: 0, cols: 2, rows: 1 };
    const at = { cx: 0, cy: 0 };
    expect(stampWrites(tilesetsOf(held), stamp, at, at)).toEqual([
      { x: 0, y: 0, gid: 3 },
    ]);
  });

  it("fills a rectangle from its own top-left corner", () => {
    const held = store();
    const set = palette(held);
    const writes = stampRange(
      tilesetsOf(held),
      { firstgid: set.firstgid, col: 0, row: 0, cols: 2, rows: 1 },
      { cx: 5, cy: 5 },
      { cx: 6, cy: 5 },
    );
    expect(writes).toEqual([
      { x: 5, y: 5, gid: 1 },
      { x: 6, y: 5, gid: 2 },
    ]);
  });

  it("tiles rather than blocks when a sweep fills a rectangle", () => {
    // A sweep is filling an *area*: what is wanted is a field of the run, so
    // it repeats one space at a time. A block per space would write each of
    // its tiles as many times as the block has spaces.
    const held = store();
    const set = palette(held);
    const writes = stampRange(
      tilesetsOf(held),
      { firstgid: set.firstgid, col: 0, row: 0, cols: 2, rows: 1 },
      { cx: 0, cy: 0 },
      { cx: 3, cy: 0 },
    );
    expect(writes).toEqual([
      { x: 0, y: 0, gid: 1 },
      { x: 1, y: 0, gid: 2 },
      { x: 2, y: 0, gid: 1 },
      { x: 3, y: 0, gid: 2 },
    ]);
  });

  it("puts nothing down where the palette has nothing", () => {
    const held = store();
    const set = palette(held);
    // Past the end of a six-tile set.
    expect(
      stampWrites(
        tilesetsOf(held),
        { firstgid: set.firstgid, col: 3, row: 2, cols: 2, rows: 1 },
        { cx: 0, cy: 0 },
        { cx: 0, cy: 0 },
      ),
    ).toEqual([]);
  });
});

describe("catching tiles in a box", () => {
  it("catches only the spaces with something on them", () => {
    // A tile layer's whole subject is what is standing on it, so catching
    // the empty ground between two tiles would be a selection of nothing
    // wearing an outline — and moving it would carry a hole across the map.
    const held = store();
    const set = palette(held);
    paintTiles(held, "layer-1", [
      { x: 0, y: 0, gid: set.firstgid },
      { x: 2, y: 0, gid: set.firstgid },
    ]);
    const caught = tilesUnderBox(held.layer("layer-1"), GRID, {
      x: 0,
      y: 0,
      width: 96,
      height: 32,
    });
    expect(caught).toEqual([
      { cx: 0, cy: 0 },
      { cx: 2, cy: 0 },
    ]);
  });

  it("catches nothing on a layer that has never been painted on", () => {
    const held = store();
    const box = { x: 0, y: 0, width: 320, height: 320 };
    expect(tilesUnderBox(held.layer("layer-1"), GRID, box)).toEqual([]);
    expect(tilesUnderBox(undefined, GRID, box)).toEqual([]);
  });
});

describe("moving and erasing a run", () => {
  it("lifts the gids before it clears, so an overlap survives", () => {
    // Every drag of one space overlaps its own source. Clearing first would
    // take a bite out of the run.
    const held = store();
    const set = palette(held);
    paintTiles(held, "layer-1", [
      { x: 0, y: 0, gid: set.firstgid },
      { x: 1, y: 0, gid: set.firstgid + 1 },
    ]);
    const moved = moveTiles(
      held,
      "layer-1",
      [
        { cx: 0, cy: 0 },
        { cx: 1, cy: 0 },
      ],
      { cx: 1, cy: 0 },
    );
    const tiles = tileLayer(held.layer("layer-1"));
    expect(tileCount(held.layer("layer-1")?.tiles)).toBe(2);
    expect(tileAt(tiles, 1, 0)).toBe(1);
    expect(tileAt(tiles, 2, 0)).toBe(2);
    expect(tileAt(tiles, 0, 0)).toBe(0);
    // And it hands back where the run ended up, for the selection to follow.
    expect(moved).toEqual([
      { cx: 1, cy: 0 },
      { cx: 2, cy: 0 },
    ]);
  });

  it("writes nothing at all for a move of no distance", () => {
    const held = store();
    palette(held);
    paintTiles(held, "layer-1", [{ x: 0, y: 0, gid: 1 }]);
    const before = held.doc;
    moveTiles(held, "layer-1", [{ cx: 0, cy: 0 }], { cx: 0, cy: 0 });
    expect(held.doc).toBe(before);
  });

  it("erases a run and drops the chunk it emptied", () => {
    const held = store();
    palette(held);
    paintTiles(held, "layer-1", [{ x: 0, y: 0, gid: 1 }]);
    eraseTiles(held, "layer-1", [{ cx: 0, cy: 0 }]);
    expect(tileCount(held.layer("layer-1")?.tiles)).toBe(0);
    expect(held.layer("layer-1")?.tiles?.chunks).toHaveLength(0);
  });

  it("lists every space that has something on it", () => {
    const held = store();
    palette(held);
    paintTiles(held, "layer-1", [
      { x: 0, y: 0, gid: 1 },
      { x: 4, y: 3, gid: 2 },
    ]);
    expect(tiledCells(held.layer("layer-1"))).toEqual([
      { cx: 0, cy: 0 },
      { cx: 4, cy: 3 },
    ]);
  });
});

describe("painting and taking away", () => {
  it("writes a whole gesture as one change to the layer", () => {
    const held = store();
    palette(held);
    paintTiles(held, "layer-1", [
      { x: 0, y: 0, gid: 1 },
      { x: 1, y: 0, gid: 2 },
    ]);
    const layer = held.layer("layer-1");
    expect(tileCount(layer?.tiles)).toBe(2);
    expect(tileAt(tileLayer(layer), 1, 0)).toBe(2);
    expect(describeTiles(layer!)).toBe("2 tiles");
  });

  it("is one step of undo per gesture, and none for a gesture that moved nothing", () => {
    const held = store();
    palette(held);
    const before = held.doc;
    paintTiles(held, "layer-1", [{ x: 0, y: 0, gid: 1 }]);
    expect(tileCount(held.layer("layer-1")?.tiles)).toBe(1);

    // Painting the same space with the same tile again is not a change, so
    // the document is handed back by identity and nothing is recorded.
    const after = held.doc;
    paintTiles(held, "layer-1", [{ x: 0, y: 0, gid: 1 }]);
    expect(held.doc).toBe(after);

    held.history.undo();
    expect(tileCount(held.layer("layer-1")?.tiles)).toBe(0);
    expect(held.doc.tilesets).toEqual(before.tilesets);
  });
});
