/**
 * The editor shell. Owns the layout, mounts the Phaser scene, and wires the
 * panels, tool rail, terminal and sheets to it.
 */

import { clear, h, ICONS, icon } from "../lib/dom";
import { DocStore } from "../lib/doc-store";
import { Grid, rangeSize } from "../lib/grid";
import { assetBase, platform, projects, psd } from "../lib/ipc";
import type { EditorMode, ProjectMeta, Selection, ToolId } from "../lib/types";
import * as log from "../lib/log";
import { bootGame, type GameHandle } from "../game/boot";
import { DrawingLayer } from "../drawing";
import { CodeModal } from "../code/code-modal";
import { Inspector } from "./inspector";
import { EditorHeader } from "./header";
import { LayersPanel } from "./layers-panel";
import { SelectionActions } from "./selection-actions";
import { Terminal } from "./terminal";
import { ToolRail } from "./tool-rail";
import { exportSelectionPng } from "./export-selection";
import { createResizer } from "./resizer";
import { openPsdExternally, refreshPsd } from "./psd-actions";
import { PsdLayerEditor } from "./psd-layers";
import { convertStrokesToPsd, convertStrokesToZone } from "./stroke-actions";
import { convertFillToPsd } from "./fill-actions";
import { anchorCell, IMPORT_SCALE, marksForSelection } from "./import-anchor";
import {
  openAddImage,
  openExportSelection,
  openProjectOptions,
  openPublish,
} from "./sheets";

export interface EditorCallbacks {
  onBack: () => Promise<void> | void;
}

