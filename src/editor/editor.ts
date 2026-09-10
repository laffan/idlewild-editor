/**
 * The editor shell. Owns the layout, mounts the Phaser scene, and wires the
 * panels, tool rail, terminal and sheets to it.
 */

import { clear, h, ICONS, icon } from "../lib/dom";
import { DocStore } from "../lib/doc-store";
import { Grid, rangeSize } from "../lib/grid";
import { assetBase, projects, psd } from "../lib/ipc";
import type { EditorMode, ProjectMeta, Selection, ToolId } from "../lib/types";
import * as log from "../lib/log";
import { bootGame, type GameHandle } from "../game/boot";
import { CodeModal } from "../code/code-modal";
import { Inspector } from "./inspector";
import { Topbar } from "./topbar";
import { LayersPanel } from "./layers-panel";
import { SelectionActions } from "./selection-actions";
import { Terminal } from "./terminal";
import { ToolRail } from "./tool-rail";
import { exportSelectionPng } from "./export-selection";
import { createResizer } from "./resizer";
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

  let activeLayerId = store.layers[0]?.id ?? "";
  let mode: EditorMode = "edit";
  let codeModal: CodeModal | null = null;
  let handle: GameHandle | null = null;

  const canvasWrap = h("div", { class: "editor-canvas-wrap" });
  const terminal = new Terminal();

  const layers = new LayersPanel(store, {
    getActiveLayerId: () => activeLayerId,
    onSelectLayer: (layerId) => {
      activeLayerId = layerId;
      if (handle) handle.scene.activeLayerId = layerId;
      layers.render();
      handle?.scene.setSelection({ kind: "layer", layerId });
    },
  });

  const inspector = new Inspector(store, grid, {
    onFillColor: (color) => applyFillColour(color),
    onToggleWalkable: (walkable) => {
      const selection = handle?.scene.getSelection();
      if (selection?.kind !== "fill") return;
      store.updateFill(selection.layerId, selection.fillId, { walkable });
    },
    onReparsePsd: (key) => void reparse(key),
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

  const topbar = new Topbar(meta.name, `${meta.gridSize} px · ${meta.projection}`, {
    onBack: () => void leave(),
    onMode: (next) => setMode(next),
    onCode: () => toggleCode(),
    onPublish: () => openPublish(meta.id, meta.name),
    onOptions: () => openProjectOptions(meta, store.layers.length),
  });

  canvasWrap.append(
    topbar.root,
    rail.root,
    rail.label,
    actions.root,
    leftToggle,
    rightToggle,
  );

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

  const shell = h(
    "div",
    { class: "editor" },
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
  log.info(`Opened ${meta.name} · ${meta.projection} · ${meta.gridSize}px grid`);

  function onSelection(selection: Selection): void {
    inspector.setSelection(selection);
    actions.update(selection, handle?.scene.selectionScreenAnchor() ?? null);
    if (selection.kind === "layer") {
      activeLayerId = selection.layerId;
      layers.render();
    }
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

  async function reparse(key: string): Promise<void> {
    try {
      await psd.reprocess(meta.id, key);
      log.info(`Re-parsed ${key}.psd`);
    } catch (err) {
      log.error(`Could not re-parse ${key}:`, err);
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
    topbar.setMode(next);
    shell.classList.toggle("play-mode", next === "play");
    handle?.scene.setMode(next);
    if (next === "play") {
      log.info("Play mode — tap the canvas to walk there");
    }
  }

  function toggleCode(): void {
    if (codeModal) {
      codeModal.destroy();
      codeModal = null;
      return;
    }
    codeModal = new CodeModal(meta.id, meta.name, () => {
      codeModal?.destroy();
      codeModal = null;
    });
    canvasWrap.appendChild(codeModal.root);
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
    codeModal?.destroy();
    terminal.destroy();
    leftResizer.destroy();
    rightResizer.destroy();
    consoleResizer.destroy();
    handle?.destroy();
    handle = null;
  }

  return teardown;
}
