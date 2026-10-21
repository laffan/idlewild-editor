/**
 * A scene file read back: which blocks place what, where they say it stands,
 * where new lines go, and which call the caret is in.
 */

import { describe, expect, it } from "vitest";
import {
  appendPoint,
  callAtCaret,
  matchBlocks,
  parseBlocks,
  positionAtCaret,
  samePosition,
  withLines,
  withPosition,
  withScale,
} from "../scene-code";
import type { PlacedPiece } from "../placement-code";
import type { Placement } from "../../lib/types";

const scene = `export default class Scene1 extends Phaser.Scene {
  create() {
    // Place PSDs here.
    const tree = this.P2P.place(this, "tree", "tree");
    tree.setPosition(120, 80);
    tree.setDepth(1);
    const roof = this.P2P.place(this, 'house', 'house/roof');
    roof.setPosition(x + 1, 4);

    ExportForPrint({ name: "page" });
  }
}
`;

const piece = (psdKey: string, path: string, x: number, y: number): PlacedPiece => ({
  layerId: "l",
  placement: { id: `${psdKey}:${path}`, psdKey, layerPath: path } as Placement,
  path,
  x,
  y,
  scaleX: 1,
  scaleY: 1,
  hidden: false,
  depth: 1,
});

describe("a scene's placing blocks", () => {
  const blocks = parseBlocks(scene);

  it("names the file, the layer and the position of each", () => {
    expect(blocks.map((b) => [b.name, b.psdKey, b.path])).toEqual([
      ["tree", "tree", "tree"],
      ["roof", "house", "house/roof"],
    ]);
    expect(blocks[0].position).toMatchObject({ x: 120, y: 80 });
    expect(blocks[1].position).toMatchObject({ x: null, y: 4 });
    expect(scene.slice(blocks[0].start, blocks[0].end)).toBe(
      'const tree = this.P2P.place(this, "tree", "tree");\n    tree.setPosition(120, 80);\n    tree.setDepth(1);',
    );
  });

  it("writes new lines after the last block, before anything that follows it", () => {
    const point = appendPoint(scene, blocks);
    const next = withLines(scene, point!, ["const rock = 1;"]);
    expect(next).toContain('roof.setPosition(x + 1, 4);\n    const rock = 1;\n\n    ExportForPrint');
  });

  it("writes them under the scaffold's comment in a scene with no blocks", () => {
    const empty = "  create() {\n    // Place PSDs here.\n  }\n";
    const point = appendPoint(empty, []);
    expect(withLines(empty, point!, ["a();"])).toBe("  create() {\n    // Place PSDs here.\n    a();\n  }\n");
  });

  it("rewrites one call's numbers and nothing else", () => {
    expect(withPosition(scene, blocks[0], 10.004, -3)).toContain("tree.setPosition(10, -3);");
    expect(withPosition(scene, blocks[0], 10.004, -3)).toContain("roof.setPosition(x + 1, 4);");
  });

  it("knows which call the caret is in", () => {
    const at = scene.indexOf("120");
    expect(positionAtCaret(blocks, at)?.name).toBe("tree");
    expect(positionAtCaret(blocks, scene.indexOf("setDepth"))).toBeNull();
  });

  it("matches pieces to blocks by file and layer, and says which have moved", () => {
    const pieces = [piece("house", "house/roof", 0, 4), piece("tree", "tree", 120, 80), piece("tree", "tree", 5, 5)];
    const matched = matchBlocks(pieces, blocks);
    expect(matched.map((b) => b?.name)).toEqual(["roof", "tree", undefined]);
    expect(samePosition(pieces[1], matched[1]!)).toBe(true);
    // An expression is not a number the canvas can agree with.
    expect(samePosition(pieces[0], matched[0]!)).toBe(false);
  });
});

describe("a setScale, and a backdrop's block", () => {
  const text = `  create() {
    const sky = this.add.graphics().setScrollFactor(0).setDepth(1);
    sky.fillRect(0, 0, 10, 10);
    const tree = this.P2P.place(this, "tree", "tree");
    tree.setPosition(1, 2);
    tree.setScale(0.5);
    const rock = this.P2P.place(this, "rock", "rock");
    rock.setScale(1, 2);
  }
`;
  const blocks = parseBlocks(text);

  it("reads one argument as both axes, and two as one each", () => {
    expect(blocks.map((b) => b.name)).toEqual(["sky", "tree", "rock"]);
    expect(blocks[1].scale).toMatchObject({ x: 0.5, y: 0.5, uniform: true });
    expect(blocks[2].scale).toMatchObject({ x: 1, y: 2, uniform: false });
  });

  it("knows a setScale from a setPosition at the caret", () => {
    expect(callAtCaret(blocks, text.indexOf("0.5"))).toMatchObject({ kind: "scale" });
    expect(callAtCaret(blocks, text.indexOf("1, 2)"))?.kind).toBe("position");
  });

  it("writes back as many arguments as it had", () => {
    expect(withScale(text, blocks[1], 0.756, 9)).toContain("tree.setScale(0.76);");
    expect(withScale(text, blocks[2], 3, 4)).toContain("rock.setScale(3, 4);");
  });

  it("puts new lines after a backdrop too", () => {
    const onlySky = "  create() {\n    const sky = this.add.graphics();\n    sky.fillRect(0, 0, 1, 1);\n  }\n";
    const point = appendPoint(onlySky, parseBlocks(onlySky));
    expect(withLines(onlySky, point!, ["a();"])).toContain("sky.fillRect(0, 0, 1, 1);\n    a();");
  });
});
