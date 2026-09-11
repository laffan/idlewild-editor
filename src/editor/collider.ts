/**
 * Collider mode as the editor shell sees it: a bar, and the two ends of a
 * session.
 *
 * The counterpart to `editor/extrude.ts`, and split the same way. The mode
 * itself lives in the scene (`game/collider-mode.ts`) because it is made of
 * gestures and geometry; what is here is the chrome around it — opening it
 * over whatever is selected, keeping the bar in step, and Apply, which is the
 * one thing the mode deliberately cannot do for itself because it has no
 * business writing to the document.
 *
 * Opening one asks the document two questions: what this file blocks now, and
 * what it would block if nobody had ever said. The first is the shape to
 * edit; the second is what Reset goes back to, which is why it is worked out
 * here rather than remembered — a default is derived from the artwork and the
 * solid behind it, and both of those can have changed since the collider was
 * last written.
 */

import {
  colliderCells,
  defaultCollider,
  placementsBox,
} from "../lib/collider";
import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import * as log from "../lib/log";
import type { Cell, Collider } from "../lib/types";
import { instanceMembers, instanceOf } from "../game/instance";
import type { WorldScene } from "../game/world-scene";
import { ColliderBar } from "./collider-bar";

export interface ColliderUiOptions {
  store: DocStore;
  grid: Grid;
  /** The canvas column: the bar sits in it, and wears the mode's class. */
  host: HTMLElement;
  scene: () => WorldScene | null;
  /**
   * Collider mode reads presses and drags over the canvas, so a drawing tool
   * holding the pointer would leave it unreachable. Entering picks Select.
   */
  useSelectTool: () => void;
}

export interface ColliderUi {
  /** Enter the mode over whatever placement is selected. */
  open: () => void;
  /** The scene says something changed; put it in the bar. */
  sync: () => void;
  destroy: () => void;
}

export function createColliderUi(options: ColliderUiOptions): ColliderUi {
  const bar = new ColliderBar({
    onApply: () => apply(),
    onCancel: () => options.scene()?.modes.collider.stop(),
    onTool: (tool) => {
      options.scene()?.modes.collider.setTool(tool);
      sync();
    },
    onReset: () => options.scene()?.modes.collider.reset(),
  });
  options.host.appendChild(bar.root);

  function sync(): void {
    const mode = options.scene()?.modes.collider;
    const active = mode?.active ?? false;
    options.host.classList.toggle("colliding", active);
    bar.update({
      active,
      key: mode?.editing?.key ?? "",
      summary: mode?.summary ?? "",
      tool: mode?.currentTool ?? "add",
      isDefault: mode?.isDefault ?? true,
    });
  }

  /**
   * Open the collider of the selected placement.
   *
   * The unit's anchor rather than the selected layer's: every member of a
   * placed PSD hangs from the same space, and the collider is a fact about
   * the file rather than about whichever of its layers happened to be tapped.
   */
  function open(): void {
    const scene = options.scene();
    const selection = scene?.getSelection();
    if (!scene || selection?.kind !== "placement") {
      log.warn("Select a placed image to edit its collider");
      return;
    }
    const placement = options.store
      .layer(selection.layerId)
      ?.placements.find((p) => p.id === selection.placementId);
    if (!placement) return;

    const instance = instanceOf(placement);
    const members = instanceMembers(
      options.store.layers,
      selection.layerId,
      instance,
    );
    const anchor = placement.anchor;
    const fallback = defaultCollider(
      options.grid,
      anchor,
      placementsBox(members),
      options.store.extrusion(placement.psdKey),
    );
    const held = options.store.collider(placement.psdKey) ?? fallback;

    options.useSelectTool();
    scene.modes.startCollider(
      { key: placement.psdKey, instance, layerId: selection.layerId, anchor },
      colliderCells(held, anchor),
      colliderCells(fallback, anchor),
    );
    sync();
  }

  /**
   * Write the spaces out and leave.
   *
   * A collider that has come back to the default is written as one rather
   * than as an edit: `edited` is what stops a re-import or a second Apply
   * from recomputing the shape, and claiming it for a shape nobody changed
   * would quietly freeze a default that should still follow its artwork.
   */
  function apply(): void {
    const scene = options.scene();
    const mode = scene?.modes.collider;
    const target = mode?.editing;
    if (!scene || !mode || !target) return;

    const held = options.store.collider(target.key);
    const collider: Collider = {
      cells: offsetsFrom(mode.shape, target.anchor),
      // Whether it blocks at all is the inspector's switch, not this mode's:
      // what is being drawn here is the shape, and a collider someone is
      // shaping while it is switched off is still switched off afterwards.
      blocking: held?.blocking ?? true,
    };
    if (!mode.isDefault) collider.edited = true;

    options.store.setCollider(target.key, collider);
    log.info(
      `${target.key}.psd blocks ${collider.cells.length} ` +
        `${collider.cells.length === 1 ? "space" : "spaces"}`,
    );
    mode.stop();
    sync();
  }

  return {
    open,
    sync,
    destroy: () => {
      options.scene()?.modes.collider.stop();
      options.host.classList.remove("colliding");
      bar.destroy();
    },
  };
}

/** Absolute spaces back into what the document stores: offsets. */
function offsetsFrom(cells: readonly Cell[], anchor: Cell): Cell[] {
  return cells.map((cell) => ({
    cx: cell.cx - anchor.cx,
    cy: cell.cy - anchor.cy,
  }));
}
