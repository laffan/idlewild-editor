/**
 * Matching a file's layer pictures to the rows that show them.
 *
 * Edit Layers lists the file and takes a row's picture by index; the Code
 * directory lists what psd-to-json made of the file and takes it by manifest
 * path. The second is the one with arithmetic in it: a path is the exported
 * name of every row above it at each shallower depth, and a row the parser
 * ignores has no path, nor does anything inside it.
 */

import { describe, expect, it } from "vitest";
import { thumbsByPath } from "../psd-thumb-box";

const row = (name: string, depth: number, url = `u:${name}`) => ({ name, depth, url });

describe("layer thumbnails by manifest path", () => {
  it("names a nested layer by its group's exported name and its own", () => {
    const paths = thumbsByPath([
      row("P | anchor", 0),
      row("G | tower", 0),
      row("S | roof", 1),
      row("S | walls", 1),
      row("S | tree", 0),
    ]);
    expect(paths.get("tower")).toBe("u:G | tower");
    expect(paths.get("tower/roof")).toBe("u:S | roof");
    expect(paths.get("tower/walls")).toBe("u:S | walls");
    expect(paths.get("tree")).toBe("u:S | tree");
    expect(paths.get("anchor")).toBe("u:P | anchor");
  });

  it("gives nothing under a row the parser ignores a path", () => {
    const paths = thumbsByPath([row("notes", 0), row("S | inside", 1), row("S | after", 0)]);
    expect(paths.has("inside")).toBe(false);
    expect(paths.get("after")).toBe("u:S | after");
  });
});
