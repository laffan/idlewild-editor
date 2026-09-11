/**
 * Extrude mode as the editor shell sees it: a bar, two ways out, and a class
 * on the canvas while it is up.
 *
 * The mode itself lives in the scene (`game/extrude-mode.ts`), because it is
 * made of gestures and geometry. What is here is everything about it that is
 * chrome — entering from the floating action bar, keeping the bar's readout
 * in step, and Apply, which is the one thing the mode deliberately cannot do
 * for itself: it has no idea what a project is, and writing a PSD needs one.
 */

import type { Grid } from "../lib/grid";
import * as log from "../lib/log";
import type { WorldScene } from "../game/world-scene";
import { ExtrudeBar } from "./extrude-bar";
import { applyExtrusion } from "./extrude-actions";

export interface ExtrudeUiOptions {
  projectId: string;
  grid: Grid;
  /** The canvas column: the bar sits in it, and wears the mode's class. */
  host: HTMLElement;
  scene: () => WorldScene | null;
  /**
   * Extrude mode reads drags and holds over the canvas, so a drawing tool
   * holding the pointer would leave it unreachable. Entering picks Select.
   */
  useSelectTool: () => void;
}

export interface ExtrudeUi {
  /** Enter the mode over whatever region selection is up. */
  open: () => void;
  /** The scene says something changed; put it in the bar. */
  sync: () => void;
  destroy: () => void;
}

export function createExtrudeUi(options: ExtrudeUiOptions): ExtrudeUi {
  const bar = new ExtrudeBar({
    onApply: () => void apply(),
    onCancel: () => options.scene()?.extrude.stop(),
  });
  options.host.appendChild(bar.root);

  function sync(): void {
    const mode = options.scene()?.extrude;
    const active = mode?.active ?? false;
    options.host.classList.toggle("extruding", active);
    bar.update(active, mode?.summary ?? "", !!mode?.shape);
  }

  function open(): void {
    const scene = options.scene();
    const selection = scene?.getSelection();
    if (!scene || selection?.kind !== "region") {
      log.warn("Hold on the grid to choose the spaces to extrude first");
      return;
    }
    options.useSelectTool();
    scene.extrude.start(selection.from, selection.to);
    sync();
  }

  /**
   * Write the solid out and leave.
   *
   * The shape is read before the mode is stopped, and the mode is stopped
   * before the PSD is written: the dim and the greybox have done their job by
   * then, and leaving them up over an import that takes a second or two would
   * make the canvas look stuck.
   */
  async function apply(): Promise<void> {
    const scene = options.scene();
    const shape = scene?.extrude.shape;
    if (!scene || !shape) return;
    scene.extrude.stop();
    sync();
    await applyExtrusion(options.projectId, options.grid, scene, shape);
  }

  return {
    open,
    sync,
    destroy: () => {
      options.scene()?.extrude.stop();
      options.host.classList.remove("extruding");
      bar.destroy();
    },
  };
}
