/**
 * How a PSD's textures are named, and what dropping one is allowed to reach.
 *
 * The bug behind this file: two PSDs with a same-named layer shared one
 * texture. `New layer` names its rows `layer-1` upward *within a file*, so a
 * `S | layer 1` added to a pattern layer's PSD and a `S | layer 1` already in
 * an object layer's PSD were the same key — and Phaser's loader declines a key
 * it already holds, silently, so the first file's artwork answered for the
 * second. What showed on the canvas was the pattern's element repeated where
 * the object layer's picture should have been.
 *
 * The fix is the plugin's own: `loadMultiple` keys a texture
 * `<psdKey>_<layerName>` and `place` reads the same flag back. This asserts
 * the consequences that are this codebase's rather than the plugin's — the
 * eviction sweep, and the one texture that cannot be namespaced.
 *
 * Phaser is stubbed because the module imports it as a *value*, for
 * `Phaser.Loader.Events`, and Phaser reaches for `window` as it initialises.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("phaser", () => ({
  default: {
    Loader: { Events: { COMPLETE: "complete", FILE_LOAD_ERROR: "loaderror" } },
  },
}));

import { evictPsd } from "../psd-loader";

/** A manifest as psd-to-phaser keeps it, under `getData(key).original`. */
function data(layers: unknown[]) {
  return { original: { layers } };
}

function setUp(
  files: Record<string, unknown[]>,
  textureKeys: readonly string[],
) {
  const textures = new Set(textureKeys);
  const json = new Set<string>();
  const held = new Map<string, unknown>(
    Object.entries(files).map(([key, layers]) => [key, data(layers)]),
  );

  const scene = {
    textures: {
      getTextureKeys: () => [...textures],
      remove: (key: string) => {
        textures.delete(key);
      },
      exists: (key: string) => textures.has(key),
    },
    cache: { json: { remove: (key: string) => void json.add(key) } },
  };

  const p2p = {
    getData: (key: string) => held.get(key),
    setData: (key: string, value: unknown) => {
      if (value === undefined) held.delete(key);
      else held.set(key, value);
    },
  };

  return {
    scene: scene as unknown as Parameters<typeof evictPsd>[0],
    p2p: p2p as unknown as Parameters<typeof evictPsd>[1],
    textures,
    json,
    held,
  };
}

describe("dropping a PSD's textures", () => {
  it("takes everything under the file's own prefix", () => {
    const { scene, p2p, textures } = setUp(
      { tower: [{ name: "S | layer 1", category: "sprite" }] },
      ["tower_S | layer 1", "tower_S | layer 1_tile_0_0"],
    );
    evictPsd(scene, p2p, "tower");
    expect([...textures]).toEqual([]);
  });

  /**
   * The collision, from the eviction end. Re-parsing the pattern layer's file
   * used to decide, name by name, whether the object layer's texture was
   * still needed — and either blanked the other file's artwork or left this
   * one stale. Namespaced, the question does not come up.
   */
  it("leaves another file's same-named layer alone", () => {
    const { scene, p2p, textures } = setUp(
      {
        pattern: [{ name: "S | layer 1", category: "sprite" }],
        object: [{ name: "S | layer 1", category: "sprite" }],
      },
      ["pattern_S | layer 1", "object_S | layer 1"],
    );
    evictPsd(scene, p2p, "pattern", ["object"]);
    expect([...textures]).toEqual(["object_S | layer 1"]);
  });

  /** A file whose name is a prefix of another's must not take it with it. */
  it("does not reach a file whose key merely starts the same way", () => {
    const { scene, p2p, textures } = setUp(
      { tower: [{ name: "art", category: "sprite" }] },
      ["tower_art", "tower-2_art"],
    );
    evictPsd(scene, p2p, "tower");
    expect([...textures]).toEqual(["tower-2_art"]);
  });

  /**
   * The one texture that cannot be namespaced. `place` looks a mask up as
   * `<name>_mask` on both of the plugin's loading paths, so two files with a
   * same-named masked layer still share one — which means a mask another
   * loaded file is using has to survive this eviction.
   */
  it("keeps a mask another loaded file is still using", () => {
    const { scene, p2p, textures } = setUp(
      {
        tower: [{ name: "wall", category: "sprite" }],
        keep: [{ name: "wall", category: "sprite" }],
      },
      ["tower_wall", "wall_mask"],
    );
    evictPsd(scene, p2p, "tower", ["keep"]);
    expect([...textures]).toEqual(["wall_mask"]);
  });

  it("drops a mask no other loaded file wants", () => {
    const { scene, p2p, textures } = setUp(
      { tower: [{ name: "wall", category: "sprite" }] },
      ["tower_wall", "wall_mask"],
    );
    evictPsd(scene, p2p, "tower", ["elsewhere"]);
    expect([...textures]).toEqual([]);
  });

  it("finds a masked layer nested inside a group", () => {
    const { scene, p2p, textures } = setUp(
      {
        tower: [
          {
            name: "G | town",
            category: "group",
            children: [{ name: "wall", category: "sprite" }],
          },
        ],
      },
      ["tower_wall", "wall_mask"],
    );
    evictPsd(scene, p2p, "tower");
    expect([...textures]).toEqual([]);
  });
});

describe("dropping a PSD's manifest", () => {
  it("forgets the plugin's parsed copy, so the next load fetches the file", () => {
    const { scene, p2p, held } = setUp({ tower: [] }, []);
    evictPsd(scene, p2p, "tower");
    expect(held.has("tower")).toBe(false);
  });

  /**
   * The hang. `loadMultiple` parks `data.json` in Phaser's JSON cache under
   * `<key>_temp_json`, and `load.json` on a key the cache already holds is
   * dropped with no event at all — so the plugin's promise never resolves and
   * the reload waits out its whole timeout with the file off the canvas.
   */
  it("clears both keys the manifest can be cached under", () => {
    const { scene, p2p, json } = setUp({ tower: [] }, []);
    evictPsd(scene, p2p, "tower");
    expect(json.has("tower")).toBe(true);
    expect(json.has("tower_temp_json")).toBe(true);
  });
});
