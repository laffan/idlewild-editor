/**
 * The four modes that take the canvas over, as the shell builds them.
 *
 * The counterpart to `game/canvas-modes.ts`, which groups the same four on
 * the scene's side and for the same reason: they are one idea in four
 * shapes. Each is a bar along the bottom of the canvas column, a class on
 * that column while it is up, and one thing the mode itself deliberately
 * cannot do — extrude and PSD Edit write files, mask mode writes the document,
 * and none of them know what a project is.
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
import { createMaskUi, type MaskUi } from "./mask";
import { createPsdEditUi, type PsdEditUi } from "./psd-edit";

export interface CanvasModeUiOptions {
  projectId: string;
  store: DocStore;
  grid: Grid;
  /** The canvas column: every bar sits in it, and wears the mode's class. */
  host: HTMLElement;
  scene: () => WorldScene | null;
  drawing: () => DrawingLayer | null;
  /**
   * Three of the four read the pointer over the canvas, so a drawing tool
   * holding it would leave them unreachable; the fourth *is* a drawing tool.
   */
  useSelectTool: () => void;
  usePencil: () => void;
  /** The document layer new ink lands on, which is where PSD Edit mode's is. */
  inkLayerId: () => string;
  /**
   * The zoom this project opens at, read when an extrusion is written: the
   * lines it bakes are as thin as the canvas's lattice looks there. A
   * function, because Project Options can change it between one pull and the
   * next.
   */
  defaultZoom: () => number;
  /** Rub was pressed on PSD Edit mode's bar, or pressed again to leave it. */
  useRub: (rubbing: boolean) => void;
  /** Whether the pointer is the rubber, so that bar can show it pressed. */
  isRubbing: () => boolean;
  /** A PSD was rewritten and re-parsed; take the result back. */
  onPsdWritten: (key: string, manifest: string) => Promise<void> | void;
  /**
   * Mask mode is over, either way out.
   *
   * It is the one of the four entered from the *left* sidebar rather than
   * from something on the canvas, so the way back is a layer rather than a
   * placement: the panel every one of its buttons is on is the layer's own.
   */
  onMaskDone: (layerId: string) => void;
}

export interface CanvasModeUis {
  extrude: ExtrudeUi;
  collider: ColliderUi;
  psdEdit: PsdEditUi;
  mask: MaskUi;
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
  const psdEdit = createPsdEditUi({
    ...shared,
    projectId: options.projectId,
    drawing: options.drawing,
    usePencil: options.usePencil,
    inkLayerId: options.inkLayerId,
    useRub: options.useRub,
    isRubbing: options.isRubbing,
    onWritten: options.onPsdWritten,
  });

  // Swept on the grid, from a pattern layer's own panel. The only one of the
  // four whose subject is a *layer* rather than something standing on one,
  // which is why it is entered from the sidebar and hands a layer back.
  const mask = createMaskUi({
    ...shared,
    useSelectTool: options.useSelectTool,
    onDone: options.onMaskDone,
  });

  return {
    extrude,
    collider,
    psdEdit,
    mask,
    destroy: () => {
      extrude.destroy();
      collider.destroy();
      psdEdit.destroy();
      mask.destroy();
    },
  };
}
