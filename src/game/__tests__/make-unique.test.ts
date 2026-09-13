/**
 * Make Unique: giving one of several objects that share a PSD a file of its own.
 *
 * The bug this pins is why the feature looked as though it did nothing. A PSD
 * with a wall and a roof in it stands on the grid as **two placements of one
 * unit**, and `repoint` moved the one that happened to be selected. So the
 * object came away half-attached: one row read the copy and the other went on
 * reading the original, an edit to either file still changed part of both
 * pictures, and which half came loose depended on which row you had clicked.
 * The duplicate on disk was real, which is what made it hard to see — nothing
 * was missing, the two simply stayed linked.
 *
 * So the unit moves as one, which is what a unit means everywhere else in this
 * editor.
 */

import { describe, expect, it, vi } from "vitest";
import { PsdPlacements, type PsdHost } from "../psd-placements";
import { DocStore } from "../../lib/doc-store";
import { emptyLayer } from "../../lib/doc-shape";
import { Grid } from "../../lib/grid";
import type { DocRenderer } from "../doc-renderer";
import type { GameDoc, Placement } from "../../lib/types";

vi.mock("../../lib/ipc", () => ({
  doc: { read: vi.fn(), write: vi.fn(async () => undefined) },
}));

// The loader is stubbed for the reason `psd-offline.test.ts` gives: it imports
// Phaser as a value, and Phaser reaches for `window` as it initialises.
vi.mock("../psd-loader", () => ({
  evictPsd: () => undefined,
  loadPsd: () => Promise.resolve(),
}));

(globalThis as unknown as { window: unknown }).window ??= {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
};

/** A two-layer PSD, as the pipeline reports it. */
const MANIFEST = JSON.stringify({
  name: "tower",
  width: 128,
  height: 160,
  layers: [
    { name: "S | roof", category: "sprite", x: 0, y: 0, width: 128, height: 40 },
    { name: "S | wall", category: "sprite", x: 0, y: 40, width: 128, height: 120 },
  ],
});

function placement(over: Partial<Placement>): Placement {
  return {
    id: "p",
    psdKey: "tower",
    layerPath: "S | wall",
    x: 0,
    y: 0,
    width: 128,
    height: 120,
    naturalWidth: 128,
    naturalHeight: 120,
    anchor: { cx: 0, cy: 0 },
    instance: "u1",
    ...over,
  };
}

function setUp() {
  const data = new Map<string, unknown>([
    ["tower", { original: JSON.parse(MANIFEST) }],
    ["tower-2", { original: JSON.parse(MANIFEST) }],
  ]);
  const textures = new Set([
    "tower_S | roof",
    "tower_S | wall",
    "tower-2_S | roof",
    "tower-2_S | wall",
  ]);

  const scene = {
    textures: {
      exists: (key: string) => textures.has(key),
      getTextureKeys: () => [...textures],
      remove: (key: string) => textures.delete(key),
    },
    cache: { json: { remove: () => undefined } },
    P2P: {
      getData: (key: string) => data.get(key),
      setData: () => undefined,
      place: () => ({
        setPosition: () => undefined,
        setScale: () => undefined,
        setDepth: () => undefined,
        setVisible: () => undefined,
        destroy: () => undefined,
      }),
    },
  };

  const doc: GameDoc = {
    version: 2,
    projection: "orthogonal",
    gridSize: 32,
    activeSceneId: "scene-main",
    scenes: [
      {
        id: "scene-main",
        name: "Main",
        layers: [
          {
            ...emptyLayer("Terrain"),
            id: "l1",
            placements: [
              placement({ id: "roof", layerPath: "S | roof" }),
              placement({ id: "wall", layerPath: "S | wall" }),
              // A second instance of the same file, which Make Unique must
              // leave exactly where it was.
              placement({ id: "other-roof", layerPath: "S | roof", instance: "u2" }),
              placement({ id: "other-wall", layerPath: "S | wall", instance: "u2" }),
            ],
          },
        ],
      },
    ],
  };
  const store = new DocStore("test", doc);

  const host: PsdHost = {
    scene: scene as unknown as PsdHost["scene"],
    store,
    grid: new Grid("orthogonal", 32),
    docRenderer: {
      detachKey: () => undefined,
      detachOne: () => undefined,
      render: () => undefined,
      attach: () => undefined,
      draws: () => true,
    } as unknown as DocRenderer,
    assetBase: "http://localhost/p",
    activeLayerId: "l1",
    setSelection: () => undefined,
    reselect: () => undefined,
    refresh: () => undefined,
    releaseKey: () => undefined,
    restoreKey: () => undefined,
  };

  return { psds: new PsdPlacements(host), store };
}

const keysOf = (store: DocStore) =>
  Object.fromEntries(
    store.layers[0].placements.map((p) => [p.id, p.psdKey]),
  );

describe("making one instance unique", () => {
  it("moves every layer of the object, not the row that was selected", async () => {
    const { psds, store } = setUp();
    await psds.repoint(
      { kind: "placement", layerId: "l1", placementId: "wall" },
      "tower-2",
      MANIFEST,
    );
    expect(keysOf(store)).toEqual({
      roof: "tower-2",
      wall: "tower-2",
      "other-roof": "tower",
      "other-wall": "tower",
    });
  });

  it("does the same when the other row is the one selected", async () => {
    const { psds, store } = setUp();
    await psds.repoint(
      { kind: "placement", layerId: "l1", placementId: "roof" },
      "tower-2",
      MANIFEST,
    );
    expect(keysOf(store)).toEqual({
      roof: "tower-2",
      wall: "tower-2",
      "other-roof": "tower",
      "other-wall": "tower",
    });
  });

  it("keeps each layer pointing at its own layer of the copy", async () => {
    const { psds, store } = setUp();
    await psds.repoint(
      { kind: "placement", layerId: "l1", placementId: "wall" },
      "tower-2",
      MANIFEST,
    );
    const paths = Object.fromEntries(
      store.layers[0].placements.map((p) => [p.id, p.layerPath]),
    );
    expect(paths).toEqual({
      roof: "S | roof",
      wall: "S | wall",
      "other-roof": "S | roof",
      "other-wall": "S | wall",
    });
  });

  /**
   * A collider is keyed by file, so the copy needs one of its own — otherwise
   * the object that has just become unique blocks whatever the original blocks
   * for as long as nobody edits either.
   */
  it("gives the copy a collider of its own", async () => {
    const { psds, store } = setUp();
    expect(store.collider("tower-2")).toBeUndefined();
    await psds.repoint(
      { kind: "placement", layerId: "l1", placementId: "wall" },
      "tower-2",
      MANIFEST,
    );
    expect(store.collider("tower-2")).toBeDefined();
  });

  it("does nothing for a placement the document has not got", async () => {
    const { psds, store } = setUp();
    await psds.repoint(
      { kind: "placement", layerId: "l1", placementId: "nobody" },
      "tower-2",
      MANIFEST,
    );
    expect(keysOf(store)).toEqual({
      roof: "tower",
      wall: "tower",
      "other-roof": "tower",
      "other-wall": "tower",
    });
  });
});
