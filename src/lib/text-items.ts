/**
 * Words written on the canvas: what one is, how big it is, and the edits.
 *
 * A `TextItem` is the same kind of thing a sketch is, and the shape itself is
 * here rather than in `lib/types.ts` because what one *is* is inseparable from
 * how it is measured — and measuring needs a canvas. `game/text-render.ts`
 * draws it, `editor/text-actions.ts` turns it into a PSD, and everything about
 * where it is comes from here.
 *
 * **The box is measured once and stored.** Text is the only thing in this
 * document whose size nobody typed: it comes out of the font, the size and the
 * string, and the browser is what knows. So every edit measures and writes the
 * box down, and picking, dragging, the selection outline and the minimap all
 * read a plain rectangle — the same rectangle a placement has — instead of
 * laying the text out again four times a frame.
 *
 * Measuring uses a 2D canvas, which is also what Phaser's `Text` renders
 * through: the same font string, laid out by the same engine, so the box the
 * document holds is the box the canvas draws. There is no measuring in a test
 * environment with no canvas at all, so `measureText` falls back to an
 * estimate rather than throwing — a document written under it is a document
 * with a slightly wrong box, which the first real edit corrects.
 */

import { makeId } from "./doc-shape";
import type { DocStore } from "./doc-store";
import type { Layer } from "./types";

/**
 * A line of text on the canvas, as a thing rather than as artwork.
 *
 * **Temporary on purpose.** It is the same kind of object a sketch is: it sits
 * on a layer, it can be moved, restyled and deleted, and the game is never
 * told about it — `game_config.rs` reads the fields it names, and this is not
 * one of them. What makes it real is **Convert to PSD**, exactly as a fill or
 * a lassoed sketch is made real, and what comes out is pixels somebody can
 * paint over rather than a font the runtime would have to have.
 *
 * That is the whole of why the editor grew one. Blocking a level out means
 * writing on it — *door to the cave*, *boss here*, a sign's own words — and
 * until now the only way to put a word on the canvas was to draw it by hand or
 * to go and make a PSD of it somewhere else.
 *
 * **The box is measured and stored.** Text is the one thing in this document
 * whose size is not something anybody typed: it comes out of the font, the
 * size and the string, and it is the browser that knows. Measuring it once on
 * every edit and writing it down is what lets picking, dragging, the selection
 * outline and the minimap all read a plain rectangle — the same rectangle a
 * placement has — instead of each of them laying the text out again.
 */
export interface TextItem {
  id: string;
  /** What it says. Newlines are lines; there is no wrapping. */
  text: string;
  /** World pixels: the top-left of the box the text is laid out in. */
  x: number;
  y: number;
  /** Cap height in world pixels, which is what a font size means. */
  size: number;
  color: string;
  /** A CSS font family, from the short list the inspector offers. */
  font: string;
  align: "left" | "center" | "right";
  /**
   * The measured box, in world pixels.
   *
   * Written by whatever last changed the text — see `updateText` below. A
   * document arriving without it (hand-edited, or from a build between this
   * landing and a later one) is read as a box of nothing, and the next edit
   * measures it.
   */
  width: number;
  height: number;
}

/** What a new one says until somebody types over it. */
export const TEXT_PLACEHOLDER = "Text";

/**
 * The families offered, which are the ones a device is certain to have.
 *
 * No webfonts: this editor runs offline on an iPad, a family that has to be
 * fetched is a family that sometimes is not there, and text whose metrics
 * change after the box was measured is text that no longer sits where its
 * outline says. The stack per family is the usual belt and braces.
 */
export const TEXT_FONTS: ReadonlyArray<{ id: string; name: string }> = [
  { id: "system-ui, sans-serif", name: "Sans" },
  { id: "Georgia, 'Times New Roman', serif", name: "Serif" },
  { id: "'Fira Code', ui-monospace, monospace", name: "Mono" },
];

/** How tall a line is against its font size — the usual typographic ratio. */
export const LINE_HEIGHT = 1.25;

/** A layer's text. Absent on every layer written before the tool existed. */
export function textsOf(layer: Layer | undefined): readonly TextItem[] {
  return layer?.texts ?? [];
}

/** The `font` shorthand a 2D context wants, for one item at one scale. */
export function fontString(item: Pick<TextItem, "size" | "font">, scale = 1): string {
  return `${Math.max(1, Math.round(item.size * scale))}px ${item.font}`;
}

/** The lines it is drawn as. Newlines are lines; nothing wraps. */
export function textLines(item: Pick<TextItem, "text">): string[] {
  return item.text.split("\n");
}

/**
 * How big a piece of text comes out, in world pixels.
 *
 * The width is the widest line and the height is the lines times the leading,
 * which is what both the renderer and the rasteriser draw — so the outline
 * round a selected piece of text is the outline round what is actually on
 * screen, rather than around the font's own ascent and descent.
 */
export function measure(item: Pick<TextItem, "text" | "size" | "font">): {
  width: number;
  height: number;
} {
  const lines = textLines(item);
  const height = Math.max(1, Math.round(lines.length * item.size * LINE_HEIGHT));
  const context = measuringContext();
  if (!context) {
    // No canvas — a test environment. Half the size per character is close
    // enough to keep a box from being zero, and the first edit on a real
    // canvas replaces it.
    const longest = lines.reduce((n, line) => Math.max(n, line.length), 0);
    return { width: Math.max(1, Math.round(longest * item.size * 0.5)), height };
  }
  context.font = fontString(item);
  const width = lines.reduce(
    (n, line) => Math.max(n, context.measureText(line).width),
    0,
  );
  return { width: Math.max(1, Math.round(width)), height };
}

