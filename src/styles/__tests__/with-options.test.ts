/**
 * The button with options — `lib/with-options-button.ts` — and the two rules
 * it leans on elsewhere.
 *
 * The action takes the row and the options half takes only what its marks
 * need, or a long label would squeeze the marks off the end. A checkbox row
 * in a menu is pressed as a whole, so the box inside it must not take the
 * press for itself: a click on the box would tick it natively *and* flip the
 * row, and the two would cancel out. And the slider knob is grey at rest —
 * a white dot on every slider was the brightest thing in the panel.
 */

import { describe, expect, it } from "vitest";
import controlsCss from "../controls.css?raw";
import menuCss from "../menu.css?raw";
import { ruleIn } from "./rules";
import { optionsShown } from "../../lib/with-options-button";

describe("a button with options", () => {
  it("gives the action the row and the options half its own width", () => {
    expect(ruleIn(controlsCss, ".with-options").display).toBe("flex");
    expect(ruleIn(controlsCss, ".with-options-main").flex).toBe("1");
    expect(ruleIn(controlsCss, ".with-options-main")["justify-content"]).toBe("flex-start");
    expect(ruleIn(controlsCss, ".with-options-more").flex).toBe("none");
  });

  it("marks only the options that are on, in the dropdown's order", () => {
    const option = (label: string, on: boolean) => ({
      label,
      glyph: "",
      on,
      onChange: () => {},
    });
    const shown = optionsShown([option("a", true), option("b", false), option("c", true)]);
    expect(shown.map((o) => o.label)).toEqual(["a", "c"]);
  });

  it("leaves a menu's checkbox to the row it is in", () => {
    expect(ruleIn(menuCss, '.menu-item.check input[type="checkbox"]')["pointer-events"]).toBe(
      "none",
    );
  });
});

describe("the slider knob", () => {
  it("is grey at rest rather than the panel's full ink", () => {
    const knob = ruleIn(controlsCss, 'input[type="range"]::-webkit-slider-thumb');
    expect(knob.background).toBe("var(--chrome-dim)");
  });
});
