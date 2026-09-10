/**
 * The floating action bar over a grid selection: Fill, Add Image, Export.
 * Follows the selection as the camera moves.
 */

import { h } from "../lib/dom";
import { describeRange, type Grid } from "../lib/grid";
import type { Selection } from "../lib/types";

export interface SelectionActionCallbacks {
  onFill: () => void;
  onAddImage: () => void;
  onExport: () => void;
}

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
      h("button", { text: "Export", onClick: callbacks.onExport }),
      this.size,
    );
  }

  /**
   * @param anchor viewport coordinates of the selection's top-left, or null
   *               when nothing suitable is selected
   */
  update(selection: Selection, anchor: { x: number; y: number } | null): void {
    if (selection.kind !== "region" || !anchor) {
      this.root.classList.add("hidden");
      return;
    }

    this.size.textContent = describeRange(this.grid, selection.from, selection.to);
    this.root.classList.remove("hidden");

    // Sit above the selection where there is room, below it where there is not.
    const rect = this.root.getBoundingClientRect();
    const top = anchor.y - rect.height - 12;
    this.root.style.left = `${Math.max(
      12,
      Math.min(anchor.x, window.innerWidth - rect.width - 12),
    )}px`;
    this.root.style.top = `${top < 88 ? anchor.y + 12 : top}px`;
  }
}
