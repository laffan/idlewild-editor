/**
 * The Fill / Undo corner / Cancel bar, floating beside a shape being tapped
 * out with the point-to-point fill.
 *
 * These three were rows in the inspector's TOOL zone first, and that was the
 * wrong place for them twice over. A shape is built by looking at the canvas,
 * so a button that finishes it 300 pixels away in a side panel is a button
 * nobody looks at — *Fill shape* was there the whole time and read as one more
 * setting. And the gesture that closes the shape, tapping the first corner
 * again, is the kind of thing you only find once somebody tells you: the bar
 * standing over the shape is what tells you.
 *
 * So it is chrome beside the work, which is what the action bar over a grid
 * selection already is; both place themselves through `float-bar.ts`. The
 * difference is what they are about — that one floats over a patch of ground
 * you selected, this one over a shape that does not exist yet.
 *
 * **Fill is refused rather than hidden** under three corners. Two corners are
 * a line and the button is about to be useful again, so it greys out and stays
 * where it is: a button that appears at the third tap is a button that moves
 * the other two under your finger.
 */

import { h } from "../lib/dom";
import { placeFloating, type FloatAnchor } from "./float-bar";
import type { DrawingLayer } from "../drawing";

export interface FillBarCallbacks {
  /** Lay the shape down. Only reachable with three corners or more. */
  onFill: () => void;
  /** Take the last corner back off. */
  onUndo: () => void;
  /** Throw the whole shape away. */
  onCancel: () => void;
}

export class FillBar {
  readonly root: HTMLElement;
  private readonly fill: HTMLButtonElement;
  private readonly count: HTMLElement;

  constructor(callbacks: FillBarCallbacks) {
    this.fill = h("button", { class: "float-go", text: "Fill", onClick: callbacks.onFill });
    this.count = h("div", { class: "float-note m" });
    this.root = h(
      "div",
      { class: "canvas-float hidden" },
      this.fill,
      h("button", { text: "Undo corner", onClick: callbacks.onUndo }),
      h("button", { text: "Cancel", onClick: callbacks.onCancel }),
      this.count,
    );
  }

  /**
   * Show the bar over the shape, or take it down.
   *
   * `anchor` is null whenever there is no shape being shown — no corners down,
   * or a tool in hand that is not the point-to-point fill. The shape survives
   * a change of tool but stops being drawn, and a bar offering to fill
   * something invisible would be a bar about nothing.
   */
  update(anchor: FloatAnchor | null, corners: number): void {
    const show = anchor !== null && corners > 0;
    this.root.classList.toggle("hidden", !show);
    if (!anchor || !show) return;
    this.fill.disabled = corners < 3;
    this.count.textContent = `${corners} ${corners === 1 ? "corner" : "corners"}`;
    // After un-hiding: a hidden element has no width to centre on.
    placeFloating(this.root, anchor);
  }
}

/** What the bar needs from the shell to run itself. */
export interface FillBarUiOptions {
  /** Read through: the drawing layer is built long after this is. */
  drawing: () => DrawingLayer | null;
  /**
   * The corner count is on screen in the TOOL zone as well, and a half-built
   * shape is drawing-layer state rather than a document edit — so nothing
   * fires a `change` for the panel to hear.
   */
  onChanged: () => void;
}

export interface FillBarUi {
  root: HTMLElement;
  /** Put the bar back over the shape, or take it down. */
  sync: () => void;
}

/**
 * The bar, wired to the drawing layer that owns the shape.
 *
 * Here rather than in `editor.ts` because all three buttons and the sync are
 * the same two lines — ask the drawing layer, tell the panel — and the shell
 * has no other business with a shape that is not in the document yet.
 */
export function createFillBarUi(options: FillBarUiOptions): FillBarUi {
  const act = (run: (drawing: DrawingLayer) => void) => () => {
    const drawing = options.drawing();
    if (!drawing) return;
    run(drawing);
    options.onChanged();
    sync();
  };

  const bar = new FillBar({
    onFill: act((drawing) => void drawing.fillPoints()),
    onUndo: act((drawing) => drawing.undoFillPoint()),
    onCancel: act((drawing) => drawing.clearFillPoints()),
  });

  function sync(): void {
    const drawing = options.drawing();
    bar.update(drawing?.fillPointsAnchor() ?? null, drawing?.fillPointCount ?? 0);
  }

  return { root: bar.root, sync };
}
