import { describe, expect, it } from "vitest";
import { parseManifest, placeableLayers } from "../manifest";

/**
 * The shape below is a real psd-to-json manifest for a converted PNG. The
 * "root" path this replaced does not exist in it — which is exactly why an
 * import used to place an empty group.
 */
const CONVERTED_PNG = JSON.stringify({
  name: "build",
  width: 384,
  height: 581,
  tile_slice_size: 512,
  tile_scaled_versions: [],
  layers: [
    {
      name: "build",
      category: "sprite",
      x: 0,
      y: 0,
      width: 384,
      height: 581,
      attributes: {},
      filePath: "sprites/build.png",
      initialDepth: 0,
    },
  ],
});

describe("parseManifest", () => {
  it("reads the top-level layer a converted image produces", () => {
    const manifest = parseManifest(CONVERTED_PNG);
    expect(manifest.name).toBe("build");
    expect(manifest.width).toBe(384);
    expect(manifest.top).toHaveLength(1);
    expect(manifest.top[0].path).toBe("build");
    expect(manifest.top[0].category).toBe("sprite");
  });

  it("never yields the path 'root'", () => {
    const manifest = parseManifest(CONVERTED_PNG);
    expect(manifest.all.map((l) => l.path)).not.toContain("root");
  });

  it("builds slash-joined paths for nested groups", () => {
    const manifest = parseManifest(
      JSON.stringify({
        name: "level",
        width: 100,
        height: 100,
        layers: [
          {
            name: "structures",
            category: "group",
            children: [
              { name: "tower", category: "sprite", x: 10, y: 20, width: 30, height: 40 },
              { name: "wall", category: "sprite", x: 50, y: 20, width: 20, height: 40 },
            ],
          },
        ],
      }),
    );

    expect(manifest.top.map((l) => l.path)).toEqual(["structures"]);
    expect(manifest.all.map((l) => l.path)).toContain("structures/tower");
    expect(manifest.all.map((l) => l.path)).toContain("structures/wall");
  });

  it("derives a group's box from its children when the manifest omits one", () => {
    const manifest = parseManifest(
      JSON.stringify({
        name: "level",
        width: 100,
        height: 100,
        layers: [
          {
            name: "structures",
            category: "group",
            children: [
              { name: "a", category: "sprite", x: 10, y: 20, width: 30, height: 40 },
              { name: "b", category: "sprite", x: 50, y: 10, width: 20, height: 40 },
            ],
          },
        ],
      }),
    );

    const group = manifest.top[0];
    expect(group.x).toBe(10);
    expect(group.y).toBe(10);
    expect(group.width).toBe(60); // 10 → 70
    expect(group.height).toBe(50); // 10 → 60
  });

  it("survives a manifest with no layers", () => {
    const manifest = parseManifest(JSON.stringify({ name: "empty", width: 1, height: 1 }));
    expect(manifest.top).toEqual([]);
    expect(placeableLayers(manifest)).toEqual([]);
  });
});

describe("placeableLayers", () => {
  it("skips zones, which are boundaries rather than art", () => {
    const manifest = parseManifest(
      JSON.stringify({
        name: "level",
        width: 10,
        height: 10,
        layers: [
          { name: "art", category: "sprite", x: 0, y: 0, width: 10, height: 10 },
          { name: "edge", category: "zone", x: 0, y: 0, width: 10, height: 10 },
        ],
      }),
    );
    expect(placeableLayers(manifest).map((l) => l.name)).toEqual(["art"]);
  });

  it("falls back to every layer when a PSD is nothing but zones", () => {
    const manifest = parseManifest(
      JSON.stringify({
        name: "bounds",
        width: 10,
        height: 10,
        layers: [{ name: "edge", category: "zone", x: 0, y: 0, width: 10, height: 10 }],
      }),
    );
    expect(placeableLayers(manifest).map((l) => l.name)).toEqual(["edge"]);
  });
});
