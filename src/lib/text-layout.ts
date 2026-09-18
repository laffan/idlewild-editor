/**
 * A note's words, laid out: runs of emphasis, broken into lines, measured.
 *
 * Everything that decides *where a glyph goes* is here, and it is one function
 * because the four things that decide it are not separable. Markdown makes runs
 * with different fonts; a run with a different font measures differently;
 * wrapping breaks lines by measuring; and the alignment of a line depends on
 * the width it came out at. Doing any of those in a second place is how the
 * canvas and the PSD it becomes end up disagreeing about where a word sits.
 *
 * **It measures through a function it is given.** The measurement is a 2D
 * canvas, which `lib/text-items.ts` owns and keeps for the life of the page —
 * so what crosses into here is `(text, bold, italic) => width` and nothing
 * about the DOM. That is also what makes the awkward half testable: line
 * breaking and alignment are arithmetic over widths, and a fake ruler where
 * every character is ten wide is a far better test than a real one.
 *
 * **Lines are laid out in text space**, left to right and top to bottom,
 * whatever plane the note is eventually drawn in. The shear that lays a note
 * into the grid is a transform applied to the finished layout — see
 * `rasteriseText` — so nothing here has to know which of the four orientations
 * it is drawing.
 */

import { parseSpans, type Span } from "./text-markdown";

/** How wide a run of characters is, in the face its emphasis asks for. */
export type Ruler = (text: string, bold: boolean, italic: boolean) => number;

/** One run of a laid-out line: what it says, how it is set, and where it sits. */
export interface PlacedSpan extends Span {
  /** From the line's own left edge, before alignment. */
  x: number;
  width: number;
}

/** One line of the finished layout. */
export interface LaidLine {
  spans: PlacedSpan[];
  width: number;
}

/** The whole note: its lines, and the box they fill in text space. */
export interface Laid {
  lines: LaidLine[];
  width: number;
  height: number;
}

/** What laying a note out needs to know about it. */
export interface Layable {
  text: string;
  size: number;
  lineHeight?: number;
  /** Break long lines at this width, in world pixels. Absent means never. */
  wrapWidth?: number;
}

/** The leading a note uses when it has not said. */
export const DEFAULT_LINE_HEIGHT = 1.25;

/** What one line advances by, in world pixels. */
export function leadingOf(item: Layable): number {
  return item.size * (item.lineHeight ?? DEFAULT_LINE_HEIGHT);
}

/**
 * Lay a note out.
 *
 * The height is the lines times the leading, which is what the drawing steps
 * by — so the box is exactly what is filled rather than the font's own ascent
 * and descent, which no two families agree about.
 *
 * With a `wrapWidth` the box takes that width even when no line reaches it.
 * That is deliberate and it is what makes the handle on the canvas mean
 * something: the box is the column somebody set, not the longest line that
 * happens to be in it, so the box stays still while the words inside it change.
 */
export function layout(item: Layable, ruler: Ruler): Laid {
  const source = item.text.split("\n");
  const wrap = item.wrapWidth && item.wrapWidth > 0 ? item.wrapWidth : null;

  const lines: LaidLine[] = [];
  for (const line of source) {
    const spans = parseSpans(line);
    if (!wrap) {
      lines.push(place(spans, ruler));
      continue;
    }
    for (const broken of breakLine(spans, wrap, ruler)) {
      lines.push(place(broken, ruler));
    }
  }
  // A note with nothing in it is still one line tall: an empty box would give
  // it no outline to select and no canvas to draw into.
  if (lines.length === 0) lines.push({ spans: [], width: 0 });

  const widest = lines.reduce((n, line) => Math.max(n, line.width), 0);
  return {
    lines,
    width: Math.max(1, Math.round(wrap ?? widest)),
    height: Math.max(1, Math.round(lines.length * leadingOf(item))),
  };
}

/** Measure a line's runs and lay them end to end. */
function place(spans: readonly Span[], ruler: Ruler): LaidLine {
  const out: PlacedSpan[] = [];
  let x = 0;
  for (const span of spans) {
    const width = ruler(span.text, span.bold, span.italic);
    out.push({ ...span, x, width });
    x += width;
  }
  return { spans: out, width: x };
}

/**
 * Break one source line into as many as it takes to fit.
 *
 * **On words, and the spans come apart with them.** A run of emphasis can be
 * half a sentence, so a line cannot be broken by choosing between whole spans:
 * what is measured is each word, and a span that straddles a break is written
 * into both lines carrying the same emphasis. That is the only reading under
 * which `**a very long bold sentence**` wraps at all.
 *
 * A word longer than the column is left over the edge rather than broken
 * mid-glyph: hyphenation is a language's business, and a URL cut in half is
 * worse than one that overhangs.
 */
function breakLine(
  spans: readonly Span[],
  wrap: number,
  ruler: Ruler,
): Span[][] {
  const words = toWords(spans);
  if (words.length === 0) return [[]];

  const lines: Span[][] = [];
  let current: Span[] = [];
  let width = 0;

  for (const word of words) {
    const size = ruler(word.text, word.bold, word.italic);
    // A leading space on a wrapped line is the break's, not the writer's.
    if (width === 0 && word.text.trim() === "") continue;
    if (width > 0 && width + size > wrap) {
      lines.push(current);
      current = [];
      width = 0;
      if (word.text.trim() === "") continue;
    }
    current.push(word);
    width += size;
  }
  lines.push(current);
  return lines.map((line) => joinRuns(line));
}

/**
 * Every word of every span, each carrying its span's emphasis.
 *
 * Split so the spaces come with the word before them, which is what makes a
 * line's trailing space measure into the line it ends rather than starting the
 * next one.
 */
function toWords(spans: readonly Span[]): Span[] {
  const out: Span[] = [];
  for (const span of spans) {
    for (const piece of span.text.split(/(?<=\s)/)) {
      if (piece) out.push({ ...span, text: piece });
    }
  }
  return out;
}

/** Put neighbouring words with the same emphasis back into one run. */
function joinRuns(words: readonly Span[]): Span[] {
  const out: Span[] = [];
  for (const word of words) {
    const last = out[out.length - 1];
    if (
      last &&
      last.bold === word.bold &&
      last.italic === word.italic &&
      last.underline === word.underline
    ) {
      last.text += word.text;
      continue;
    }
    out.push({ ...word });
  }
  return out;
}
