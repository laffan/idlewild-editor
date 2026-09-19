/**
 * What every row and button in the left sidebar actually does.
 *
 * `inspect-wiring.ts` for the other column, and here for the same reason: the
 * panel reads the document and draws rows, and none of its rows know what a
 * project is, where the scene keeps its parsed manifests, or what bringing a
 * Tiled map in involves. So the answers are gathered here and the panel is
 * left as a thing that draws.
 *
 * **Everything is reached lazily**, as over there. The panel is built before
 * the scene — the canvas is not up until the end of `editor.ts` — and two of
 * its questions are the scene's to answer, so they are functions called when
 * a row is drawn rather than values captured when the shell was assembled.
 */

import { layerOf } from "./inspect-zone";
import { openNewBackground, type BackgroundDeps } from "./background-actions";
import { importTiledMap, type TileDeps } from "./tile-actions";
import type { LayersPanel, LayersPanelCallbacks } from "./layers-panel";
import type { WorldScene } from "../game/world-scene";
import type { Selection } from "../lib/types";

export interface LayersWiringDeps {
  /** The live scene, or null before it has booted. */
  scene: () => WorldScene | null;
  /** The panel itself, which two of its own rows have to re-render. */
  panel: () => LayersPanel;
  /** The layer new work lands on, and the way to move it. */
  activeLayerId: () => string;
  setActiveLayer: (layerId: string) => void;
  /** New Background's deps, and Import Tiled's — see `editor.ts`. */
  backgrounds: () => BackgroundDeps;
  tiles: () => TileDeps;
}

export function layersPanelCallbacks(
  deps: LayersWiringDeps,
): LayersPanelCallbacks {
  const selection = (): Selection =>
    deps.scene()?.getSelection() ?? { kind: "none" };

  return {
    getActiveLayerId: deps.activeLayerId,
    getSelection: selection,
    onSelectLayer: (layerId) => {
      deps.setActiveLayer(layerId);
      deps.panel().render();
      deps.scene()?.setSelection({ kind: "layer", layerId });
    },
    onSelectItem: (held) => {
      // Selecting something inside a layer makes that layer the active one,
      // so the next Fill or Add Image lands where the user is looking.
      // `layerOf` rather than a list of the kinds that have one: this was a
      // list, and every kind added since has had to remember to join it.
      deps.setActiveLayer(layerOf(held) || deps.activeLayerId());
      deps.scene()?.setSelection(held);
    },
    // A fact about the file rather than about the document, so it is asked
    // of the scene — see `PsdPlacements.anchored`.
    isAnchored: (key) => deps.scene()?.psdAnchored(key) ?? true,
    psdLayers: (key) => deps.scene()?.psdLayers(key) ?? [],
    onNewBackground: (layerId, anchor) =>
      openNewBackground(anchor, layerId, deps.backgrounds()),
    onImportTiled: (layerId) => void importTiledMap(deps.tiles(), layerId),
  };
}
