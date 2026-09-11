/**
 * The floating action bar over a grid selection: Fill, Add Image, Generate
 * PSD and Extrude. Follows the selection as the camera moves.
 *
 * All four are ways of turning "this much space" into something: a colour, a
 * file from disk, an empty PSD to go and paint, or a solid pulled up off the
 * grid. Export used to sit here and is gone — sending a PNG *out* is the
 * opposite of what the others do, and it belonged with the selection about as
 * much as Save As belongs on a shape.
 *
 * Extrude is the one that is not always there. It needs a lattice to stack
 * on, and a blank project's spaces are single world pixels, so it is offered
 * on the two templates that snap and left off the one that does not.
 */

import { h } from "../lib/dom";
import { describeRange, type Grid } from "../lib/grid";
import type { Selection } from "../lib/types";

/** Where the selection is on screen, in viewport coordinates. */
export interface SelectionAnchor {
  /** Its left edge. */
  x: number;
  /** Its top edge. */
  y: number;
  /** How wide it is, so the bar can be centred over it. */
  width: number;
}

export interface SelectionActionCallbacks {
  onFill: () => void;
  onAddImage: () => void;
  onGeneratePsd: () => void;
  onExtrude: () => void;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}

/** Kept this far clear of the edges of the column it floats in. */
const MARGIN = 12;

export class SelectionActions {
  readonly root: HTMLElement;
  private readonly size: HTMLElement;
  private readonly grid: Grid;

  constructor(grid: Grid, callbacks: SelectionActionCallbacks) {
    this.grid = grid;
    this.size = h("div", { class: "selection-size m" });
    this.root = h(
      "div",
      { class: "selection-actions hidden" },
      h("button", { text: "Fill", onClick: callbacks.onFill }),
      h("button", { text: "Add Image", onClick: callbacks.onAddImage }),
      h("button", { text: "Generate PSD", onClick: callbacks.onGeneratePsd }),
      grid.snaps && h("button", { text: "Extrude", onClick: callbacks.onExtrude }),
      this.size,
    );
  }

  update(selection: Selection, anchor: SelectionAnchor | null): void {
    if (selection.kind !== "region" || !anchor) {
      this.root.classList.add("hidden");
      return;
    }

    this.size.textContent = describeRange(this.grid, selection.from, selection.to);
    this.root.classList.remove("hidden");

    // Measured after un-hiding, because a hidden element has no width to
    // centre on.
    const rect = this.root.getBoundingClientRect();

    // The anchor is in viewport coordinates, and the bar is positioned inside
    // whatever it is absolutely positioned against — the canvas column, not
    // the viewport. That column is also what it has to stay inside: bounding
    // it by the window instead let it slide under the layers panel, where the
    // column's own overflow clipped the first button off.
    const host = this.root.offsetParent?.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
    };

    const left = clamp(
      anchor.x + anchor.width / 2 - rect.width / 2,
      host.left + MARGIN,
      host.right - rect.width - MARGIN,
    );
    // Above the selection where it fits, below it where it does not.
    const above = anchor.y - rect.height - MARGIN;
    const top = clamp(
      above < host.top + MARGIN ? anchor.y + MARGIN : above,
      host.top + MARGIN,
      host.bottom - rect.height - MARGIN,
    );

    this.root.style.left = `${left - host.left}px`;
    this.root.style.top = `${top - host.top}px`;
  }
}
