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
import { placeFloating, type FloatAnchor } from "./float-bar";
import type { Selection } from "../lib/types";

/** Where the selection is on screen, in viewport coordinates. */
export type SelectionAnchor = FloatAnchor;

export interface SelectionActionCallbacks {
  onFill: () => void;
  onAddImage: () => void;
  onGeneratePsd: () => void;
  onExtrude: () => void;
  /**
   * Confine the active pattern layer to this patch of grid.
   *
   * The one button here that is not about turning space into content: it says
   * *where* something already on the layer is allowed to be. It only appears
   * when the active layer is a pattern layer, because on any other layer it
   * would have nothing to confine.
   */
  onPatternShape: () => void;
}

export class SelectionActions {
  readonly root: HTMLElement;
  private readonly size: HTMLElement;
  private readonly patternShape: HTMLElement;
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
    this.patternShape = h("button", {
      text: "Pattern Shape",
      onClick: callbacks.onPatternShape,
    });
    // Inserted before the size readout, which is the row's last element.
    this.root.insertBefore(this.patternShape, this.size);
    this.patternShape.hidden = true;
  }

  /**
   * Offer Pattern Shape, or stop.
   *
   * Told by the shell rather than worked out here: which layer is active is
   * the shell's business, and this bar is handed a selection and a place to
   * float rather than the document.
   */
  setPatternLayer(on: boolean): void {
    this.patternShape.hidden = !on;
  }

  update(selection: Selection, anchor: SelectionAnchor | null): void {
    if (selection.kind !== "region" || !anchor) {
      this.root.classList.add("hidden");
      return;
    }

    this.size.textContent = describeRange(this.grid, selection.from, selection.to);
    this.root.classList.remove("hidden");
    // After un-hiding, because a hidden element has no width to centre on —
    // see `float-bar.ts` for the rest of what the placement has to get right.
    placeFloating(this.root, anchor);
  }
}
