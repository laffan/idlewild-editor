/**
 * Extract: which layers it takes, in what order, and when it is offered.
 *
 * Three things decide whether an extraction is right, and none of them looks
 * wrong afterwards if it is not.
 *
 * **The order** is the new file's stack, which is what its composite will be
 * read from — and on an isometric object layer draw order is not document
 * order, so getting it backwards inverts the picture and nothing throws.
 *
 * **What is offered.** A selection holding every placed layer of every file
 * it touches would write the file Merge writes and leave the same sources
 * untouched, so Extract there would be a second name for one outcome.
 *
 * **The name.** Rust takes the first free name from whatever it is given, so
 * a bad guess is a file called the wrong thing rather than a file written
 * over somebody's artwork — but it is the name they then have to rename.
 */

import { describe, expect, it, vi } from "vitest";
import { DocStore } from "../../lib/doc-store";
import {
  describeExtract,
  extractLeavesSomething,
  extractOrder,
  selectedPlacements,
} from "../extract-actions";
import type { GameDoc, Layer, Placement } from "../../lib/types";

vi.mock("../../lib/ipc", () => ({
  doc: { read: vi.fn(), write: vi.fn(async () => undefined) },
  psd: { merge: vi.fn(), dropLayers: vi.fn() },
}));

(globalThis as unknown as { window: unknown }).window ??= {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
};

/** One layer of one placed PSD, standing at `y` down the screen. */
function placed(
  id: string,
  psdKey: string,
  layerPath: string,
  unit: string,
  y: number,
): Placement {
  return {
    id,
    psdKey,
    layerPath,
    x: 0,
    y,
    width: 32,
    height: 32,
    anchor: { cx: 0, cy: Math.round(y / 32) },
    instance: unit,
  };
}

function store(...placements: Placement[]): DocStore {
  const layer: Layer = {
    id: "layer-1",
    name: "Foreground",
    locked: false,
    visible: true,
    fills: [],
    placements,
    points: [],
    zones: [],
    strokes: [],
  } as Layer;
  const doc: GameDoc = {
    version: 2,
    projection: "orthogonal",
    gridSize: 32,
    scenes: [{ id: "scene-main", name: "Main", layers: [layer] }],
    activeSceneId: "scene-main",
  };
  return new DocStore("p1", doc);
}

/**
 * A hut of two layers at the back and a tree of two in front of it — the
 * ordinary case a marquee catches, and the one where taking *some* of each is
 * the thing Extract is for.
 */
function wood(): DocStore {
  return store(
    placed("p1", "hut", "walls", "u1", 0),
    placed("p2", "hut", "roof", "u1", 0),
    placed("p3", "tree", "trunk", "u2", 64),
    placed("p4", "tree", "leaves", "u2", 64),
  );
}

describe("what a selection names", () => {
  it("reads one placement and several the same way", () => {
    const held = wood();
    expect(
      selectedPlacements(held, {
        kind: "placement",
        layerId: "layer-1",
        placementId: "p2",
      })?.placements.map((p) => p.id),
    ).toEqual(["p2"]);
    expect(
      selectedPlacements(held, {
        kind: "placements",
        layerId: "layer-1",
        ids: ["p4", "p1"],
      })?.placements.map((p) => p.id),
    ).toEqual(["p1", "p4"]);
  });

  it("answers null for anything that is not placed artwork", () => {
    const held = wood();
    expect(selectedPlacements(held, { kind: "none" })).toBeNull();
    expect(selectedPlacements(held, null)).toBeNull();
    expect(
      selectedPlacements(held, { kind: "layer", layerId: "layer-1" }),
    ).toBeNull();
  });
});

describe("the order the new file is stacked in", () => {
  /**
   * Back-first, because `add_layer` stacks bottom-up on the Rust side. The
   * hut is further up the screen than the tree, so it is behind it, so it
   * goes in first.
   */
  it("is draw order across files and document order inside one", () => {
    const held = wood();
    const order = extractOrder(held, "layer-1", ["p4", "p2", "p1", "p3"], false);
    expect(order.map((p) => p.id)).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("takes only what was asked for", () => {
    const held = wood();
    const order = extractOrder(held, "layer-1", ["p2", "p4"], false);
    expect(order.map((p) => p.layerPath)).toEqual(["roof", "leaves"]);
  });
});

describe("whether Extract is offered", () => {
  /**
   * The case it exists for: some of each file, so each keeps something.
   */
  it("is, when the files keep a layer between them", () => {
    const held = wood();
    const chosen = held.layers[0].placements.filter((p) =>
      ["p2", "p4"].includes(p.id),
    );
    expect(extractLeavesSomething(held, chosen)).toBe(true);
  });

  /**
   * And is not when the selection is whole files. That writes the file Merge
   * writes and leaves the same sources untouched — Rust refuses to empty a
   * PSD — so a second button there would be one outcome under two names.
   */
  it("is not, when every placed layer of every file is in it", () => {
    const held = wood();
    expect(extractLeavesSomething(held, held.layers[0].placements)).toBe(false);
  });

  it("is not, for a selection of nothing", () => {
    expect(extractLeavesSomething(wood(), [])).toBe(false);
  });

  /**
   * What is left behind is a question about the **file's layers**, not about
   * how many drawings of them are on the canvas. A PSD placed twice is one
   * file: extract `walls` from either drawing of it and `walls` leaves the
   * file, so the other drawing loses it too and there is nothing left.
   *
   * That is the rule the button's own tooltip states, and it is the one thing
   * about Extract somebody could be surprised by.
   */
  it("reads two drawings of one layer as one layer", () => {
    const held = store(
      placed("p1", "hut", "walls", "u1", 0),
      placed("p2", "hut", "walls", "u2", 64),
    );
    const one = held.layers[0].placements.filter((p) => p.id === "p1");
    expect(extractLeavesSomething(held, one)).toBe(false);
  });

  /**
   * And a second placement drawing a *different* layer of the same file is
   * something left, because that layer stays in the file.
   */
  it("counts another layer of the same file as something left", () => {
    const held = store(
      placed("p1", "hut", "walls", "u1", 0),
      placed("p2", "hut", "roof", "u2", 64),
    );
    const one = held.layers[0].placements.filter((p) => p.id === "p1");
    expect(extractLeavesSomething(held, one)).toBe(true);
  });
});

describe("what the button says it takes", () => {
  it("counts layers, and files when there is more than one", () => {
    const held = wood();
    const all = held.layers[0].placements;
    expect(describeExtract([all[1]])).toBe("1 layer");
    expect(describeExtract([all[0], all[1]])).toBe("2 layers");
    expect(describeExtract([all[1], all[3]])).toBe("2 layers from 2 PSDs");
  });
});
