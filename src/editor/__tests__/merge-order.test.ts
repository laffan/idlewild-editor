/**
 * The order a merge sends its parts in.
 *
 * The editor's whole half of a merge is arithmetic: which placements, in which
 * order, at which offsets. Rust stacks them in the order it is given and never
 * asks what a grid is — so if this list is wrong, the merged file is a picture
 * drawn in the wrong order and nothing anywhere throws. A roof under its walls
 * is a roof under its walls, whether a merge put it there or a hand did.
 *
 * The case that makes it worth a test is the isometric one. On an isometric
 * **object** layer the drawn order is screen Y rather than the document's —
 * a thing standing nearer the viewer draws in front of one behind it — so the
 * document's order is exactly not the answer there.
 */

import { describe, expect, it } from "vitest";
import { DocStore } from "../../lib/doc-store";
import { mergeOrder } from "../merge-actions";
import type { GameDoc, Placement } from "../../lib/types";

/** A placement standing at `y`, in unit `unit`. */
function placed(id: string, unit: string, y: number): Placement {
  return {
    id,
    psdKey: id,
    layerPath: `S | ${id}`,
    x: 0,
    y,
    width: 32,
    height: 32,
    anchor: { cx: 0, cy: 0 },
    instance: unit,
  };
}

function storeWith(placements: Placement[]): DocStore {
  const doc: GameDoc = {
    version: 2,
    projection: "isometric",
    gridSize: 64,
    activeSceneId: "scene-1",
    scenes: [
      {
        id: "scene-1",
        name: "Main",
        layers: [
          {
            id: "layer-1",
            name: "Foreground",
            locked: false,
            visible: true,
            fills: [],
            placements,
            points: [],
            zones: [],
            strokes: [],
          },
        ],
      },
    ],
  };
  return new DocStore("project-1", doc);
}

describe("which placements a merge sends, and in what order", () => {
  it("sends them back-first, in the document's order on a flat layer", () => {
    const store = storeWith([
      placed("ground", "u-ground", 100),
      placed("walls", "u-walls", 50),
      placed("roof", "u-roof", 0),
    ]);
    const order = mergeOrder(
      store,
      "layer-1",
      ["u-ground", "u-walls", "u-roof"],
      false,
    );
    expect(order.map((p) => p.id)).toEqual(["ground", "walls", "roof"]);
  });

  /**
   * On an isometric object layer the canvas sorts on screen Y, so the merged
   * file's stack has to be that order — not the one the document happens to
   * hold. Sending the document's order there writes a file whose composite is
   * not the picture that was on screen.
   */
  it("sorts by screen Y on an isometric object layer", () => {
    const store = storeWith([
      placed("front", "u-front", 200),
      placed("back", "u-back", 10),
      placed("middle", "u-middle", 100),
    ]);
    const order = mergeOrder(
      store,
      "layer-1",
      ["u-front", "u-back", "u-middle"],
      true,
    );
    expect(order.map((p) => p.id)).toEqual(["back", "middle", "front"]);
  });

  it("takes only the units that were selected", () => {
    const store = storeWith([
      placed("a", "u-a", 0),
      placed("b", "u-b", 10),
      placed("c", "u-c", 20),
    ]);
    const order = mergeOrder(store, "layer-1", ["u-a", "u-c"], false);
    expect(order.map((p) => p.id)).toEqual(["a", "c"]);
  });

  /**
   * A placed PSD is one thing and several placements, so every layer of it
   * goes — one part each, keeping the file's own stack. Sending only the
   * placement the selection happened to name would merge a tower's roof and
   * leave its walls standing on the grid.
   */
  it("carries every layer of a multi-layer file, in the file's order", () => {
    const store = storeWith([
      placed("tower-base", "u-tower", 0),
      placed("tower-top", "u-tower", 0),
      placed("tree", "u-tree", 50),
    ]);
    const order = mergeOrder(store, "layer-1", ["u-tower", "u-tree"], false);
    expect(order.map((p) => p.id)).toEqual([
      "tower-base",
      "tower-top",
      "tree",
    ]);
  });

  it("answers nothing for a layer that is not there", () => {
    const store = storeWith([placed("a", "u-a", 0)]);
    expect(mergeOrder(store, "layer-9", ["u-a"], false)).toEqual([]);
  });
});
