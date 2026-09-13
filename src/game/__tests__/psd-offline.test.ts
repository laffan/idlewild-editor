/**
 * The window in which a PSD is being rewritten, and what may happen in it.
 *
 * This invariant has broken three times, each time looking like a different
 * bug: a throw inside Phaser's renderer on every frame, thirty *Texture not
 * found for sprite* warnings, and every copy of a file vanishing on a rename.
 * All three are the same thing — an object standing on a texture that is not
 * there, or is about to not be there — and `canPlace` is the one answer that
 * now prevents it. Both renderers ask it: the pattern one on its frame loop,
 * and the document one whenever it draws a placement the canvas has none of.
 *
 * The three conditions are deliberately not the same question:
 *
 *   - the **manifest** is in, which psd-to-phaser records as soon as
 *     `data.json` parses — several frames before any image lands;
 *   - the **texture** is in, which is what its own `place` looks for;
 *   - and no rewrite currently has the file off the canvas.
 *
 * Believing the first was the whole of the second bug.
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

/**
 * The loader is stubbed, for two reasons.
 *
 * It imports Phaser as a *value* — for `Phaser.Loader.Events` — and Phaser
 * reaches for `window` as its module initialises, which node has not got. And
 * stubbing it is what makes the window this file is about controllable:
 * `settle` finishes the load, so the assertions in between happen at exactly
 * the moment the real thing spends several frames in.
 */
let settle: () => void = () => undefined;
let settleWith: (err: Error) => void = () => undefined;
vi.mock("../psd-loader", () => ({
  evictPsd: (
    scene: { textures: { remove: (k: string) => void } },
    _p: unknown,
    key: string,
  ) => scene.textures.remove(key),
  loadPsd: () =>
    new Promise<void>((resolve, reject) => {
      settle = resolve;
      settleWith = reject;
    }),
}));

(globalThis as unknown as { window: unknown }).window ??= {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
};

function placement(psdKey: string): Placement {
  return {
    id: `p-${psdKey}`,
    psdKey,
    layerPath: psdKey,
    x: 0,
    y: 0,
    width: 32,
    height: 32,
    anchor: { cx: 0, cy: 0 },
    instance: `u-${psdKey}`,
  };
}

/**
 * Enough of a scene and a plugin to answer the three questions, and to let a
 * rename run end to end. `loadPsd` returns immediately for a key the plugin
 * already has data for, which is what keeps this a unit test.
 */
function setUp(keys: string[]) {
  const data = new Map<string, unknown>(keys.map((k) => [k, { original: { layers: [] } }]));
  const textures = new Set(keys);

  const scene = {
    textures: {
      exists: (key: string) => textures.has(key),
      getTextureKeys: () => [...textures],
      remove: (key: string) => textures.delete(key),
    },
    cache: { json: { remove: () => undefined } },
    P2P: {
      getData: (key: string) => data.get(key),
      setData: (key: string, value: unknown) => {
        if (value === undefined) data.delete(key);
        else data.set(key, value);
      },
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
        layers: [{ ...emptyLayer("Terrain"), placements: keys.map(placement) }],
      },
    ],
  };
  const store = new DocStore("test", doc);

  const placed: string[] = [];
  const docRenderer = {
    detachKey: () => undefined,
    detachOne: () => undefined,
    render: () => undefined,
    attach: (_layerId: string, p: Placement) => placed.push(p.psdKey),
    draws: () => true,
  } as unknown as DocRenderer;

  const host: PsdHost = {
    scene: scene as unknown as PsdHost["scene"],
    store,
    grid: new Grid("orthogonal", 32),
    docRenderer,
    assetBase: "http://localhost/p",
    activeLayerId: store.layers[0].id,
    setSelection: () => undefined,
    reselect: () => undefined,
    refresh: () => undefined,
    releaseKey: () => undefined,
    restoreKey: () => undefined,
  };

  return { psds: new PsdPlacements(host), scene, data, textures, placed };
}

describe("whether a file may be placed from", () => {
  it("says yes when the manifest and the texture are both in", () => {
    const { psds } = setUp(["tower"]);
    expect(psds.canPlace("tower", "tower")).toBe(true);
  });

  it("says no for a file the plugin has never heard of", () => {
    const { psds } = setUp(["tower"]);
    expect(psds.canPlace("nobody", "nobody")).toBe(false);
  });

  /**
   * The bug that printed one warning per copy on screen. psd-to-phaser sets
   * its data the moment `data.json` parses and queues the images after, so
   * the manifest is in long before anything is drawable.
   */
  it("says no while the manifest is in and the texture is not", () => {
    const { psds, textures } = setUp(["tower"]);
    textures.delete("tower");
    expect(psds.canPlace("tower", "tower")).toBe(false);
  });

  /** A layer inside a group: the texture is keyed on the leaf, not the path. */
  it("asks about the layer's own name rather than its path", () => {
    const { psds, textures } = setUp(["tower"]);
    textures.add("S | roof");
    expect(psds.canPlace("tower", "G | town/S | roof")).toBe(true);
    expect(psds.canPlace("tower", "G | town/S | missing")).toBe(false);
  });
});

describe("while a file is being rewritten", () => {
  /**
   * The rename crash. The rewrite fires a document change, which is a
   * repaint, which is the document renderer asking for an object for every
   * placement it now draws and has none of — and at that moment the old
   * textures have gone and the new ones have not arrived.
   */
  it("says no to both names, until it is over", async () => {
    const { psds, data, textures } = setUp(["tower"]);
    expect(psds.canPlace("tower", "tower")).toBe(true);

    const renaming = psds.rename("tower", "keep");
    expect(psds.canPlace("tower", "tower")).toBe(false);
    expect(psds.canPlace("keep", "keep")).toBe(false);

    // What the load brings back, once it lands.
    data.set("keep", { original: { layers: [] } });
    textures.add("keep");
    settle();
    await renaming;
    expect(psds.canPlace("keep", "keep")).toBe(true);
  });

  it("leaves another file alone", async () => {
    const { psds } = setUp(["tower", "tree"]);
    const renaming = psds.rename("tower", "keep");
    expect(psds.canPlace("tree", "tree")).toBe(true);
    settle();
    await renaming;
  });

  /**
   * However it ended. A key left held is a key nothing would ever draw
   * again — the failure that looks like the file quietly disappearing.
   */
  it("lets go even when the work throws", async () => {
    const { psds, data, textures } = setUp(["tower"]);
    const renaming = psds.rename("tower", "keep");
    expect(psds.canPlace("tower", "tower")).toBe(false);

    data.set("tower", { original: { layers: [] } });
    textures.add("tower");
    settleWith(new Error("the asset server is not answering"));
    await expect(renaming).rejects.toThrow();
    expect(psds.canPlace("tower", "tower")).toBe(true);
  });
});
