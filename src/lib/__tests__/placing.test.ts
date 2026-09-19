import { describe, expect, it } from "vitest";
import { parseManifest } from "../manifest";
import {
  anchorOffset,
  canvasBox,
  offsetFromAnchor,
  placedPosition,
} from "../placing";

/**
 * The frame PSD Edit mode draws, which is the *document* rather than the artwork.
 *
 * The distinction is the whole reason this exists: a placement's own box is
 * one layer's pixels, and everything this editor writes has a grid space of
 * clear canvas around them, so the two differ by most of a space.
 */
describe("the PSD's canvas in the world", () => {
  // A 64×64 file whose anchor mark is dead centre, with the artwork filling
  // the middle 32×32 — a converted fill, with its margin around it.
  const withMargin = parseManifest(
    JSON.stringify({
      name: "hut",
      width: 64,
      height: 64,
      layers: [
        { name: "hut", category: "sprite", x: 16, y: 16, width: 32, height: 32 },
        { name: "anchor", category: "point", x: 32, y: 32, width: 12, height: 12 },
      ],
    }),
  );

  it("puts the anchor mark on the grid space, and the canvas around it", () => {
    const box = canvasBox({ x: 0, y: 0 }, withMargin, 1);
    expect(box).toEqual({ x: -32, y: -32, width: 64, height: 64 });
  });

  it("is bigger than the artwork inside it, which is the point", () => {
    const box = canvasBox({ x: 0, y: 0 }, withMargin, 1);
    const art = withMargin.top.find((l) => l.name === "hut");
    const at = placedPosition({ x: 0, y: 0 }, withMargin, art!, 1, 1);
    expect(at.x).toBeGreaterThan(box.x);
    expect(at.x + art!.width).toBeLessThan(box.x + box.width);
  });

  it("scales with the placement, because the artwork does", () => {
    // Every import lands at half size, and the frame has to land with it.
    expect(canvasBox({ x: 0, y: 0 }, withMargin, 0.5)).toEqual({
      x: -16,
      y: -16,
      width: 32,
      height: 32,
    });
  });

  it("falls back to the canvas centre for a file with no mark", () => {
    const plain = parseManifest(
      JSON.stringify({
        name: "other",
        width: 100,
        height: 40,
        layers: [
          { name: "other", category: "sprite", x: 0, y: 0, width: 100, height: 40 },
        ],
      }),
    );
    expect(canvasBox({ x: 0, y: 0 }, plain, 1)).toEqual({
      x: -50,
      y: -20,
      width: 100,
      height: 40,
    });
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
 * The offset a placement keeps so the mark can be found again.
 *
 * `placedPosition` turns it into a world position; this is the offset itself,
 * and the two have to be exact inverses or a re-parse moves the artwork. It
 * is what a placement holds instead of trusting its anchor *cell*, which
 * stops describing where the mark is the moment the placement is resized.
 */
describe("offsetFromAnchor", () => {
  const MARKED = parseManifest(
    JSON.stringify({
      name: "hut",
      width: 200,
      height: 160,
      layers: [
        { name: "hut", category: "sprite", x: 40, y: 0, width: 160, height: 160 },
        { name: "anchor", category: "point", x: 100, y: 80, width: 12, height: 12 },
      ],
    }),
  );

  it("is the layer's distance from the mark, in the file's own pixels", () => {
    const entry = MARKED.all.find((l) => l.name === "hut")!;
    expect(offsetFromAnchor(anchorOffset(MARKED), entry)).toEqual({
      x: -60,
      y: -80,
    });
  });

  /**
   * Walking back along it at the scale the placement is shown at lands on the
   * world point the mark stands on — which is what a re-parse positions from.
   */
  it("inverts placedPosition at any scale", () => {
    const entry = MARKED.all.find((l) => l.name === "hut")!;
    const offset = offsetFromAnchor(anchorOffset(MARKED), entry);
    for (const scale of [0.5, 1, 2.5]) {
      const at = placedPosition({ x: 300, y: 220 }, MARKED, entry, scale, scale);
      expect({
        x: at.x - offset.x * scale,
        y: at.y - offset.y * scale,
      }).toEqual({ x: 300, y: 220 });
    }
  });
});
