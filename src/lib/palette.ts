/**
 * The working palette: the colours somebody has decided this project looks
 * like, and whether they travel out with the artwork.
 *
 * **It is one palette, not a library of them.** The pattern and shape
 * libraries are libraries because a pattern is a *mark* — you keep dozens and
 * pick one per stroke. A palette is not that. It is the eight or twelve
 * colours a thing is being drawn in, and a second one is not a variation on
 * the first, it is a different picture. So there is one row, it sits directly
 * under the recents, and the way to start again is to take colours out of it.
 *
 * **App-wide, in `localStorage`**, beside the recent swatches and the two
 * libraries — see `lib/library/store.ts` for the same decision argued at
 * greater length. A palette built on Tuesday belongs to the person rather
 * than to the project they happened to have open.
 *
 * ## The difference from the recents
 *
 * The recents are a *record*: the last eight colours used, in the order they
 * were used, kept without being asked for and dropped off the end without
 * being asked either. The palette is a *decision*: nothing enters it except
 * by the `+`, and nothing leaves it except by the `−`. They look alike on
 * purpose and they are opposite kinds of list, which is why the palette row
 * is the one with buttons under it.
 */

import { alphaOf, isValidHex, normaliseHex } from "./color";

const KEY = "idlewild.palette";
const ATTACH_KEY = "idlewild.palette.attach";

/**
 * As many colours as the row will hold.
 *
 * Generous rather than tight: the browser hands over five at a time and
 * somebody taking three rows from it has fifteen before they have made a
 * single decision. The ceiling is here to stop the strip written into a PSD
 * growing without limit, not to make the palette an exercise in restraint.
 */
export const MAX_PALETTE = 48;

/** What the palette strip drawn into a PSD is, as a share of the grid. */
export const PSD_SWATCH_RATIO = 0.25;

/** The smallest a swatch may be. Below this it is not a colour, it is a dot. */
const MIN_SWATCH = 4;

/**
 * How big one square of the attached strip is, for a project on this grid.
 *
 * A quarter of a grid space. The strip has to sit *somewhere* on a canvas it
 * knows nothing about, and the only scale the file carries any relation to is
 * the grid the artwork was drawn over: a quarter of it is small enough to
 * stay out of the way on a one-space sprite and large enough to put an
 * eyedropper in the middle of on a 16px grid, which is the smallest this
 * editor offers.
 */
export function psdSwatchSize(gridSize: number): number {
  const scaled = Math.round(gridSize * PSD_SWATCH_RATIO);
  return Math.max(MIN_SWATCH, Number.isFinite(scaled) ? scaled : MIN_SWATCH);
}

/**
 * Exported so a test can make one over a stubbed store. The app has exactly
 * one, below: a second would be a second palette, which is the whole thing
 * this module says there is not.
 */
export class PaletteStore extends EventTarget {
  private colors: string[] = read();
  private attaching: boolean = readAttach();

  /** The palette, in the order it was built. */
  list(): string[] {
    return [...this.colors];
  }

  /**
   * Whether this colour is already in the palette.
   *
   * What the leading button reads to decide whether it is a `+` or a `−`.
   * Compared on the normalised string, so `#FFF`, `#ffffff` and `#ffffffff`
   * are one colour rather than three — a palette that held all three would be
   * three identical squares somebody would have to remove one at a time.
   */
  has(hex: string): boolean {
    if (!isValidHex(hex)) return false;
    const wanted = normaliseHex(hex);
    return this.colors.some((c) => c === wanted);
  }

  /**
   * Put a colour in, and say whether anything changed.
   *
   * A colour already in the palette is not added twice and does not move: the
   * order is the order they were chosen in, and re-picking one is not a
   * choice about where it sits.
   */
  add(hex: string): boolean {
    if (!isValidHex(hex)) return false;
    // At zero opacity every swatch is the same empty square — the same rule
    // the recents keep, and for the same reason.
    if (alphaOf(hex) === 0) return false;
    const next = normaliseHex(hex);
    if (this.colors.includes(next)) return false;
    if (this.colors.length >= MAX_PALETTE) return false;
    this.colors = [...this.colors, next];
    this.commit();
    return true;
  }

