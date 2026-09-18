/**
 * Words on the canvas: the box, and the edits that move it.
 *
 * The box is the part worth holding to account. It is not something anybody
 * typed — it comes out of the font, the size and the string — and four things
 * read it back as though it were a fact: the tap that picks a note up, the
 * drag that moves it, the outline drawn round it, and the conversion that
 * crops a PSD to it. A box that stopped agreeing with the text is an outline
 * in the wrong place and a file with the last word cut off, and neither of
 * those looks like a measuring bug when you meet it.
 *
 * There is no canvas in this environment, so `measure` takes its documented
 * fallback — which is exactly why the assertions here are about the box
 * *changing when it should* rather than about particular pixel widths.
 */

import { describe, expect, it, vi } from "vitest";
import { DocStore } from "../doc-store";
import {
  LINE_HEIGHT,
  TEXT_PLACEHOLDER,
  addText,
  fontString,
  lineOffset,
  measure,
  newText,
  removeText,
  textById,
  textLines,
  textsOf,
  updateText,
} from "../text-items";
import type { GameDoc } from "../types";

// The store writes through `ipc.doc.write`, which wants Tauri, and debounces
// that write on window timers, where this runs in node. Neither is what any of
// this is about — the same two stubs `history.test.ts` puts up.
vi.mock("../ipc", () => ({
  doc: { read: vi.fn(), write: vi.fn(async () => undefined) },
}));
(globalThis as unknown as { window: unknown }).window ??= {
  setTimeout: () => 0,
  clearTimeout: () => undefined,
};

const STYLE = {
  size: 24,
  color: "#1d1f22",
  font: "system-ui, sans-serif",
  align: "left" as const,
};

function store(): DocStore {
  const doc: GameDoc = {
    version: 2,
    projection: "orthogonal",
    gridSize: 32,
    activeSceneId: "scene-1",
    scenes: [
      {
        id: "scene-1",
        name: "Main",
        layers: [
          {
            id: "layer-1",
            name: "Foreground",
            locked: false,
            visible: true,
            fills: [],
            placements: [],
            points: [],
            zones: [],
            strokes: [],
          },
        ],
      },
    ],
  };
  return new DocStore("project-1", doc);
}

describe("what a new note is", () => {
  it("says the placeholder, where it was tapped", () => {
    const item = newText({ x: 120, y: 64 }, STYLE);
    expect(item.text).toBe(TEXT_PLACEHOLDER);
    expect(item.x).toBe(120);
    expect(item.y).toBe(64);
  });

  it("arrives measured rather than as a box of nothing", () => {
    const item = newText({ x: 0, y: 0 }, STYLE);
    expect(item.width).toBeGreaterThan(0);
    expect(item.height).toBeGreaterThan(0);
  });
});

describe("the box", () => {
  it("is as many lines tall as the text has", () => {
    const one = measure({ text: "door", size: 20, font: STYLE.font });
    const two = measure({ text: "door\nto the cave", size: 20, font: STYLE.font });
    expect(two.height).toBe(Math.round(2 * 20 * LINE_HEIGHT));
    expect(two.height).toBeGreaterThan(one.height);
  });

  it("grows with the size", () => {
    const small = measure({ text: "door", size: 12, font: STYLE.font });
    const large = measure({ text: "door", size: 48, font: STYLE.font });
    expect(large.width).toBeGreaterThan(small.width);
    expect(large.height).toBeGreaterThan(small.height);
  });

  it("is never zero, whatever it is asked about", () => {
    const empty = measure({ text: "", size: 16, font: STYLE.font });
    expect(empty.width).toBeGreaterThan(0);
    expect(empty.height).toBeGreaterThan(0);
  });

  it("reads a newline as a line and nothing else as one", () => {
    expect(textLines({ text: "a\nb\nc" })).toEqual(["a", "b", "c"]);
    expect(textLines({ text: "one long line that does not wrap" })).toHaveLength(1);
  });
});

