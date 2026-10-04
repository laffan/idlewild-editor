import { describe, expect, it } from "vitest";
import { measure, styleOf, trackingOf, type TextItem } from "../text-items";
import { isFontFile, projectFontId } from "../project-fonts";
import { DEFAULT_TEXT_STYLE } from "../../game/text-style";

const item = (extra: Partial<TextItem> = {}): TextItem => ({
  id: "t",
  text: "abcd",
  x: 0,
  y: 0,
  size: 10,
  color: "#000",
  font: "serif",
  align: "left",
  width: 1,
  height: 1,
  ...extra,
});

describe("letter spacing", () => {
  it("is against the size, and adds after every character", () => {
    expect(trackingOf(item({ letterSpacing: 0.5 }))).toBe(5);
    expect(trackingOf(item())).toBe(0);
    const plain = measure(item()).width;
    expect(measure(item({ letterSpacing: 0.5 })).width).toBe(plain + 4 * 5);
  });

  it("is carried to the next note with the rest of the style", () => {
    expect(styleOf(item({ letterSpacing: 0.2 })).letterSpacing).toBe(0.2);
  });

  it("a new note wraps by default", () => {
    expect(DEFAULT_TEXT_STYLE.wrapWidth).toBeGreaterThan(0);
  });
});

describe("project fonts", () => {
  it("takes the four font formats, by name", () => {
    expect(["a.ttf", "B.OTF", "c.woff", "d.woff2"].every(isFontFile)).toBe(true);
    expect(isFontFile("e.png")).toBe(false);
  });

  it("stores a family quoted, with a generic behind it", () => {
    expect(projectFontId('My "Font"')).toBe('"My Font", sans-serif');
  });
});
