/**
 * The editor shell. Owns the layout, mounts the Phaser scene, and wires the
 * panels, tool rail, terminal and sheets to it.
 */

import { clear, h, ICONS, icon } from "../lib/dom";
import { DocStore } from "../lib/doc-store";
import { describeRange, Grid } from "../lib/grid";
import { assetBase, checkAssetServer, platform, projects, psd } from "../lib/ipc";
import type { EditorMode, ProjectMeta, Selection, ToolId } from "../lib/types";
import * as log from "../lib/log";
import { bootGame, type GameHandle } from "../game/boot";
import { DrawingLayer } from "../drawing";
import { CodePanel } from "./code-panel";
import { Inspector } from "./inspector";
import { EditorHeader } from "./header";
import { LayersPanel } from "./layers-panel";
import { SelectionActions } from "./selection-actions";
import { bindShortcuts } from "./shortcuts";
import { startIntake } from "./intake";
import { GameFrame } from "./game-frame";
import { Terminal } from "./terminal";
import { ToolRail } from "./tool-rail";
import { exportSelectionPng } from "./export-selection";
import { createResizer } from "./resizer";
import { openPsdExternally, refreshPsd } from "./psd-actions";
import { PsdLayerEditor, psdLayerOwner } from "./psd-layers";
import { convertStrokesToPsd, convertStrokesToZone } from "./stroke-actions";
import { convertFillToPsd, generatePsdForRegion } from "./fill-actions";
import { createExtrudeUi } from "./extrude";
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
        selection.kind === "placements" ||
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
    onRenamePsd: (key, name) => void renamePsd(key, name),
    onToggleLayerAdjust: () => {
      if (!handle) return;
      if (handle.scene.adjustingInstance) handle.scene.stopAdjusting();
      else handle.scene.startAdjusting();
    },
    onStrokesToPsd: () => void strokesToPsd(),
    onStrokesToZone: () => strokesToZone(),
    onFillToPsd: () => void fillToPsd(),
    onRemoveReference: (key) => void removeReference(key),
    // Renaming a layer changes the path a placement reads, so the rename map
    // travels with the manifest — see reconcilePlacements.
    createPsdLayers: (key) =>
      new PsdLayerEditor(meta.id, key, {
        onWritten: (manifest, renames) => void applyPsdLayers(key, manifest, renames),
        // The marks and an extrusion's artwork are the app's to name, and the
        // extrusion's row is the way back into the mode that built it.
        ownerOf: (layer) =>
          psdLayerOwner(layer, key, !!store.extrusion(key), () => extrude.resume()),
      }),
    onStrokeStyle: (patch) => {
      if (!drawing) return;
      drawing.style = { ...drawing.style, ...patch };
      inspector.updateStrokeStyle(drawing.style);
    },
    onDeleteSelection: () => deleteSelection(),
    onExportSelection: () => {
      const selection = handle?.scene.getSelection();
      if (selection?.kind !== "region") return;
      openExportSelection(
        describeRange(grid, selection.from, selection.to),
        async () => exportSelectionPng(store, grid, selection.from, selection.to),
      );
    },
    onUsePatternImage: () =>
      openAddImage(meta.id, os, (result) => {
        const selection = handle?.scene.getSelection();
        if (selection?.kind !== "fill") return;
        store.updateFill(selection.layerId, selection.fillId, {
          kind: "pattern",
          patternKey: result.key,
        });
      }),
  });

  const actions = new SelectionActions(grid, {
    onFill: () => handle?.scene.fillSelection(inspector.fillColor, false),
    onAddImage: () => {
      const selection = handle?.scene.getSelection();
      if (selection?.kind !== "region") return;
      const anchor = anchorCell(selection.from, selection.to);
      // The selection travels into the PSD as its orienting marks, and the
      // anchor mark that comes back out is what the placement lines up on.
      openAddImage(
        meta.id,
        os,
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
    onGeneratePsd: () => {
      const selection = handle?.scene.getSelection();
      const scene = handle?.scene;
      if (selection?.kind !== "region" || !scene) return;
      void generatePsdForRegion(meta.id, grid, scene, selection.from, selection.to);
    },
    onExtrude: () => extrude.open(),
  });

  // Extrude mode: the bar along the bottom of the canvas, and the two ways
  // out of it. The mode itself is the scene's — see game/extrude-mode.ts.
  const extrude = createExtrudeUi({
    projectId: meta.id,
    store,
    grid,
    host: canvasWrap,
    scene: () => handle?.scene ?? null,
    useSelectTool: () => applyTool("select", false),
  });

  // Pencil, eraser and lasso hand the pointer to the drawing layer; select
  // and pan leave it with the game canvas and its gesture arbiter.
  const rail = new ToolRail((tool: ToolId) => applyTool(tool));

  /**
   * Put a tool in the pointer's hands.
   *
   * Called by the rail and by the space bar, which borrows Pan for as long as
   * it is held. `rail.setTool` is what the space bar needs from it: the rail
   * has to show what the pointer is actually doing, or holding space looks
   * like nothing happened.
   */
  function applyTool(tool: ToolId, announce = true): void {
    rail.setTool(tool);
    const drawingTool =
      tool === "pencil" || tool === "eraser" || tool === "lasso" ? tool : null;
    handle?.scene.suspendGestures(drawingTool !== null);
    handle?.scene.setGestureMode(tool === "pan" ? "pan" : "select");
    // A hand over the canvas, whether Pan was picked from the rail or
    // borrowed with the space bar. The class carries it rather than an inline
    // style so the drawing layer's own crosshair still wins where it is up.
    canvasWrap.classList.toggle("panning", tool === "pan");
    drawing?.setTool(drawingTool);
    inspector.setDrawingTool(drawingTool, drawing?.style ?? null);
    if (!announce) return;
    if (tool === "select") log.info("Select — drag a box around what you want");
    if (tool === "pan") log.info("Pan tool: drag to move the camera");
    if (tool === "pencil") log.info("Pencil — draw with a pencil or a mouse; fingers pan");
    if (tool === "lasso") log.info("Lasso — sweep around strokes to select them");
  }

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
      onCode: () => code.toggle(),
      onPasteImage: () => intake.paste(),
      onPublish: () => openPublish(meta.id, meta.name),
      onOptions: () => openProjectOptions(meta, store.layers.length),
    },
  );

  // What Play runs: the project's own `game/` tree, in a frame over the
  // canvas. Built for every project and shown only in play mode — see
  // setMode, and `editor/game-frame.ts` for why Play is the program rather
  // than a second implementation of it.
  const gameFrame = new GameFrame(meta.id);

  // The header is a row of the shell, not chrome floating over the canvas, so
  // only the tools and the selection bar are inside the canvas wrapper.
  canvasWrap.append(
    rail.root,
    rail.label,
    actions.root,
    leftToggle,
    rightToggle,
    gameFrame.root,
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

  // Where the code modal sits in the shell, and what pinning it does to the
  // rows around it. Built after the shell because both are facts about it.
  const code = new CodePanel(meta.id, shell, terminal.root, (path) => {
    // Saving code applies it: a game that is up restarts against the file
    // just written, which is the only way to tell whether the change worked.
    if (!gameFrame.isRunning) return;
    gameFrame.reload();
    log.info(`Play restarted on ${path}`);
  });

  // The document's save is what rewrites `game/js/game.config.json`, so it is
  // also when a code modal showing that file has gone stale.
  store.addEventListener("saved", () => code.refreshGenerated());

  // A paste and a drop are the same import: the bytes become a PSD, marked
  // with the grid spaces they landed on, and placed on the layer being worked
  // on. A drop that lands on an image already there offers to replace the
  // file behind it instead — see editor/intake.ts.
  const intake = startIntake({
    projectId: meta.id,
    grid,
    os,
    canvas: canvasWrap,
    scene: () => handle?.scene ?? null,
    enabled: () => mode === "edit",
    onPsdReplaced: async (key, manifest) => {
      await handle?.scene.reloadPsd(key, manifest);
      inspector.reloadPsdLayers(key);
    },
  });

  clear(container);
  container.appendChild(shell);
  const stopShortcuts = bindShortcuts({
    currentTool: () => rail.tool,
    applyTool: (tool) => applyTool(tool, false),
    hasSelection: () => {
      const selection = handle?.scene.getSelection();
      return !!selection && selection.kind !== "none" && selection.kind !== "layer";
    },
    onDelete: () => deleteSelection(),
  });
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
    onExtrudeChange: () => extrude.sync(),
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
  // Not awaited: it is a loopback request that says whether images can arrive
  // at all, and the editor is usable either way.
  void checkAssetServer(base).then((trouble) => {
    if (trouble) {
      log.error(
        `The asset server at ${base} is not answering this page — ${trouble}. ` +
          "Every PSD will import and then place empty.",
      );
    } else {
      log.info(`Asset server ready at ${base}`);
    }
  });

  /** New strokes land on the layer the rest of the editor is working on. */
  function setActiveLayer(layerId: string): void {
    activeLayerId = layerId;
    if (handle) handle.scene.activeLayerId = layerId;
    drawing?.setLayer(layerId);
  }

  function onSelection(selection: Selection): void {
    inspector.setSelection(selection);
    // Fired for a change of mode as well as of selection, which is how the
    // panel learns that the canvas has opened a PSD up.
    inspector.setAdjusting(handle?.scene.adjustingInstance ?? null);
    actions.update(selection, handle?.scene.selectionScreenAnchor() ?? null);

    if (selection.kind === "layer") {
      setActiveLayer(selection.layerId);
      layers.render();
      return;
    }

    // Picking something on the canvas reveals it in the layer list too.
    if (
      selection.kind === "placement" ||
      selection.kind === "placements" ||
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
  function deleteSelection(): void {
    const selection = handle?.scene.getSelection();
    if (!selection) return;
    if (selection.kind === "fill") {
      store.removeFill(selection.layerId, selection.fillId);
    } else if (selection.kind === "placement") {
      // The scene decides how much of a placed PSD goes: the whole thing, or
      // the one layer of it that has been opened up.
      handle?.scene.removeSelectedPlacement();
      return;
    } else if (selection.kind === "placements") {
      // Every image the marquee caught, whole. A unit opened up for layer
      // adjustment is the one case where part of a PSD can go, and a marquee
      // is never that.
      for (const id of selection.ids) {
        store.removePlacement(selection.layerId, id);
      }
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
      if (!manifest) return;
      await handle?.scene.reloadPsd(key, manifest);
      // The file on disk has changed, and the inspector's list of its layers
      // is built once and kept — so it has to be told, or it goes on showing
      // the stack from before the edit.
      inspector.reloadPsdLayers(key);
    } catch (err) {
      log.error(`Could not refresh ${key}:`, err);
    }
  }

  /** The inspector rewrote the PSD's own layer stack; take the result back. */
  async function applyPsdLayers(
    key: string,
    manifest: string,
    renames: Map<string, string>,
  ): Promise<void> {
    await handle?.scene.reloadPsd(key, manifest, renames);
    // Reordering renumbers every layer, so the next edit has to be made
    // against the file as it is now rather than as it was.
    inspector.reloadPsdLayers(key);
  }

  /**
   * Rename a PSD, then carry every placement on it over to the new key.
   *
   * Rust decides the key: what the field holds is raw text and goes through
   * the same sanitiser an import uses, so the name that lands can differ from
   * the name that was typed. On failure the panel is redrawn, which is what
   * puts the real name back in the field.
   */
  async function renamePsd(key: string, name: string): Promise<void> {
    try {
      const result = await psd.rename(meta.id, key, name);
      if (result.key === key) return;
      await handle?.scene.renamePsd(key, result.key);
      log.info(`${key}.psd → ${result.key}.psd`);
    } catch (err) {
      log.error(`Could not rename ${key}.psd:`, err);
      inspector.render();
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
      // A copy of an extruded PSD is an extrusion of its own, and carrying
      // one on must rewrite the file this placement actually draws.
      store.copyExtrusion(key, copy.key);
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

    if (next !== "play") {
      gameFrame.stop();
      return;
    }
    log.info("Play — running this project's own code");
    // Flushed first, and awaited: the config the game reads is rewritten by
    // the document's save, so starting without waiting would run the project
    // against whatever the last debounce happened to have written.
    void store.flush().then(() => {
      // Play may already have been left again while that was in flight.
      if (mode === "play") void gameFrame.start();
    });
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
    stopShortcuts();
    intake.stop();
    if (mode === "play") setMode("edit");
    await saveThumbnail();
    await store.flush();
    header.destroy();
    layers.destroy();
    inspector.destroy();
    gameFrame.destroy();
    extrude.destroy();
    drawing?.destroy();
    drawing = null;
    code.destroy();
    terminal.destroy();
    leftResizer.destroy();
    rightResizer.destroy();
    consoleResizer.destroy();
    handle?.destroy();
    handle = null;
  }

  return teardown;
}
