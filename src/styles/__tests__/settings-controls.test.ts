/**
 * The settings vocabulary's in-row controls, and the hint bubble.
 *
 * Three claims, each of which fails silently rather than loudly.
 *
 * A control in a row is **sized to the row**, not to a form. `.option-btn`
 * settled that at 30px and every control added since has to agree with it: one
 * that came in at a form's 42px would make the row half again as tall, and a
 * settings list whose rows are all different heights is a list nobody can run
 * their eye down. Nothing throws when that drifts; the sheet just gets worse.
 *
 * A pressed segment and a switch that is on are the **settings system's**
 * accent (`--opt-accent`), which is the token that flips between the editor's
 * dark chrome and the home screen's paper. A colour written in by hand would
 * look right on whichever surface it was written against and wrong on the
 * other, and New Project is on the light one while the Logins sheet is on the
 * dark one.
 *
 * And the bubble is `position: fixed`. Every group in this system is
 * `overflow: hidden` — that is what gives a card its corners — and a sheet's
 * body scrolls, so a hint laid out inside its row would be clipped by the
 * first of those and left behind by the second. That is the one of the three
 * that is not a matter of taste: it is the difference between an explanation
 * and a sliver of one.
 */

import { describe, expect, it } from "vitest";
import optionsCss from "../options.css?raw";
import controlsCss from "../controls.css?raw";
import sheetsCss from "../sheets.css?raw";
import menuCss from "../menu.css?raw";
import { ruleIn } from "./rules";

/** What `.option-btn` settled, and what everything beside it has to match. */
const ROW_CONTROL_HEIGHT = "30px";

describe("a control inside an options row", () => {
  it("is the height the row's own buttons already are", () => {
    expect(ruleIn(optionsCss, ".option-btn")["min-height"]).toBe(ROW_CONTROL_HEIGHT);
    for (const selector of [".opt-seg-btn", ".opt-number", ".opt-swatch", ".opt-text"]) {
      expect(ruleIn(optionsCss, selector)["min-height"]).toBe(ROW_CONTROL_HEIGHT);
    }
  });

  /**
   * The switch is the one that is not 30px, and deliberately: it is a track a
   * knob slides in rather than a box with a label in it, and 26px is what
   * makes a 20px knob sit in one with 2px of track showing. Pinned so the
   * exception stays a decision rather than becoming a drift.
   */
  it("except the switch, which is a track rather than a box", () => {
    const track = ruleIn(optionsCss, ".opt-switch");
    const knob = ruleIn(optionsCss, ".opt-switch-knob");
    expect(track.height).toBe("26px");
    expect(knob.height).toBe("20px");
    expect(knob.top).toBe("2px");
  });

  it("does not let a control overflow the row it is in", () => {
    // `flex: none` on each, so a long title elides and the control keeps its
    // size — the other way round is a segmented control squashed to nothing
    // by a row whose name happens to be long.
    for (const selector of [".opt-seg", ".opt-switch", ".opt-number-wrap", ".opt-swatch", ".opt-text"]) {
      expect(ruleIn(optionsCss, selector).flex).toBe("none");
    }
  });
});

describe("what a chosen answer is coloured with", () => {
  it("takes the settings system's accent rather than a colour of its own", () => {
    expect(ruleIn(optionsCss, '.opt-seg-btn[aria-pressed="true"]').background).toBe(
      "var(--opt-accent)",
    );
    const on = ruleIn(optionsCss, '.opt-switch[aria-checked="true"]');
    expect(on.background).toBe("var(--opt-accent)");
    expect(on["border-color"]).toBe("var(--opt-accent)");
  });
});

describe("the hint bubble", () => {
  /**
   * The group it is opened from clips, and the body it is in scrolls. Fixed
   * and parented to `document.body` is the only position that survives both —
   * see `lib/tooltip.ts`, which places it from the trigger's rectangle.
   */
  it("is fixed, so no options group can clip it", () => {
    expect(ruleIn(controlsCss, ".tip").position).toBe("fixed");
  });

  /**
   * Above the sheet it was opened from *and* above a menu, which is the other
   * thing in this app that floats. A hint opened from a row inside a sheet is
   * the innermost thing on screen and has to be drawn as such.
   */
  it("sits over the sheet it was opened from, and over a menu", () => {
    const tip = Number(ruleIn(controlsCss, ".tip")["z-index"]);
    expect(tip).toBeGreaterThan(Number(ruleIn(sheetsCss, ".sheet-backdrop")["z-index"]));
    expect(tip).toBeGreaterThan(Number(ruleIn(menuCss, ".menu")["z-index"]));
  });

  /**
   * It explains the row under it, so it must never be the thing the next tap
   * lands on — a bubble that ate the press meant for the control it describes
   * would be worse than no bubble.
   */
  it("never takes a press", () => {
    expect(ruleIn(controlsCss, ".tip")["pointer-events"]).toBe("none");
  });
});
