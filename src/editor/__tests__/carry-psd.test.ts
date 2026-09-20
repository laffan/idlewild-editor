/**
 * What a PSD takes with it when it is carried off a tile layer.
 *
 * A tile is a number — the nth tile across every tileset in the map — rather
 * than a copy of the artwork, so carrying the file its palette was cut from
 * to another layer does not move the tiles and does not break them either. It
 * orphans them: the document goes on describing them perfectly, the palette
 * is still in `GameDoc.tilesets` because a `firstgid` handed out is
 * permanent, and the canvas draws nothing, because nothing on that layer
 * loads the artwork any more. That is the worst of the two possible wrongs,
 * which is why the tiles go with the file.
 *
 * Asserted on the question rather than on the carry: `carryPlacements` puts a
 * sheet up and there is no DOM in this suite, as `tool-bars.test.ts` says.
 * What decides whether anything is asked at all is `orphanedByCarry`, and its
 * two mistakes are the ones nobody would see — taking tiles off a layer that
 * still has the file on it, and taking another file's tiles with them.
 */

import { describe, expect, it, vi } from "vitest";
import { DocStore } from "../../lib/doc-store";
import { Grid } from "../../lib/grid";
import { orphanedByCarry } from "../carry-psd";
import { paintTiles } from "../../lib/tile-layers";
import { addTileset } from "../../lib/tile-palettes";
import type { GameDoc, Layer, LayerKind } from "../../lib/types";

vi.mock("../../lib/ipc", () => ({
  doc: { read: vi.fn(), write: vi.fn(async () => undefined) },
}));

(globalThis as unknown as { window: unknown }).window ??= {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
};

const GRID = new Grid("orthogonal", 32);

function layer(id: string, name: string, kind: LayerKind): Layer {
  return {
    id,
    name,
    kind,
    locked: false,
    visible: true,
    fills: [],
    placements: [],
    points: [],
    zones: [],
    strokes: [],
  } as Layer;
}

/** A tile layer and an object layer to carry something onto. */
function store(): DocStore {
  const doc: GameDoc = {
    version: 2,
    projection: "orthogonal",
    gridSize: 32,
    scenes: [
      {
        id: "scene-main",
        name: "Main",
        layers: [layer("layer-1", "Ground", "tile"), layer("layer-2", "Props", "object")],
      },
    ],
    activeSceneId: "scene-main",
  };
  return new DocStore("p1", doc);
}

/** A palette 96 × 64 on a 32px grid: three across, two down. */
function palette(held: DocStore, key: string, layerPath = "S | art") {
  return addTileset(held, GRID, {
    psdKey: key,
    layerPath,
    name: key,
    image: `assets/${key}/sprites/art.png`,
    imagewidth: 96,
    imageheight: 64,
  });
}

/** Put the file on the tile layer, as a drop or a carry does. */
function place(held: DocStore, layerId: string, psdKey: string, instance: string) {
  return held.addPlacement(layerId, {
    psdKey,
    layerPath: "S | art",
    x: 0,
    y: 0,
    width: 96,
    height: 64,
    naturalWidth: 96,
    anchor: { cx: 0, cy: 0 },
    instance,
  });
}

describe("what a carry off a tile layer would orphan", () => {
  it("is the tiles made from the file that is leaving", () => {
    const held = store();
    const set = palette(held, "ground");
    const placed = place(held, "layer-1", "ground", "ground-1");
    paintTiles(held, "layer-1", [
      { x: 0, y: 0, gid: set.firstgid },
      { x: 1, y: 0, gid: set.firstgid + 1 },
      { x: 4, y: 3, gid: set.firstgid + 5 },
    ]);

    const orphaned = orphanedByCarry(held, "layer-1", [placed.id]);
    expect(orphaned.map((lost) => lost.psdKey)).toEqual(["ground"]);
    expect(orphaned[0].cells).toEqual([
      { cx: 0, cy: 0 },
      { cx: 1, cy: 0 },
      { cx: 4, cy: 3 },
    ]);
  });

  /**
   * And nothing else's. A gid is only a number, so the one thing that could
   * quietly go wrong here is a sweep that took every tile on the layer.
   */
  it("leaves another file's tiles where they are", () => {
    const held = store();
    const ground = palette(held, "ground");
    const walls = palette(held, "walls");
    const placed = place(held, "layer-1", "ground", "ground-1");
    place(held, "layer-1", "walls", "walls-1");
    paintTiles(held, "layer-1", [
      { x: 0, y: 0, gid: ground.firstgid },
      { x: 1, y: 0, gid: walls.firstgid },
    ]);

    const orphaned = orphanedByCarry(held, "layer-1", [placed.id]);
    expect(orphaned).toHaveLength(1);
    expect(orphaned[0].psdKey).toBe("ground");
    expect(orphaned[0].cells).toEqual([{ cx: 0, cy: 0 }]);
  });

  /**
   * A file placed twice — one layer of it carried away, the other staying —
   * is still on the layer, and its palette is still drawable. Only a file
   * that is *leaving* takes its tiles with it.
   */
  it("is nothing while the file still has a placement here", () => {
    const held = store();
    const set = palette(held, "ground");
    const first = place(held, "layer-1", "ground", "ground-1");
    place(held, "layer-1", "ground", "ground-2");
    paintTiles(held, "layer-1", [{ x: 0, y: 0, gid: set.firstgid }]);

    expect(orphanedByCarry(held, "layer-1", [first.id])).toEqual([]);
  });

  it("is nothing for a file nothing was painted from", () => {
    const held = store();
    palette(held, "ground");
    const placed = place(held, "layer-1", "ground", "ground-1");
    expect(orphanedByCarry(held, "layer-1", [placed.id])).toEqual([]);
  });

  /**
   * The question is only asked of a tile layer, which is what lets the caller
   * ask it of every carry. A PSD on an object layer is the artwork itself:
   * carrying it moves the picture, and there is nothing left behind to warn
   * about.
   */
  it("is nothing on a layer that is not a tile layer", () => {
    const held = store();
    const placed = place(held, "layer-2", "ground", "ground-1");
    expect(orphanedByCarry(held, "layer-2", [placed.id])).toEqual([]);
  });
});
