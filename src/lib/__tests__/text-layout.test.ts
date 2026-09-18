/**
 * Breaking a note into lines, and measuring what comes out.
 *
 * Written against a **fake ruler** — every character ten wide, bold twelve —
 * which is not a shortcut. Line breaking is arithmetic over widths, and a real
 * font would make every expected number a magic one nobody could check by
 * reading. What is being tested is where the breaks fall given the widths, and
 * a ruler you can do in your head is the only way to say that out loud.
 *
 * The bold ruler matters for one case: a run of emphasis measures differently
 * from the same characters plain, so a layout that broke lines on the plain
 * width would overflow a column the moment somebody emboldened a word.
 */

import { describe, expect, it } from "vitest";
import { layout, leadingOf, DEFAULT_LINE_HEIGHT, type Ruler } from "../text-layout";

/** Ten pixels a character, twelve when it is bold. */
const ruler: Ruler = (text, bold) => text.length * (bold ? 12 : 10);

/** The words of each line, joined — what the reader would see. */
function lines(text: string, wrapWidth?: number): string[] {
  return layout({ text, size: 10, wrapWidth }, ruler).lines.map((line) =>
    line.spans.map((span) => span.text).join(""),
  );
}

describe("lines", () => {
  it("breaks on the newlines somebody typed", () => {
    expect(lines("door\nto the cave")).toEqual(["door", "to the cave"]);
  });

  it("never breaks a long line when there is no column", () => {
    expect(lines("a very long line indeed")).toEqual(["a very long line indeed"]);
  });

  /** An empty note is one line tall: no box means no outline and no canvas. */
  it("is one line even with nothing in it", () => {
    expect(lines("")).toEqual([""]);
    expect(layout({ text: "", size: 10 }, ruler).height).toBe(
      Math.round(10 * DEFAULT_LINE_HEIGHT),
    );
  });
});

describe("wrapping", () => {
  it("breaks between words at the column", () => {
    // "aaa " is 40 and "bbb" is 30, so 60 takes one word a line.
    expect(lines("aaa bbb", 60)).toEqual(["aaa ", "bbb"]);
    expect(lines("aaa bbb", 200)).toEqual(["aaa bbb"]);
  });

  /**
   * The break eats its own space. A wrapped line starting with the space that
   * caused the break would be indented by one character for no reason anybody
   * typed.
   */
  it("does not start a line with the space it broke on", () => {
    for (const line of lines("aaaa bbbb cccc", 50)) {
      expect(line.startsWith(" ")).toBe(false);
    }
  });

  /**
   * Hyphenation is a language's business and a URL cut in half is worse than
   * one that overhangs, so a word wider than the column is left over the edge.
   */
  it("leaves a word longer than the column alone", () => {
    expect(lines("supercalifragilistic", 50)).toEqual(["supercalifragilistic"]);
  });

  /**
   * A run of emphasis measures differently from the same characters plain, so
   * a layout that broke on the plain width would overflow the moment somebody
   * emboldened a word. The same six characters come to 60 plain and 66 with
   * the first three bold, so a column of 62 holds one and breaks the other.
   */
  it("breaks on the width the emphasis actually measures", () => {
    expect(lines("aaa bb", 62)).toEqual(["aaa bb"]);
    expect(lines("**aaa** bb", 62)).toEqual(["aaa ", "bb"]);
  });

  /** A span that straddles a break is written into both lines, still bold. */
  it("carries emphasis across a break", () => {
    const laid = layout({ text: "**aaa bbb**", size: 10, wrapWidth: 60 }, ruler);
    expect(laid.lines).toHaveLength(2);
    for (const line of laid.lines) {
      expect(line.spans.every((span) => span.bold)).toBe(true);
    }
  });

  /**
   * The box takes the column's width even when no line reaches it. That is
   * what makes the handle on the canvas mean something: the box is the column
   * somebody set, so it stays still while the words inside it change.
   */
  it("is as wide as the column, not as the longest line", () => {
    expect(layout({ text: "a", size: 10, wrapWidth: 300 }, ruler).width).toBe(300);
  });

  it("is as wide as its longest line when there is no column", () => {
    expect(layout({ text: "abc\na", size: 10 }, ruler).width).toBe(30);
  });
});

describe("the leading", () => {
  it("is the usual ratio when the note has not said", () => {
    expect(leadingOf({ text: "", size: 20 })).toBe(20 * DEFAULT_LINE_HEIGHT);
  });

  it("is the note's own when it has", () => {
    expect(leadingOf({ text: "", size: 20, lineHeight: 2 })).toBe(40);
  });

  it("is what the height is counted in", () => {
    const laid = layout({ text: "a\nb\nc", size: 20, lineHeight: 1.5 }, ruler);
    expect(laid.height).toBe(90);
  });
});

describe("where a run sits on its line", () => {
  it("lays the runs end to end", () => {
    const laid = layout({ text: "ab**cd**", size: 10 }, ruler);
    const [line] = laid.lines;
    expect(line.spans.map((span) => [span.text, span.x, span.width])).toEqual([
      ["ab", 0, 20],
      ["cd", 20, 24],
    ]);
    expect(line.width).toBe(44);
  });
});