  /**
   * Put several in at once — what **Use** on a browsed row does.
   *
   * One write and one event for the whole row, rather than five of each: the
   * picker rebuilds its row on every change, and five rebuilds in a loop is
   * four rebuilds of a list nobody has seen yet.
   */
  addMany(hexes: readonly string[]): number {
    let added = 0;
    for (const hex of hexes) {
      if (!isValidHex(hex)) continue;
      if (alphaOf(hex) === 0) continue;
      const next = normaliseHex(hex);
      if (this.colors.includes(next)) continue;
      // The list is extended in place as this goes, so the length *is* the
      // running total: adding `added` to it again counted every colour twice
      // and stopped the row halfway to the ceiling.
      if (this.colors.length >= MAX_PALETTE) break;
      this.colors = [...this.colors, next];
      added += 1;
    }
    if (added > 0) this.commit();
    return added;
  }

  remove(hex: string): boolean {
    if (!isValidHex(hex)) return false;
    const wanted = normaliseHex(hex);
    const next = this.colors.filter((c) => c !== wanted);
    if (next.length === this.colors.length) return false;
    this.colors = next;
    this.commit();
    return true;
  }

  clear(): void {
    if (this.colors.length === 0) return;
    this.colors = [];
    this.commit();
  }

  /**
   * Whether the palette goes out with a PSD — see `editor/psd-actions.ts`.
   *
   * A preference rather than a property of the palette, but stored beside it
   * because it is meaningless apart from it: what the toggle attaches is
   * *this* list, and a project with an empty palette attaches nothing whatever
   * the flag says.
   */
  get attach(): boolean {
    return this.attaching;
  }

  set attach(on: boolean) {
    if (this.attaching === on) return;
    this.attaching = on;
    try {
      localStorage.setItem(ATTACH_KEY, on ? "1" : "0");
    } catch {
      // Blocked site data — it just does not persist. See `read`.
    }
    this.dispatchEvent(new Event("change"));
  }

  private commit(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.colors));
    } catch {
      // A full or refused store is not worth failing an edit over: the
      // palette stays right for this session and comes back as it was.
    }
    this.dispatchEvent(new Event("change"));
  }
}

export const palette = new PaletteStore();

/**
 * Hear about a change to the palette, and get the way to stop hearing.
 *
 * The same shape as `onLibraryChange`, and for the same reason: several
 * copies of the colour picker are on screen at once — the TOOL zone, a fill's
 * own panel, the backdrop's — and a `+` pressed in one has to reach the rest.
 */
export function onPaletteChange(listener: () => void): () => void {
  palette.addEventListener("change", listener);
  return () => palette.removeEventListener("change", listener);
}

/**
 * How **Browse Palettes** opens, and the way to take it back.
 *
 * The browser is a panel docked to the editor's sidebar, and the picker that
 * offers it lives in `lib/` — which nothing in `editor/` may be imported
 * from. So the editor registers the opener on its way up and drops it on the
 * way down, and a picker with nothing registered simply does not draw the
 * button. The same arrangement as `eyedropper.ts`'s engine sampler, and for
 * the same reason.
 */
let browser: (() => void) | null = null;

export function setPaletteBrowser(open: (() => void) | null): () => void {
  browser = open;
  return () => {
    if (browser === open) browser = null;
  };
}

/** Whether there is a browser to open — what decides if the button is drawn. */
export function hasPaletteBrowser(): boolean {
  return browser !== null;
}

export function openPaletteBrowser(): void {
  browser?.();
}

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const value of parsed) {
      if (typeof value !== "string" || !isValidHex(value)) continue;
      const hex = normaliseHex(value);
      if (!out.includes(hex)) out.push(hex);
      if (out.length >= MAX_PALETTE) break;
    }
    return out;
  } catch {
    return [];
  }
}

function readAttach(): boolean {
  try {
    return localStorage.getItem(ATTACH_KEY) === "1";
  } catch {
    return false;
  }
}
