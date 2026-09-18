/**
 * Finding the typefaces this device has.
 *
 * The probe itself cannot be asserted here — there is no canvas in this
 * environment and no font book behind it, so `systemFonts` takes its documented
 * fallback. What *can* be pinned is everything around it, and each of these is
 * a way for a font picker to be quietly useless:
 *
 * - The fallback has to be the three generics rather than an empty list, or a
 *   device the probe cannot run on gets a picker with nothing in it.
 * - A family the document names and this device has not got still has to read
 *   as its own name, because the note is set to it and a panel that showed the
 *   fallback instead would be agreeing with something nobody chose.
 */

import { describe, expect, it } from "vitest";
import {
  CANDIDATES,
  GENERIC_FONTS,
  fontLabel,
  systemFonts,
} from "../system-fonts";

describe("what the picker offers", () => {
  it("always offers the generics, whatever the probe finds", () => {
    const offered = systemFonts();
    for (const generic of GENERIC_FONTS) {
      expect(offered.some((font) => font.id === generic.id)).toBe(true);
    }
  });

  it("puts them first, so the list opens on something known", () => {
    expect(systemFonts().slice(0, GENERIC_FONTS.length)).toEqual([
      ...GENERIC_FONTS,
    ]);
  });

  /** Worked out once: a few dozen measurements is nothing, and repeating them
   *  every time a panel is drawn is a few dozen too many. */
  it("answers the same list every time", () => {
    expect(systemFonts()).toBe(systemFonts());
  });

  it("offers no family twice", () => {
    const ids = systemFonts().map((font) => font.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("the families it asks about", () => {
  it("names each one once", () => {
    expect(new Set(CANDIDATES).size).toBe(CANDIDATES.length);
  });

  /**
   * Quoting happens where the id is built, so a name here must be the family
   * as the system spells it — `Times New Roman`, not `"Times New Roman"` and
   * not a stack. A quoted entry would come out `""Times New Roman"", …`, which
   * resolves to nothing at all and would simply never be offered.
   */
  it("names them plainly, without quotes or fallbacks", () => {
    for (const family of CANDIDATES) {
      expect(family).not.toMatch(/[",]/);
      expect(family.trim()).toBe(family);
    }
  });
});

describe("saying what a note is set to", () => {
  it("uses the picker's own name for a family it knows", () => {
    expect(fontLabel(GENERIC_FONTS[0].id)).toBe(GENERIC_FONTS[0].name);
  });

  /**
   * A document written on another machine — or on this one before somebody
   * uninstalled something — names a family that is not in the list. The row
   * still says what the note is set to, unpicked from the stack it was stored
   * as, rather than going blank or claiming the fallback.
   */
  it("unpicks a family it has never heard of", () => {
    expect(fontLabel('"Comic Neue", sans-serif')).toBe("Comic Neue");
    expect(fontLabel("Futura")).toBe("Futura");
    expect(fontLabel("'Party LET', sans-serif")).toBe("Party LET");
  });

  it("answers something for an empty or malformed stack", () => {
    expect(fontLabel("")).toBe("");
    expect(fontLabel(",,,")).toBe(",,,");
  });
});
