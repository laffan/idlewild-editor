/**
 * Chrome that floats over the canvas beside the thing it is about.
 *
 * Two of these now — the action bar over a grid selection, and the Fill /
 * Cancel pair over a half-built point-to-point shape — and the placement is
 * the same problem both times, with the same three traps in it. So the
 * arithmetic is written once here and the bars are only their buttons.
 *
 * The traps, in the order they were fallen into:
 *
 * - **The anchor is in viewport coordinates and the bar is not.** It is
 *   absolutely positioned inside the canvas column, so the column's own
 *   origin has to come back off at the end.
 * - **The column is what it has to stay inside, not the window.** Bounding it
 *   by the window let it slide under the layers panel, where the column's
 *   `overflow: hidden` clipped the first button off — which looks like a
 *   button that is not there rather than one that is out of view.
 * - **The tool columns are inside the column too.** Both run down its left
 *   edge, and a bar centred on something near that edge landed on top of
 *   them — covering the very buttons you reach for while the thing the bar is
 *   about is still in hand. So the left bound clears them; see `FLOAT_GUTTER`.
 * - **A hidden element has no width to centre on.** Whatever is being placed
 *   has to be visible before it is measured.
 */

/** Where the thing being annotated is on screen, in viewport coordinates. */
export interface FloatAnchor {
  /** Its left edge. */
  x: number;
  /** Its top edge. */
  y: number;
  /** How wide it is, so the bar can be centred over it. */
  width: number;
}

/** Kept this far clear of the edges of the column it floats in. */
export const FLOAT_MARGIN = 12;

/**
 * And this far clear of its left edge, where the tool columns are.
 *
 * The rail's own 16px inset plus a 56px button plus a gap. It applies down
 * the whole height rather than only where a column actually is: the rail
 * hangs from the top and the drawing toolbar stands on the bottom, so between
 * them they cover most of that edge, and a bound that came and went as a bar
 * moved up the screen would be harder to predict than one that is always
 * there.
 */
export const FLOAT_GUTTER = 88;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}

/**
 * Put `root` over `anchor`: centred on it, above it where there is room and
 * below it where there is not, and never outside the column it lives in.
 *
 * Call it only on an element that is already visible.
 */
export function placeFloating(root: HTMLElement, anchor: FloatAnchor): void {
  const rect = root.getBoundingClientRect();
  const host = root.offsetParent?.getBoundingClientRect() ?? {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
  };

  const left = clamp(
    anchor.x + anchor.width / 2 - rect.width / 2,
    // Never narrower than the right-hand bound, on a column too narrow to
    // hold the bar clear of the gutter at all: `clamp` would then return the
    // gutter and push the bar off the right-hand edge.
    Math.min(host.left + FLOAT_GUTTER, host.right - rect.width - FLOAT_MARGIN),
    host.right - rect.width - FLOAT_MARGIN,
  );
  const above = anchor.y - rect.height - FLOAT_MARGIN;
  const top = clamp(
    above < host.top + FLOAT_MARGIN ? anchor.y + FLOAT_MARGIN : above,
    host.top + FLOAT_MARGIN,
    host.bottom - rect.height - FLOAT_MARGIN,
  );

  root.style.left = `${left - host.left}px`;
  root.style.top = `${top - host.top}px`;
}
