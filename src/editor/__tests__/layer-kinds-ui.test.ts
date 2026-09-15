/**
 * What the left sidebar shows for each kind of layer.
 *
 * The rule an object layer enforces is the one worth pinning: a PSD with no
 * `P | anchor` at the root of its stack greys out and says so. It is not a
 * refusal — the artwork is placed and it draws — so what the test checks is
 * that the row is still there and still selectable, carrying a warning.
 */

import { describe, expect, it } from "vitest";
import { layerItems } from "../layer-items";
import { hasRootAnchor } from "../../lib/manifest";
import type { Background, Layer, Placement } from "../../lib/types";

function layer(patch: Partial<Layer> = {}): Layer {
  return {
    id: "l1",
    name: "Terrain",
    locked: false,
    visible: true,
    fills: [],
    placements: [],
    points: [],
    zones: [],
    strokes: [],
    ...patch,
  };
}

function placement(key: string): Placement {
  return {
    id: `p-${key}`,
    psdKey: key,
    layerPath: key,
    x: 0,
    y: 0,
    width: 64,
    height: 64,
    anchor: { cx: 0, cy: 0 },
    instance: `u-${key}`,
  };
}

describe("the anchor rule", () => {
  it("reads a root-level anchor mark out of a manifest's layers", () => {
    expect(
      hasRootAnchor([
        { name: "tower", category: "sprite" },
        { name: "anchor", category: "point" },
      ]),
    ).toBe(true);
  });

  /**
   * Not the same question `manifest.anchor` answers. That one finds the mark
   * wherever it is; this is the rule, and the rule is that it sits where
   * anybody opening the file sees it.
   */
  it("does not count one tucked inside a group", () => {
    expect(
      hasRootAnchor([
        {
          name: "marks",
          category: "group",
          children: [{ name: "anchor", category: "point" }],
        },
      ]),
    ).toBe(false);
  });

  it("takes psd-to-json at any of the spellings it uses", () => {
    expect(hasRootAnchor([{ name: " Anchor ", category: "Points" }])).toBe(true);
  });

  it("answers no for anything that is not a list of layers", () => {
    expect(hasRootAnchor(undefined)).toBe(false);
    expect(hasRootAnchor([{ name: "tower", category: "sprite" }])).toBe(false);
  });
});

describe("a layer's rows", () => {
  it("warn about an unanchored PSD on an object layer, without hiding it", () => {
    const [row] = layerItems(layer({ placements: [placement("tower")] }), {
      isAnchored: () => false,
    });
    expect(row.label).toBe("tower.psd");
    expect(row.warning).toBe("No anchor");
    expect(row.selection).toEqual({
      kind: "placement",
      layerId: "l1",
      placementId: "p-tower",
    });
  });

  it("says nothing when the file has its mark", () => {
    const [row] = layerItems(layer({ placements: [placement("tower")] }), {
      isAnchored: () => true,
    });
    expect(row.warning).toBeUndefined();
  });

  /**
   * A pattern layer's placements are the palette it scatters and a background
   * layer's are scenery — neither is a thing standing on a grid space, so
   * neither has anywhere to be anchored *to*.
   */
  it("leaves the rule off a pattern or a background layer", () => {
    for (const kind of ["pattern", "background"] as const) {
      const [row] = layerItems(
        layer({ kind, placements: [placement("grass")] }),
        { isAnchored: () => false },
      );
      expect(row.warning).toBeUndefined();
    }
  });

  it("asks nothing when nobody handed it a way to ask", () => {
    const [row] = layerItems(layer({ placements: [placement("tower")] }));
    expect(row.warning).toBeUndefined();
  });

  /**
   * The label reads `tower.psd`, which is a thing to read rather than a key
   * to ask questions with — and Code mode's directory asks one of every
   * placed row: what is inside this file. Stripping `.psd` back off a label
   * is how that goes wrong for a file somebody named `map.psd.psd`.
   */
  it("carry the file's key, not only its filename", () => {
    const [row] = layerItems(layer({ placements: [placement("tower")] }));
    expect(row.label).toBe("tower.psd");
    expect(row.psdKey).toBe("tower");
  });

  it("leave it off everything that is not a placed file", () => {
    const rows = layerItems(
      layer({
        points: [
          { id: "pt1", name: "Start", cell: { cx: 0, cy: 0 } },
        ],
        zones: [
          {
            id: "z1",
            name: "Wall",
            blocking: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
            ],
          },
        ],
      }),
    );
    expect(rows.map((r) => r.psdKey)).toEqual([undefined, undefined]);
  });
});

describe("a background layer's rows", () => {
  const backdrop = (patch: Partial<Background> = {}): Background => ({
    id: "b1",
    name: "Colour 1",
    kind: "color",
    color: "#2b3b4a",
    ...patch,
  });

  it("list backdrops before anything standing on the layer", () => {
    const rows = layerItems(
      layer({
        kind: "background",
        backgrounds: [backdrop()],
        placements: [placement("hills")],
      }),
    );
    expect(rows.map((r) => r.label)).toEqual(["Colour 1", "hills.psd"]);
    expect(rows[0].selection).toEqual({
      kind: "background",
      layerId: "l1",
      backgroundId: "b1",
    });
  });

  it("show a gradient as one, with its first stop as the chip", () => {
    const [row] = layerItems(
      layer({
        kind: "background",
        backgrounds: [
          backdrop({
            kind: "gradient",
            color: undefined,
            gradient: { from: "#6ea8d8", to: "#dfe9f2", angle: 0 },
          }),
        ],
      }),
    );
    expect(row.detail).toBe("gradient");
    expect(row.swatch).toBe("#6ea8d8");
  });
});
