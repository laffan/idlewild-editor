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
  DEFAULT_LINE_HEIGHT,
  TEXT_PLACEHOLDER,
  addText,
  fontString,
  groundPlane,
  lineOffset,
  measure,
  newText,
  planeBox,
  planeFor,
  textFrame,
  textPoint,
  textWidthAt,
  removeText,
  textById,
  textsOf,
  updateText,
} from "../text-items";
import { Grid } from "../grid";
import type { GameDoc, TextItem } from "../types";

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
    expect(two.height).toBe(Math.round(2 * 20 * DEFAULT_LINE_HEIGHT));
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
    const one = measure({ text: "a b c", size: 20, font: STYLE.font });
    const three = measure({ text: "a\nb\nc", size: 20, font: STYLE.font });
    expect(three.height).toBe(Math.round(3 * 20 * DEFAULT_LINE_HEIGHT));
    expect(one.height).toBe(Math.round(20 * DEFAULT_LINE_HEIGHT));
  });

  /** The leading is the note's own when it has one. */
  it("follows the line height it was given", () => {
    const tight = measure({ text: "a\nb", size: 20, font: STYLE.font, lineHeight: 1 });
    const loose = measure({ text: "a\nb", size: 20, font: STYLE.font, lineHeight: 2 });
    expect(tight.height).toBe(40);
    expect(loose.height).toBe(80);
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
   * Emphasis goes in the **font string**, in the order the CSS shorthand wants
   * it. Not a transform on the glyphs: a synthesised slant is not the family's
   * own italic, and a run measured upright and drawn slanted overlaps the run
   * beside it.
   */
  it("asks for the family's own bold and italic", () => {
    const face = { size: 24, font: "serif" };
    expect(fontString(face, 1, true, false)).toBe("700 24px serif");
    expect(fontString(face, 1, false, true)).toBe("italic 24px serif");
    expect(fontString(face, 1, true, true)).toBe("italic 700 24px serif");
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

/**
 * Lying in the grid's plane.
 *
 * On an isometric project a note drawn flat is the one thing on the canvas
 * facing the viewer while everything else is seen from above and to the side.
 * Turned on, the words are laid along the grid's own two axes.
 *
 * The arithmetic is worth pinning because **the box has to follow**. A sheared
 * note fills a bigger rectangle than the same words drawn flat, and four things
 * read that rectangle as fact — the tap that picks the note up, the drag, the
 * outline, and the crop a conversion makes. A box that stopped agreeing with
 * the drawing is an outline in the wrong place and a file with a corner of the
 * words cut off.
 */
describe("the grid's plane", () => {
  const iso = new Grid("isometric", 64);
  const flat = new Grid("orthogonal", 64);

  /**
   * Null on a projection whose plane is already the screen. Not an identity
   * transform: there is nothing to do, and saying so is what lets every caller
   * skip the work rather than multiplying by one.
   */
  it("is nothing at all on an orthogonal or blank project", () => {
    expect(groundPlane(flat)).toBeNull();
    expect(groundPlane(new Grid("blank", 64))).toBeNull();
    expect(groundPlane(null)).toBeNull();
  });

  it("is the two grid axes, each one unit long", () => {
    const plane = groundPlane(iso);
    expect(plane).not.toBeNull();
    if (!plane) return;
    expect(Math.hypot(plane.ax, plane.ay)).toBeCloseTo(1, 6);
    expect(Math.hypot(plane.bx, plane.by)).toBeCloseTo(1, 6);
    // `+cx` runs down-right and `+cy` down-left — see `Grid.cellToWorld`.
    expect(plane.ax).toBeGreaterThan(0);
    expect(plane.bx).toBeLessThan(0);
    expect(plane.ay).toBeGreaterThan(0);
    expect(plane.by).toBeGreaterThan(0);
  });

  /**
   * Normalised rather than raw, which is the part that would be silently wrong:
   * the axes themselves are a *cell* long, so using them would scale every note
   * to the size of one grid space however big the words were.
   */
  it("does not scale with the grid", () => {
    const small = groundPlane(new Grid("isometric", 16));
    const large = groundPlane(new Grid("isometric", 256));
    expect(small?.ax).toBeCloseTo(large?.ax ?? 0, 6);
    expect(small?.by).toBeCloseTo(large?.by ?? 0, 6);
  });

  it("only applies where the note asks for it", () => {
    expect(planeFor({ tracksGrid: true }, iso)).not.toBeNull();
    expect(planeFor({}, iso)).toBeNull();
    expect(planeFor({ tracksGrid: false }, iso)).toBeNull();
    // And never on a projection that has no plane of its own.
    expect(planeFor({ tracksGrid: true }, flat)).toBeNull();
  });

  it("gives a sheared note a wider box than the same words flat", () => {
    const plane = groundPlane(iso);
    if (!plane) return;
    const box = planeBox(plane, 100, 40);
    // Both axes push sideways, so the parallelogram is wider than the text and
    // shorter than the two runs added up.
    expect(box.width).toBeGreaterThan(100);
    expect(box.height).toBeGreaterThan(0);
    // Its own corner is up and to the left of the origin, because `+cy` runs
    // left: that offset is what the drawing translates by.
    expect(box.x).toBeLessThan(0);
    expect(box.y).toBe(0);
  });

  it("measures a note as the box it comes out in", () => {
    const words = { text: "door to the cave", size: 24, font: STYLE.font };
    const plain = measure(words);
    const laid = measure(words, groundPlane(iso));
    expect(laid.width).toBeGreaterThan(plain.width);
    expect(laid.height).toBeGreaterThan(plain.height);
  });

  it("re-measures when the switch is thrown, with no word changed", () => {
    const s = store();
    const item = addText(s, "layer-1", newText({ x: 0, y: 0 }, STYLE));
    const before = { ...item };
    updateText(s, "layer-1", item.id, { tracksGrid: true });
    const after = textById(s.layer("layer-1"), item.id);
    expect(after?.text).toBe(before.text);
    // This store is orthogonal, so the plane is null and the box is unchanged —
    // which is the assertion: throwing the switch where it means nothing must
    // not move anything.
    expect(after?.width).toBe(before.width);
  });
});

/**
 * The four orientations, which are two decisions rather than four pictures:
 * which of the grid's diagonals a line runs along, and whether the lines step
 * across the floor or straight down the screen.
 *
 * Each is invisible when wrong in the ordinary way — text at the wrong angle
 * looks like text at an angle — so what is asserted is the *direction* each
 * axis points, which is the thing that would be swapped.
 */
describe("which way the words run", () => {
  const iso = new Grid("isometric", 64);
  const on = { tracksGrid: true as const };

  it("runs NW→SE by default, with the lines stepping SW", () => {
    const plane = planeFor(on, iso);
    if (!plane) throw new Error("isometric should have a plane");
    // Down-right along the line, down-left between them: a label on the floor.
    expect(plane.ax).toBeGreaterThan(0);
    expect(plane.ay).toBeGreaterThan(0);
    expect(plane.bx).toBeLessThan(0);
    expect(plane.by).toBeGreaterThan(0);
  });

  it("runs SW→NE on the other diagonal, with the lines stepping SE", () => {
    const plane = planeFor({ ...on, runs: "cy" }, iso);
    if (!plane) throw new Error("isometric should have a plane");
    // Up-right along the line, down-right between them.
    expect(plane.ax).toBeGreaterThan(0);
    expect(plane.ay).toBeLessThan(0);
    expect(plane.bx).toBeGreaterThan(0);
    expect(plane.by).toBeGreaterThan(0);
  });

  /**
   * Standing up is the one that changes only the *second* axis: the line still
   * follows the grid, and the lines below it step straight down the screen —
   * which is what makes a run of text read as a sign on the face of a wall.
   */
  it("stands up without changing which way the line runs", () => {
    const lying = planeFor(on, iso);
    const upright = planeFor({ ...on, upright: true }, iso);
    if (!lying || !upright) throw new Error("isometric should have a plane");
    expect(upright.ax).toBeCloseTo(lying.ax, 6);
    expect(upright.ay).toBeCloseTo(lying.ay, 6);
    expect(upright.bx).toBe(0);
    expect(upright.by).toBe(1);
  });

  it("stands up on the other diagonal too", () => {
    const plane = planeFor({ ...on, runs: "cy", upright: true }, iso);
    if (!plane) throw new Error("isometric should have a plane");
    expect(plane.ay).toBeLessThan(0);
    expect(plane.bx).toBe(0);
    expect(plane.by).toBe(1);
  });

  it("keeps every axis one unit long, whichever way it is turned", () => {
    for (const how of [
      {},
      { runs: "cy" as const },
      { upright: true },
      { runs: "cy" as const, upright: true },
    ]) {
      const plane = planeFor({ ...on, ...how }, iso);
      if (!plane) throw new Error("isometric should have a plane");
      expect(Math.hypot(plane.ax, plane.ay)).toBeCloseTo(1, 6);
      expect(Math.hypot(plane.bx, plane.by)).toBeCloseTo(1, 6);
    }
  });
});

/**
 * The note's own frame, which is what puts the wrap handle at the end of the
 * column rather than at the corner of the box.
 *
 * The round trip is the assertion worth having: a point put at a text-space
 * width and read back as a width has to come out as the width it went in as,
 * in every orientation. That one property is what makes the handle draggable
 * on a note laid into the grid at all — and it is why `textWidthAt` is a
 * projection rather than a subtraction.
 */
describe("a note's own frame", () => {
  const iso = new Grid("isometric", 64);

  function note(over: Partial<TextItem> = {}): TextItem {
    return {
      ...newText({ x: 200, y: 120 }, STYLE),
      text: "door to the cave",
      wrapWidth: 180,
      ...over,
    };
  }

  it("reads a width back as the width it drew at, drawn flat", () => {
    const item = note();
    const frame = textFrame(item, null);
    const at = textPoint(frame, 140, 20);
    expect(textWidthAt(frame, at)).toBeCloseTo(140, 6);
  });

  it("reads it back in every orientation", () => {
    for (const how of [
      { tracksGrid: true },
      { tracksGrid: true, runs: "cy" as const },
      { tracksGrid: true, upright: true },
      { tracksGrid: true, runs: "cy" as const, upright: true },
    ]) {
      const item = note(how);
      const frame = textFrame(item, planeFor(item, iso));
      const at = textPoint(frame, 140, 20);
      expect(textWidthAt(frame, at)).toBeCloseTo(140, 6);
    }
  });

  /** Text-space zero is the note's own corner when nothing is sheared. */
  it("puts text-space zero at the note's corner when it is flat", () => {
    const item = note();
    const frame = textFrame(item, null);
    expect(textPoint(frame, 0, 0)).toEqual({ x: item.x, y: item.y });
  });
});
