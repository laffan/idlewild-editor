/**
 * Extrude mode as the editor shell sees it: a bar, its toggles, and a class
 * on the canvas while it is up.
 *
 * The mode itself lives in the scene (`game/extrude-mode.ts`), because it is
 * made of gestures and geometry. What is here is everything about it that is
 * chrome — entering from the floating action bar or from the inspector,
 * keeping the bar's readout in step, the modifier key that borrows X-ray, and
 * Apply, which is the one thing the mode deliberately cannot do for itself:
 * it has no idea what a project is, and writing a PSD needs one.
 */

import type { DocStore } from "../lib/doc-store";
import { translateShape } from "../lib/extrude";
import type { Grid } from "../lib/grid";
import * as log from "../lib/log";
import { instanceOf } from "../game/instance";
import type { WorldScene } from "../game/world-scene";
import { ExtrudeBar } from "./extrude-bar";
import { applyExtrusion } from "./extrude-actions";

export interface ExtrudeUiOptions {
  projectId: string;
  store: DocStore;
  grid: Grid;
  /** The canvas column: the bar sits in it, and wears the mode's class. */
  host: HTMLElement;
  scene: () => WorldScene | null;
  /**
   * Extrude mode reads drags and holds over the canvas, so a drawing tool
   * holding the pointer would leave it unreachable. Entering picks Select.
   */
  useSelectTool: () => void;
  /**
   * The zoom this project opens at, read when Apply writes the file: the
   * lines it bakes are as thin as the canvas's own lattice looks there. A
   * function rather than a number, because Project Options can change it
   * between one pull and the next.
   */
  defaultZoom: () => number;
}

export interface ExtrudeUi {
  /** Enter the mode over whatever region selection is up. */
  open: () => void;
  /** Re-enter it over the solid behind whatever placement is selected. */
  resume: () => void;
  /** The scene says something changed; put it in the bar. */
  sync: () => void;
  destroy: () => void;
}

export function createExtrudeUi(options: ExtrudeUiOptions): ExtrudeUi {
  const bar = new ExtrudeBar({
    onApply: () => void apply(),
    onCancel: () => options.scene()?.modes.extrude.stop(),
    onToggleBackfaces: () => {
      const mode = options.scene()?.modes.extrude;
      mode?.setBackfaces(!mode.xray);
    },
    onToggleErase: () => {
      const mode = options.scene()?.modes.extrude;
      mode?.setTool(mode.erasing ? "pull" : "erase");
    },
  });
  options.host.appendChild(bar.root);

  /**
   * ⌘ (or Ctrl) borrows X-ray for as long as it is held, the way space
   * borrows Pan everywhere else in this editor.
   *
   * Watched on the window rather than the canvas, which never takes focus:
   * every pointer handler over it calls `preventDefault`, so nothing in the
   * scene is ever the key event's target. A window that loses focus mid-hold
   * never sees the keyup, so blur releases it too.
   */
  function peek(on: boolean): void {
    options.scene()?.modes.extrude.setPeek(on);
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Meta" || event.key === "Control") peek(true);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === "Meta" || event.key === "Control") peek(false);
  };
  const onBlur = (): void => peek(false);

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  function sync(): void {
    const scene = options.scene();
    const mode = scene?.modes.extrude;
    const active = mode?.active ?? false;
    // A solid being carried on with stands on exactly the ground its own flat
    // artwork covers, so the placement steps aside while the work goes on.
    // Derived here rather than switched on and off at each call site, so
    // however the mode ends — Cancel, Apply, a trip through play mode — the
    // unit comes back.
    scene?.suppressInstance(active ? mode?.target?.instance ?? null : null);
    options.host.classList.toggle("extruding", active);
    bar.update({
      active,
      summary: mode?.summary ?? "",
      canApply: !!mode?.shape,
      backfaces: mode?.xray ?? false,
      erasing: mode?.erasing ?? false,
      hasBackfaces: mode?.hasBackfaces ?? false,
    });
  }

  function open(): void {
    const scene = options.scene();
    const selection = scene?.getSelection();
    if (!scene || selection?.kind !== "region") {
      log.warn("Hold on the grid to choose the spaces to extrude first");
      return;
    }
    options.useSelectTool();
    scene.modes.startExtrude(selection.from, selection.to);
    sync();
  }

  /**
   * Re-open the solid a placed PSD was made from.
   *
   * The voxels were written against the space the artwork hung from at the
   * time; if the placement has been dragged since, the difference between
   * that space and its anchor now is how far the whole shape has moved, so
   * the shape is carried the same way and reopens under its own artwork.
   */
  function resume(): void {
    const scene = options.scene();
    const selection = scene?.getSelection();
    if (!scene || selection?.kind !== "placement") return;
    const placement = options.store
      .layer(selection.layerId)
      ?.placements.find((p) => p.id === selection.placementId);
    if (!placement) return;

    const held = options.store.extrusion(placement.psdKey);
    if (!held) {
      log.warn(`${placement.psdKey}.psd is not an extrusion this editor made`);
      return;
    }

    const shape = translateShape(new Set(held.voxels), {
      cx: placement.anchor.cx - held.anchor.cx,
      cy: placement.anchor.cy - held.anchor.cy,
    });
    options.useSelectTool();
    scene.modes.resumeExtrude(shape, {
      key: placement.psdKey,
      instance: instanceOf(placement),
      layerId: selection.layerId,
    });
    sync();
  }

  /**
   * Write the solid out and leave.
   *
   * The mode stays up until the file is written. A write can be refused — a
   * PSD with groups or masks cannot be rebuilt without flattening it, so the
   * rewrite declines rather than doing that — and a session that had already
   * closed would have taken the shape with it. So the greybox holds until
   * there is something to replace it with, which also reads as the work it
   * is: the unit it was carrying on with is still hidden, so nothing flashes
   * back into place first.
   */
  async function apply(): Promise<void> {
    const scene = options.scene();
    const shape = scene?.modes.extrude.shape;
    if (!scene || !shape) return;
    const written = await applyExtrusion(
      options.projectId,
      options.store,
      options.grid,
      scene,
      shape,
      scene.modes.extrude.target,
      options.defaultZoom(),
    );
    if (!written) return;
    scene.modes.extrude.stop();
    sync();
  }

  return {
    open,
    resume,
    sync,
    destroy: () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      options.scene()?.modes.extrude.stop();
      options.host.classList.remove("extruding");
      bar.destroy();
    },
  };
}
