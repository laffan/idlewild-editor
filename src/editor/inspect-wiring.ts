/**
 * What every control in the properties sidebar actually does.
 *
 * The panel itself reads the document and writes rows; none of its buttons
 * know what a project is, where a PSD lives on disk, or which canvas mode a
 * Collider row opens. So the wiring is here, the way `psd-actions.ts` holds
 * what happens to a file behind a placement and `canvas-mode-ui.ts` holds
 * what the four canvas modes need from the shell.
 *
 * **Everything it reaches is reached lazily.** The panel is built before the
 * scene, before the drawing layer, and before half the actions its own rows
 * call — the PSD file actions need the panel, which would be a circle if
 * either held the other — so every dependency here is a function called at
 * the moment a button is pressed rather than a value captured when the shell
 * was assembled.
 */

import { applyFillPaint } from "./fill-actions";
import { exportSelectionPng } from "./export-selection";
import { openAddImage, openExportSelection } from "./sheets";
import * as log from "../lib/log";
import { renameGroup } from "../lib/groups";
import { describeRange, type Grid } from "../lib/grid";
import type { DocStore } from "../lib/doc-store";
import type { DrawingLayer } from "../drawing";
import type { WorldScene } from "../game/world-scene";
import type { ColliderUi } from "./collider";
import type { Conversions } from "./conversions";
import type { PatternShapes } from "./pattern-actions";
import type { PsdFileActions } from "./psd-actions";
import type { PsdLayerEditor } from "./psd-layers";
import type { Inspector, InspectorCallbacks } from "./inspector";
import type { ToolRouting } from "./tool-routing";

export interface InspectWiringDeps {
  projectId: string;
  /** Which platform, as `platform()` reports it — Add Image asks it. */
  os: string;
  store: DocStore;
  grid: Grid;
  /** All four are built after the panel, so all four are read through. */
  scene: () => WorldScene | null;
  drawing: () => DrawingLayer | null;
  inspector: () => Inspector;
  psdFile: () => PsdFileActions;
  convert: () => Conversions;
  collider: () => ColliderUi;
  /** A pattern layer's shapes, and the mode one is edited in. */
  shapes: PatternShapes;
  openShape: (layerId: string, shapeId: string | null) => void;
  /** The selected PSD's own layer list, made per file by the shell. */
  psdLayers: (key: string) => PsdLayerEditor;
  /** The layer new work lands on, which is the LAYER zone's fallback. */
  activeLayerId: () => string;
  deleteSelection: () => void;
  deleteLayer: (layerId: string) => void;
  /**
   * Tying placed PSDs together, letting them go, and making one file of them
   * — `group-actions.ts` and `merge-actions.ts`.
   */
  groups: () => { group: () => void; ungroup: () => void; merge: () => void };
  /**
   * Which tool is in hand and which way round it is.
   *
   * Read through like the rest: the routing is built after the panel, and it
   * is the routing rather than the style that remembers which tools are set
   * to erase — see `tool-routing.ts`.
   */
  tools: () => ToolRouting;
}

