/**
 * The little bit of Markdown a note understands: bold, italic, underline.
 *
 * A label on a level is prose, and prose has emphasis in it — *the* door,
 * **not** this one. Typing the marks is what anybody does anyway, in a field
 * that is three words wide, so the marks may as well mean something.
 *
 * **Three, and no more.** Not headings, not lists, not links, not code: every
 * one of those is a *block* rather than a span, and a block changes the size,
 * the leading or the left edge of a line — which would make this a document
 * renderer rather than a run of styled words. What a note needs is the three
 * things a pen has, and each of them is one glyph at the same size in the same
 * place.
 *
 * `<u>` rather than a Markdown mark for the third, because Markdown has no
 * underline: it is the one of the three that CommonMark deliberately leaves to
 * HTML, and inventing a fourth mark for it would be inventing a dialect.
 *
 * **Unmatched marks are text.** `2 * 3 * 4` is arithmetic and `a **thing` is
 * somebody mid-sentence, so a mark with no partner on the same line is drawn
 * as the character it is. That is the difference between a parser that helps
 * and one you have to escape your way out of.
 */

/** One run of characters that share their emphasis. */
export interface Span {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

/** Nothing set, which is what a run starts as and what plain text stays. */
const PLAIN = { bold: false, italic: false, underline: false };

/**
 * Read one line into runs.
 *
 * A line at a time, because every mark here closes on the line it opened on:
 * a `**` left dangling at the end of a paragraph is a typo rather than a
 * request to embolden the rest of the note, and scanning across the newline
 * would make one stray asterisk change everything under it.
 *
 * The scan is a stack of open marks rather than a regular expression, which is
 * what makes nesting work in either order — `**bold *and italic***` and
 * `*italic **and bold***` both come out as the reader meant. A closing mark
 * pairs with the nearest matching open one; anything left open at the end of
 * the line is rewound and drawn as characters.
 *
 * A fence with a space inside it does not close, which is Markdown's own rule
 * and not an accident here: `**bold **` is two literal pairs and a bold run
 * that never opened, so it comes out as the characters somebody typed.
 */
export function parseSpans(line: string): Span[] {
  const out: Span[] = [];
  /** Where each open mark started in `out`, so an unmatched one can be undone. */
  const open: Array<{ mark: Mark; at: number }> = [];
  let buffer = "";

  const style = () => ({
    bold: open.some((m) => m.mark === "**"),
    italic: open.some((m) => m.mark === "*" || m.mark === "_"),
    underline: open.some((m) => m.mark === "<u>"),
  });

  const flush = () => {
    if (!buffer) return;
    out.push({ text: buffer, ...style() });
    buffer = "";
  };

  let i = 0;
  while (i < line.length) {
    const found = markAt(line, i);
    if (!found) {
      buffer += line[i];
      i += 1;
      continue;
    }

    const held = open.findIndex((m) => m.mark === found.mark);
    if (found.canClose && held >= 0) {
      flush();
      open.splice(held, 1);
      i += found.length;
      continue;
    }
    // Nothing of this kind is open, so a mark that reads as closing has to be
    // given its other chance before it is called a character. `***both***`
    // lives here: the inner `*` has a `*` behind it and a letter in front, so
    // it reads as closing — and there is nothing for it to close.
    if (found.canOpen) {
      flush();
      open.push({ mark: found.mark, at: out.length });
      i += found.length;
      continue;
    }
    buffer += line.slice(i, i + found.length);
    i += found.length;
  }
  flush();

  // Anything still open never closed, so its mark was text. Its own characters
  // go back in front of the runs it opened, and — the part that is easy to
  // miss — the emphasis it was claiming comes off them: `a **thing` is four
  // plain words, not a bold one after a literal `**`.
  for (const unmatched of [...open].reverse()) {
    const rest = out.splice(unmatched.at).map((span) => without(span, unmatched.mark));
    out.push({ text: unmatched.mark, ...(rest[0] ? emphasis(rest[0]) : PLAIN) });
    for (const span of rest) out.push(span);
  }
  return merge(out.filter((span) => span.text.length > 0));
}

/** Whether the whole line is plain, which the layout can then draw in one go. */
export function isPlain(spans: readonly Span[]): boolean {
  return spans.every((span) => !span.bold && !span.italic && !span.underline);
}

/** The words with every mark taken out — what a name or a label reads as. */
export function plainText(line: string): string {
  return parseSpans(line)
    .map((span) => span.text)
    .join("");
}

/** The four marks, as the stack holds them. */
type Mark = "**" | "*" | "_" | "<u>";

/** One span's emphasis, without its text. */
function emphasis(span: Span): Omit<Span, "text"> {
  return { bold: span.bold, italic: span.italic, underline: span.underline };
}

/** The same, with what one mark was claiming taken off. */
function without(span: Span, mark: Mark): Span {
  if (mark === "**") return { ...span, bold: false };
  if (mark === "<u>") return { ...span, underline: false };
  return { ...span, italic: false };
}

/**
 * What is at `i`, if it is one of the marks, and which way it can go.
 *
 * `canOpen` and `canClose` rather than one answer, because the same two
 * characters do both jobs and only the scan knows what is already open. The
 * readings are Markdown's own: a mark can open when what follows it is not a
 * space, and can close when what precedes it is not one — which is what keeps
 * `2 * 3 * 4` arithmetic, since a `*` with air on both sides can do neither.
 */
function markAt(
  line: string,
  i: number,
): { mark: Mark; length: number; canOpen: boolean; canClose: boolean } | null {
  if (line.startsWith("<u>", i)) {
    return { mark: "<u>", length: 3, canOpen: true, canClose: false };
  }
  if (line.startsWith("</u>", i)) {
    return { mark: "<u>", length: 4, canOpen: false, canClose: true };
  }
  // The longer mark first, so `**` is never read as two italics.
  if (line.startsWith("**", i)) return symmetric(line, i, "**");
  const ch = line[i];
  if (ch === "*" || ch === "_") return symmetric(line, i, ch);
  return null;
}

function symmetric(
  line: string,
  i: number,
  mark: Mark,
): { mark: Mark; length: number; canOpen: boolean; canClose: boolean } {
  const before = line[i - 1];
  const after = line[i + mark.length];
  let canOpen = after !== undefined && after !== " ";
  let canClose = before !== undefined && before !== " ";
  if (mark === "_") {
    // CommonMark's rule, and the reason it has one: `under_score` is a name
    // somebody typed, not a word with an italic tail. An underscore between
    // two word characters is a character.
    if (isWord(before)) canOpen = false;
    if (isWord(after)) canClose = false;
  }
  return { mark, length: mark.length, canOpen, canClose };
}

function isWord(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

/** Join neighbours that came out with the same emphasis. */
function merge(spans: readonly Span[]): Span[] {
  const out: Span[] = [];
  for (const span of spans) {
    const last = out[out.length - 1];
    if (
      last &&
      last.bold === span.bold &&
      last.italic === span.italic &&
      last.underline === span.underline
    ) {
      last.text += span.text;
      continue;
    }
    out.push({ ...span });
  }
  return out;
}
