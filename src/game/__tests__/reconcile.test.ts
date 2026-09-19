import { describe, expect, it } from "vitest";
import { DocStore } from "../../lib/doc-store";
import { Grid } from "../../lib/grid";
import { parseManifest } from "../../lib/manifest";
import { reconcilePlacements } from "../reconcile";
import type { StoredDoc, Placement } from "../../lib/types";

// `DocStore` debounces its autosave on window timers, and this runs in node.
// A stub rather than a real clock: the point here is what reconciliation
// leaves in the document, and a save that actually fired would reach for Tauri.
(globalThis as unknown as { window: unknown }).window ??= {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
};

const grid = new Grid("isometric", 64);

/** What this editor writes: the artwork, with both orienting marks over it. */
const MARKED = JSON.stringify({
  name: "extrude-abc",
  width: 128,
  height: 160,
  layers: [
    { name: "anchor", category: "point", x: 60, y: 76, width: 12, height: 12 },
    { name: "grid", category: "zone", x: 32, y: 64, width: 64, height: 32 },
    { name: "extrude-abc", category: "sprite", x: 0, y: 0, width: 128, height: 160 },
  ],
});

/** A file built in Photoshop: one group with a layer inside it. */
const GROUPED = JSON.stringify({
  name: "hut",
  width: 128,
  height: 160,
  layers: [
    {
      name: "building",
      category: "group",
      x: 0,
      y: 0,
      width: 128,
      height: 160,
      children: [
        { name: "wall", category: "sprite", x: 0, y: 0, width: 128, height: 160 },
      ],
    },
  ],
});

/**
 * The same file before and after its loose sprites are grouped into an atlas.
 *
 * One edit in Photoshop; two very different manifests. `purple` and `green`
 * stop being layers and survive only as keys of the atlas's `frames` map,
 * which is the whole difficulty: a placement standing on `purple` points at
 * something the file no longer has.
 */
const LOOSE = JSON.stringify({
  name: "confetti",
  width: 128,
  height: 160,
  layers: [
    { name: "anchor", category: "point", x: 60, y: 76, width: 12, height: 12 },
    { name: "purple", category: "sprite", x: 0, y: 0, width: 32, height: 32 },
    { name: "green", category: "sprite", x: 40, y: 0, width: 32, height: 32 },
  ],
});

const ATLASED = JSON.stringify({
  name: "confetti",
  width: 128,
  height: 160,
  layers: [
    { name: "anchor", category: "point", x: 60, y: 76, width: 12, height: 12 },
    {
      name: "confetti",
      category: "sprite",
      type: "atlas",
      x: 0,
      y: 0,
      width: 72,
      height: 32,
      filePath: "sprites/confetti.png",
      frames: {
        purple: { x: 0, y: 0, width: 32, height: 32 },
        green: { x: 32, y: 0, width: 32, height: 32 },
      },
      instances: [
        { name: "purple", x: 0, y: 0 },
        { name: "green", x: 40, y: 0 },
      ],
    },
  ],
});

function placement(psdKey: string, layerPath: string, id = "p1"): Placement {
  return {
    id,
    psdKey,
    layerPath,
    x: 0,
    y: 0,
    width: 64,
    height: 80,
    naturalWidth: 128,
    naturalHeight: 160,
    anchor: { cx: 0, cy: 0 },
    instance: "unit-1",
    order: 0,
  };
}

