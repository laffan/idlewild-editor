/**
 * The document's placements as psd-to-phaser code — what a PSD to Phaser
 * scene is written with, and what a row dragged out of the sidebar writes.
 *
 * Pinned on what would be wrong on screen: the order things draw in, a
 * group's layers each landing at their own offset rather than all on one
 * point, and two drags into one file declaring the same `const`.
 */

import { describe, expect, it } from "vitest";
import {
  barePlacement,
  declaredNames,
  piecesFor,
  placementCode,
  sceneCode,
  scenePieces,
  type PlacementSource,
} from "../placement-code";
import type { ManifestLayer } from "../../lib/manifest";
import type { Layer, Placement } from "../../lib/types";

function placement(id: string, psdKey: string, layerPath: string, extra: Partial<Placement> = {}): Placement {
  return {
    id,
    psdKey,
    layerPath,
    x: 10,
    y: 20,
    width: 50,
    height: 40,
    anchor: { cx: 0, cy: 0 },
    ...extra,
  } as Placement;
}

function layer(id: string, name: string, placements: Placement[], extra: Partial<Layer> = {}): Layer {
  return {
    id,
    name,
    locked: false,
    visible: true,
    fills: [],
    placements,
    zones: [],
    strokes: [],
    ...extra,
  } as Layer;
}

function manifestLayer(path: string, category: ManifestLayer["category"], x: number, y: number): ManifestLayer {
  return { path, name: path.split("/").pop() ?? path, category, visible: true, x, y, width: 10, height: 10 };
}

const source = (layers: Layer[], manifests: Record<string, ManifestLayer[]> = {}): PlacementSource => ({
  layers,
  isometric: false,
  psdLayers: (key) => manifests[key] ?? [],
});

describe("a scene's placements, as code", () => {
  it("places each piece, back to front, with its depth as its rank", () => {
    const scene = source([
      layer("front", "Front", [placement("a", "tree", "tree", { x: 120, y: 80 })]),
      layer("back", "Back", [placement("b", "sky", "sky")]),
    ]);
    expect(sceneCode(scene)).toBe(
      "    // Back\n" +
        '    const sky = this.P2P.place(this, "sky", "sky");\n' +
        "    sky.setPosition(10, 20);\n" +
        "    sky.setDepth(1);\n" +
        "\n" +
        "    // Front\n" +
        '    const tree = this.P2P.place(this, "tree", "tree");\n' +
        "    tree.setPosition(120, 80);\n" +
        "    tree.setDepth(2);\n",
    );
  });

  it("scales what was resized, and hides what is hidden", () => {
    const lines = placementCode(
      scenePieces(
        source([
          layer("l", "L", [
            placement("a", "rock", "rock", { width: 25, naturalWidth: 50, height: 20, naturalHeight: 40, hidden: true }),
          ]),
        ]),
      ),
      new Set(),
    );
    expect(lines).toContain("rock.setScale(0.5);");
    expect(lines).toContain("rock.setVisible(false);");
  });

  it("leaves out pattern layers, tile layers and layers that are off", () => {
    const scene = source([
      layer("p", "P", [placement("a", "x", "x")], { kind: "pattern" } as Partial<Layer>),
      layer("t", "T", [placement("b", "y", "y")], { kind: "tile" } as Partial<Layer>),
      layer("o", "O", [placement("c", "z", "z")], { visible: false }),
    ]);
    expect(scenePieces(scene)).toEqual([]);
  });

  /**
   * psd-to-phaser's `setPosition` on a group puts every child on one point,
   * so a group is written as one `place` per layer inside it.
   */
  it("writes a group as each of its layers, at their own offsets", () => {
    const scene = source([layer("l", "L", [placement("a", "house", "house", { x: 100, y: 200 })])], {
      house: [
        manifestLayer("house", "group", 0, 0),
        manifestLayer("house/walls", "sprite", 5, 30),
        manifestLayer("house/roof", "sprite", 0, 0),
      ],
    });
    const pieces = scenePieces(scene);
    expect(pieces.map((p) => [p.path, p.x, p.y])).toEqual([
      ["house/walls", 105, 230],
      ["house/roof", 100, 200],
    ]);
  });
});

describe("a dragged row's lines", () => {
  const scene = source([
    layer("l", "Terrain", [
      placement("a", "house", "walls", { instance: "u1", order: 0 }),
      placement("b", "house", "roof", { instance: "u1", order: 1 }),
      placement("c", "tree", "tree"),
    ]),
  ]);
  const pieces = scenePieces(scene);

  it("is a whole unit for a placed PSD, and one layer for a layer in it", () => {
    const unit = piecesFor(pieces, { kind: "placed", layerId: "l", placementId: "b" });
    expect(unit.map((p) => p.path)).toEqual(["walls", "roof"]);
    const one = piecesFor(pieces, { kind: "psd-layer", layerId: "l", placementId: "a", psdKey: "house", path: "roof" });
    expect(one.map((p) => [p.path, p.depth])).toEqual([["roof", 2]]);
    expect(piecesFor(pieces, { kind: "layer", layerId: "l" })).toHaveLength(3);
  });

  it("never declares a name the file already has", () => {
    const taken = declaredNames("const tree = 1;\nlet roof;\n");
    const lines = placementCode(piecesFor(pieces, { kind: "layer", layerId: "l" }), taken);
    expect(lines[0]).toBe('const walls = this.P2P.place(this, "house", "walls");');
    expect(lines.some((l) => l.startsWith("const roof2 = "))).toBe(true);
    expect(lines.some((l) => l.startsWith("const tree2 = "))).toBe(true);
  });

  it("names a layer that is not an identifier after its file", () => {
    expect(barePlacement("logo", "1 final", new Set())[0]).toBe(
      'const logo1Final = this.P2P.place(this, "logo", "1 final");',
    );
  });
});