export function inspectorCallbacks(deps: InspectWiringDeps): InspectorCallbacks {
  const { store, grid } = deps;

  return {
    onFillPaint: (paint) => applyFillPaint(store, deps.scene(), paint),
    onToggleWalkable: (walkable) => {
      const selection = deps.scene()?.getSelection();
      if (selection?.kind !== "fill") return;
      store.updateFill(selection.layerId, selection.fillId, { walkable });
    },
    onRenamePsd: (key, name) => void deps.psdFile().rename(key, name),
    onToggleCollider: (key, blocking) => deps.collider().setBlocking(key, blocking),
    onEditCollider: () => deps.collider().open(),
    // A conversion ends with the new file selected, and what anybody wants
    // next is its layer list — see `Inspector.revealPsdLayers`, which refuses
    // when the conversion was the one that got refused.
    onStrokesToPsd: () =>
      void deps.convert().strokesToPsd().then(() => deps.inspector().revealPsdLayers()),
    onStrokesToZone: () => deps.convert().strokesToZone(),
    isAnchored: (key) => deps.scene()?.psdAnchored(key) ?? true,
    // A pattern shape is drawn in mask mode — `editor/mask.ts`. The panel's
    // own button opens it; the sketch panel's turns a lassoed outline into one
    // directly, because that route's whole point is keeping the drawn line.
    patternShapeTarget: () => deps.shapes.strokeTarget(),
    onStrokesToPatternShape: () => deps.shapes.fromStrokes(),
    onEditShape: (layerId, shapeId) => deps.openShape(layerId, shapeId),
    onFillToPsd: () =>
      void deps.convert().fillToPsd().then(() => deps.inspector().revealPsdLayers()),
    onMakeUnique: (key) => void deps.convert().makeUnique(key),
    // Renaming a layer changes the path a placement reads, so the rename map
    // travels with the manifest — see reconcilePlacements.
    // Every button in the PSD section, wired in psd-actions.ts beside the
    // rest of what happens to the file behind a placement.
    createPsdLayers: (key) => deps.psdLayers(key),
    onStrokeStyle: (patch) => {
      const drawing = deps.drawing();
      if (!drawing) return;
      drawing.style = { ...drawing.style, ...patch };
      // Deliberately not a re-render: the colour picker fires continuously
      // while it is dragged, and rebuilding the panel under it would throw
      // the drag away. See `Inspector.updateStrokeStyle`.
      deps.inspector().updateStrokeStyle(drawing.style);
    },
    onDeleteSelection: () => deps.deleteSelection(),
    // ⌘G and ⇧⌘G, as the two buttons an iPad needs — `group-actions.ts` is the
    // same code the keyboard reaches.
    onGroup: () => deps.groups().group(),
    onUngroup: () => deps.groups().ungroup(),
    onRenameGroup: (layerId, groupId, name) =>
      renameGroup(store, layerId, groupId, name),
    onMerge: () => deps.groups().merge(),
    // The one exit a note has: the words become pixels in a file of their
    // own, placed where they were standing — see `editor/text-actions.ts`.
    onTextToPsd: () => deps.convert().textToPsd(),
    // Restyling a piece of text sets the tool, so the next one is written to
    // match — the same reading every brush keeps about its own size.
    onTextStyle: (style) => {
      const scene = deps.scene();
      if (scene) scene.textStyle = style;
    },
    onDeleteLayer: (layerId) => deps.deleteLayer(layerId),
    onRenamePoint: (layerId, pointId, name) =>
      store.updatePoint(layerId, pointId, { name }),
    onSetStartPoint: (pointId) => {
      store.setStartPoint(pointId);
      const point = store.startPoint;
      log.info(
        point
          ? `${store.activeScene.name} starts at ${point.name}`
          : `${store.activeScene.name} has no start point`,
      );
    },
    onExportSelection: () => {
      const selection = deps.scene()?.getSelection();
      if (selection?.kind !== "region") return;
      openExportSelection(
        describeRange(grid, selection.from, selection.to),
        async () => exportSelectionPng(store, grid, selection.from, selection.to),
      );
    },
    onUsePatternImage: () =>
      openAddImage(deps.projectId, deps.os, (result) => {
        const selection = deps.scene()?.getSelection();
        if (selection?.kind !== "fill") return;
        store.updateFill(selection.layerId, selection.fillId, {
          kind: "pattern",
          patternKey: result.key,
        });
      }),
    // The LAYER zone's fallback: the layer new work lands on, when nothing on
    // the canvas is selected to name one.
    activeLayerId: () => deps.activeLayerId(),

    // ── the sweep fill's two halves ──────────────────────────────────────
    //
    // State of the drawing layer rather than of the document: a half-built
    // shape is about where you are pointing and nothing in the project, so it
    // is never saved and never undone. Changing the mode re-renders the panel
    // by hand, because nothing in the document changed for it to hear about;
    // the corner count is a readout, and the three things you can do about a
    // shape are on the bar floating beside it.
    fillMode: () => deps.drawing()?.fillMode ?? "draw",
    onFillMode: (mode) => {
      deps.drawing()?.setFillMode(mode);
      deps.inspector().render();
    },
    fillPoints: () => deps.drawing()?.fillPointCount ?? 0,

    // Use as Eraser, the first row of every brush's panel. The routing owns
    // the flag because it is per tool and outlives the panel; all this does
    // is ask it and tell it.
    erasing: (tool) => deps.tools().isErasing(tool),
    onErasing: (tool, on) => deps.tools().setErasing(tool, on),
  };
}
