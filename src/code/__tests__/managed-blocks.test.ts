import { describe, expect, it } from "vitest";
import {
  addMissingBlocks,
  analyse,
  isGenerated,
  resetBlock,
} from "../managed-blocks";

/** The shape a scaffolded file has: a marked run among unmarked code. */
const SCAFFOLD = [
  "import config from './game.config.json';",
  "",
  "// idlewild:begin placeDocument",
  "placeDocument() {",
  "  for (const layer of config.layers ?? []) {",
  "    this.paint(layer);",
  "  }",
  "}",
  "// idlewild:end placeDocument",
  "",
  "spawn() {",
  "  this.character = this.add.rectangle(0, 0, 8, 8);",
  "}",
].join("\n");

const owned = (text: string, canonical = SCAFFOLD) =>
  [...analyse("js/WorldScene.js", text, canonical).owned].sort((a, b) => a - b);

describe("managed blocks", () => {
  it("owns a marked run, markers included, and nothing outside it", () => {
    expect(owned(SCAFFOLD)).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  it("owns nothing when there is no scaffold to compare against", () => {
    const managed = analyse("js/mine.js", SCAFFOLD, null);
    expect(managed.owned.size).toBe(0);
    expect(managed.blocks.every((b) => !b.resettable)).toBe(true);
  });

  it("leaves a line inserted inside a block to the user", () => {
    const lines = SCAFFOLD.split("\n");
    lines.splice(5, 0, "  console.log('layers', config.layers);");
    const text = lines.join("\n");

    // Line 6 is the inserted one. Everything the scaffold wrote is still the
    // editor's, shifted down past it.
    expect(owned(text)).toEqual([3, 4, 5, 7, 8, 9, 10]);
  });

  it("does not disown the rest of a block after an insertion", () => {
    const lines = SCAFFOLD.split("\n");
    lines.splice(4, 0, "  // mine");
    lines.splice(8, 0, "  // also mine");
    const managed = analyse("js/WorldScene.js", lines.join("\n"), SCAFFOLD);
    // Seven scaffold lines, still seven, with two of the user's between them.
    expect(managed.owned.size).toBe(7);
    expect(managed.owned.has(5)).toBe(false);
    expect(managed.owned.has(9)).toBe(false);
  });

  it("ignores a begin with no end rather than locking the rest of the file", () => {
    const text = ["// idlewild:begin orphan", "doSomething();"].join("\n");
    const managed = analyse("js/WorldScene.js", text, text);
    expect(managed.blocks).toEqual([]);
    expect(managed.owned.size).toBe(0);
  });

  it("offers no reset for a block the scaffold does not have", () => {
    const text = [
      "// idlewild:begin invented",
      "mine();",
      "// idlewild:end invented",
    ].join("\n");
    const managed = analyse("js/WorldScene.js", text, SCAFFOLD);
    expect(managed.blocks).toEqual([
      { id: "invented", from: 1, to: 3, resettable: false },
    ]);
    expect(managed.owned.size).toBe(0);
  });

  it("treats the generated config as the editor's from end to end", () => {
    expect(isGenerated("js/game.config.json")).toBe(true);
    const config = '{\n  "grid": 64\n}';
    const managed = analyse("js/game.config.json", config, config);
    expect(managed.generated).toBe(true);
    expect([...managed.owned]).toEqual([1, 2, 3]);
    expect(managed.blocks[0].resettable).toBe(true);
  });

  it("puts a block back, dropping what was added inside it", () => {
    const lines = SCAFFOLD.split("\n");
    lines.splice(5, 0, "  console.log('mine');");
    const reset = resetBlock(
      "js/WorldScene.js",
      lines.join("\n"),
      SCAFFOLD,
      "placeDocument",
    );
    expect(reset).toBe(SCAFFOLD);
  });

  it("leaves everything outside the block alone when resetting", () => {
    const edited = SCAFFOLD.replace(
      "  this.character = this.add.rectangle(0, 0, 8, 8);",
      "  this.character = this.add.sprite(0, 0, 'hero');",
    ).replace("    this.paint(layer);", "    this.paintDifferently(layer);");

    const reset = resetBlock(
      "js/WorldScene.js",
      edited,
      SCAFFOLD,
      "placeDocument",
    );
    expect(reset).toContain("this.add.sprite(0, 0, 'hero')");
    expect(reset).toContain("    this.paint(layer);");
    expect(reset).not.toContain("paintDifferently");
  });

  it("regenerates a generated file wholesale", () => {
    const fresh = '{\n  "grid": 32\n}';
    expect(resetBlock("js/game.config.json", "{}", fresh, "anything")).toBe(fresh);
  });

  it("reports nothing to reset for an id neither side has", () => {
    expect(resetBlock("js/WorldScene.js", SCAFFOLD, SCAFFOLD, "nope")).toBeNull();
  });
});

/**
 * A project's `game/` tree is its own copy, so a template that gains a block
 * can never reach a project made before it — and Reset cannot help, because
 * there is nothing there to put back. This is not hypothetical:
 * `WorldScene.js` gained `drawOrder` and `applyDepth` when the exported game
 * learned to stack a PSD the right way up.
 */
describe("blocks the template has and the file does not", () => {
  /** The scaffold, after it grew a helper in front of the block using it. */
  const GROWN = [
    "import config from './game.config.json';",
    "",
    "// idlewild:begin drawOrder",
    "function drawOrder(placements) {",
    "  return placements;",
    "}",
    "// idlewild:end drawOrder",
    "",
    "// idlewild:begin placeDocument",
    "placeDocument() {",
    "  for (const p of drawOrder(config.layers)) this.paint(p);",
    "}",
    "// idlewild:end placeDocument",
    "",
    "spawn() {",
    "  this.character = this.add.rectangle(0, 0, 8, 8);",
    "}",
  ].join("\n");

  /** The same project's file, made before the helper existed. */
  const OLD = [
    "import config from './game.config.json';",
    "",
    "// idlewild:begin placeDocument",
    "placeDocument() {",
    "  console.log('mine');",
    "  for (const p of config.layers) this.paint(p);",
    "}",
    "// idlewild:end placeDocument",
    "",
    "spawn() {",
    "  this.character = this.add.sprite(0, 0, 'hero');",
    "}",
  ].join("\n");

  it("names them, so the modal can offer to put them in", () => {
    expect(analyse("js/WorldScene.js", OLD, GROWN).missing).toEqual(["drawOrder"]);
    expect(analyse("js/WorldScene.js", GROWN, GROWN).missing).toEqual([]);
  });

  it("names none when there is no scaffold to compare against", () => {
    expect(analyse("js/mine.js", OLD, null).missing).toEqual([]);
  });

  it("puts a missing block beside the code that calls it", () => {
    const fixed = addMissingBlocks(OLD, GROWN);
    expect(fixed).not.toBeNull();
    if (!fixed) return;

    const lines = fixed.split("\n");
    const helper = lines.indexOf("// idlewild:begin drawOrder");
    const caller = lines.indexOf("// idlewild:begin placeDocument");
    // In front of `placeDocument`, where the scaffold has it — not appended
    // at the end of the file, below the code that uses it.
    expect(helper).toBeGreaterThan(-1);
    expect(helper).toBeLessThan(caller);

    // And nothing of the user's was touched on the way in.
    expect(fixed).toContain("console.log('mine');");
    expect(fixed).toContain("this.add.sprite(0, 0, 'hero')");
    expect(analyse("js/WorldScene.js", fixed, GROWN).missing).toEqual([]);
  });

  it("adds a run of them in the order the scaffold has them", () => {
    const grown = [
      "// idlewild:begin one",
      "const one = 1;",
      "// idlewild:end one",
      "// idlewild:begin two",
      "const two = 2;",
      "// idlewild:end two",
      "// idlewild:begin three",
      "const three = 3;",
      "// idlewild:end three",
    ].join("\n");
    const mine = ["// idlewild:begin three", "const three = 3;", "// idlewild:end three"].join("\n");

    const fixed = addMissingBlocks(mine, grown) ?? "";
    const order = analyse("js/WorldScene.js", fixed, grown).blocks.map((b) => b.id);
    expect(order).toEqual(["one", "two", "three"]);
  });

  it("appends when the file shares no block to position against", () => {
    const fixed = addMissingBlocks("const mine = 1;\n", GROWN) ?? "";
    expect(fixed).toContain("const mine = 1;");
    expect(analyse("js/WorldScene.js", fixed, GROWN).missing).toEqual([]);
  });

  it("has nothing to say about a file that is already whole", () => {
    expect(addMissingBlocks(GROWN, GROWN)).toBeNull();
  });
});
