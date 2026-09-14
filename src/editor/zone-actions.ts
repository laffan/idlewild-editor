/**
 * A boundary swept straight onto the canvas.
 *
 * The other way of making one — lasso a sketch and convert it — is in
 * `stroke-actions.ts`, and it exists because a boundary is often the outline
 * of something you have already drawn. This is the case that route cannot
 * cover: an empty patch of ground with nothing on it to promote. So the
 * Boundary tool on the rail sweeps the outline itself, and nothing is
 * ever stored as ink on the way.
 *
 * Both ends meet in the middle deliberately. The polygon is simplified by the
 * same `zonePoints` and named by the same counter, so a boundary swept here
 * and one converted from a sketch of the same shape are the same document
 * object — and play mode cannot tell which way round it was made.
 */

import { zonePoints } from "../drawing";
import type { DocStore } from "../lib/doc-store";
import * as log from "../lib/log";
import type { WorldScene } from "../game/world-scene";

export function addSweptZone(
  store: DocStore,
  scene: WorldScene | null,
  layerId: string,
  swept: readonly { x: number; y: number }[],
): void {
  // A tap rather than a sweep. The drawing layer reports it as an empty list
  // rather than as two points, so there is nothing here to guess at.
  if (swept.length === 0) return;

  const layer = store.layer(layerId);
  if (!layer || layer.locked) {
    log.warn("The active layer is locked");
    return;
  }

  const points = zonePoints(swept, store.gridSize);
  if (points.length < 3) {
    log.warn("A boundary needs an outline — that sweep encloses nothing");
    return;
  }

  const zone = store.addZone(layerId, {
    name: `Boundary ${layer.zones.length + 1}`,
    points,
    // Drawn to stop something; play mode reads this when it builds the
    // navigation grid, and the inspector is where it is turned off.
    blocking: true,
  });
  scene?.setSelection({ kind: "zone", layerId, zoneId: zone.id });
  log.info(`${zone.name} — ${points.length} points, blocking`);
}
