/**
 * The bundled palettes are data carried over from another project, so what is
 * worth pinning is that they are *still the shape the browser draws*: five
 * sources, every one credited, every row a run of colours the picker will
 * actually accept.
 *
 * It is a real risk rather than a ceremonial one. These files were generated
 * from `swatches/*.json` upstream and the next batch will be too, and a hex
 * that arrived without its `#` or with five digits would draw as a transparent
 * square that silently refuses to go into the palette — which looks like a
 * broken button rather than like bad data.
 */

import { describe, expect, it } from "vitest";
import { PALETTE_SOURCES } from "../palettes";
import { isValidHex, normaliseHex } from "../color";

describe("the bundled palettes", () => {
  it("has the five sources the browser lists", () => {
    expect(PALETTE_SOURCES.map((s) => s.id)).toEqual([
      "muzli",
      "adobe",
      "colourlovers",
      "coolors",
      "colorhunt",
    ]);
  });

  it("credits every one of them", () => {
    for (const source of PALETTE_SOURCES) {
      expect(source.name.trim()).not.toBe("");
      expect(source.url).toMatch(/^https:\/\//);
    }
  });

  it("is made entirely of colours the palette will take", () => {
    for (const source of PALETTE_SOURCES) {
      expect(source.palettes.length).toBeGreaterThan(0);
      for (const row of source.palettes) {
        // Three is the fewest that is a palette rather than a pair.
        expect(row.length).toBeGreaterThanOrEqual(3);
        for (const colour of row) {
          expect(isValidHex(colour), `${source.id}: ${colour}`).toBe(true);
          // Already in the form the palette stores, so a colour tapped in the
          // browser is the same string as one added from the picker — which
          // is what makes "already in the palette" true rather than nearly.
          expect(normaliseHex(colour)).toBe(colour);
        }
      }
    }
  });

  it("carries the whole collection", () => {
    const rows = PALETTE_SOURCES.reduce((n, s) => n + s.palettes.length, 0);
    expect(rows).toBe(123);
  });
});
