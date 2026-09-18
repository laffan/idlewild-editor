/**
 * Getting rid of things: a document layer, and whatever is selected.
 *
 * The left panel could add a layer and reorder, rename, lock and hide one,
 * and there was no way at all to remove one — so the inspector grew a Delete
 * layer button and this is what stands behind it.
 *
 * It asks first, for the reason deleting a scene asks first: everything drawn
 * on the layer goes with it and there is no undo anywhere in this editor yet.
 * What it does *not* delete is any PSD — a placement is a drawing of a file,
 * the file lives in `psd/`, and the whole project's other scenes may be
 * drawing it too.
 *
 * Here rather than in the shell because it is a question with a sheet in
 * front of it, and the shell only wants the answer.
 */

import { confirmSheet } from "../lib/sheet";
import type { DocStore } from "../lib/doc-store";
import { removeBackground } from "../lib/layer-kinds";
import { pruneLayerGroups } from "../lib/groups";
import { removeText, textsOf } from "../lib/text-items";
import type { Layer, Selection } from "../lib/types";
import { count } from "./layer-items";
import * as log from "../lib/log";

/** What deleting a selection needs from the shell around it. */
export interface DeleteDeps {
  store: DocStore;
  /** How much of a placed PSD goes is the scene's call — see below. */
  removeSelectedPlacement: () => void;
  removeStrokes: (ids: readonly string[]) => void;
  clearSelection: () => void;
}

/**
 * Delete removes whatever is selected — the same thing the inspector's last
 * button does.
 *
 * Here rather than in the shell because it is a switch over every kind of
 * selection there is and it grows by one arm every time a new kind arrives;
 * the shell's half is which scene is asking and what to do afterwards.
 */
export function deleteSelected(selection: Selection, deps: DeleteDeps): void {
  const { store } = deps;
  if (selection.kind === "fill") {
    store.removeFill(selection.layerId, selection.fillId);
  } else if (selection.kind === "placement") {
    // The scene decides how much of a placed PSD goes: the whole thing, or
    // the one layer of it that has been opened up.
    deps.removeSelectedPlacement();
    return;
  } else if (selection.kind === "placements") {
    // Every image the marquee caught, whole. A unit opened up for layer
    // adjustment is the one case where part of a PSD can go, and a marquee
    // is never that. One step, with whatever group they were in going quietly
    // along with the last member of it.
    const layerId = selection.layerId;
    store.history.group(() => {
      for (const id of selection.ids) store.removePlacement(layerId, id);
      pruneLayerGroups(store, layerId);
    });
  } else if (selection.kind === "point") {
    store.removePoint(selection.layerId, selection.pointId);
  } else if (selection.kind === "zone") {
    store.removeZone(selection.layerId, selection.zoneId);
  } else if (selection.kind === "text") {
    removeText(store, selection.layerId, selection.textId);
  } else if (selection.kind === "background") {
    removeBackground(store, selection.layerId, selection.backgroundId);
  } else if (selection.kind === "strokes") {
    deps.removeStrokes(selection.ids);
  } else {
    return;
  }
  deps.clearSelection();
}

/**
 * Ask, and delete if the answer is yes.
 *
 * @returns whether the layer went, so the caller knows to move the selection
 *          and the active layer off it.
 */
export async function confirmDeleteLayer(
  store: DocStore,
  layerId: string,
): Promise<boolean> {
  const layer = store.layer(layerId);
  if (!layer) return false;
  if (store.layers.length <= 1) {
    log.warn("A scene keeps at least one layer");
    return false;
  }

  const on = describeContents(layer);
  const ok = await confirmSheet(
    `Delete ${layer.name}?`,
    on
      ? `${on} on it goes with it. The PSDs themselves stay in the project.`
      : "There is nothing on it.",
    "Delete",
    false,
  );
  if (!ok) return false;

  store.removeLayer(layerId);
  log.info(`Deleted layer ${layer.name}`);
  return true;
}

/**
 * What would go with the layer, in a sentence.
 *
 * A placed PSD is counted as the **unit** it is — one file dropped on the
 * canvas is one thing however many layers came in with it — because that is
 * what the left panel lists and what the number has to agree with.
 */
function describeContents(layer: Layer): string {
  const units = new Set(
    layer.placements.map((p) => p.instance ?? p.id),
  ).size;
  const parts: string[] = [];
  if (units) parts.push(count(units, "placed PSD"));
  if (layer.fills.length) parts.push(count(layer.fills.length, "fill"));

  const zones = layer.zones.length;
  if (zones) parts.push(`${zones} ${zones === 1 ? "boundary" : "boundaries"}`);
  if (layer.strokes.length) parts.push(count(layer.strokes.length, "stroke"));
  const texts = textsOf(layer).length;
  if (texts) parts.push(`${texts} ${texts === 1 ? "note" : "notes"}`);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** What the shell's two delete entry points need from around them. */
export interface DeleteWiring extends DeleteDeps {
  /** The selection as it stands, or null when the canvas is not up. */
  selection: () => Selection | null;
  setSelection: (selection: Selection) => void;
  /** Make this the layer new work lands on. */
  setActiveLayer: (layerId: string) => void;
  /** Redraw the left panel, which both of these change. */
  redrawLayers: () => void;
}

/**
 * The two ways something is deleted, as the shell offers them.
 *
 * Both are thin — a guard, the question above, and what has to happen
 * *afterwards* — and both were in the middle of `editor.ts` between things
 * they have nothing to do with. They belong beside the answers they call.
 */
export function createDeletes(wiring: DeleteWiring): {
  deleteSelection: () => void;
  deleteLayer: (layerId: string) => Promise<void>;
} {
  return {
    /** Delete removes whatever is selected — see `deleteSelected`. */
    deleteSelection() {
      const selection = wiring.selection();
      if (selection) deleteSelected(selection, wiring);
    },

    /**
     * Get rid of a whole document layer, once the sheet above has asked.
     *
     * The layer that was being worked on may be the one that has gone, and a
     * selection pointing into it certainly has, so both land on whatever
     * remains.
     */
    async deleteLayer(layerId: string): Promise<void> {
      if (!(await confirmDeleteLayer(wiring.store, layerId))) return;
      const next = wiring.store.layers[0]?.id ?? "";
      wiring.setActiveLayer(next);
      wiring.setSelection(
        next ? { kind: "layer", layerId: next } : { kind: "none" },
      );
      wiring.redrawLayers();
    },
  };
}