/**
 * One 2D context, kept for the life of the page.
 *
 * Measuring happens on every keystroke in the inspector's field, and a canvas
 * allocated per measurement is a canvas allocated per keystroke. Null where
 * there is no DOM at all, which is where the estimate above takes over.
 */
let measuring: CanvasRenderingContext2D | null | undefined;
function measuringContext(): CanvasRenderingContext2D | null {
  if (measuring !== undefined) return measuring;
  try {
    measuring = document.createElement("canvas").getContext("2d");
  } catch {
    measuring = null;
  }
  return measuring;
}

/** What a piece of text looks like before anybody has touched it. */
export function newText(
  at: { x: number; y: number },
  style: Pick<TextItem, "size" | "color" | "font" | "align">,
): TextItem {
  const item: TextItem = {
    id: makeId("text"),
    text: TEXT_PLACEHOLDER,
    x: at.x,
    y: at.y,
    ...style,
    width: 1,
    height: 1,
  };
  return { ...item, ...measure(item) };
}

/**
 * Put one on a layer, measured.
 *
 * Through `editLayer` rather than a method on `DocStore`, the way a pattern's
 * rule and a background layer's backdrops are: what a *kind* of thing on a
 * layer holds is its own module's subject, and the store is at its line limit
 * besides.
 */
export function addText(store: DocStore, layerId: string, item: TextItem): TextItem {
  store.editLayer(layerId, (layer) => ({
    ...layer,
    texts: [...textsOf(layer), item],
  }));
  return item;
}

/**
 * Change one, and re-measure when the change could have changed its size.
 *
 * Which is the point of doing it here rather than at each of the four controls
 * in the inspector: the string, the size and the family all move the box, and
 * a box that stopped agreeing with the text is an outline in the wrong place
 * and a conversion that crops the words.
 */
export function updateText(
  store: DocStore,
  layerId: string,
  textId: string,
  patch: Partial<Omit<TextItem, "id">>,
): void {
  store.editLayer(layerId, (layer) => ({
    ...layer,
    texts: textsOf(layer).map((item) => {
      if (item.id !== textId) return item;
      const next = { ...item, ...patch };
      const resized =
        patch.text !== undefined ||
        patch.size !== undefined ||
        patch.font !== undefined;
      return resized ? { ...next, ...measure(next) } : next;
    }),
  }));
}

/** Take one off, and take the field with it when it was the last. */
export function removeText(store: DocStore, layerId: string, textId: string): void {
  store.editLayer(layerId, (layer) => {
    const kept = textsOf(layer).filter((item) => item.id !== textId);
    if (kept.length > 0) return { ...layer, texts: kept };
    if (!layer.texts) return layer;
    const { texts: _gone, ...rest } = layer;
    return rest;
  });
}

/** The one a selection names, if it is still there. */
export function textById(
  layer: Layer | undefined,
  textId: string,
): TextItem | undefined {
  return textsOf(layer).find((item) => item.id === textId);
}

/**
 * Where a line starts, against the box, for an alignment.
 *
 * The renderer and the rasteriser both ask, so a centred piece of text is
 * centred the same way on the canvas and in the file it becomes.
 */
export function lineOffset(
  item: Pick<TextItem, "align" | "width">,
  lineWidth: number,
): number {
  if (item.align === "center") return (item.width - lineWidth) / 2;
  if (item.align === "right") return item.width - lineWidth;
  return 0;
}

/**
 * The words, drawn into a canvas of their own box at `scale`.
 *
 * **This is the only place text is turned into pixels**, and that is the whole
 * point of it. The canvas shows a note by putting the result on the scene as a
 * texture, and a conversion reads the same result back as RGBA — so what is on
 * screen and what goes into the PSD cannot disagree about the leading, the
 * baseline or where a centred line starts. Drawing it once with Phaser's
 * `Text` and again here would be two layout engines agreeing by luck: Phaser's
 * line advance is the font's own ascent plus descent plus a spacing value, and
 * matching that from outside Phaser means guessing at metrics it measured.
 *
 * Drawn on the **alphabetic** baseline rather than at the top of each line,
 * because that is what a font size means. `textBaseline: "top"` puts the
 * ascent's own box at the top and moves every glyph down by whatever padding
 * the family leaves — exactly the kind of difference that shows as a note
 * landing two pixels lower than it was.
 *
 * Null where there is no canvas to draw on, which is a test environment.
 */
export function rasteriseText(item: TextItem, scale: number): HTMLCanvasElement | null {
  const width = Math.max(1, Math.ceil(item.width * scale));
  const height = Math.max(1, Math.ceil(item.height * scale));
  let canvas: HTMLCanvasElement;
  try {
    canvas = document.createElement("canvas");
  } catch {
    return null;
  }
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.scale(scale, scale);
  ctx.font = fontString(item);
  ctx.fillStyle = item.color;
  ctx.textBaseline = "alphabetic";

  const leading = item.size * LINE_HEIGHT;
  textLines(item).forEach((line, index) => {
    const at = lineOffset(item, ctx.measureText(line).width);
    // The baseline within its line box. One number for every family here,
    // which is what makes the box `measure` wrote the box that is filled.
    ctx.fillText(line, at, index * leading + item.size);
  });
  return canvas;
}
