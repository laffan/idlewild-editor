/**
 * Which palette in the sidebar carries the Layers toggle.
 *
 * Both cuts of a file can be in the list at once. A palette with tiles
 * standing on it is always shown, whichever way the file is cut *now*,
 * because the panel has to be able to explain what is on the ground — and a
 * `firstgid` handed out is permanent, so switching never takes one away. That
 * leaves two things to get right, and this is both of them: one toggle per
 * file, because the choice is the file's; and on a palette that **agrees**
 * with the answer it is showing, because a control reading *Merged* directly
 * over one of three layer palettes is a control contradicting the picture
 * under it.
 *
 * There is no DOM in this suite, as in `tool-bars.test.ts`, so the rows are
 * not built — what is asserted is the function that decides which of them
 * gets the control.
 */

import { describe, expect, it, vi } from "vitest";
import { DocStore } from "../../lib/doc-store";
import { toggleRows } from "../inspect-tiles";
import {
  MERGED_LAYER,
  PSD_LAYER_PROPERTY,
  PSD_PROPERTY,
  type TiledTileset,
} from "../../lib/tiled/types";
import type { GameDoc } from "../../lib/types";

vi.mock("../../lib/ipc", () => ({
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
    scenes: [{ id: "scene-main", name: "Main", layers: [] }],
    activeSceneId: "scene-main",
  };
  return new DocStore("p1", doc);
}

/** A palette of `key`, cut from the whole file or from one of its layers. */
function palette(firstgid: number, key: string, layer: string): TiledTileset {
  return {
    firstgid,
    name: key,
    image: `assets/${key}/x.png`,
    imagewidth: 64,
    imageheight: 64,
    tilewidth: 32,
    tileheight: 32,
    spacing: 0,
    margin: 0,
    columns: 2,
    tilecount: 4,
    properties: [
      { name: PSD_PROPERTY, type: "string", value: key },
      { name: PSD_LAYER_PROPERTY, type: "string", value: layer },
    ],
  };
}

describe("the Layers toggle", () => {
  it("goes on the one palette of a file cut as one", () => {
    const held = store();
    const merged = palette(1, "hut", MERGED_LAYER);
    expect(toggleRows(held, [merged])).toEqual(new Set([1]));
  });

  it("goes on the first of three, not on all three", () => {
    const held = store();
    held.setPaletteMode("hut", "separate");
    const rows = [
      palette(1, "hut", "S | walls"),
      palette(5, "hut", "S | roof"),
      palette(9, "hut", "S | shadow"),
    ];
    expect(toggleRows(held, rows)).toEqual(new Set([1]));
  });

  /**
   * The case this exists for. A file switched to Separate keeps the merged
   * palette it was cut as, because tiles may be standing on it — and the
   * toggle has to go on one of the layer palettes, which are what the file is
   * cut into now, rather than on the merged one it is sitting above.
   */
  it("skips a palette that disagrees with the file's mode", () => {
    const held = store();
    held.setPaletteMode("hut", "separate");
    const rows = [
      palette(1, "hut", MERGED_LAYER),
      palette(5, "hut", "S | walls"),
      palette(9, "hut", "S | roof"),
    ];
    expect(toggleRows(held, rows)).toEqual(new Set([5]));
  });

  it("and the other way round, for a file switched back to Merged", () => {
    const held = store();
    const rows = [
      palette(1, "hut", "S | walls"),
      palette(5, "hut", "S | roof"),
      palette(9, "hut", MERGED_LAYER),
    ];
    expect(toggleRows(held, rows)).toEqual(new Set([9]));
  });

  it("gives every file its own", () => {
    const held = store();
    const rows = [
      palette(1, "hut", MERGED_LAYER),
      palette(5, "tree", MERGED_LAYER),
    ];
    expect(toggleRows(held, rows)).toEqual(new Set([1, 5]));
  });

  /**
   * A palette that came in from a Tiled map somebody else made has no PSD
   * behind it and therefore nothing to cut differently.
   */
  it("gives none to a palette with no PSD behind it", () => {
    const held = store();
    const bare: TiledTileset = { ...palette(1, "hut", MERGED_LAYER), properties: [] };
    expect(toggleRows(held, [bare])).toEqual(new Set());
  });
});
