/**
 * **Reset Layer Position**: putting a placed PSD's layers back where the file
 * has them.
 *
 * A PSD arrives on the grid as one thing, and a double-tap opens it up so one
 * layer of it can be moved on its own — a roof lifted off its tower to see
 * what is under it, a shadow slid half a space. That is the gesture, and until
 * now it had no way back: the file's own arrangement was gone, and nothing on
 * the canvas said so, because a roof dragged half a space sideways looks
 * exactly like a roof somebody drew half a space sideways. Neither did a
 * re-parse put it back — reconciliation positions each placement from *its
 * own* anchor cell, which is precisely the thing the move changed.
 *
 * Which layers are out of place, and where they belong, is
 * `game/layer-home.ts` — pure, and tested without a canvas. What is here is
 * the part that cannot be: reading the selection, asking before throwing the
 * moves away, and writing the answer as one undo step.
 *
 * It asks because it is destructive in the one way this editor takes
 * seriously: it is work somebody did that no longer exists afterwards. Undo
 * reaches it — it is one step, like the drag that made the mess — but a sheet
 * naming what goes is cheaper than finding that out.
 */

import { displacedMembers, homePlacement, unitAnchor } from "../game/layer-home";
import { unitMembers, unitOf } from "../game/unit";
import type { WorldScene } from "../game/world-scene";
import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import * as log from "../lib/log";
import { confirmSheet } from "../lib/sheet";
import { layerName } from "../lib/manifest";
import type { Placement } from "../lib/types";

/** What the reset needs: the document, the geometry, and what is selected. */
export interface LayerPositionsDeps {
  store: DocStore;
  grid: Grid;
  scene: () => WorldScene | null;
}

/**
 * Put the selected PSD's moved layers back, after asking.
 *
 * The unit is read out of the selection **before** the sheet goes up and acted
 * on by id afterwards, because a sheet is a round trip through the user and
 * the selection is free to move under it: a tap outside the sheet that reached
 * the canvas would otherwise have this resetting whatever was selected by the
 * time the answer came back. A unit that has gone in the meantime is dropped
 * rather than half-reset.
 */
export async function resetLayerPositions(
  deps: LayerPositionsDeps,
): Promise<void> {
  const { store, grid } = deps;
  const selection = deps.scene()?.getSelection();
  if (selection?.kind !== "placement") return;

  const layerId = selection.layerId;
  const selected = store
    .layer(layerId)
    ?.placements.find((p) => p.id === selection.placementId);
  if (!selected) return;

  const unit = unitOf(selected);
  const displaced = displacedMembers(unitMembers(store.layers, layerId, unit));
  if (displaced.length === 0) return;

  const ok = await confirmSheet(
    displaced.length === 1 ? "Reset layer position" : "Reset layer positions",
    `${describe(displaced)} of ${selected.psdKey}.psd ` +
      `${displaced.length === 1 ? "goes" : "go"} back to where the file puts ` +
      `${displaced.length === 1 ? "it" : "them"}. The ` +
      `${displaced.length === 1 ? "move you made" : "moves you made"} to ` +
      `${displaced.length === 1 ? "it" : "them"} will be lost.`,
    "Reset",
    // Dark: this sheet sits over the editor's canvas, not over the home screen.
    false,
  );
  if (!ok) return;

  // Read again: the sheet was up, and the document is free to have moved on.
  const members = unitMembers(store.layers, layerId, unit);
  const home = unitAnchor(members);
  const moved = displacedMembers(members);
  if (!home || moved.length === 0) return;

  // One step, like the drag that displaced them. A history that stepped back
  // through this a layer at a time would be a history of the loop.
  store.history.group(() => {
    for (const placement of moved) {
      store.updatePlacement(
        layerId,
        placement.id,
        homePlacement(grid, placement, home),
      );
    }
  });

  log.info(
    `${selected.psdKey}.psd — put ${describe(moved)} back on ` +
      `${home.cx}, ${home.cy}`,
  );
}

/**
 * The layers a reset is about, named while the list is short enough to read
 * and counted when it is not — the same bargain the home screen's bulk delete
 * makes.
 */
function describe(placements: readonly Placement[]): string {
  if (placements.length === 1) {
    return `“${layerName(placements[0].layerPath)}”`;
  }
  if (placements.length <= 3) {
    return placements.map((p) => `“${layerName(p.layerPath)}”`).join(", ");
  }
  return `${placements.length} layers`;
}
