/**
 * Tiled's own format, read and written.
 *
 * The first rule of a tile layer is that its data is indistinguishable from
 * data Tiled wrote, and that is a claim about *bytes* rather than about
 * behaviour — so this is mostly a set of round trips. A map goes in, the same
 * map comes out, and the two things that could silently ruin it are pinned:
 * the four flags packed into the top of a gid, and the order a `.tmj` writes
 * its layers in.
 *
 * The XML half of the reader is not exercised here. It needs a `DOMParser`,
 * which this suite has no DOM to supply — and the two halves meet at
 * `assemble` and `chunked`, both of which the JSON cases put through their
 * paces.
 */

import { describe, expect, it } from "vitest";
import {
  CHUNK_SIZE,
  chunksOf,
  emptyTileLayer,
  tileAt,
  tileCount,
  tilesInRange,
  writeTiles,
} from "../tiled/chunks";
import {
  FLIPPED_DIAGONALLY,
  FLIPPED_HORIZONTALLY,
  FLIPPED_VERTICALLY,
  gidAt,
  localId,
  tileFlags,
  tileGrid,
  tileId,
  tileRect,
  tilesetForGid,
  withFlags,
} from "../tiled/gid";
import { readTiledMap } from "../tiled/read";
import { tiledMap, tiledMapJson } from "../tiled/write";
import type { TiledTileset } from "../tiled/types";

const TILESET: TiledTileset = {
  firstgid: 1,
  name: "ground",
  image: "assets/ground/sprites/ground.png",
  imagewidth: 96,
  imageheight: 64,
  tilewidth: 32,
  tileheight: 32,
  spacing: 0,
  margin: 0,
  columns: 3,
  tilecount: 6,
};

describe("a global tile id", () => {
  it("keeps the tile and the flags in separate halves", () => {
    // A tile flipped both ways: the id is still 5, and the flags are still
    // the two that were set. `0x80000000` does not fit in a signed 32-bit
    // integer, which is the whole reason this file exists — read without the
    // unsigned shift it is a large negative number matching no tileset.
    const gid = withFlags(5, FLIPPED_HORIZONTALLY | FLIPPED_VERTICALLY);
    expect(gid).toBeGreaterThan(0);
    expect(tileId(gid)).toBe(5);
    expect(tileFlags(gid)).toBe((FLIPPED_HORIZONTALLY | FLIPPED_VERTICALLY) >>> 0);
    expect(tileFlags(gid) & FLIPPED_DIAGONALLY).toBe(0);
  });

  it("finds its tileset by the largest firstgid that is not past it", () => {
    const second: TiledTileset = { ...TILESET, firstgid: 7, name: "walls" };
    const sets = [TILESET, second];
    expect(tilesetForGid(sets, 1)?.name).toBe("ground");
    expect(tilesetForGid(sets, 6)?.name).toBe("ground");
    expect(tilesetForGid(sets, 7)?.name).toBe("walls");
    // Zero means the space is empty, which is not a tileset at all.
    expect(tilesetForGid(sets, 0)).toBeUndefined();
    // And a flipped gid resolves to the same set as the plain one.
    expect(tilesetForGid(sets, withFlags(7, FLIPPED_HORIZONTALLY))?.name).toBe("walls");
  });

  it("reads back the patch of the image it names", () => {
    expect(localId([TILESET], 5)?.id).toBe(4);
    // Fifth tile of a three-wide set: second row, second column.
    expect(tileRect(TILESET, 4)).toEqual({ x: 32, y: 32, width: 32, height: 32 });
    expect(gidAt(TILESET, 1, 1)).toBe(5);
    // Off the end of a row is nothing rather than the next row's first tile.
    expect(gidAt(TILESET, 3, 0)).toBe(0);
    expect(gidAt(TILESET, 0, 2)).toBe(0);
  });

  it("counts whole tiles only", () => {
    // A strip of image narrower than a whole tile is not a tile, and a frame
    // running off the edge of a texture is a warning per sprite per frame.
    expect(tileGrid(96, 70, 32, 32)).toEqual({ columns: 3, rows: 2 });
    expect(tileGrid(100, 64, 32, 32, 1, 2)).toEqual({ columns: 2, rows: 1 });
  });
});

