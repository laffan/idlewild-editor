/**
 * What the editor hands the canvas, and what the canvas hands back.
 *
 * Its own file because `world-scene.ts` is against the 700-line rule and this
 * is the part of it that is not the scene: a list of the seams between the
 * shell and the canvas, which is read far more often than it is changed. The
 * type is re-exported from `world-scene.ts`, so nothing importing it has to
 * know it moved.
 */

import type { DocStore } from "../lib/doc-store";
import type { Selection } from "../lib/types";
import type { Viewport } from "../drawing";
import type { TileHand } from "../lib/tile-tools";

export interface WorldSceneConfig {
  store: DocStore;
  assetBase: string;
  /**
   * The zoom a scene with no camera of its own opens at. Asked for rather
   * than handed over: Project Options changes it under a running editor, and
   * a number taken once is a scene still opening at what the editor booted at.
   */
  defaultZoom: () => number;
  onSelectionChange: (selection: Selection) => void;
  onCameraChange: () => void;
  /**
   * A drag mutates the document on every pointer move. The panels listen for
   * document changes, so without this the inspector would rebuild its colour
   * picker — and the layer panel its name inputs — on every frame of a drag.
   */
  onDragStateChange: (dragging: boolean) => void;
  /**
   * The camera, whenever it has actually moved. The drawing layer's stage is
   * slaved to this: its ink is baked in world coordinates and presented
   * with a transform, so it has to be told where the camera is, and told
   * only when there is something to tell.
   */
  onViewport?: (view: Viewport) => void;
  /**
   * An option-shift drag has just made a copy that should not be an instance of
   * the original — it wants a PSD of its own. The editor owns the duplication
   * because it owns the IPC.
   */
  onDetachCopy?: (layerId: string, placementId: string, key: string) => void;
  /** Extrude mode has started, finished, or changed what it is holding. */
  onExtrudeChange?: () => void;
  /** Collider mode has started, finished, or changed the spaces it holds. */
  onColliderChange?: () => void;
  /** PSD Edit mode has started or finished. */
  onPsdEditChange?: () => void;
  /** Mask mode has started, finished, or changed the spaces it holds. */
  onMaskChange?: () => void;
  /**
   * What the tile tool in hand is, what it is set to, and what is picked.
   *
   * One record rather than five questions, because they are read together and
   * always at the same moment — see `TileHand`. Resolved by the shell, since
   * which tool is held is the rail's business and what was picked is the
   * sidebar's, and the canvas knows neither. Absent means no tile tool is
   * ever in hand, which is what a scene built by a test gets.
   */
  tileHand?: () => TileHand;
  /**
   * Every PSD the open scene places has loaded.
   *
   * The panels ask the plugin what is in a file — whether it carries an
   * anchor mark — and the answer changes the moment the manifest arrives.
   * Nothing about the *document* changes when it does, so without this the
   * rows would keep showing what was true before anything had been read.
   */
  onPsdsLoaded?: () => void;
}