describe("editing one", () => {
  it("re-measures when the words change", () => {
    const s = store();
    const item = addText(s, "layer-1", newText({ x: 0, y: 0 }, STYLE));
    const before = item.width;
    updateText(s, "layer-1", item.id, {
      text: "a much longer note than the one it started with",
    });
    expect(textById(s.layer("layer-1"), item.id)?.width).toBeGreaterThan(before);
  });

  it("re-measures when the size changes", () => {
    const s = store();
    const item = addText(s, "layer-1", newText({ x: 0, y: 0 }, STYLE));
    updateText(s, "layer-1", item.id, { size: 64 });
    const after = textById(s.layer("layer-1"), item.id);
    expect(after?.height).toBeGreaterThan(item.height);
  });

  /**
   * A move must **not** re-measure: it is the same words at the same size, and
   * running the measurement again on every frame of a drag is a canvas
   * measurement per pointer move for an answer that cannot have changed.
   */
  it("leaves the box alone when only the position changes", () => {
    const s = store();
    const item = addText(s, "layer-1", newText({ x: 0, y: 0 }, STYLE));
    updateText(s, "layer-1", item.id, { x: 500, y: 240 });
    const after = textById(s.layer("layer-1"), item.id);
    expect(after?.x).toBe(500);
    expect(after?.width).toBe(item.width);
    expect(after?.height).toBe(item.height);
  });

  it("changes nothing about the others", () => {
    const s = store();
    const first = addText(s, "layer-1", newText({ x: 0, y: 0 }, STYLE));
    const second = addText(s, "layer-1", newText({ x: 100, y: 0 }, STYLE));
    updateText(s, "layer-1", first.id, { text: "changed" });
    expect(textById(s.layer("layer-1"), second.id)?.text).toBe(TEXT_PLACEHOLDER);
  });
});

describe("taking one off", () => {
  it("takes the field with the last of them", () => {
    const s = store();
    const item = addText(s, "layer-1", newText({ x: 0, y: 0 }, STYLE));
    expect(textsOf(s.layer("layer-1"))).toHaveLength(1);
    removeText(s, "layer-1", item.id);
    // The field goes rather than being left empty, so a layer that has never
    // had a note and one whose last note has gone are the same layer.
    expect(s.layer("layer-1")?.texts).toBeUndefined();
  });

  it("keeps the rest", () => {
    const s = store();
    const first = addText(s, "layer-1", newText({ x: 0, y: 0 }, STYLE));
    addText(s, "layer-1", newText({ x: 60, y: 0 }, STYLE));
    removeText(s, "layer-1", first.id);
    expect(textsOf(s.layer("layer-1"))).toHaveLength(1);
  });

  it("answers an empty list for a layer that has never had one", () => {
    expect(textsOf(store().layer("layer-1"))).toEqual([]);
    expect(textsOf(undefined)).toEqual([]);
  });
});

describe("laying it out", () => {
  it("writes the font the way a 2D context wants it", () => {
    expect(fontString({ size: 24, font: "system-ui, sans-serif" })).toBe(
      "24px system-ui, sans-serif",
    );
    // At `EXPORT_SCALE`, which is what a conversion rasterises at.
    expect(fontString({ size: 24, font: "serif" }, 2)).toBe("48px serif");
  });

  /**
   * The renderer and the rasteriser both ask, so a centred note is centred the
   * same way on the canvas and in the file it becomes — the one place an
   * alignment bug would show as artwork that moved when it was converted.
   */
  it("puts a line where its alignment says, against the measured box", () => {
    const box = { width: 100 } as const;
    expect(lineOffset({ ...box, align: "left" }, 40)).toBe(0);
    expect(lineOffset({ ...box, align: "center" }, 40)).toBe(30);
    expect(lineOffset({ ...box, align: "right" }, 40)).toBe(60);
  });
});
