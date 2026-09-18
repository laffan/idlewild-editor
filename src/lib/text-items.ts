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
import {
  DEFAULT_LINE_HEIGHT,
  layout,
  leadingOf,
  type Laid,
  type Layable,
  type Ruler,
} from "./text-layout";
import type { Layer } from "./types";

export { DEFAULT_LINE_HEIGHT };

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
  /**
   * What it says, in the little bit of Markdown `lib/text-markdown.ts` reads:
   * `**bold**`, `*italic*` and `<u>underline</u>`. A newline is a new line.
   */
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
   * How far one line advances against the size. Absent is `DEFAULT_LINE_HEIGHT`.
   */
  lineHeight?: number;
  /**
   * The column the words are broken into, in world pixels.
   *
   * Absent means no wrapping at all, which is what a label usually wants: a
   * line ends where the writer put a newline. Set, it is the width of the box
   * whether or not any line reaches it — that is what makes the handle on the
   * canvas mean something, since the column somebody set stays still while the
   * words inside it change.
   */
  wrapWidth?: number;
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
   * Which of the grid's two axes a line of text runs along, when it tracks the
   * grid. `"cx"` is the NW→SE line and is the default; `"cy"` is SW→NE.
   */
  runs?: "cx" | "cy";
  /**
   * Whether the words **stand up** in that plane rather than lying in it.
   *
   * Lying down, a line runs along one grid axis and the next line steps along
   * the other — a label painted on the floor. Standing up, a line runs along
   * the same axis but the lines step straight down the screen, which is how a
   * sign on the face of a wall reads. The two are the same decision made twice
   * — which axis, and which way up — so they are two fields rather than four
   * named orientations.
   */
  upright?: boolean;
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
 * Everything about a note except its words, its place and its measured box.
 *
 * What the tool carries from one note to the next, and what the inspector
 * writes back when any of it is changed — see `game/text-style.ts`. A field
 * added here is carried without anything else being told, which is the reason
 * it is a type rather than a list repeated in three places.
 */
export type TextStyleFields = Pick<
  TextItem,
  | "size"
  | "color"
  | "font"
  | "align"
  | "lineHeight"
  | "wrapWidth"
  | "tracksGrid"
  | "runs"
  | "upright"
>;

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

export function groundPlane(
  grid: Grid | null | undefined,
  how: Pick<TextItem, "runs" | "upright"> = {},
): TextPlane | null {
  if (!grid || grid.projection !== "isometric") return null;
  // A `+cx` step is (tw/2, th/2) — down-right, the NW→SE line — and a `+cy`
  // step is (-tw/2, th/2), down-left. Read straight off `Grid.cellToWorld`.
  const hw = grid.tileWidth / 2;
  const hh = grid.tileHeight / 2;
  const len = Math.hypot(hw, hh) || 1;
  const se = { x: hw / len, y: hh / len };
  const sw = { x: -hw / len, y: hh / len };
  // SW→NE is the *other* diagonal, which is `+cy` walked backwards.
  const ne = { x: hw / len, y: -hh / len };

  // Which axis a line runs along, and which way the lines step.
  const along = how.runs === "cy" ? ne : se;
  const down = how.upright
    ? // Standing up: the lines step straight down the screen, which is what
      // makes a run of text read as a sign on the face of a wall rather than
      // as a label on the floor in front of it.
      { x: 0, y: 1 }
    : how.runs === "cy"
      ? se
      : sw;
  return { ax: along.x, ay: along.y, bx: down.x, by: down.y };
}

