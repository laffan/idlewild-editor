/**
 * What the editor's own settings read as, given whatever is in the store.
 *
 * A preference store is the one input nothing validates on the way in: it is
 * a string somebody's browser has been holding since a version of this app
 * that had two of these three settings, and it comes back parsed into
 * whatever it happens to be. So the reading is total — every missing, wrong
 * or out-of-range value has an answer — and that is what is asserted here,
 * rather than the round trip, which is `JSON.stringify`.
 */

import { describe, expect, it } from "vitest";
import {
  CODE_SETTINGS_DEFAULTS,
  clampTextSize,
  codeSettings,
  TEXT_SIZE_RANGE,
} from "../code-settings";

describe("the type size", () => {
  it("is held inside what the editor can draw", () => {
    expect(clampTextSize(13)).toBe(13);
    expect(clampTextSize(2)).toBe(TEXT_SIZE_RANGE.min);
    expect(clampTextSize(400)).toBe(TEXT_SIZE_RANGE.max);
  });

  it("is a whole number of pixels", () => {
    expect(clampTextSize(13.4)).toBe(13);
    expect(clampTextSize("15")).toBe(15);
  });

  it("falls back rather than throwing for something that is not a size", () => {
    expect(clampTextSize("large")).toBe(CODE_SETTINGS_DEFAULTS.textSize);
    expect(clampTextSize(null)).toBe(CODE_SETTINGS_DEFAULTS.textSize);
    expect(clampTextSize(undefined)).toBe(CODE_SETTINGS_DEFAULTS.textSize);
  });
});

describe("reading the store", () => {
  it("answers the defaults for an install that has never said anything", () => {
    expect(codeSettings(null)).toEqual(CODE_SETTINGS_DEFAULTS);
    expect(codeSettings({})).toEqual(CODE_SETTINGS_DEFAULTS);
  });

  /**
   * Tidy is the one that is off by default, and deliberately: it rewrites the
   * whole file, and a setting that reformats somebody's code the first time
   * they press ⌘S is one that has to be asked for.
   */
  it("leaves Tidy off unless it was asked for", () => {
    expect(codeSettings({}).tidyOnSave).toBe(false);
    expect(codeSettings({ tidyOnSave: true }).tidyOnSave).toBe(true);
    expect(codeSettings({ tidyOnSave: "yes" }).tidyOnSave).toBe(false);
  });

  it("keeps one hint source when the other is missing", () => {
    expect(codeSettings({ hints: { phaser: false } }).hints).toEqual({
      phaser: false,
      js: true,
    });
  });

  it("takes what it understands out of a value of the wrong shape", () => {
    const held = codeSettings({ textSize: 999, hints: "both", tidyOnSave: 1 });
    expect(held.textSize).toBe(TEXT_SIZE_RANGE.max);
    expect(held.hints).toEqual(CODE_SETTINGS_DEFAULTS.hints);
    expect(held.tidyOnSave).toBe(false);
  });

  it("does not hand back the defaults object itself", () => {
    const held = codeSettings({});
    held.hints.phaser = false;
    expect(CODE_SETTINGS_DEFAULTS.hints.phaser).toBe(true);
  });
});