function store(...placements: Placement[]): DocStore {
  const doc: StoredDoc = {
    version: 1,
    projection: "isometric",
    gridSize: 64,
    layers: [
      {
        id: "l1",
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
  };
  return new DocStore("p", doc);
}

const paths = (s: DocStore) => s.layers[0].placements.map((p) => p.layerPath);

describe("re-parsing a PSD", () => {
  it("leaves an ordinary placement exactly as it found it", () => {
    const s = store(placement("extrude-abc", "extrude-abc"));
    reconcilePlacements(s, grid, "extrude-abc", parseManifest(MARKED));
    expect(paths(s)).toEqual(["extrude-abc"]);
  });

  /**
   * The bug this exists for: one re-parse, one extra row in the layer list,
   * and nothing new on the canvas.
   *
   * A placement standing on one of the orienting marks used to survive
   * revision — the mark is in the manifest, so the layer had not "gone" —
   * while adoption looked only at the layers that can be placed, saw nothing
   * standing on the artwork, and added a second placement for it. The extra
   * one drew a point, which is to say nothing.
   */
  it("does not add a second placement beside one standing on a mark", () => {
    const s = store(placement("extrude-abc", "anchor"));
    reconcilePlacements(s, grid, "extrude-abc", parseManifest(MARKED));
    expect(paths(s)).toEqual(["extrude-abc"]);
  });

  it("keeps the placement's own identity when it repoints it", () => {
    const s = store(placement("extrude-abc", "grid"));
    reconcilePlacements(s, grid, "extrude-abc", parseManifest(MARKED));
    const [p] = s.layers[0].placements;
    expect(p.id).toBe("p1");
    expect(p.instance).toBe("unit-1");
    expect(p.anchor).toEqual({ cx: 0, cy: 0 });
  });

  it("does not adopt a group whose child is already placed", () => {
    const s = store(placement("hut", "building/wall"));
    reconcilePlacements(s, grid, "hut", parseManifest(GROUPED));
    expect(paths(s)).toEqual(["building/wall"]);
  });

  it("still adopts a layer that has genuinely appeared", () => {
    const s = store(placement("hut", "building"));
    const grown = JSON.stringify({
      name: "hut",
      width: 128,
      height: 160,
      layers: [
        { name: "building", category: "sprite", x: 0, y: 0, width: 128, height: 160 },
        { name: "roof", category: "sprite", x: 16, y: 0, width: 96, height: 40 },
      ],
    });
    reconcilePlacements(s, grid, "hut", parseManifest(grown));
    expect(paths(s).sort()).toEqual(["building", "roof"]);
  });

  /**
   * The empty layer the inspector's New layer button writes.
   *
   * It is real, and it is a single transparent pixel — see `psd_layers::add`.
   * Adopting one would put an invisible placement on the grid before there
   * was anything in it to see, and a row in the layer list for a layer with
   * no artwork. It becomes a placement the moment somebody draws in it,
   * because painting gives the layer the ink's own bounds.
   */
  it("does not adopt the placeholder an empty layer is written as", () => {
    const s = store(placement("hut", "building"));
    const withEmpty = JSON.stringify({
      name: "hut",
      width: 128,
      height: 160,
      layers: [
        { name: "layer-1", category: "sprite", x: 0, y: 0, width: 1, height: 1 },
        { name: "building", category: "sprite", x: 0, y: 0, width: 128, height: 160 },
      ],
    });
    reconcilePlacements(s, grid, "hut", parseManifest(withEmpty));
    expect(paths(s)).toEqual(["building"]);
  });

  it("adopts it once it has been drawn in", () => {
    const s = store(placement("hut", "building"));
    const painted = JSON.stringify({
      name: "hut",
      width: 128,
      height: 160,
      layers: [
        { name: "layer-1", category: "sprite", x: 20, y: 20, width: 40, height: 30 },
        { name: "building", category: "sprite", x: 0, y: 0, width: 128, height: 160 },
      ],
    });
    reconcilePlacements(s, grid, "hut", parseManifest(painted));
    expect(paths(s).sort()).toEqual(["building", "layer-1"]);
  });

  it("still removes a placement whose layer has gone", () => {
    const s = store(placement("hut", "chimney"));
    reconcilePlacements(s, grid, "hut", parseManifest(GROUPED));
    expect(paths(s)).toEqual([]);
  });
});

/**
 * The shape a re-parse actually arrived in: the category spelled in a way
 * this parser did not recognise, so every layer in the file counted as
 * placeable and reconciliation adopted one placed object per PSD layer.
 */
describe("a manifest whose categories are spelled differently", () => {
  const LOOSE = JSON.stringify({
    name: "extrude-abc",
    width: 128,
    height: 160,
    layers: [
      { name: "anchor", category: "Point", x: 60, y: 76, width: 12, height: 12 },
      { name: "grid", category: "Zones", x: 32, y: 64, width: 64, height: 32 },
      { name: "extrude-abc", category: "Sprite", x: 0, y: 0, width: 128, height: 160 },
    ],
  });

  it("does not turn one placed PSD into one per layer", () => {
    const s = store(placement("extrude-abc", "extrude-abc"));
    reconcilePlacements(s, grid, "extrude-abc", parseManifest(LOOSE));
    expect(paths(s)).toEqual(["extrude-abc"]);
  });

  it("is the same on a second and third re-parse", () => {
    const s = store(placement("extrude-abc", "extrude-abc"));
    for (let i = 0; i < 3; i++) {
      reconcilePlacements(s, grid, "extrude-abc", parseManifest(LOOSE));
    }
    expect(paths(s)).toEqual(["extrude-abc"]);
  });
});

/**
 * A file that comes home without its mark.
 *
 * The numbers are a real extrusion's, read off the pipeline: a 2 × 2 plate
 * pulled up three on a 64 px isometric grid writes a 512 × 480 canvas with
 * the artwork at (128, 64), 256 × 320, and the anchor dot at (256, 288). Put
 * on the space at (0, 0) and displayed at a half, that is a placement at
 * (-64, -112).
 *
 * Two things can happen to that file out of the app, and neither leaves the
 * mark behind: an editor that flattens on save, and an edit that comes back
 * through the photo library or as a PNG, which `reimport` converts with no
 * marks at all. `anchorOffset` then answers with the canvas centre and the
 * artwork lands somewhere else — most of a grid space away, because the
 * margin is not symmetric about the anchor.
 */
describe("a re-import that lost its anchor", () => {
  const APPLIED = JSON.stringify({
    name: "extrude-abc",
    width: 512,
    height: 480,
    layers: [
      { name: "anchor", category: "point", x: 256, y: 288, width: 12, height: 12 },
      { name: "grid-2x2", category: "zone", x: 128, y: 224, width: 256, height: 192 },
      {
        name: "extrude-abc",
        category: "sprite",
        x: 128,
        y: 64,
        width: 256,
        height: 320,
      },
    ],
  });

  /** The same file flattened: one layer over the whole canvas, marks gone. */
  const FLATTENED = JSON.stringify({
    name: "extrude-abc",
    width: 512,
    height: 480,
    layers: [
      { name: "extrude-abc", category: "sprite", x: 0, y: 0, width: 512, height: 480 },
    ],
  });

  /** And the same edit back as a picture: the canvas is the artwork. */
  const AS_IMAGE = JSON.stringify({
    name: "extrude-abc",
    width: 256,
    height: 320,
    layers: [
      { name: "extrude-abc", category: "sprite", x: 0, y: 0, width: 256, height: 320 },
    ],
  });

  function applied(): Placement {
    return {
      ...placement("extrude-abc", "extrude-abc"),
      x: -64,
      y: -112,
      width: 128,
      height: 160,
      naturalWidth: 256,
      naturalHeight: 320,
    };
  }

  it("puts a marked file back exactly where it was", () => {
    const s = store(applied());
    reconcilePlacements(s, grid, "extrude-abc", parseManifest(APPLIED));
    const after = s.layers[0].placements[0];
    expect([after.x, after.y]).toEqual([-64, -112]);
  });

  it("holds a flattened file where it is instead of centring it", () => {
    const s = store(applied());
    reconcilePlacements(s, grid, "extrude-abc", parseManifest(FLATTENED));
    const after = s.layers[0].placements[0];
    // The canvas centre would have put it at (-128, -120): a whole tile
    // sideways, and off the grid.
    expect([after.x, after.y]).toEqual([-64, -112]);
    // The artwork really is the whole canvas now, so the box says so.
    expect([after.width, after.height]).toEqual([256, 240]);
  });

  it("holds an edit that came back as a picture", () => {
    const s = store(applied());
    reconcilePlacements(s, grid, "extrude-abc", parseManifest(AS_IMAGE));
    const after = s.layers[0].placements[0];
    // The centre would have dropped it a full tile height, to (-64, -80).
    expect([after.x, after.y]).toEqual([-64, -112]);
  });

  it("keeps the file's own arrangement for a layer added beside it", () => {
    const WITH_EXTRA = JSON.stringify({
      name: "extrude-abc",
      width: 256,
      height: 320,
      layers: [
        { name: "roof", category: "sprite", x: 40, y: 0, width: 100, height: 60 },
        { name: "extrude-abc", category: "sprite", x: 0, y: 0, width: 256, height: 320 },
      ],
    });
    const s = store(applied());
    reconcilePlacements(s, grid, "extrude-abc", parseManifest(WITH_EXTRA));
    const roof = s.layers[0].placements.find((p) => p.layerPath === "roof");
    // 40 px right of the artwork in the file, so 20 on the grid beside it.
    expect(roof && [roof.x, roof.y]).toEqual([-44, -112]);
  });

  it("still centres a file nothing has placed, which is the only guess left", () => {
    const s = store();
    reconcilePlacements(s, grid, "extrude-abc", parseManifest(AS_IMAGE));
    expect(s.layers[0].placements).toHaveLength(0);
  });
});

/**
 * The mark still finding its place after the placement has been resized.
 *
 * The bug this exists for, and it was the loud one: re-parse a PSD that had
 * been made bigger or smaller on the canvas and the artwork jumped, often by
 * more than a grid space, with nothing in the file having moved.
 *
 * Reconciliation put each placement's anchor mark on `cellToWorld(anchor)` —
 * the grid space the PSD was dropped on. A drag keeps that cell and the
 * placement in step, but a resize cannot: every offset inside a placement
 * scales with it, so the distance from the space to the artwork's corner is
 * no longer the distance it was, and the cell stops saying where the mark is.
 * The position was then recomputed at the new scale from the old space, which
 * moves the artwork by the mark's own offset times the change in scale. An
 * image import is anchored on its middle, so doubling one moved it half its
 * own width.
 *
 * The numbers are the extrusion above: a 512 x 480 canvas with the artwork at
 * (128, 64) and the dot at (256, 288), placed on the space at (0, 0) at a
 * half — so the mark stands at the world origin and the artwork at
 * (-64, -112).
 */
describe("a placement that has been resized since it was placed", () => {
  const APPLIED = JSON.stringify({
    name: "extrude-abc",
    width: 512,
    height: 480,
    layers: [
      { name: "anchor", category: "point", x: 256, y: 288, width: 12, height: 12 },
      { name: "grid-2x2", category: "zone", x: 128, y: 224, width: 256, height: 192 },
      {
        name: "extrude-abc",
        category: "sprite",
        x: 128,
        y: 64,
        width: 256,
        height: 320,
      },
    ],
  });

  /** As `place` writes it: the offset from the mark, in the file's pixels. */
  function placed(): Placement {
    return {
      ...placement("extrude-abc", "extrude-abc"),
      x: -64,
      y: -112,
      width: 128,
      height: 160,
      naturalWidth: 256,
      naturalHeight: 320,
      fromAnchor: { x: -128, y: -224 },
    };
  }

  /** Dragged out to twice the size by its bottom-right handle. */
  function doubled(): Placement {
    return { ...placed(), width: 256, height: 320 };
  }

  it("leaves it where it is", () => {
    const s = store(doubled());
    reconcilePlacements(s, grid, "extrude-abc", parseManifest(APPLIED));
    const after = s.layers[0].placements[0];
    // Positioning from the anchor *cell* put it at (-128, -224): a tile
    // across and most of two down, for a file nothing had moved.
    expect([after.x, after.y]).toEqual([-64, -112]);
  });

  it("leaves one that has not been resized where it is too", () => {
    const s = store(placed());
    reconcilePlacements(s, grid, "extrude-abc", parseManifest(APPLIED));
    const after = s.layers[0].placements[0];
    expect([after.x, after.y]).toEqual([-64, -112]);
  });

  /**
   * The inspector's Width box is the other way to change the scale, and it
   * writes the width on its own — no anchor, no position.
   */
  it("leaves one resized through the inspector where it is", () => {
    const s = store({ ...placed(), width: 256 });
    reconcilePlacements(s, grid, "extrude-abc", parseManifest(APPLIED));
    const after = s.layers[0].placements[0];
    // The old reading moved it in x alone, to -128, and left y as it was.
    expect([after.x, after.y]).toEqual([-64, -112]);
  });

  /** And a second re-parse is the same, because the offset is re-recorded. */
  it("records the offset it found the mark by", () => {
    const s = store(doubled());
    reconcilePlacements(s, grid, "extrude-abc", parseManifest(APPLIED));
    expect(s.layers[0].placements[0].fromAnchor).toEqual({ x: -128, y: -224 });
    reconcilePlacements(s, grid, "extrude-abc", parseManifest(APPLIED));
    const after = s.layers[0].placements[0];
    expect([after.x, after.y]).toEqual([-64, -112]);
  });

  /**
   * The feature itself, on a resized placement: the artist slides the artwork
   * 64 px right inside the canvas and leaves the dot alone, so the picture
   * moves on the grid by 64 at the scale it is shown at.
   */
  it("still follows artwork moved inside the canvas", () => {
    const MOVED = JSON.stringify({
      name: "extrude-abc",
      width: 512,
      height: 480,
      layers: [
        { name: "anchor", category: "point", x: 256, y: 288, width: 12, height: 12 },
        {
          name: "extrude-abc",
          category: "sprite",
          x: 192,
          y: 64,
          width: 256,
          height: 320,
        },
      ],
    });
    const s = store(doubled());
    reconcilePlacements(s, grid, "extrude-abc", parseManifest(MOVED));
    const after = s.layers[0].placements[0];
    expect([after.x, after.y]).toEqual([0, -112]);
  });

  /**
   * A document written before the offset was recorded has none, and falls
   * back to the anchor cell — which is what every placement did before, and
   * is exact for one nobody has resized.
   */
  it("falls back to the anchor cell for a document that has no offset", () => {
    const { fromAnchor: _unused, ...legacy } = placed();
    const s = store(legacy);
    reconcilePlacements(s, grid, "extrude-abc", parseManifest(APPLIED));
    const after = s.layers[0].placements[0];
    expect([after.x, after.y]).toEqual([-64, -112]);
  });

  /**
   * A crop that took the dot off the canvas.
   *
   * Photoshop deletes what falls outside a crop, and the row stays in the
   * layer list with nothing in it — so the file still *looks* anchored and
   * psd-to-json reports the point at 0 × 0 on the origin. Read as a position
   * that is an anchor on the canvas's top-left corner, and the artwork lands
   * most of a canvas away from where it was.
   */
  it("holds a placement whose mark was cropped away", () => {
    const EMPTIED = JSON.stringify({
      name: "extrude-abc",
      width: 256,
      height: 320,
      layers: [
        { name: "anchor", category: "point", x: 0, y: 0, width: 0, height: 0 },
        {
          name: "extrude-abc",
          category: "sprite",
          x: 0,
          y: 0,
          width: 256,
          height: 320,
        },
      ],
    });
    const s = store(placed());
    reconcilePlacements(s, grid, "extrude-abc", parseManifest(EMPTIED));
    const after = s.layers[0].placements[0];
    // Reading the empty row as an anchor on (0, 0) put it at (0, 0).
    expect([after.x, after.y]).toEqual([-64, -112]);
  });

  /** And a resized one whose file came home flattened is still held. */
  it("holds a resized placement whose mark has gone", () => {
    const FLATTENED = JSON.stringify({
      name: "extrude-abc",
      width: 512,
      height: 480,
      layers: [
        { name: "extrude-abc", category: "sprite", x: 0, y: 0, width: 512, height: 480 },
      ],
    });
    const s = store(doubled());
    reconcilePlacements(s, grid, "extrude-abc", parseManifest(FLATTENED));
    const after = s.layers[0].placements[0];
    expect([after.x, after.y]).toEqual([-64, -112]);
  });
});

/**
 * Grouping loose sprites into an atlas.
 *
 * The edit that took a document off the canvas. `S | confetti | atlas |` eats
 * its children, so the layers a placement was standing on stop existing and
 * the honest old reading — the layer is gone, drop the placement — removed
 * every placement the key had. With none left there was no sibling to infer
 * a position from either, so nothing was adopted in their place and the PSD
 * simply vanished.
 */
describe("grouping layers into an atlas", () => {
  it("moves a placement onto the atlas that swallowed its layer", () => {
    const s = store(placement("confetti", "purple"));
    reconcilePlacements(s, grid, "confetti", parseManifest(ATLASED));
    expect(paths(s)).toEqual(["confetti"]);
  });

  it("keeps the placement's own identity while it does", () => {
    const s = store(placement("confetti", "purple"));
    reconcilePlacements(s, grid, "confetti", parseManifest(ATLASED));
    const [p] = s.layers[0].placements;
    expect(p.id).toBe("p1");
    expect(p.instance).toBe("unit-1");
    expect(p.anchor).toEqual({ cx: 0, cy: 0 });
  });

  /**
   * Two frames of one atlas were two placements a moment ago, and one
   * placement draws the whole image. Without the collapse the canvas gains a
   * second copy of the atlas exactly on top of the first.
   */
  it("collapses several swallowed placements onto one", () => {
    const s = store(
      placement("confetti", "purple", "p1"),
      placement("confetti", "green", "p2"),
    );
    reconcilePlacements(s, grid, "confetti", parseManifest(ATLASED));
    expect(paths(s)).toEqual(["confetti"]);
  });

  /** The document survives the round trip rather than emptying out. */
  it("leaves the PSD on the canvas", () => {
    const s = store(
      placement("confetti", "purple", "p1"),
      placement("confetti", "green", "p2"),
    );
    reconcilePlacements(s, grid, "confetti", parseManifest(ATLASED));
    expect(s.layers[0].placements.length).toBeGreaterThan(0);
  });

  /**
   * The guard is the frames map, not "anything missing finds a home": a layer
   * genuinely deleted from the file still takes its placement with it.
   */
  it("still drops a placement whose layer is really gone", () => {
    const s = store(placement("confetti", "orange"));
    reconcilePlacements(s, grid, "confetti", parseManifest(ATLASED));
    expect(paths(s)).toEqual([]);
  });

  /** Nothing changes for a file whose layers are still loose. */
  it("leaves loose sprites alone", () => {
    const s = store(
      placement("confetti", "purple", "p1"),
      placement("confetti", "green", "p2"),
    );
    reconcilePlacements(s, grid, "confetti", parseManifest(LOOSE));
    expect(paths(s).sort()).toEqual(["green", "purple"]);
  });
});
