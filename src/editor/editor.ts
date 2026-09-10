/**
 * The editor shell. Owns the layout, mounts the Phaser scene, and wires the
 * panels, tool rail, terminal and sheets to it.
 */

import { clear, h, ICONS, icon } from "../lib/dom";
import { DocStore } from "../lib/doc-store";
import { Grid, rangeSize } from "../lib/grid";
import { assetBase, platform, projects } from "../lib/ipc";
import type { EditorMode, ProjectMeta, Selection, ToolId } from "../lib/types";
import * as log from "../lib/log";
import { bootGame, type GameHandle } from "../game/boot";
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

  const canvasWrap = h("div", { class: "editor-canvas-wrap" });
  const terminal = new Terminal();

  const layers = new LayersPanel(store, {
    getActiveLayerId: () => activeLayerId,
    getSelection: () => handle?.scene.getSelection() ?? { kind: "none" },
    onSelectLayer: (layerId) => {
      activeLayerId = layerId;
      if (handle) handle.scene.activeLayerId = layerId;
      layers.render();
      handle?.scene.setSelection({ kind: "layer", layerId });
    },
    onSelectItem: (selection) => {
      // Selecting something inside a layer makes that layer the active one,
      // so the next Fill or Add Image lands where the user is looking.
      const layerId =
        selection.kind === "placement" ||
        selection.kind === "fill" ||
        selection.kind === "zone"
          ? selection.layerId
          : activeLayerId;
      activeLayerId = layerId;
      if (handle) handle.scene.activeLayerId = layerId;
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
      const anchor = {
        cx: Math.min(selection.from.cx, selection.to.cx),
        cy: Math.min(selection.from.cy, selection.to.cy),
      };
      openAddImage(meta.id, (result) => {
        void handle?.scene.placePsd(result.key, result.manifest, anchor);
      });
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

  const rail = new ToolRail((tool: ToolId) => {
    // Pencil, eraser and boundary hand raw input to the drawing layer once
    // the engine port lands; until then only the camera tools are live.
    handle?.scene.suspendGestures(false);
    if (tool === "pan") log.info("Pan tool: drag to move the camera");
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
  });
  handle.scene.activeLayerId = activeLayerId;
  if (import.meta.env.DEV) {
    // Handle for the browser harness in harness/; dev builds only.
    (window as unknown as Record<string, unknown>).__idlewildScene = handle.scene;
  }
  log.info(`Opened ${meta.name} · ${meta.projection} · ${meta.gridSize}px grid`);

  function onSelection(selection: Selection): void {
    inspector.setSelection(selection);
    actions.update(selection, handle?.scene.selectionScreenAnchor() ?? null);

    if (selection.kind === "layer") {
      activeLayerId = selection.layerId;
      layers.render();
      return;
    }

    // Picking something on the canvas reveals it in the layer list too.
    if (
      selection.kind === "placement" ||
      selection.kind === "fill" ||
      selection.kind === "zone"
    ) {
      activeLayerId = selection.layerId;
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

  function deleteSelection(): void {
    const selection = handle?.scene.getSelection();
    if (!selection) return;
    if (selection.kind === "fill") {
      store.removeFill(selection.layerId, selection.fillId);
    } else if (selection.kind === "placement") {
      store.removePlacement(selection.layerId, selection.placementId);
    } else if (selection.kind === "zone") {
      store.removeZone(selection.layerId, selection.zoneId);
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
    canvasWrap.appendChild(codeModal.root);
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
      canvasWrap.appendChild(codeModal.root);
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
    if (mode === "play") setMode("edit");
    await saveThumbnail();
    await store.flush();
    header.destroy();
    layers.destroy();
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
