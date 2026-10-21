/**
 * A PSD or a layer renamed in the editor, renamed in the code — wherever the
 * code means the file or the layer, and nowhere else.
 */

import { describe, expect, it } from "vitest";
import { renameKeyInCode, renameLayersInCode } from "../rename-refs";

describe("a PSD renamed", () => {
  it("renames the key in every psd-to-phaser call, however it is laid out", () => {
    const code = [
      'const tree = this.P2P.place(this, "tree", "tree");',
      "const seeds = scene.P2P.getTexture(",
      "  this,",
      "  'tree',",
      "  'root/seeds',",
      ");",
      "const data = this.P2P.getData(`tree`);",
      'this.P2P.load.loadMultiple(this, [{ key: "tree", path: "assets/tree" }]);',
    ].join("\n");
    expect(renameKeyInCode(code, "tree", "oak")).toBe(
      [
        'const tree = this.P2P.place(this, "oak", "tree");',
        "const seeds = scene.P2P.getTexture(",
        "  this,",
        "  'oak',",
        "  'root/seeds',",
        ");",
        "const data = this.P2P.getData(`oak`);",
        'this.P2P.load.loadMultiple(this, [{ key: "oak", path: "assets/oak" }]);',
      ].join("\n"),
    );
  });

  it("follows a key held in a name, and a texture made from the file", () => {
    const code = 'const KEY = "tree";\nthis.P2P.place(this, KEY, "trunk");\nthis.add.image(0, 0, "tree_trunk");';
    expect(renameKeyInCode(code, "tree", "oak", ["trunk"])).toBe(
      'const KEY = "oak";\nthis.P2P.place(this, KEY, "trunk");\nthis.add.image(0, 0, "oak_trunk");',
    );
  });

  it("leaves the same word alone where it is not the file", () => {
    const code = [
      'this.scene.start("tree");',
      'console.log("tree");',
      '// this.P2P.place(this, "tree", "tree")',
      'const label = "tree";',
      "const t = `${'tree'}`;",
    ].join("\n");
    expect(renameKeyInCode(code, "tree", "oak")).toBe(code);
  });
});

describe("a layer renamed", () => {
  const names = new Map([["roof", "tiles"]]);

  it("renames the path of a call on that file, and only that file", () => {
    const code = [
      'const roof = this.P2P.place(this, "house", "house/roof");',
      'const other = this.P2P.place(this, "barn", "barn/roof");',
      'this.add.image(0, 0, "house_roof");',
    ].join("\n");
    expect(renameLayersInCode(code, "house", names)).toBe(
      [
        'const roof = this.P2P.place(this, "house", "house/tiles");',
        'const other = this.P2P.place(this, "barn", "barn/roof");',
        'this.add.image(0, 0, "house_tiles");',
      ].join("\n"),
    );
  });

  it("renames a target on something placed from it, relative to where it was placed", () => {
    const code = 'const house = this.P2P.place(this, "house", "house");\nhouse.target("roof").setAlpha(0.5);';
    expect(renameLayersInCode(code, "house", names)).toBe(
      'const house = this.P2P.place(this, "house", "house");\nhouse.target("tiles").setAlpha(0.5);',
    );
  });

  it("follows a key and a path held in names", () => {
    const code = 'const K = "house";\nconst P = "house/roof";\nthis.P2P.place(this, K, P);';
    expect(renameLayersInCode(code, "house", names)).toBe(
      'const K = "house";\nconst P = "house/tiles";\nthis.P2P.place(this, K, P);',
    );
  });
});
