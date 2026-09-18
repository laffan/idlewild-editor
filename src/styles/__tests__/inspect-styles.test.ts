/**
 * The properties sidebar's own stylesheet, asserted.
 *
 * Split out of `styles.test.ts`, which had reached the line limit — and the
 * split is the one the stylesheets themselves make: `inspect.css` is the right
 * sidebar, where whatever is in your hand and whatever is under it are
 * described, and it is now most of what there is to assert about this app's
 * chrome. Everything in here is a declaration with nothing in the code to
 * notice its absence: `editor/inspect-collapse.ts` adds a `collapsed` class
 * and lets the stylesheet decide what that means, and the panels build rows
 * and bars and let it decide how wide they are.
 */

import { describe, expect, it } from "vitest";
import inspectCss from "../inspect.css?raw";
import { ruleIn } from "./rules";

/**
 * A named inspector section folds away, and the two rules that make the fold
 * a fold rather than a class nobody reads are here rather than in code — the
 * pass in `editor/inspect-collapse.ts` only adds `collapsed` and lets the
 * stylesheet decide what that means.
 */
describe("the inspector's folded sections", () => {
  it("hides everything but the heading", () => {
    const folded = ruleIn(
      inspectCss,
      ".inspect-section.collapsed > *:not(.inspect-section-fold)",
    );
    expect(folded.display).toBe("none");
  });

  it("gives the heading a caret that turns when it is shut", () => {
    // Two borders on a square turned 45°: down is open, and a quarter turn
    // anticlockwise is shut. No asset, and nothing to line up.
    expect(ruleIn(inspectCss, ".inspect-section-fold::after").transform).toBe(
      "rotate(45deg)",
    );
    expect(
      ruleIn(inspectCss, ".inspect-section.collapsed > .inspect-section-fold::after")
        .transform,
    ).toBe("rotate(-45deg)");
  });

  /**
   * A heading can carry a subject after a colon — `BRUSH : INK` — which makes
   * it two spans rather than one. `space-between` would then put the subject
   * in the middle of the row with the caret past it; the caret has to take the
   * free space instead, or the heading reads as two unrelated words.
   */
  it("keeps the caret at the end of a heading that carries a subject", () => {
    const fold = ruleIn(inspectCss, ".inspect-section-fold");
    expect(fold["justify-content"]).toBe("flex-start");
    expect(ruleIn(inspectCss, ".inspect-section-fold::after")["margin-left"]).toBe(
      "auto",
    );
  });

  /**
   * The heading is the panel's full text colour, and the caret is not.
   *
   * A heading that is also the control for folding a section is the thing a
   * reader scans this column for, and it used to be the dimmest text in it.
   * Turning it up is half the fix; the other half is keeping the caret where
   * it was, because eight full-strength arrows down the right-hand edge would
   * be louder than the eight names they belong to. The caret sets its own
   * `color` rather than inheriting, so the two are asserted together — one
   * without the other is the version of this that looked worse.
   */
  it("sets the heading in the panel's own ink and leaves the caret quiet", () => {
    expect(ruleIn(inspectCss, ".inspect-section-title").color).toBe(
      "var(--chrome-text)",
    );
    expect(ruleIn(inspectCss, ".inspect-section-fold::after").color).toBe(
      "var(--chrome-dim)",
    );
  });
});

/**
 * The inspector's controls, laid out for a 260px column rather than for a
 * settings sheet.
 *
 * Both of these are rules with nothing in the code to notice their absence.
 * The segmented control is shared with the sheets, where it sits at the end of
 * a row and is right to hug its own labels; here it is the whole line, and
 * without these two declarations `Left · Centre · Right` bunches against the
 * left edge with a third of the column empty beside it. The hidden row is
 * load-bearing in the stronger sense: `.inspect-row` sets `display: flex`,
 * which beats the user agent's `[hidden]`, so the text size's own field would
 * be permanently on screen with the menu above it saying the same number.
 */
describe("the inspector's controls", () => {
  it("spreads a segmented control across the column", () => {
    expect(ruleIn(inspectCss, ".side-panel .opt-seg").width).toBe("100%");
    const button = ruleIn(inspectCss, ".side-panel .opt-seg-btn");
    expect(button.flex).toBe("1");
    // Without this the two grid axes keep their own widths and come out
    // uneven the moment one arrow is wider than the other.
    expect(button["min-width"]).toBe("0");
  });

  it("hides a row the panel has drawn but is not showing", () => {
    expect(ruleIn(inspectCss, ".inspect-row[hidden]").display).toBe("none");
  });

  /**
   * The grid's two axes and Upright share a row and not an outline. Inside one
   * border the three would read as one choice of three, and pressing Upright
   * would look like it turned the axis off — so the control takes the slack
   * and the button keeps its own words, with a gap between the two outlines.
   */
  it("gives the axes the slack and leaves Upright its own width", () => {
    expect(ruleIn(inspectCss, ".inspect-bar").display).toBe("flex");
    expect(ruleIn(inspectCss, ".inspect-bar .opt-seg").flex).toBe("1");
    const button = ruleIn(inspectCss, ".inspect-bar .panel-btn");
    expect(button.flex).toBe("none");
    expect(button.width).toBe("auto");
  });
});

/**
 * The three zone headings fold too, and they are the one thing in this panel
 * that is not a section — so they need both halves: the fold itself, and
 * enough contrast to say which three headings are the structure. See
 * editor/inspect-zone.ts.
 */
describe("the inspector's zones", () => {
  it("folds the body away and turns the caret, as a section does", () => {
    expect(ruleIn(inspectCss, ".inspect-zone.collapsed > .inspect-zone-body").display)
      .toBe("none");
    expect(ruleIn(inspectCss, ".inspect-zone-head::after").transform).toBe(
      "rotate(45deg)",
    );
    expect(
      ruleIn(inspectCss, ".inspect-zone.collapsed > .inspect-zone-head::after")
        .transform,
    ).toBe("rotate(-45deg)");
  });

  it("marks the boundary more heavily than a section's", () => {
    // 2px is the system's heavy rule, and the only one in this panel: every
    // section boundary is 1px. Without the difference a column of foldable
    // headings has nothing in it that says which three are the structure.
    expect(ruleIn(inspectCss, ".inspect-zone")["border-top"]).toContain("2px");
    expect(ruleIn(inspectCss, ".inspect-section")["border-top"]).toContain("1px");
    expect(ruleIn(inspectCss, ".inspect-zone-head").background).toBeTruthy();
  });
});
