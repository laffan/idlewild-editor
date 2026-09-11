import { describe, expect, it } from "vitest";
import {
  anchorOffset,
  parseManifest,
  placeableLayers,
  placedPosition,
  stackOrder,
} from "../manifest";

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

describe("the anchor mark", () => {
  const marked = JSON.stringify({
    name: "hut",
    width: 64,
    height: 64,
    layers: [
      { name: "hut", category: "sprite", x: 0, y: 0, width: 64, height: 64 },
      { name: "grid", category: "zone", x: 32, y: 32, width: 32, height: 32 },
      { name: "anchor", category: "point", x: 32, y: 32, width: 12, height: 12 },
    ],
  });

  it("is read back from the point an import wrote", () => {
    expect(parseManifest(marked).anchor).toEqual({ x: 32, y: 32 });
  });

  it("falls back to the canvas centre for a PSD that has none", () => {
    const plain = JSON.stringify({
      name: "other",
      width: 100,
      height: 40,
      layers: [
        { name: "other", category: "sprite", x: 0, y: 0, width: 100, height: 40 },
      ],
    });
    const manifest = parseManifest(plain);
    expect(manifest.anchor).toBeNull();
    expect(anchorOffset(manifest)).toEqual({ x: 50, y: 20 });
  });

  it("keeps the marks out of what gets placed", () => {
    // Both are metadata psd-to-json exports no pixels for; placing either
    // would put an empty group on the layer.
    const placeable = placeableLayers(parseManifest(marked));
    expect(placeable.map((l) => l.name)).toEqual(["hut"]);
  });
});

/**
 * The anchor mark is what survives an artist editing the PSD, so these are
 * the edits it has to survive. Each is the same import re-parsed after one
 * change in Photoshop, and each says where the artwork should end up.
 *
 * The import: a 200×160 sprite whose anchor mark sits at its centre, placed
 * on the grid space at world (0, 0) and displayed at half size — so it lands
 * spanning (−50, −40) to (50, 40).
 */
describe("re-anchoring after an edit", () => {
  const WORLD = { x: 0, y: 0 };
  const HALF = 0.5;

  const reparse = (
    canvas: { width: number; height: number },
    sprite: { x: number; y: number },
    anchor: { x: number; y: number },
  ) => {
    const manifest = parseManifest(
      JSON.stringify({
        name: "hut",
        ...canvas,
        layers: [
          { name: "hut", category: "sprite", ...sprite, width: 200, height: 160 },
          { name: "anchor", category: "point", ...anchor, width: 12, height: 12 },
        ],
      }),
    );
    return placedPosition(WORLD, manifest, sprite, HALF, HALF);
  };

  it("places the import where the mark says", () => {
    expect(reparse({ width: 200, height: 160 }, { x: 0, y: 0 }, { x: 100, y: 80 }))
      .toEqual({ x: -50, y: -40 });
  });

  it("does not move when the canvas grew and everything moved together", () => {
    // 80px added on the left and 40 on top; the artwork and the mark both
    // slid by the same amount, so nothing changed relative to the grid.
    expect(reparse({ width: 280, height: 200 }, { x: 80, y: 40 }, { x: 180, y: 120 }))
      .toEqual({ x: -50, y: -40 });
  });

  it("carries a deliberate nudge through to the canvas", () => {
    // The artwork moved 40px right of the mark. That is the artist saying
    // "sit further right on this space", and 40 canvas px at half scale is
    // 20 world px.
    expect(reparse({ width: 200, height: 160 }, { x: 40, y: 0 }, { x: 100, y: 80 }))
      .toEqual({ x: -30, y: -40 });
  });

  it("follows the mark moved to the artwork's foot", () => {
    // The usual place to put it for something that stands on a tile: the
    // bottom-left corner now lands on the grid space.
    expect(reparse({ width: 200, height: 160 }, { x: 0, y: 0 }, { x: 0, y: 160 }))
      .toEqual({ x: 0, y: -80 });
  });

  it("falls back to the canvas centre for a PSD with no mark", () => {
    const manifest = parseManifest(
      JSON.stringify({
        name: "other",
        width: 200,
        height: 160,
        layers: [
          { name: "other", category: "sprite", x: 0, y: 0, width: 200, height: 160 },
        ],
      }),
    );
    expect(placedPosition(WORLD, manifest, { x: 0, y: 0 }, HALF, HALF))
      .toEqual({ x: -50, y: -40 });
  });
});

/**
 * The stack a PSD was built in, which is the artwork.
 *
 * psd-to-json lists layers top-first, as Photoshop's own panel does, and
 * numbers them `initialDepth` counting up from the back. A placement records
 * the same number because nothing else in the document says which of two
 * layers was above — and a re-import can restack the file.
 */
describe("stackOrder", () => {
  /** A hut with a roof on it and the ground underneath, plus an import's marks. */
  const HUT = JSON.stringify({
    name: "hut",
    width: 64,
    height: 96,
    layers: [
      { name: "anchor", category: "point", x: 32, y: 80, width: 12, height: 12 },
      { name: "grid", category: "zone", x: 0, y: 64, width: 64, height: 32 },
      { name: "roof", category: "sprite", x: 0, y: 0, width: 64, height: 40, initialDepth: 2 },
      { name: "walls", category: "sprite", x: 4, y: 30, width: 56, height: 50, initialDepth: 1 },
      { name: "ground", category: "sprite", x: 0, y: 70, width: 64, height: 26, initialDepth: 0 },
    ],
  });

  it("counts up from the back of the stack", () => {
    const order = stackOrder(parseManifest(HUT));
    expect(order.get("ground")).toBe(0);
    expect(order.get("walls")).toBe(1);
    expect(order.get("roof")).toBe(2);
  });

  it("numbers the layers that are placed, not the marks beside them", () => {
    // The anchor and the grid are metadata with no pixels — they are not
    // placed, so they take no room in the stack either.
    const order = stackOrder(parseManifest(HUT));
    expect(order.size).toBe(3);
    expect(order.has("anchor")).toBe(false);
    expect(order.has("grid")).toBe(false);
  });

  it("gives a one-layer PSD the only place there is", () => {
    expect([...stackOrder(parseManifest(CONVERTED_PNG))]).toEqual([["build", 0]]);
  });
});
