/**
 * What is offered as you type: which file gets it, and which part of the
 * Phaser reference answers.
 *
 * The prefix is the whole of the second question, and getting it wrong is not
 * visible: `this.input.` answering for `this.input.keyboard.` gives a list of
 * real Phaser members that are simply the wrong class's, which reads as the
 * reference being incomplete rather than as a bug. It is the same
 * longest-first match the docs panel makes when the caret lands — see
 * `docs/phaser-api.ts`.
 */

import { describe, expect, it } from "vitest";
import { firstSentence, hintExtensions, hintSection } from "../hints";

/** A reference that has every prefix the real one does. */
const everything = () => true;

describe("which section answers", () => {
  it("takes the longest prefix the text ends with", () => {
    expect(hintSection("this.", everything)).toBe("this.");
    expect(hintSection("this.add.", everything)).toBe("this.add.");
    expect(hintSection("this.input.", everything)).toBe("this.input.");
    expect(hintSection("this.input.keyboard.", everything)).toBe(
      "this.input.keyboard.",
    );
    expect(hintSection("  const s = this.physics.add.", everything)).toBe(
      "this.physics.add.",
    );
  });

  /**
   * Anything else ending in a dot is some object of the user's, and the
   * members every game object has are the best guess — the same fallback the
   * panel makes when it is following the caret.
   */
  it("falls back to the game-object members for an object of your own", () => {
    expect(hintSection("clouds.", everything)).toBe("gameobject");
    expect(hintSection("this.clouds.", everything)).toBe("gameobject");
  });

  /**
   * A reference that does not carry a prefix answers with the game-object
   * members rather than with a class it does not have — the same answer as
   * for an object of the user's, which is what an unknown expression is from
   * here.
   */
  it("skips a prefix the loaded reference does not carry", () => {
    expect(
      hintSection("this.tweens.", (prefix) => prefix !== "this.tweens."),
    ).toBe("gameobject");
  });
});

describe("which files are offered hints", () => {
  const both = { phaser: true, js: true };

  it("is JavaScript, and not a stylesheet or a page", () => {
    expect(hintExtensions("js/main.js", both).length).toBe(1);
    expect(hintExtensions("styles.css", both)).toEqual([]);
    expect(hintExtensions("index.html", both)).toEqual([]);
  });

  it("is nothing at all with both switches off", () => {
    expect(hintExtensions("js/main.js", { phaser: false, js: false })).toEqual([]);
  });

  it("is still offered with one of the two on", () => {
    expect(hintExtensions("js/main.js", { phaser: true, js: false }).length).toBe(1);
    expect(hintExtensions("js/main.js", { phaser: false, js: true }).length).toBe(1);
  });
});

describe("what a member says in the list", () => {
  it("is one sentence of its JSDoc, in plain text", () => {
    expect(
      firstSentence("Adds a Sprite. Only available if defined in the map.\n\nMore."),
    ).toBe("Adds a Sprite.");
  });

  it("keeps a description that is one sentence with no full stop", () => {
    expect(firstSentence("The Scene Game Object Factory")).toBe(
      "The Scene Game Object Factory",
    );
  });

  it("cuts one that would not fit on a line", () => {
    const long = `${"word ".repeat(60)}end`;
    const one = firstSentence(long);
    expect(one.length).toBeLessThanOrEqual(160);
    expect(one.endsWith("…")).toBe(true);
  });
});
