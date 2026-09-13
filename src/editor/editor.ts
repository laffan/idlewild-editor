/**
 * The editor shell. Owns the layout, mounts the Phaser scene, and wires the
 * panels, tool rail, terminal and sheets to it.
 */

import { clear, h } from "../lib/dom";
import { DocStore } from "../lib/doc-store";
import { describeRange, Grid } from "../lib/grid";
import { assetBase, checkAssetServer, platform, projects } from "../lib/ipc";
import type { EditorMode, ProjectMeta, Selection, ToolId } from "../lib/types";
import * as log from "../lib/log";
import { bootGame, type GameHandle } from "../game/boot";
import { snapshotPng } from "../game/snapshot";
import { DEFAULT_STYLE, DrawingLayer, PIXEL_BRUSH } from "../drawing";
import { CodePanel } from "./code-panel";
import { Inspector } from "./inspector";
import { EditorHeader } from "./header";
import { LayersPanel } from "./layers-panel";
import { SelectionActions } from "./selection-actions";
import { bindShortcuts } from "./shortcuts";
import { createHistoryUi, type HistoryUi } from "./history";
import { startIntake } from "./intake";
import { GameFrame } from "./game-frame";
import { Terminal } from "./terminal";
import { ToolRail } from "./tool-rail";
import { exportSelectionPng } from "./export-selection";
import { createShell } from "./shell";
import { createPsdFileActions, createPsdLayersFactory } from "./psd-actions";
import { convertStrokesToPsd, convertStrokesToZone } from "./stroke-actions";
import { convertFillToPsd, generatePsdForRegion } from "./fill-actions";
import { createCanvasModeUis } from "./canvas-mode-ui";
import { penToolEffect, type PenTool } from "./pen-rail";
import { anchorCell, IMPORT_SCALE, marksForSelection } from "./import-anchor";
import { confirmDeleteLayer } from "./layer-actions";
import { openAddImage, openExportSelection, openPublish } from "./sheets";
import { createRenderSettings } from "./render-settings";

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
  /** The brush the pencil had before the pen rail's Pixels borrowed it. */
  let remembered = DEFAULT_STYLE.brushId;
  let mode: EditorMode = "draw";
  let handle: GameHandle | null = null;
  let drawing: DrawingLayer | null = null;
  // Built once the scene is up — see below. The header's two buttons and the
  // keyboard both reach it through closures, which run long after.
  let history: HistoryUi | null = null;

  const canvasWrap = h("div", { class: "editor-canvas-wrap" });
  // Pixel art, whole-pixel drawing and the zoom a scene opens at: what boot is
  // told, and what Project Options changes. `handle` is read through a closure
  // because the sheet is opened long after the game is up, and `gameFrame` for
  // the same reason — a game that is up restarts on the options just written,
  // the way it restarts on code just saved.
  const render = createRenderSettings(meta, () => handle, () => {
    if (gameFrame.isRunning) gameFrame.reload();
  });
  // The console's level chip is a link when the line came from a file the
  // code modal can open. `code` is built further down, once there is a shell
  // to put it in; this only runs when something is clicked.
  const terminal = new Terminal((site) => {
    // A line in the drawer knows which file it was written in, and the shortest
    // way to say so is to show it — which means being in Code.
    setMode("code");
    code.openAt(site.path, site.line);
  });

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
        selection.kind === "point" ||
        selection.kind === "zone" ||
        selection.kind === "strokes"
          ? selection.layerId
          : activeLayerId;
      setActiveLayer(layerId);
      handle?.scene.setSelection(selection);
    },
  });

  const inspector = new Inspector(store, grid, {
    onFillColor: (color) => applyFillColour(color),
    onToggleWalkable: (walkable) => {
      const selection = handle?.scene.getSelection();
      if (selection?.kind !== "fill") return;
      store.updateFill(selection.layerId, selection.fillId, { walkable });
    },
    onRenamePsd: (key, name) => void psdFile.rename(key, name),
    onToggleCollider: (key, blocking) => collider.setBlocking(key, blocking),
    onEditCollider: () => collider.open(),
    onStrokesToPsd: () => void strokesToPsd(),
    onStrokesToZone: () => strokesToZone(),
    onFillToPsd: () => void fillToPsd(),
    onRemoveReference: (key) => void removeReference(key),
    // Renaming a layer changes the path a placement reads, so the rename map
    // travels with the manifest — see reconcilePlacements.
    // Every button in the PSD section, wired in psd-actions.ts beside the
    // rest of what happens to the file behind a placement.
    createPsdLayers: (key) => psdLayers(key),
    onStrokeStyle: (patch) => {
      if (!drawing) return;
      drawing.style = { ...drawing.style, ...patch };
      inspector.updateStrokeStyle(drawing.style);
    },
    onDeleteSelection: () => deleteSelection(),
    onDeleteLayer: (layerId) => void deleteLayer(layerId),
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

  // Everything that happens to the *file* behind a placement — out to
  // Photoshop and back, a rewritten layer stack, a rename, a copy of its own.
  // Bound here because it needs both panels; written in psd-actions, beside
  // the round trip it is mostly made of.
  const psdFile = createPsdFileActions({
    projectId: meta.id,
    os,
    store,
    scene: () => handle?.scene ?? null,
    inspector,
  });

  // And the list of the file's layers, which is where all of those buttons
  // now are. Built through a factory rather than inline because the inspector
  // asks for one per key, and it needs half the shell to answer.
  const psdLayers = createPsdLayersFactory({
    projectId: meta.id,
    os,
    store,
    file: psdFile,
    scene: () => handle?.scene ?? null,
    onExtrude: () => extrude.resume(),
    onPen: (key, layer) => pen.open(key, layer),
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

  // The three bars along the bottom of the canvas — a solid being pulled out
  // of the grid, a collider painted on it, a PSD layer drawn into. The modes
  // themselves are the scene's; see editor/canvas-mode-ui.ts for what the
  // shell owes them.
  const modes = createCanvasModeUis({
    projectId: meta.id,
    store,
    grid,
    host: canvasWrap,
    scene: () => handle?.scene ?? null,
    drawing: () => drawing,
    useSelectTool: () => applyTool("select", false),
    usePencil: () => applyTool("pencil", false),
    inkLayerId: () => activeLayerId,
    defaultZoom: () => render.options.defaultZoom,
    onPenTool: (tool) => applyPenTool(tool),
    onPsdWritten: async (key, manifest) => {
      await handle?.scene.reloadPsd(key, manifest);
      inspector.reloadPsdLayers(key);
    },
  });
  const { extrude, collider, pen } = modes;

  // Pencil, eraser and lasso hand the pointer to the drawing layer; select
  // and pan leave it with the game canvas and its gesture arbiter.
  const rail = new ToolRail((tool: ToolId) => applyTool(tool));

  /** Put one of pen mode's own three in the pointer's hands, or take it back. */
  function applyPenTool(tool: PenTool): void {
    if (!drawing) return;
    if (tool === "pixels" && drawing.style.brushId !== PIXEL_BRUSH) {
      remembered = drawing.style.brushId;
    }
    const effect = penToolEffect(tool, remembered);
    drawing.style = { ...drawing.style, ...effect.style };
    applyTool(effect.tool, false);
    inspector.updateStrokeStyle(drawing.style);
  }

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
      tool === "pencil" || tool === "eraser" || tool === "lasso" || tool === "fill"
        ? tool
        : null;
    handle?.scene.suspendGestures(drawingTool !== null);
    handle?.scene.setGestureMode(
      tool === "pan" ? "pan" : tool === "point" ? "point" : "select",
    );
    // A hand over the canvas, whether Pan was picked from the rail or
    // borrowed with the space bar. The class carries it rather than an inline
    // style so the drawing layer's own crosshair still wins where it is up.
    canvasWrap.classList.toggle("panning", tool === "pan");
    canvasWrap.classList.toggle("placing", tool === "point");
    drawing?.setTool(drawingTool);
    inspector.setDrawingTool(drawingTool, drawing?.style ?? null);
    if (!announce) return;
    if (tool === "select") log.info("Select — drag a box around what you want");
    if (tool === "pan") log.info("Pan tool: drag to move the camera");
    if (tool === "point") log.info("Point — tap to put one down; drag still pans");
    if (tool === "pencil") log.info("Pencil — draw with a pencil or a mouse; fingers pan");
    if (tool === "lasso") log.info("Lasso — sweep around strokes to select them");
    if (tool === "fill") log.info("Fill — sweep a closed shape and it fills");
  }

  const header = new EditorHeader(
    meta.name,
    `${meta.gridSize} px · ${meta.projection}`,
    {
      onBack: () => void leave(),
      onUndo: () => history?.undo(),
      onRedo: () => history?.redo(),
      onMode: (next) => setMode(next),
      onPasteImage: () => intake.paste(),
      onPublish: () => openPublish(meta.id, meta.name),
      onOptions: () => render.open(store.layers.length),
    },
  );

  // What Play runs: the project's own `game/` tree, in a frame over the
  // canvas. Built for every project and shown only in play mode — see
  // setMode, and `editor/game-frame.ts` for why Play is the program rather
  // than a second implementation of it.
  const gameFrame = new GameFrame(meta.id);

  // The header is a row of the shell, not chrome floating over the canvas, so
  // only the tools and the selection bar are inside the canvas wrapper. The
  // two edge toggles go in too, from `createShell` — they are layout.
  canvasWrap.append(rail.root, rail.label, actions.root, gameFrame.root);

  // The rows and columns, and the dividers between them — see `shell.ts`.
  const layout = createShell({
    header: header.root,
    layers,
    canvas: canvasWrap,
    inspector,
    terminal,
  });
  const shell = layout.root;

  // Where the code panel sits — a row above the console, a column either side
  // of the canvas, or over the whole shell. Built after the shell because
  // every one of those is a fact about it.
  const code = new CodePanel({
    projectId: meta.id,
    shell,
    beforeConsole: terminal.root,
    main: layout.main,
    canvas: canvasWrap,
    // Its Close leaves the section rather than leaving an empty one up.
    onClose: () => setMode("draw"),
    onSaved: (path) => {
      // Saving code applies it: a game that is up restarts against the file
      // just written, which is the only way to tell whether the change worked.
      if (!gameFrame.isRunning) return;
      gameFrame.reload();
      log.info(`Play restarted on ${path}`);
    },
  });

  // The document's save is what rewrites `game/js/game.config.json`, so it is
  // also when a code modal showing that file has gone stale.
  store.addEventListener("saved", () => code.refreshGenerated());

  // A scene switch is a clean canvas. The Phaser scene rebuilds itself off
  // the same event; what the shell owes it is the shared state that names a
  // layer — which layer new work lands on, which one the ink is on, and an
  // inspector still describing something that has gone.
  store.addEventListener("scene", () => {
    setActiveLayer(store.layers[0]?.id ?? "");
    layers.render();
    inspector.setSelection({ kind: "none" });
    actions.update({ kind: "none" }, null);
    log.info(`Scene · ${store.activeScene.name}`);
    // A scene is a different place, and the game places the open one. In Code
    // the game is up while the scene dropdown is reachable, which is the whole
    // point of that mode — so switching restarts it on where you have gone.
    if (mode !== "draw") runGame();
  });

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
    enabled: () => mode === "draw",
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
    onUndo: () => history?.undo(),
    onRedo: () => history?.redo(),
  });
  layout.restore();

  handle = await bootGame(
    canvasWrap,
    {
      store,
      assetBase: base,
      defaultZoom: () => render.options.defaultZoom,
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
        void psdFile.detach(layerId, placementId, key),
      onExtrudeChange: () => extrude.sync(),
      onColliderChange: () => collider.sync(),
      onPenChange: () => pen.sync(),
    },
    render.options,
  );
  handle.scene.activeLayerId = activeLayerId;

  // Undo and redo: the two header buttons, and which history a press means —
  // the document's, the code editor's, or whichever mode owns the canvas.
  // Built after the scene because the modes' own stacks are on it, and the
  // header and the keyboard reach it through closures rather than by order.
  history = createHistoryUi({ store, code, header, scene: handle.scene });

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
      selection.kind === "point" ||
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
    } else if (selection.kind === "point") {
      store.removePoint(selection.layerId, selection.pointId);
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
   * Get rid of a whole document layer, once `layer-actions.ts` has asked.
   *
   * What is left here is the shell's half: the layer that was being worked on
   * may be the one that has gone, and a selection pointing into it certainly
   * has, so both land on whatever remains.
   */
  async function deleteLayer(layerId: string): Promise<void> {
    if (!(await confirmDeleteLayer(store, layerId))) return;
    const next = store.layers[0]?.id ?? "";
    setActiveLayer(next);
    handle?.scene.setSelection(
      next ? { kind: "layer", layerId: next } : { kind: "none" },
    );
    layers.render();
  }

  /** Hand a stroke selection to a layer as a placed PSD. */
  async function strokesToPsd(): Promise<void> {
    const selection = handle?.scene.getSelection();
    if (selection?.kind !== "strokes" || !drawing || !handle) return;
    await convertStrokesToPsd(meta.id, store, grid, drawing, handle.scene, selection);
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
    await psdFile.detach(selection.layerId, selection.placementId, key);
  }

  /** Hand a stroke selection to a layer as a boundary zone. */
  function strokesToZone(): void {
    const selection = handle?.scene.getSelection();
    if (selection?.kind !== "strokes" || !drawing) return;
    convertStrokesToZone(store, drawing, selection);
    handle?.scene.setSelection({ kind: "none" });
  }

  /**
   * Draw, Code or Play.
   *
   * **Code shows what Play shows.** The project's own game runs over the
   * canvas in both, because a code editor beside a still picture of the game
   * is a code editor you cannot check anything in: save a file and the thing
   * in front of you restarts on it. What Code keeps that Play does not is the
   * editor around it — both sidebars and the panel — so the scene can be
   * switched and the document adjusted while the game runs, before a full
   * test in Play.
   *
   * Code is a section rather than a panel that happens to be open: entering it
   * puts the panel up wherever it was last docked, and leaving takes it down.
   * Anything that wants a file on screen — a console line naming where it was
   * written — asks for the mode first.
   */
  function setMode(next: EditorMode): void {
    mode = next;
    header.setMode(next);
    shell.classList.toggle("play-mode", next === "play");
    shell.classList.toggle("code-mode", next === "code");
    handle?.scene.setMode(next);

    if (next === "code") code.show();
    else code.hide();

    if (next === "draw") {
      gameFrame.stop();
      return;
    }
    log.info(
      next === "play"
        ? "Play — running this project's own code"
        : "Code — the game is running beside it; a save restarts it",
    );
    runGame();
  }

  /**
   * Start the game, or start it again.
   *
   * The document is flushed first, and awaited: the config the game reads is
   * rewritten by the document's save, so starting without waiting would run
   * the project against whatever the last debounce happened to have written.
   */
  function runGame(): void {
    void store.flush().then(() => {
      // The canvas may have been come back to while that was in flight.
      if (mode !== "draw") void gameFrame.start();
    });
  }

  async function saveThumbnail(): Promise<void> {
    if (!handle) return;
    try {
      const dataUrl = await snapshotPng(handle.game);
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
    history?.destroy();
    history = null;
    intake.stop();
    // A thumbnail is of the canvas, so the game comes down first.
    if (mode === "play") setMode("draw");
    await saveThumbnail();
    await store.flush();
    header.destroy();
    layers.destroy();
    inspector.destroy();
    gameFrame.destroy();
    modes.destroy();
    drawing?.destroy();
    drawing = null;
    code.destroy();
    terminal.destroy();
    layout.destroy();
    handle?.destroy();
    handle = null;
  }

  return teardown;
}
