/**
 * The little bit of Markdown a note understands.
 *
 * The value of a parser like this is almost entirely in what it *refuses* to
 * do. A mark that helps when you meant it is pleasant; a mark that fires when
 * you did not is a field you have to escape your way out of, in an editor
 * where the text is three words long and there is nowhere to put an escape.
 * So most of these are about arithmetic staying arithmetic and names staying
 * names.
 */

import { describe, expect, it } from "vitest";
import { isPlain, parseSpans, plainText } from "../text-markdown";

/** A compact reading of the runs: `B`, `I`, `U` before each one's text. */
function read(line: string): string {
  return parseSpans(line)
    .map(
      (span) =>
        `${span.bold ? "B" : ""}${span.italic ? "I" : ""}` +
        `${span.underline ? "U" : ""}[${span.text}]`,
    )
    .join("");
}

describe("the three marks", () => {
  it("reads bold, italic and underline", () => {
    expect(read("**bold**")).toBe("B[bold]");
    expect(read("*italic*")).toBe("I[italic]");
    expect(read("_italic_")).toBe("I[italic]");
    expect(read("<u>under</u>")).toBe("U[under]");
  });

  it("leaves plain words alone", () => {
    expect(read("plain words")).toBe("[plain words]");
    expect(isPlain(parseSpans("plain words"))).toBe(true);
    expect(isPlain(parseSpans("**bold**"))).toBe(false);
  });

  it("keeps the words between the marks", () => {
    expect(read("a **big** door")).toBe("[a ]B[big][ door]");
  });

  it("nests, in either order", () => {
    expect(read("**bold *and italic***")).toBe("B[bold ]BI[and italic]");
    expect(read("*italic **and bold***")).toBe("I[italic ]BI[and bold]");
    expect(read("***both***")).toBe("BI[both]");
  });
});

describe("what it refuses", () => {
  /** The one that would make the feature a nuisance rather than a help. */
  it("leaves arithmetic alone", () => {
    expect(read("2 * 3 * 4")).toBe("[2 * 3 * 4]");
    expect(read("a * b")).toBe("[a * b]");
  });

  /** CommonMark's own rule, and the reason it has one. */
  it("leaves an underscore inside a word alone", () => {
    expect(read("_under_score_")).toBe("I[under_score]");
    expect(read("game_config.json")).toBe("[game_config.json]");
  });

  /**
   * A mark with no partner is a character. Crucially the runs it opened lose
   * the emphasis it was claiming — `a **thing` is four plain words, not a bold
   * one behind a literal `**`.
   */
  it("reads an unmatched mark as the characters it is", () => {
    expect(read("a **thing")).toBe("[a **thing]");
    expect(read("*")).toBe("[*]");
    expect(read("<u>never closed")).toBe("[<u>never closed]");
  });

  /** A fence with a space inside it does not close, which is Markdown's rule. */
  it("does not close a fence across a space", () => {
    expect(read("**bold **")).toBe("[**bold **]");
  });

  /**
   * A line at a time. A `**` left dangling at the end of one line is a typo,
   * not a request to embolden everything under it — and a parser that scanned
   * across the newline would make one stray asterisk change the whole note.
   */
  it("does not carry a mark across a newline", () => {
    expect(read("**start")).toBe("[**start]");
    expect(read("end**")).toBe("[end**]");
  });

  it("has nothing to say about an empty line", () => {
    expect(parseSpans("")).toEqual([]);
    expect(isPlain(parseSpans(""))).toBe(true);
  });
});

describe("reading the words back", () => {
  it("strips every mark", () => {
    expect(plainText("**door** to the *cave*")).toBe("door to the cave");
    expect(plainText("<u>boss</u> here")).toBe("boss here");
  });

  it("keeps the characters an unmatched mark turned back into", () => {
    expect(plainText("2 * 3")).toBe("2 * 3");
    expect(plainText("a **thing")).toBe("a **thing");
  });
});
