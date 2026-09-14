/**
 * Mask mode as the editor shell sees it: a bar, and the two ends of a session.
 *
 * The counterpart to `editor/collider.ts`, split the same way and for the same
 * reason. The mode itself lives in the scene (`game/mask-mode.ts`) because it
 * is a set of grid spaces and a sweep; what is here is the chrome around it —
 * opening it over a shape the panel named, keeping the bar in step, and Apply,
 * which the mode deliberately cannot do for itself because it has no business
 * writing to the document.
 *
 * ## What this replaced
 *
 * Two buttons and a held request. **Add Shape — select** put the Select tool
 * up and waited for somebody to long-press a patch of grid and then find
 * *Pattern Shape* on the floating action bar. **Add Shape — draw** put the
 * pencil up and waited for somebody to find *Finish shape* back in the panel
 * — and then took every stroke on the layer, threaded them into one polygon
 * and deleted them. Neither said the canvas was in a mode, because neither
 * was one.
 *
 * The select half still exists, as a shortcut rather than as a route: a patch
 * of grid you have already selected is a shape you have already described, so
 * *Pattern Shape* on the floating bar opens this mode **seeded** with those
 * spaces. Seeded rather than written — Cancel still means nothing happened,
 * and the spaces can be trimmed before anybody commits to them.
 */

import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import type { Cell } from "../lib/types";
import { layerKind, patternSpec, writePatternShape } from "../lib/layer-kinds";
import * as log from "../lib/log";
import type { WorldScene } from "../game/world-scene";
import { MaskBar } from "./mask-bar";

export interface MaskUiOptions {
  store: DocStore;
  grid: Grid;
  /** The canvas column: the bar sits in it, and wears the mode's class. */
  host: HTMLElement;
  scene: () => WorldScene | null;
  /**
   * Mask mode reads presses and drags over the canvas, so a drawing tool
   * holding the pointer would leave it unreachable. Entering picks Select.
   */
  useSelectTool: () => void;
  /** The mode is over; put the layer back in front of the user. */
  onDone: (layerId: string) => void;
}

export interface MaskUi {
  /**
   * Enter the mode over one shape of a pattern layer.
   *
   * `shapeId` null is a shape that does not exist yet — Apply is what makes
   * it, and Cancel leaves the layer exactly as it was. `seed` is the spaces a
   * new one starts with, which is how the floating bar's Pattern Shape hands
   * over a region somebody has already selected: seeded rather than written,
   * so it can still be trimmed and Cancel still means nothing happened.
   */
  open: (
    layerId: string,
    shapeId: string | null,
    seed?: readonly Cell[],
  ) => void;
  /** The scene says something changed; put it in the bar. */
  sync: () => void;
  destroy: () => void;
}

export function createMaskUi(options: MaskUiOptions): MaskUi {
  const bar = new MaskBar({
    onApply: () => apply(),
    onCancel: () => cancel(),
    onTool: (tool) => {
      options.scene()?.modes.mask.setTool(tool);
      sync();
    },
    onReset: () => options.scene()?.modes.mask.reset(),
    onClear: () => options.scene()?.modes.mask.clearShape(),
  });
  options.host.appendChild(bar.root);

  function sync(): void {
    const mode = options.scene()?.modes.mask;
    const active = mode?.active ?? false;
    options.host.classList.toggle("masking", active);
    bar.update({
      active,
      name: mode?.editing?.name ?? "",
      layer: mode?.editing?.layerName ?? "",
      summary: mode?.summary ?? "",
      tool: mode?.currentTool ?? "add",
      isOriginal: mode?.isOriginal ?? true,
      canApply: (mode?.shape.length ?? 0) > 0,
    });
  }

  /**
   * The name a shape that does not exist yet is shown under.
   *
   * The same arithmetic `addPatternShape` uses when it actually makes one, so
   * the bar says the name the row will have rather than "New shape" followed
   * by something else. They can disagree only if something else adds a shape
   * to the same layer while this mode is up, and nothing can: the mode owns
   * the canvas and the panel that could is behind it.
   */
  function nextName(layerId: string): string {
    return `Shape ${patternSpec(options.store.layer(layerId)).shapes.length + 1}`;
  }

  function open(
    layerId: string,
    shapeId: string | null,
    seed?: readonly Cell[],
  ): void {
    const scene = options.scene();
    const layer = options.store.layer(layerId);
    if (!scene || !layer) return;
    if (layerKind(layer) !== "pattern") {
      log.warn("A pattern shape belongs to a pattern layer");
      return;
    }
    const held = shapeId
      ? patternSpec(layer).shapes.find((shape) => shape.id === shapeId)
      : null;
    if (shapeId && !held) return;

    options.useSelectTool();
    scene.modes.startMask(
      {
        layerId,
        layerName: layer.name,
        shapeId: held?.id ?? null,
        name: held?.name ?? nextName(layerId),
      },
      held?.cells ?? seed ?? [],
    );
    sync();
  }

  /** Leave, keeping nothing. The layer's shapes are as they were. */
  function cancel(): void {
    const layerId = options.scene()?.modes.mask.editing?.layerId ?? null;
    options.scene()?.modes.mask.stop();
    if (layerId) options.onDone(layerId);
    sync();
  }

  /**
   * Write the spaces out and leave.
   *
   * Refused on an empty shape, which the bar already says by disabling Apply —
   * checked again here because the bar is chrome and this is the rule. An
   * empty shape *list* is what makes a pattern layer infinite, so a shape with
   * no spaces in it would confine the pattern to nowhere.
   */
  function apply(): void {
    const scene = options.scene();
    const mode = scene?.modes.mask;
    const target = mode?.editing;
    if (!scene || !mode || !target) return;

    const cells = mode.shape;
    if (cells.length === 0) {
      log.warn("Sweep the spaces the pattern may use — an empty shape is no shape");
      return;
    }

    const shape = writePatternShape(
      options.store,
      target.layerId,
      target.shapeId,
      cells,
    );
    if (shape) {
      log.info(
        `${shape.name} — ${cells.length} ${cells.length === 1 ? "space" : "spaces"} ` +
          `on ${target.layerName}`,
      );
    }
    mode.stop();
    options.onDone(target.layerId);
    sync();
  }

  return {
    open: (layerId, shapeId, seed) => open(layerId, shapeId, seed),
    sync,
    destroy: () => {
      options.scene()?.modes.mask.stop();
      options.host.classList.remove("masking");
      bar.destroy();
    },
  };
}