describe("an infinite layer's chunks", () => {
  it("makes a chunk when a space in it is first written", () => {
    const empty = emptyTileLayer(1, "Ground");
    expect(chunksOf(empty)).toHaveLength(0);

    const after = writeTiles(empty, [{ x: 2, y: 3, gid: 4 }]);
    expect(chunksOf(after)).toHaveLength(1);
    expect(tileAt(after, 2, 3)).toBe(4);
    expect(tileAt(after, 2, 4)).toBe(0);
    // The four numbers Tiled reports about the content are derived on every
    // write rather than maintained, so they cannot go stale.
    expect(after.startx).toBe(0);
    expect(after.width).toBe(CHUNK_SIZE);
  });

  it("puts negative coordinates in the chunk below the origin", () => {
    const after = writeTiles(emptyTileLayer(1, "Ground"), [
      { x: -1, y: -1, gid: 9 },
    ]);
    const [chunk] = chunksOf(after);
    expect(chunk.x).toBe(-CHUNK_SIZE);
    expect(chunk.y).toBe(-CHUNK_SIZE);
    expect(tileAt(after, -1, -1)).toBe(9);
  });

  it("drops a chunk once the last tile in it is rubbed out", () => {
    const one = writeTiles(emptyTileLayer(1, "Ground"), [{ x: 0, y: 0, gid: 4 }]);
    const none = writeTiles(one, [{ x: 0, y: 0, gid: 0 }]);
    // Not kept as 256 zeroes: a document that remembered every space ever
    // rubbed out would grow without bound over a long session.
    expect(chunksOf(none)).toHaveLength(0);
    expect(tileCount(none)).toBe(0);
  });

  it("hands back the same layer when nothing moved", () => {
    // What makes a paint drag over ground it has already covered leave no
    // step behind: `UndoHistory.end` tests the entry by identity.
    const one = writeTiles(emptyTileLayer(1, "Ground"), [{ x: 1, y: 1, gid: 3 }]);
    expect(writeTiles(one, [{ x: 1, y: 1, gid: 3 }])).toBe(one);
    expect(writeTiles(one, [])).toBe(one);
    // And a rub-out on ground that is already empty is not a write either.
    expect(writeTiles(one, [{ x: 9, y: 9, gid: 0 }])).toBe(one);
  });

  it("never writes through the chunk a snapshot is holding", () => {
    // The immutability rule, which is what makes undo a pointer copy.
    const before = writeTiles(emptyTileLayer(1, "Ground"), [{ x: 0, y: 0, gid: 1 }]);
    const after = writeTiles(before, [{ x: 1, y: 0, gid: 2 }]);
    expect(tileAt(before, 1, 0)).toBe(0);
    expect(tileAt(after, 1, 0)).toBe(2);
  });

  it("reports only the tiles inside a range", () => {
    let layer = emptyTileLayer(1, "Ground");
    layer = writeTiles(layer, [
      { x: 0, y: 0, gid: 1 },
      { x: 20, y: 0, gid: 2 },
    ]);
    // Two chunks, and the far one is outside the window even though its
    // chunk overlaps nothing of it.
    const near = tilesInRange(layer, { cx: -1, cy: -1 }, { cx: 4, cy: 4 });
    expect(near).toEqual([{ x: 0, y: 0, gid: 1 }]);
    expect(tilesInRange(layer, { cx: 0, cy: 0 }, { cx: 30, cy: 0 })).toHaveLength(2);
  });
});

