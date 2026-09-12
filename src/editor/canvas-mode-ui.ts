/**
 * The three modes that take the canvas over, as the shell builds them.
 *
 * The counterpart to `game/canvas-modes.ts`, which groups the same three on
 * the scene's side and for the same reason: they are one idea in three
 * shapes. Each is a bar along the bottom of the canvas column, a class on
 * that column while it is up, and one thing the mode itself deliberately
 * cannot do — extrude and pen write files, and none of the three know what a
 * project is.
 *
 * What differs between them is only where they are entered from — the
 * floating action bar, a row of the inspector, a row of a PSD's layer list —
 * and what the pointer means once they are up. What they need from the shell
 * is nearly the same list, which is what makes this worth writing once.
 */

import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import type { DrawingLayer } from "../drawing";
import type { WorldScene } from "../game/world-scene";
import { createColliderUi, type ColliderUi } from "./collider";
import { createExtrudeUi, type ExtrudeUi } from "./extrude";
import { createPenUi, type PenUi } from "./pen";

export interface CanvasModeUiOptions {
  projectId: string;
  store: DocStore;
  grid: Grid;
  /** The canvas column: every bar sits in it, and wears the mode's class. */
  host: HTMLElement;
  scene: () => WorldScene | null;
  drawing: () => DrawingLayer | null;
  /**
   * Two of the three read the pointer over the canvas, so a drawing tool
   * holding it would leave them unreachable; the third *is* a drawing tool.
   */
  useSelectTool: () => void;
  usePencil: () => void;
  /** The document layer new ink lands on, which is where pen mode's is. */
  inkLayerId: () => string;
  /**
   * The zoom this project opens at, read when an extrusion is written: the
   * lines it bakes are as thin as the canvas's lattice looks there. A
   * function, because Project Options can change it between one pull and the
   * next.
   */
  defaultZoom: () => number;
  /** A PSD was rewritten and re-parsed; take the result back. */
  onPsdWritten: (key: string, manifest: string) => Promise<void> | void;
}

export interface CanvasModeUis {
  extrude: ExtrudeUi;
  collider: ColliderUi;
  pen: PenUi;
  destroy: () => void;
}

export function createCanvasModeUis(
  options: CanvasModeUiOptions,
): CanvasModeUis {
  const shared = {
    store: options.store,
    grid: options.grid,
    host: options.host,
    scene: options.scene,
  };

  // Pulled out of the grid, from the floating action bar over a selection.
  const extrude = createExtrudeUi({
    ...shared,
    projectId: options.projectId,
    useSelectTool: options.useSelectTool,
    defaultZoom: options.defaultZoom,
  });

  // Painted on the grid, from the inspector's Collider section — a collider
  // is about a file that is already standing on it.
  const collider = createColliderUi({
    ...shared,
    useSelectTool: options.useSelectTool,
  });

  // Drawn into, from a sprite row of a PSD's layer list. Unlike the other two
  // it does not hold the pointer: the drawing layer does, as it does
  // everywhere else. What this owns is the frame, the session's ink, and
  // getting that ink into the file.
  const pen = createPenUi({
    ...shared,
    projectId: options.projectId,
    drawing: options.drawing,
    usePencil: options.usePencil,
    inkLayerId: options.inkLayerId,
    onWritten: options.onPsdWritten,
  });

  return {
    extrude,
    collider,
    pen,
    destroy: () => {
      extrude.destroy();
      collider.destroy();
      pen.destroy();
    },
  };
}
