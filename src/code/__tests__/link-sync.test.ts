/**
 * The editor's blocks in a scene file: placed as Draw places, kept up while
 * untouched, released by a hand edit, linked again by a reset — and nothing
 * of anybody else's touched.
 */

import { describe, expect, it } from "vitest";
import { sceneParts, type PlacementSource } from "../placement-code";
import type { LinkRecords } from "../code-links";
import { relink, syncScene } from "../link-sync";
import type { Layer, Placement } from "../../lib/types";

const empty = `export default class Scene1 extends Phaser.Scene {
  create() {
    // Place PSDs here.
  }
}
`;

function sourceWith(placements: Array<Partial<Placement> & { id: string }>): PlacementSource {
  const layer = {
    id: "l",
    name: "Terrain",
    locked: false,
    visible: true,
    fills: [],
    zones: [],
    strokes: [],
    placements: placements.map((p) => ({
      psdKey: "tree",
      layerPath: "tree",
      x: 10,
      y: 20,
      width: 50,
      height: 40,
      anchor: { cx: 0, cy: 0 },
      ...p,
    })),
  } as unknown as Layer;
  return { layers: [layer], isometric: false, psdLayers: () => [] };
}

function pass(text: string, source: PlacementSource, records: LinkRecords, fresh = false, adopt = false) {
  return syncScene({
    sceneId: "s",
    text,
    parts: sceneParts(source),
    records,
    fresh: () => fresh,
    adopt,
  });
}

describe("a block the editor places", () => {
  it("is written as the piece is placed, and follows Draw while untouched", () => {
    const records: LinkRecords = {};
    const placed = pass(empty, sourceWith([{ id: "a" }]), records, true);
    expect(placed.text).toContain("    const tree = this.P2P.place(this, \"tree\", \"tree\");\n    tree.setPosition(10, 20);");
    expect(Object.values(records)[0]).toMatchObject({ name: "tree", linked: true });

    // Moved in Draw before the code was ever opened.
    const moved = pass(placed.text, sourceWith([{ id: "a", x: 300, y: 40 }]), records);
    expect(moved.text).toContain("tree.setPosition(300, 40);");
    expect(moved.text).not.toContain("setPosition(10, 20)");
    // Resized: a scale line arrives, and goes again at 1.
    const big = pass(moved.text, sourceWith([{ id: "a", x: 300, y: 40, width: 100, naturalWidth: 50, height: 80, naturalHeight: 40 }]), records);
    expect(big.text).toContain("tree.setScale(2);");
    expect(pass(big.text, sourceWith([{ id: "a", x: 300, y: 40 }]), records).text).not.toContain("setScale");
  });

  it("is released by an edit, stops following, and says it has moved off Draw", () => {
    const records: LinkRecords = {};
    const placed = pass(empty, sourceWith([{ id: "a" }]), records, true).text;
    const edited = placed.replace("tree.setPosition(10, 20);", "tree.setPosition(10, 20);\n    tree.setAlpha(0.5);");
    const after = pass(edited, sourceWith([{ id: "a", x: 99, y: 99 }]), records);
    expect(after.text).toBe(edited);
    expect(Object.values(records)[0].linked).toBe(false);
    expect([...after.diverged]).toEqual(["a\u0000tree"]);
  });

  it("is linked again by a reset, keeping the lines that were added", () => {
    const records: LinkRecords = {};
    const placed = pass(empty, sourceWith([{ id: "a" }]), records, true).text;
    const edited = placed.replace("tree.setPosition(10, 20);", "tree.setPosition(1, 1);\n    tree.setAlpha(0.5);");
    pass(edited, sourceWith([{ id: "a", x: 99, y: 99 }]), records);
    const part = sceneParts(sourceWith([{ id: "a", x: 99, y: 99 }]))[0];
    const reset = relink(edited, part, records);
    expect(reset).toContain("tree.setPosition(99, 99);\n    tree.setAlpha(0.5);");
    expect(Object.values(records)[0].linked).toBe(true);
    // And it follows Draw again from there.
    expect(pass(reset, sourceWith([{ id: "a", x: 5, y: 6 }]), records).text).toContain("tree.setPosition(5, 6);\n    tree.setAlpha(0.5);");
  });

  it("answers for its own block only, never a second place of the same layer", () => {
    const records: LinkRecords = {};
    const placed = pass(empty, sourceWith([{ id: "a" }]), records, true).text;
    const copy = placed.replace(
      "    tree.setDepth(1);",
      '    tree.setDepth(1);\n    const tree2 = this.P2P.place(this, "tree", "tree");\n    tree2.setPosition(10, 20);',
    );
    const moved = pass(copy, sourceWith([{ id: "a", x: 70, y: 80 }]), records).text;
    expect(moved).toContain("tree.setPosition(70, 80);");
    expect(moved).toContain("tree2.setPosition(10, 20);");
  });

  it("goes when its piece leaves the document, and comes back with an undo", () => {
    const records: LinkRecords = {};
    const placed = pass(empty, sourceWith([{ id: "a" }]), records, true).text;
    const gone = pass(placed, sourceWith([]), records).text;
    expect(gone).not.toContain("this.P2P.place");
    const back = pass(gone, sourceWith([{ id: "a" }]), records).text;
    expect(back).toContain("const tree = this.P2P.place");
  });
});

describe("blocks from before links", () => {
  const legacy = empty.replace(
    "    // Place PSDs here.\n",
    '    // Place PSDs here.\n    const tree = this.P2P.place(this, "tree", "tree");\n    tree.setPosition(10, 20);\n    tree.setDepth(1);\n',
  );

  it("are adopted and follow Draw while they are still only the editor's lines", () => {
    const records: LinkRecords = {};
    const text = pass(legacy, sourceWith([{ id: "a", x: 40, y: 50 }]), records, false, true).text;
    expect(text).toContain("tree.setPosition(40, 50);");
  });

  it("are adopted released once something has been added to them", () => {
    const records: LinkRecords = {};
    const touched = legacy.replace("tree.setDepth(1);", "tree.setDepth(1);\n    tree.setAlpha(0.2);");
    const result = pass(touched, sourceWith([{ id: "a", x: 40, y: 50 }]), records, false, true);
    expect(result.text).toBe(touched);
    expect(result.diverged.size).toBe(1);
  });
});

describe("a pass that cannot see a group's layers yet", () => {
  it("leaves the blocks of a placement it can still see alone", () => {
    const records: LinkRecords = {
      "a\u0000house/roof": {
        sceneId: "s",
        name: "roof",
        text: 'const roof = this.P2P.place(this, "tree", "house/roof");\nroof.setPosition(1, 2);\nroof.setDepth(1);',
        linked: true,
      },
    };
    const text = empty.replace(
      "    // Place PSDs here.\n",
      '    // Place PSDs here.\n    const roof = this.P2P.place(this, "tree", "house/roof");\n    roof.setPosition(1, 2);\n    roof.setDepth(1);\n',
    );
    // The file has not loaded, so the placement is one part, under "house".
    const after = pass(text, sourceWith([{ id: "a", layerPath: "house" }]), records);
    expect(after.text).toBe(text);
    expect(records["a\u0000house/roof"].removed).toBeUndefined();
  });
});
