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
import { Grid } from "./grid";
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
   * Whether the words lie **in the grid's plane** rather than flat on screen.
   *
   * On an isometric project a note drawn flat reads as floating in front of
   * the world: it is the one thing on the canvas facing the viewer while
   * everything else is seen from above and to the side. Turned on, the words
   * are sheared onto the two grid axes — a line runs along `+cx` and the next
   * line steps along `+cy` — so a label reads as painted on the floor, which
   * is what a label on a floor plan is.
   *
   * Means nothing on an orthogonal or blank project, where the grid's plane
   * *is* the screen, so the switch is not offered there. Absent is off, which
   * is what every note written before it existed is.
   */
  tracksGrid?: boolean;
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
 * Which families a note can be set in: `lib/system-fonts.ts`.
 *
 * Whatever this device has, found by measuring rather than by asking — the API
 * that would answer outright is Chromium's, and this runs in WKWebView. **No
 * webfonts**, which is the one rule: this editor works offline, a family that
 * has to be fetched is a family that is sometimes not there, and text whose
 * metrics arrive after the box was measured is text that no longer sits where
 * its outline says.
 *
 * Using a *local* font is safe here precisely because a note is temporary: what
 * ships is the pixels a conversion writes, so the typeface never has to exist
 * anywhere but on the machine the words were typed on.
 */

/** How tall a line is against its font size — the usual typographic ratio. */
export const LINE_HEIGHT = 1.25;

/** A layer's text. Absent on every layer written before the tool existed. */
export function textsOf(layer: Layer | undefined): readonly TextItem[] {
  return layer?.texts ?? [];
}

/**
 * The grid's own two axes as unit vectors, or null where they are the screen's.
 *
 * `+cx` and `+cy` in world pixels, each normalised to length one. That is the
 * whole of what "lying in the grid's plane" is: text-x laid along the first and
 * text-y along the second. **Normalised**, rather than the axes themselves,
 * because the axes are a *cell* long and a note is measured in world pixels —
 * using them raw would scale every note to the size of one grid space. What it
 * keeps is the length of a horizontal and a vertical run; what it changes is
 * the angle between them, which is exactly what makes the words lie down.
 *
 * Null on an orthogonal or blank project: there the two axes are already the
 * screen's, so the transform would be the identity and the honest answer is
 * that there is nothing to do.
 */
export interface TextPlane {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export function groundPlane(grid: Grid | null | undefined): TextPlane | null {
  if (!grid || grid.projection !== "isometric") return null;
  // A `+cx` step is (tw/2, th/2) and a `+cy` step is (-tw/2, th/2) — see
  // `Grid.cellToWorld`, which this is read straight off.
  const hw = grid.tileWidth / 2;
  const hh = grid.tileHeight / 2;
  const len = Math.hypot(hw, hh) || 1;
  return { ax: hw / len, ay: hh / len, bx: -hw / len, by: hh / len };
}

/** The plane an item should be laid out in, which is its switch and the grid. */
export function planeFor(
  item: Pick<TextItem, "tracksGrid">,
  grid: Grid | null | undefined,
): TextPlane | null {
  return item.tracksGrid ? groundPlane(grid) : null;
}

/**
 * A box in text space, as it comes out on the canvas under a plane.
 *
 * The four corners through the transform, and the box around them. Both the
 * measuring and the drawing ask, so the canvas a note is drawn into is exactly
 * the box the document stores — which is what everything downstream reads as a
 * plain rectangle.
 */
export function planeBox(
  plane: TextPlane,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const xs = [0, plane.ax * width, plane.bx * height, plane.ax * width + plane.bx * height];
  const ys = [0, plane.ay * width, plane.by * height, plane.ay * width + plane.by * height];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(1, Math.round(Math.max(...xs) - x)),
    height: Math.max(1, Math.round(Math.max(...ys) - y)),
  };
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
export function measure(
  item: Pick<TextItem, "text" | "size" | "font">,
  plane: TextPlane | null = null,
): { width: number; height: number } {
  const flat = measureFlat(item);
  if (!plane) return flat;
  // Laid into the grid's plane, what the document has to hold is the box the
  // words come out in *on the canvas* — every reader of it, from the tap that
  // picks the note up to the crop a conversion makes, wants the rectangle that
  // is actually there.
  const box = planeBox(plane, flat.width, flat.height);
  return { width: box.width, height: box.height };
}

/** The box before any plane: the widest line, and the lines times the leading. */
function measureFlat(item: Pick<TextItem, "text" | "size" | "font">): {
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
  style: Pick<TextItem, "size" | "color" | "font" | "align" | "tracksGrid">,
  grid?: Grid | null,
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
  return { ...item, ...measure(item, planeFor(item, grid)) };
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
  // The grid comes off the document rather than being threaded in: every
  // caller has the store and none of them has a reason to say which projection
  // the project is in. One allocation per edit, which is once per keystroke at
  // worst and nothing beside the measurement it is for.
  const grid = new Grid(store.projection, store.gridSize);
  store.editLayer(layerId, (layer) => ({
    ...layer,
    texts: textsOf(layer).map((item) => {
      if (item.id !== textId) return item;
      const next = { ...item, ...patch };
      const resized =
        patch.text !== undefined ||
        patch.size !== undefined ||
        patch.font !== undefined ||
        // The plane changes the box without changing a word of the text.
        patch.tracksGrid !== undefined;
      return resized
        ? { ...next, ...measure(next, planeFor(next, grid)) }
        : next;
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
export function rasteriseText(
  item: TextItem,
  scale: number,
  plane: TextPlane | null = null,
): HTMLCanvasElement | null {
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
  if (plane) {
    // Text space onto the grid's two axes, shifted so the parallelogram's own
    // corner lands on the canvas's. The box was measured through the same
    // `planeBox`, so what is drawn fills it exactly.
    const flat = measureFlat(item);
    const box = planeBox(plane, flat.width, flat.height);
    ctx.transform(plane.ax, plane.ay, plane.bx, plane.by, -box.x, -box.y);
  }
  ctx.font = fontString(item);
  ctx.fillStyle = item.color;
  ctx.textBaseline = "alphabetic";

  // Laid out in text space either way: the transform above is what turns a
  // line running left-to-right into one running along `+cx`, so nothing here
  // has to know which of the two it is drawing.
  const flat = plane ? measureFlat(item) : { width: item.width, height: item.height };
  const leading = item.size * LINE_HEIGHT;
  textLines(item).forEach((line, index) => {
    const at = lineOffset({ align: item.align, width: flat.width }, ctx.measureText(line).width);
    // The baseline within its line box. One number for every family here,
    // which is what makes the box `measure` wrote the box that is filled.
    ctx.fillText(line, at, index * leading + item.size);
  });
  return canvas;
}
