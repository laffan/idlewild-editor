/**
 * The scan behind ⌘F and ⇧⌘F's frontend half.
 *
 * Plain substring rather than a regular expression, because the thing people
 * look for in this tree is `config.scenes` or `place(` — and a box that
 * quietly reads those as patterns answers a question nobody asked. What is
 * pinned here is that, that matches do not overlap, and that a case-insensitive
 * search still reports offsets into the document rather than into the
 * lower-cased copy of it.
 */

import { describe, expect, it } from "vitest";
import { findMatches, MAX_MATCHES } from "../find-matches";

const at = (doc: string, query: string, caseSensitive = false) =>
  findMatches(doc, query, caseSensitive).map((m) => [m.from, m.to]);

describe("finding a string in the open file", () => {
  it("answers with every place it appears, in document order", () => {
    expect(at("place, place", "place")).toEqual([
      [0, 5],
      [7, 12],
    ]);
  });

  /** "Next" means the next one along, not the next character along. */
  it("does not report overlapping matches", () => {
    expect(at("aaaa", "aa")).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });

  it("ignores case unless asked not to", () => {
    expect(at("Scene scene", "scene")).toHaveLength(2);
    expect(at("Scene scene", "scene", true)).toEqual([[6, 11]]);
  });

  /**
   * The offsets are into the document, not into the folded copy the scan
   * walks — a match reported one place to the left would select the wrong
   * characters, which is the one failure a Find cannot get away with.
   */
  it("reports offsets into the document it was given", () => {
    expect(at("// Scene\nconst scene = 1", "SCENE")).toEqual([
      [3, 8],
      [15, 20],
    ]);
  });

  it("has no answers for an empty query, rather than one per character", () => {
    expect(at("place", "")).toEqual([]);
  });

  /**
   * A file of one repeated character is a file somebody generated. A panel
   * that stops answering is better than one that stops responding.
   */
  it("stops at the cap", () => {
    expect(findMatches("x".repeat(MAX_MATCHES + 50), "x", false)).toHaveLength(
      MAX_MATCHES,
    );
  });
});
