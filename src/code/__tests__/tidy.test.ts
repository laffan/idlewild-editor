/**
 * Tidy: what it can read, what it does to a file, and what it must not touch.
 *
 * The last of those is the one that would go wrong quietly. A scaffolded file
 * has runs the editor owns, and a line is the editor's only while it is still
 * one of the lines the scaffold wrote — so a tidy that reprints an owned line
 * does not break the file, it dissolves the block, and nothing on screen says
 * so until a Reset has nothing to put back.
 */

import { describe, expect, it } from "vitest";
import { ownedLinesSurvive, parserFor, tidy, tidyable } from "../tidy";

describe("what Tidy can read", () => {
  it("knows a parser for the four kinds of file in a project", () => {
    expect(parserFor("js/main.js")).toBe("babel");
    expect(parserFor("js/game.config.json")).toBe("json");
    expect(parserFor("styles.css")).toBe("css");
    expect(parserFor("index.html")).toBe("html");
    expect(parserFor("README.md")).toBe("markdown");
  });

  it("has nothing to offer a file that is not text it knows", () => {
    expect(parserFor("assets/tower/sprites/roof.png")).toBeNull();
    expect(tidyable("assets/tower/sprites/roof.png")).toBe(false);
    expect(tidyable("js/shared/grid.js")).toBe(true);
  });
});

describe("what it does to a file", () => {
  it("reprints the code rather than only fixing its left edge", async () => {
    const before = "const box={x:1,  y:2}\nfunction wide (a,b){return a+b}\n";
    const after = await tidy("js/main.js", before);
    expect(after).toBe(
      'const box = { x: 1, y: 2 };\nfunction wide(a, b) {\n  return a + b;\n}\n',
    );
  });

  it("throws for a file that does not parse, naming what it found", async () => {
    await expect(tidy("js/main.js", "function broken( {\n")).rejects.toThrow();
  });

  it("answers null where there is no parser at all", async () => {
    expect(await tidy("assets/tower/data.json.png", "not code")).toBeNull();
  });
});

describe("the editor's own lines", () => {
  const before = [
    "// idlewild:begin placeDocument",
    "placeDocument() {",
    "  this.doc.place(this);",
    "}",
    "// idlewild:end placeDocument",
    "const mine   = 1",
  ].join("\n");

  /** Line numbers are 1-based, as `managed-blocks.ts` counts them. */
  const owned = new Set([1, 2, 3, 4, 5]);

  it("survive a tidy that only reflowed the user's own lines", () => {
    const after = before.replace("const mine   = 1", "const mine = 1;");
    expect(ownedLinesSurvive(before, after, owned)).toBe(true);
  });

  /**
   * Indentation is Prettier's to decide and the scaffold's own anyway, so a
   * block that moved sideways is still the same block.
   */
  it("survive being indented, because the text is what is owned", () => {
    const after = before
      .split("\n")
      .map((line) => `    ${line}`)
      .join("\n");
    expect(ownedLinesSurvive(before, after, owned)).toBe(true);
  });

  it("do not survive a line being reprinted", () => {
    const after = before.replace("this.doc.place(this);", "this.doc.place(this)");
    expect(ownedLinesSurvive(before, after, owned)).toBe(false);
  });

  it("do not survive coming out in a different order", () => {
    const after = [
      "// idlewild:begin placeDocument",
      "placeDocument() {",
      "}",
      "  this.doc.place(this);",
      "// idlewild:end placeDocument",
    ].join("\n");
    expect(ownedLinesSurvive(before, after, owned)).toBe(false);
  });

  it("are nothing to check in a file the editor does not own", () => {
    expect(ownedLinesSurvive(before, "anything at all", new Set())).toBe(true);
  });
});