export async function mountEditor(
  container: HTMLElement,
  meta: ProjectMeta,
  callbacks: EditorCallbacks,
): Promise<() => Promise<void>> {
  const store = await DocStore.load(meta.id);
  const grid = new Grid(store.projection, store.gridSize);
  const base = await assetBase(meta.id);
  // Resolved once: it decides whether a PSD's edits come back by re-parsing
  // a file that never moved or by picking the one the share sheet sent out.
  const os = await platform();

  let activeLayerId = store.layers[0]?.id ?? "";
  let mode: EditorMode = "edit";
  let codeModal: CodeModal | null = null;
  let handle: GameHandle | null = null;
  let drawing: DrawingLayer | null = null;

  const canvasWrap = h("div", { class: "editor-canvas-wrap" });
  const terminal = new Terminal();

  const layers = new LayersPanel(store, {
    getActiveLayerId: () => activeLayerId,
    getSelection: () => handle?.scene.getSelection() ?? { kind: "none" },
    onSelectLayer: (layerId) => {
      setActiveLayer(layerId);
      layers.render();
      handle?.scene.setSelection({ kind: "layer", layerId });
    },
    onSelectItem: (selection) => {
      // Selecting something inside a layer makes that layer the active one,
      // so the next Fill or Add Image lands where the user is looking.
      const layerId =
        selection.kind === "placement" ||
        selection.kind === "fill" ||
        selection.kind === "zone" ||
        selection.kind === "strokes"
          ? selection.layerId
          : activeLayerId;
      setActiveLayer(layerId);
      handle?.scene.setSelection(selection);
    },
  });

  const inspector = new Inspector(store, grid, os, {
    onFillColor: (color) => applyFillColour(color),
    onToggleWalkable: (walkable) => {
      const selection = handle?.scene.getSelection();
      if (selection?.kind !== "fill") return;
      store.updateFill(selection.layerId, selection.fillId, { walkable });
    },
    onOpenPsd: (key) => void openPsd(key),
    onRefreshPsd: (key) => void refresh(key),
    onStrokesToPsd: () => void strokesToPsd(),
    onStrokesToZone: () => strokesToZone(),
    onFillToPsd: () => void fillToPsd(),
    onRemoveReference: (key) => void removeReference(key),
    // Renaming a layer changes the path a placement reads, so the rename map
    // travels with the manifest — see reconcilePlacements.
    createPsdLayers: (key) =>
      new PsdLayerEditor(meta.id, key, {
        onWritten: (manifest, renames) =>
          void handle?.scene.reloadPsd(key, manifest, renames),
      }),
    onStrokeStyle: (patch) => {
      if (!drawing) return;
      drawing.style = { ...drawing.style, ...patch };
      inspector.updateStrokeStyle(drawing.style);
    },
    onDeleteSelection: () => deleteSelection(),
    onUsePatternImage: () =>
      openAddImage(meta.id, (result) => {
        const selection = handle?.scene.getSelection();
        if (selection?.kind !== "fill") return;
        store.updateFill(selection.layerId, selection.fillId, {
          kind: "pattern",
          patternKey: result.key,
        });
      }),
  });

  const actions = new SelectionActions({
    onFill: () => handle?.scene.fillSelection(inspector.fillColor, false),
    onAddImage: () => {
      const selection = handle?.scene.getSelection();
      if (selection?.kind !== "region") return;
      const anchor = anchorCell(selection.from, selection.to);
      // The selection travels into the PSD as its orienting marks, and the
      // anchor mark that comes back out is what the placement lines up on.
      openAddImage(
        meta.id,
        (result) => {
          void handle?.scene.placePsd(
            result.key,
            result.manifest,
            anchor,
            IMPORT_SCALE,
          );
        },
        marksForSelection(grid, selection.from, selection.to),
      );
    },
    onExport: () => {
      const selection = handle?.scene.getSelection();
      if (selection?.kind !== "region") return;
      const { w, h: height } = rangeSize(selection.from, selection.to);
      openExportSelection(`${w} × ${height} spaces`, async () =>
        exportSelectionPng(store, grid, selection.from, selection.to),
      );
    },
  });

  // Pencil, eraser and lasso hand the pointer to the drawing layer; select
  // and pan leave it with the game canvas and its gesture arbiter.
  const rail = new ToolRail((tool: ToolId) => {
    const drawingTool =
      tool === "pencil" || tool === "eraser" || tool === "lasso" ? tool : null;
    handle?.scene.suspendGestures(drawingTool !== null);
    drawing?.setTool(drawingTool);
    inspector.setDrawingTool(drawingTool, drawing?.style ?? null);
    if (tool === "pan") log.info("Pan tool: drag to move the camera");
    if (tool === "pencil") log.info("Pencil — draw with a pencil or a mouse; fingers pan");
    if (tool === "lasso") log.info("Lasso — sweep around strokes to select them");
  });

  const leftToggle = h(
    "button",
    {
      class: "edge-toggle left",
      title: "Toggle layers",
      onClick: () => toggleSide("left"),
    },
    icon(ICONS.chevronLeft, 14),
  );
  const rightToggle = h(
    "button",
    {
      class: "edge-toggle right",
      title: "Toggle inspector",
      onClick: () => toggleSide("right"),
    },
    icon(ICONS.chevronRight, 14),
  );

  const header = new EditorHeader(
    meta.name,
    `${meta.gridSize} px · ${meta.projection}`,
    {
      onBack: () => void leave(),
      onMode: (next) => setMode(next),
      onCode: () => toggleCode(),
      onPublish: () => openPublish(meta.id, meta.name),
      onOptions: () => openProjectOptions(meta, store.layers.length),
    },
  );

  // The header is a row of the shell, not chrome floating over the canvas, so
  // only the tools and the selection bar are inside the canvas wrapper.
  canvasWrap.append(rail.root, rail.label, actions.root, leftToggle, rightToggle);

  // Draggable dividers on both sidebars and the console drawer. Sizes are a
  // per-viewer convenience, so they live in localStorage rather than the doc.
  const leftResizer = createResizer({
    target: layers.root,
    axis: "width",
    edge: "end",
    min: 200,
    max: 560,
    storageKey: "leftWidth",
  });
  const rightResizer = createResizer({
    target: inspector.root,
    axis: "width",
    edge: "start",
    min: 240,
    max: 620,
    storageKey: "rightWidth",
  });
  const consoleResizer = createResizer({
    target: terminal.body,
    axis: "height",
    edge: "start",
    min: 80,
    max: 620,
    storageKey: "consoleHeight",
  });
  terminal.mountResizeHandle(consoleResizer.handle);

  // The docked code panel's own divider. It is built up front so its stored
  // height survives closing and reopening the modal within a session.
  let codeResizer: ReturnType<typeof createResizer> | null = null;

  const shell = h(
    "div",
    { class: "editor" },
    header.root,
    h(
      "div",
      { class: "editor-main" },
      layers.root,
      leftResizer.handle,
      canvasWrap,
      rightResizer.handle,
      inspector.root,
    ),
    terminal.root,
  );

  clear(container);
  container.appendChild(shell);
  document.addEventListener("keydown", onKeyDown);
  leftResizer.restore();
  rightResizer.restore();
  consoleResizer.restore();

  handle = await bootGame(canvasWrap, {
    store,
    assetBase: base,
    onSelectionChange: (selection) => onSelection(selection),
    onCameraChange: () =>
      actions.update(
        handle?.scene.getSelection() ?? { kind: "none" },
        handle?.scene.selectionScreenAnchor() ?? null,
      ),
    onDragStateChange: (dragging) => {
      inspector.setSuspended(dragging);
      layers.setSuspended(dragging);
    },
    onViewport: (view) => drawing?.sync(view),
    onDetachCopy: (layerId, placementId, key) =>
      void detach(layerId, placementId, key),
  });
  handle.scene.activeLayerId = activeLayerId;

  // The drawing layer is built after the scene because its two-finger
  // navigation drives that camera. It sits over the canvas, inert until one
  // of its tools is picked.
  drawing = new DrawingLayer(store, activeLayerId, {
    onPan: (dx, dy) => handle?.scene.panScreen(dx, dy),
    onZoom: (factor, x, y) => handle?.scene.zoomAt(factor, x, y),
    onSelect: (ids) => {
      handle?.scene.setSelection(
        ids.length
          ? { kind: "strokes", layerId: activeLayerId, ids }
          : { kind: "none" },
      );
    },
  });
  canvasWrap.appendChild(drawing.root);
  drawing.sync(handle.scene.viewport());
  if (import.meta.env.DEV) {
    // Handle for the browser harness in harness/; dev builds only.
    (window as unknown as Record<string, unknown>).__idlewildScene = handle.scene;
  }
  log.info(`Opened ${meta.name} · ${meta.projection} · ${meta.gridSize}px grid`);

  /** New strokes land on the layer the rest of the editor is working on. */
  function setActiveLayer(layerId: string): void {
    activeLayerId = layerId;
    if (handle) handle.scene.activeLayerId = layerId;
    drawing?.setLayer(layerId);
  }

  function onSelection(selection: Selection): void {
    inspector.setSelection(selection);
    actions.update(selection, handle?.scene.selectionScreenAnchor() ?? null);

    if (selection.kind === "layer") {
      setActiveLayer(selection.layerId);
      layers.render();
      return;
    }

    // Picking something on the canvas reveals it in the layer list too.
    if (
      selection.kind === "placement" ||
      selection.kind === "fill" ||
      selection.kind === "zone" ||
      selection.kind === "strokes"
    ) {
      setActiveLayer(selection.layerId);
      layers.expand(selection.layerId);
    }
    layers.render();
  }

  function applyFillColour(color: string): void {
    const selection = handle?.scene.getSelection();
    if (selection?.kind === "fill") {
      store.updateFill(selection.layerId, selection.fillId, {
        kind: "color",
        color,
      });
      return;
    }
    if (selection?.kind === "region") {
      handle?.scene.fillSelection(color, false);
    }
  }

  /**
   * Delete removes whatever is selected — the same thing the inspector's
   * last button does.
   *
   * Ignored while the caret is in a field, which is every layer name, every
   * numeric input, the colour picker's hex box and the whole code editor:
   * there, backspace means backspace. `isContentEditable` is what catches
   * CodeMirror, which is a div rather than a textarea.
   */
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }

    const selection = handle?.scene.getSelection();
    if (!selection || selection.kind === "none" || selection.kind === "layer") {
      return;
    }
    event.preventDefault();
    deleteSelection();
  }

  function deleteSelection(): void {
    const selection = handle?.scene.getSelection();
    if (!selection) return;
    if (selection.kind === "fill") {
      store.removeFill(selection.layerId, selection.fillId);
    } else if (selection.kind === "placement") {
      store.removePlacement(selection.layerId, selection.placementId);
    } else if (selection.kind === "zone") {
      store.removeZone(selection.layerId, selection.zoneId);
    } else if (selection.kind === "strokes") {
      drawing?.removeStrokes(selection.ids);
    } else {
      return;
    }
    handle?.scene.setSelection({ kind: "none" });
  }

  /**
   * Hand the PSD to the OS. On macOS that is the editor registered for PSDs,
   * opened where the file lies; on iPadOS, where an app cannot open another
   * app's document in place, it is the share sheet.
   */
  async function openPsd(key: string): Promise<void> {
    try {
      await openPsdExternally(meta.id, key, os);
    } catch (err) {
      log.error(`Could not open ${key}.psd:`, err);
    }
  }

  /** Bring a PSD's edits back in, then reload what is on the canvas. */
  async function refresh(key: string): Promise<void> {
    try {
      const manifest = await refreshPsd(meta.id, key, os);
      if (manifest) await handle?.scene.reloadPsd(key, manifest);
    } catch (err) {
      log.error(`Could not refresh ${key}:`, err);
    }
  }

  /** Hand a stroke selection to a layer as a placed PSD. */
  async function strokesToPsd(): Promise<void> {
    const selection = handle?.scene.getSelection();
    if (selection?.kind !== "strokes" || !drawing || !handle) return;
    await convertStrokesToPsd(meta.id, grid, drawing, handle.scene, selection);
  }

  /** Hand a filled run of grid spaces to its layer as a placed PSD. */
  async function fillToPsd(): Promise<void> {
    const selection = handle?.scene.getSelection();
    if (selection?.kind !== "fill" || !handle) return;
    await convertFillToPsd(meta.id, store, grid, handle.scene, selection);
  }

  /**
   * Give a referencing placement its own copy of the PSD.
   *
   * The selected placement is the one that moves off the shared file, so
   * whichever of the two you were looking at is the one that becomes
   * independent — and everything else pointing at the original stays put.
   */
  async function removeReference(key: string): Promise<void> {
    const selection = handle?.scene.getSelection();
    if (selection?.kind !== "placement") return;
    await detach(selection.layerId, selection.placementId, key);
  }

  /**
   * The same, named by id rather than by what is selected — which is what an
   * option-shift drag needs, since the copy it hands over is only *usually*
   * still the selection by the time the file has finished copying.
   */
  async function detach(
    layerId: string,
    placementId: string,
    key: string,
  ): Promise<void> {
    try {
      const copy = await psd.duplicate(meta.id, key);
      await handle?.scene.repointPlacement(
        { kind: "placement", layerId, placementId },
        copy.key,
        copy.manifest,
      );
      log.info(`${key}.psd → ${copy.key}.psd — this placement is now its own`);
    } catch (err) {
      log.error(`Could not break the reference to ${key}:`, err);
    }
  }

  /** Hand a stroke selection to a layer as a boundary zone. */
  function strokesToZone(): void {
    const selection = handle?.scene.getSelection();
    if (selection?.kind !== "strokes" || !drawing) return;
    convertStrokesToZone(store, drawing, selection);
    handle?.scene.setSelection({ kind: "none" });
  }

  function toggleSide(side: "left" | "right"): void {
    const panel = side === "left" ? layers : inspector;
    const resizer = side === "left" ? leftResizer : rightResizer;
    const collapsed = panel.root.classList.contains("collapsed");
    panel.setCollapsed(!collapsed);
    resizer.handle.classList.toggle("collapsed", !collapsed);
  }

  function setMode(next: EditorMode): void {
    mode = next;
    header.setMode(next);
    shell.classList.toggle("play-mode", next === "play");
    handle?.scene.setMode(next);
    if (next === "play") {
      log.info("Play mode — tap the canvas to walk there");
    }
  }

  function toggleCode(): void {
    if (codeModal) {
      closeCode();
      return;
    }
    codeModal = new CodeModal(
      meta.id,
      meta.name,
      () => closeCode(),
      (pinned) => setCodePinned(pinned),
    );
    shell.appendChild(codeModal.root);
  }

  function closeCode(): void {
    codeModal?.destroy();
    codeModal = null;
    codeResizer?.destroy();
    codeResizer = null;
  }

  /**
   * Move the code panel between floating over the canvas and sitting as a row
   * of the shell above the console. Docked it takes a divider of its own, so
   * the two stacked panels are sized the same way.
   */
  function setCodePinned(pinned: boolean): void {
    if (!codeModal) return;

    if (!pinned) {
      codeResizer?.destroy();
      codeResizer = null;
      shell.appendChild(codeModal.root);
      return;
    }

    codeResizer = createResizer({
      target: codeModal.root,
      axis: "height",
      edge: "start",
      min: 140,
      max: 720,
      storageKey: "codeHeight",
    });
    shell.insertBefore(codeResizer.handle, terminal.root);
    shell.insertBefore(codeModal.root, terminal.root);
    codeResizer.restore();
  }

  async function saveThumbnail(): Promise<void> {
    if (!handle) return;
    try {
      const dataUrl = await handle.scene.snapshot();
      if (dataUrl) await projects.writeThumbnail(meta.id, dataUrl);
    } catch (err) {
      log.warn("Could not save a thumbnail:", err);
    }
  }

  async function leave(): Promise<void> {
    await teardown();
    await callbacks.onBack();
  }

  async function teardown(): Promise<void> {
    document.removeEventListener("keydown", onKeyDown);
    if (mode === "play") setMode("edit");
    await saveThumbnail();
    await store.flush();
    header.destroy();
    layers.destroy();
    inspector.destroy();
    drawing?.destroy();
    drawing = null;
    closeCode();
    terminal.destroy();
    leftResizer.destroy();
    rightResizer.destroy();
    consoleResizer.destroy();
    handle?.destroy();
    handle = null;
  }

  return teardown;
}