/** The plane an item should be laid out in, which is its switch and the grid. */
export function planeFor(
  item: Pick<TextItem, "tracksGrid" | "runs" | "upright">,
  grid: Grid | null | undefined,
): TextPlane | null {
  return item.tracksGrid ? groundPlane(grid, item) : null;
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

/**
 * The `font` shorthand a 2D context wants, for one item at one scale.
 *
 * `italic` and `bold` in front, which is where the CSS shorthand puts them and
 * the only way to get the family's *own* italic and bold rather than a slant
 * and a smear painted over the upright.
 */
export function fontString(
  item: Pick<TextItem, "size" | "font">,
  scale = 1,
  bold = false,
  italic = false,
): string {
  const style = `${italic ? "italic " : ""}${bold ? "700 " : ""}`;
  return `${style}${Math.max(1, Math.round(item.size * scale))}px ${item.font}`;
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
  item: Layable & Pick<TextItem, "font">,
  plane: TextPlane | null = null,
): { width: number; height: number } {
  const flat = laidOut(item);
  if (!plane) return { width: flat.width, height: flat.height };
  // Laid into the grid's plane, what the document has to hold is the box the
  // words come out in *on the canvas* — every reader of it, from the tap that
  // picks the note up to the crop a conversion makes, wants the rectangle that
  // is actually there.
  const box = planeBox(plane, flat.width, flat.height);
  return { width: box.width, height: box.height };
}

/**
 * The note's lines and runs, measured in this device's own faces.
 *
 * The one place `lib/text-layout.ts` is handed a ruler, so the measuring and
 * the drawing are the same layout — see `rasteriseText`, which asks for it
 * again rather than being passed one, because a texture is rebuilt far less
 * often than a box is read.
 */
export function laidOut(item: Layable & Pick<TextItem, "font">): Laid {
  return layout(item, ruler(item));
}

/**
 * How wide a run of characters is, in the face its emphasis asks for.
 *
 * Bold and italic are **the font string's**, not a transform on the glyphs: a
 * synthesised slant is not what the family's own italic looks like, and a run
 * measured in the upright and drawn in the italic is a run that overlaps its
 * neighbour. So every measurement and every `fillText` go through the same
 * shorthand — which is what `fontString` takes those two flags for.
 */
function ruler(item: Pick<TextItem, "size" | "font">, scale = 1): Ruler {
  const context = measuringContext();
  if (!context) {
    // No canvas — a test environment. Half the size per character is close
    // enough to keep a box from being zero, and the first edit on a real
    // canvas replaces it.
    return (text) => text.length * item.size * scale * 0.5;
  }
  return (text, bold, italic) => {
    context.font = fontString(item, scale, bold, italic);
    return context.measureText(text).width;
  };
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
  style: TextStyleFields,
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
      // Everything that can move the box, which is everything but the
      // position and the colour. Listed rather than "anything at all", because
      // a drag writes `x` and `y` on every pointer move and re-measuring there
      // would be a canvas measurement per frame for an answer that cannot have
      // changed.
      const resized =
        patch.text !== undefined ||
        patch.size !== undefined ||
        patch.font !== undefined ||
        patch.lineHeight !== undefined ||
        patch.wrapWidth !== undefined ||
        // The plane changes the box without changing a word of the text.
        patch.tracksGrid !== undefined ||
        patch.runs !== undefined ||
        patch.upright !== undefined;
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

/**
 * Everything but the words, the place and the box — what the tool carries on.
 *
 * Built by picking rather than by spreading and deleting, so a field that is
 * genuinely per-note — the id, the text, the position — cannot leak into the
 * tool's style by being added to the record later.
 */
export function styleOf(item: TextItem): TextStyleFields {
  return {
    size: item.size,
    color: item.color,
    font: item.font,
    align: item.align,
    lineHeight: item.lineHeight,
    wrapWidth: item.wrapWidth,
    tracksGrid: item.tracksGrid,
    runs: item.runs,
    upright: item.upright,
  };
}

/** The one a selection names, if it is still there. */
export function textById(
  layer: Layer | undefined,
  textId: string,
): TextItem | undefined {
  return textsOf(layer).find((item) => item.id === textId);
}

/**
 * A note's own coordinate frame on the canvas.
 *
 * Text is laid out left-to-right and top-to-bottom in its own space, and what
 * ends up on the canvas is that space through a plane — so anything that wants
 * to put something *at a place in the text* has to go the same way. The wrap
 * handle is the one caller: it belongs at the end of the column, which is a
 * text-space x and has no fixed direction on screen at all.
 *
 * Computed rather than stored, because it is derived from the item and the
 * grid, and a fourth copy of the layout in the document is a fourth thing to
 * keep in step.
 */
export interface TextFrame {
  /** Where text-space `(0, 0)` is in the world. */
  origin: { x: number; y: number };
  plane: TextPlane | null;
  /** The box before any plane: the column, and the lines times the leading. */
  flat: { width: number; height: number };
}

export function textFrame(item: TextItem, plane: TextPlane | null): TextFrame {
  const flat = laidOut(item);
  if (!plane) {
    return { origin: { x: item.x, y: item.y }, plane, flat };
  }
  // The sheared box's own corner is up and to the left of text-space zero, so
  // the origin is the note's corner *plus* that offset back.
  const box = planeBox(plane, flat.width, flat.height);
  return {
    origin: { x: item.x - box.x, y: item.y - box.y },
    plane,
    flat: { width: flat.width, height: flat.height },
  };
}

/** A point in the text, in the world. */
export function textPoint(
  frame: TextFrame,
  tx: number,
  ty: number,
): { x: number; y: number } {
  const { plane, origin } = frame;
  if (!plane) return { x: origin.x + tx, y: origin.y + ty };
  return {
    x: origin.x + plane.ax * tx + plane.bx * ty,
    y: origin.y + plane.ay * tx + plane.by * ty,
  };
}

/**
 * How wide a column a pointer is asking for, in text space.
 *
 * The pointer's offset from the origin, taken **back through the plane** — the
 * inverse of the transform `textPoint` applies, so a point put at a width and
 * read back comes out as that width in every orientation.
 *
 * It is not a projection onto the axis the text runs along, which is what this
 * was and which is wrong for a reason worth writing down: the two axes are
 * *not perpendicular* — that is the whole of what a shear is — so a dot product
 * with one of them picks up a share of the distance along the other. The
 * handle sits half the note's height down the second axis, so grabbing it
 * would have snapped the column to a different width before the pointer moved
 * at all. On a note drawn flat the matrix is the identity and this is `x -
 * item.x`, the way it always was.
 */
export function textWidthAt(
  frame: TextFrame,
  world: { x: number; y: number },
): number {
  const dx = world.x - frame.origin.x;
  const dy = world.y - frame.origin.y;
  const plane = frame.plane;
  if (!plane) return dx;
  const det = plane.ax * plane.by - plane.bx * plane.ay;
  // Two axes pointing the same way have no inverse and no plane worth the
  // name; nothing builds one, so this is a floor rather than a case.
  if (Math.abs(det) < 1e-6) return dx;
  return (plane.by * dx - plane.bx * dy) / det;
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

  const laid = laidOut(item);
  ctx.scale(scale, scale);
  if (plane) {
    // Text space onto the grid's two axes, shifted so the parallelogram's own
    // corner lands on the canvas's. The box was measured through the same
    // `planeBox`, so what is drawn fills it exactly — and the layout below is
    // in text space either way, which is what keeps every orientation one
    // transform rather than four drawings.
    const box = planeBox(plane, laid.width, laid.height);
    ctx.transform(plane.ax, plane.ay, plane.bx, plane.by, -box.x, -box.y);
  }
  ctx.fillStyle = item.color;
  ctx.textBaseline = "alphabetic";

  const leading = leadingOf(item);
  laid.lines.forEach((line, index) => {
    // The baseline within its line box. One number for every family here,
    // which is what makes the box `measure` wrote the box that is filled.
    const baseline = index * leading + item.size;
    const left = lineOffset({ align: item.align, width: laid.width }, line.width);
    for (const span of line.spans) {
      ctx.font = fontString(item, 1, span.bold, span.italic);
      ctx.fillText(span.text, left + span.x, baseline);
      if (!span.underline) continue;
      // Drawn rather than asked for: a 2D canvas has no text decoration, and
      // the two numbers a rule needs — how far under the baseline, how thick —
      // are the ones every type designer picks by eye anyway. A fifteenth of
      // the size sits under the descenders of the faces here without touching
      // the line below.
      const drop = Math.max(1, item.size / 12);
      ctx.fillRect(
        left + span.x,
        baseline + drop,
        span.width,
        Math.max(1, item.size / 16),
      );
    }
  });
  return canvas;
}