describe("reading a .tmj", () => {
  it("takes a finite map and cuts it into chunks", async () => {
    const { map, skipped } = await readTiledMap(
      "town.tmj",
      JSON.stringify({
        type: "map",
        orientation: "orthogonal",
        infinite: false,
        width: 2,
        height: 2,
        tilewidth: 32,
        tileheight: 32,
        tilesets: [TILESET],
        layers: [
          {
            type: "tilelayer",
            id: 1,
            name: "Ground",
            width: 2,
            height: 2,
            x: 0,
            y: 0,
            opacity: 1,
            visible: true,
            data: [1, 2, 0, 3],
          },
          { type: "objectgroup", name: "Spawns", objects: [] },
        ],
      }),
    );

    // A finite layer keeps its gids and loses its rectangle, which is the
    // honest conversion: the rectangle was a claim about a map with edges.
    expect(map.infinite).toBe(true);
    const [ground] = map.layers;
    expect(tileAt(ground, 0, 0)).toBe(1);
    expect(tileAt(ground, 1, 0)).toBe(2);
    expect(tileAt(ground, 0, 1)).toBe(0);
    expect(tileAt(ground, 1, 1)).toBe(3);
    // What it could not read is said rather than dropped in silence.
    expect(skipped).toEqual(["Spawns (objectgroup)"]);
  });

  it("reads base64 tile data, four little-endian bytes at a time", async () => {
    // 1, 2, 0, 3 as uint32 little-endian.
    const bytes = new Uint8Array(16);
    new DataView(bytes.buffer).setUint32(0, 1, true);
    new DataView(bytes.buffer).setUint32(4, 2, true);
    new DataView(bytes.buffer).setUint32(12, 3, true);
    // `btoa` rather than node's Buffer, because this suite is typechecked
    // against the browser's lib and the reader uses `atob` at the other end.
    const base64 = btoa(String.fromCharCode(...bytes));

    const { map } = await readTiledMap(
      "town.tmj",
      JSON.stringify({
        type: "map",
        orientation: "orthogonal",
        width: 2,
        height: 2,
        tilewidth: 32,
        tileheight: 32,
        tilesets: [],
        layers: [
          {
            type: "tilelayer",
            id: 1,
            name: "Ground",
            width: 2,
            height: 2,
            x: 0,
            y: 0,
            encoding: "base64",
            data: base64,
          },
        ],
      }),
    );
    expect(tileAt(map.layers[0], 1, 1)).toBe(3);
  });

  it("refuses a projection this editor has no grid for", async () => {
    await expect(
      readTiledMap(
        "hex.tmj",
        JSON.stringify({ type: "map", orientation: "hexagonal", layers: [] }),
      ),
    ).rejects.toThrow(/hexagonal/);
  });
});

describe("writing a .tmj", () => {
  it("puts the layers back-first, the way Tiled draws them", () => {
    // This editor stores layers top-first, matching Hush and matching the
    // panel; Tiled lists them in draw order. Getting it wrong exports a map
    // whose sky is under its ground.
    const sky = writeTiles(emptyTileLayer(1, "Sky"), [{ x: 0, y: 0, gid: 1 }]);
    const ground = writeTiles(emptyTileLayer(2, "Ground"), [
      { x: 0, y: 0, gid: 2 },
    ]);
    const map = tiledMap(
      { orientation: "orthogonal", tilewidth: 32, tileheight: 32 },
      [sky, ground],
      [TILESET],
    );
    expect(map.layers.map((l) => l.name)).toEqual(["Ground", "Sky"]);
    // And the ids are renumbered from one, because a map is a document of its
    // own and two layers from two files can easily share an id.
    expect(map.layers.map((l) => l.id)).toEqual([1, 2]);
    expect(map.nextlayerid).toBe(3);
    expect(map.infinite).toBe(true);
  });

  it("writes every key in Tiled's own alphabetical order", () => {
    const map = tiledMap(
      { orientation: "isometric", tilewidth: 64, tileheight: 32 },
      [writeTiles(emptyTileLayer(1, "Ground"), [{ x: 0, y: 0, gid: 1 }])],
      [TILESET],
    );
    const text = tiledMapJson(map);
    const keys = Object.keys(JSON.parse(text) as Record<string, unknown>);
    expect(keys).toEqual([...keys].sort());
    // A diff between one of Tiled's files and one of ours should show
    // nothing, so the same rule holds all the way down.
    const layer = JSON.parse(text).layers[0] as Record<string, unknown>;
    expect(Object.keys(layer)).toEqual([...Object.keys(layer)].sort());
  });

  it("comes back out of its own reader unchanged", async () => {
    const ground = writeTiles(emptyTileLayer(1, "Ground"), [
      { x: 0, y: 0, gid: 1 },
      { x: 3, y: 2, gid: withFlags(5, FLIPPED_HORIZONTALLY) },
      { x: -4, y: -1, gid: 2 },
    ]);
    const written = tiledMapJson(
      tiledMap(
        { orientation: "orthogonal", tilewidth: 32, tileheight: 32 },
        [ground],
        [TILESET],
      ),
    );
    const { map } = await readTiledMap("out.tmj", written);
    const back = map.layers[0];
    expect(tileAt(back, 0, 0)).toBe(1);
    expect(tileAt(back, -4, -1)).toBe(2);
    // The flag survives the trip, which is the one thing a naive reader loses.
    expect(tileId(tileAt(back, 3, 2))).toBe(5);
    expect(tileFlags(tileAt(back, 3, 2))).toBe(FLIPPED_HORIZONTALLY >>> 0);
    expect(map.tilesets[0].name).toBe("ground");
  });
});
