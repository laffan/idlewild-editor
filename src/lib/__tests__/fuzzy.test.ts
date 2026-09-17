/**
 * The matcher behind the repository picker.
 *
 * What is worth pinning is not "does it match" — a subsequence match nearly
 * always does — but the **ordering**, because with three letters typed half a
 * hundred repositories are a legal match and only one of them is the answer.
 * Each test below is a case where the obvious implementation ranks the wrong
 * one first.
 */

import { describe, expect, it } from "vitest";
import { fuzzyMatch, fuzzyRank, highlight } from "../fuzzy";

const best = (query: string, names: string[]) =>
  fuzzyRank(names, query, (name) => name).map(({ item }) => item);

describe("finding a repository by the letters you remember", () => {
  it("matches letters in order, not as a substring", () => {
    expect(fuzzyMatch("iwed", "laffan/idlewild-editor")).not.toBeNull();
    expect(fuzzyMatch("idlewild", "laffan/idlewild-editor")).not.toBeNull();
    // Out of order is not a match at all. (`dlei` *is* in `idlewild` — d, l,
    // e, then the second i — so the example has to be one that really is not.)
    expect(fuzzyMatch("dei", "idle")).toBeNull();
    expect(fuzzyMatch("zz", "idlewild")).toBeNull();
  });

  it("ignores case, and treats a space as 'and also' rather than a character", () => {
    expect(fuzzyMatch("IDLE", "laffan/idlewild-editor")).not.toBeNull();
    expect(fuzzyMatch("idle wild", "idlewild-editor")).not.toBeNull();
  });

  /** An empty box is the whole list in the order it arrived, not no list. */
  it("matches everything with nothing typed", () => {
    expect(fuzzyMatch("", "anything")?.score).toBe(0);
    expect(best("", ["b", "a", "c"])).toEqual(["b", "a", "c"]);
  });

  it("puts a run of letters above the same letters scattered", () => {
    expect(best("ide", ["i-d-e-a", "ideal"])[0]).toBe("ideal");
  });

  /** `ie` should find `idlewild-editor`, not `pipeline`. */
  it("puts letters that start words above letters inside them", () => {
    expect(best("ie", ["pipeline", "idlewild-editor"])[0]).toBe("idlewild-editor");
    expect(best("ie", ["pipeline", "idlewildEditor"])[0]).toBe("idlewildEditor");
  });

  it("prefers a match near the front, gently", () => {
    expect(best("game", ["old-game", "game-engine"])[0]).toBe("game-engine");
  });

  /**
   * A longer match always wins: typing more letters must never demote the row
   * you were typing towards, which is the one behaviour that makes a fuzzy box
   * feel broken.
   */
  it("scores a longer match above a shorter one", () => {
    const short = fuzzyMatch("id", "idlewild")?.score ?? 0;
    const long = fuzzyMatch("idlew", "idlewild")?.score ?? 0;
    expect(long).toBeGreaterThan(short);
  });
});

describe("showing why a row matched", () => {
  it("splits the name into matched and unmatched stretches", () => {
    const pieces = highlight("idlewild", fuzzyMatch("ide", "idlewild")?.hits ?? []);
    expect(pieces.map((piece) => piece.text).join("")).toBe("idlewild");
    expect(
      pieces
        .filter((piece) => piece.hit)
        .map((piece) => piece.text)
        .join(""),
    ).toBe("ide");
  });

  /** Runs are joined, so three adjacent hits are one `mark` rather than three. */
  it("joins adjacent hits into one stretch", () => {
    expect(highlight("abcd", [0, 1, 2])).toEqual([
      { text: "abc", hit: true },
      { text: "d", hit: false },
    ]);
  });

  it("has nothing to mark when nothing matched", () => {
    expect(highlight("abc", [])).toEqual([{ text: "abc", hit: false }]);
  });
});
