/**
 * The editor shell. Owns the layout, mounts the Phaser scene, and wires the
 * panels, tool rail, terminal and sheets to it.
 */

import { clear, h } from "../lib/dom";
import { DocStore } from "../lib/doc-store";
import { Grid } from "../lib/grid";
import { assetBase, checkAssetServer, platform } from "../lib/ipc";
import type { EditorMode, ProjectMeta, Selection, ToolId } from "../lib/types";
import * as log from "../lib/log";
import { bootGame, type GameHandle } from "../game/boot";
import { saveThumbnail } from "./thumbnail";
import { DrawingLayer } from "../drawing";
import { CodePanel } from "./code-panel";
import { Inspector } from "./inspector";
import { inspectorCallbacks } from "./inspect-wiring";
import { EditorHeader } from "./header";
import { LayersPanel } from "./layers-panel";
import { SelectionActions } from "./selection-actions";
import { bindShortcuts } from "./shortcuts";
import { createHistoryUi, type HistoryUi } from "./history";
import { startIntake } from "./intake";
import { GameFrame } from "./game-frame";
import { Terminal } from "./terminal";
import { ToolRail } from "./tool-rail";
import { createShell } from "./shell";
import { createPsdFileActions, createPsdLayersFactory } from "./psd-actions";
import { openNewBackground, type BackgroundDeps } from "./background-actions";
import { createPatternShapes } from "./pattern-actions";
import { layerKind } from "../lib/layer-kinds";
import { addImageToRegion, generatePsdForRegion } from "./fill-actions";
import { createConversions } from "./conversions";
import { createCanvasModeUis } from "./canvas-mode-ui";
import { createToolRouting } from "./tool-routing";
import { libraryPointer, libraryStyle } from "./stamp-box";
import { createDeletes } from "./layer-actions";
import { headerCallbacks } from "./header-wiring";
import { createRenderSettings } from "./render-settings";
import { Minimap } from "./minimap";
import { OverlaysPanel } from "./overlays-panel";
import { addSweptZone } from "./zone-actions";
import { createFillBarUi } from "./fill-bar";
import { ScreenGuide } from "./screen-guide";

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
    guide.refresh();
  });

  /**
   * A PSD on disk is not what it was: restart the game if one is running.
   *
   * The same promise saving a code file makes — what is in front of you is
   * what is on disk — for the other half of a project. In Code the game runs
   * beside the canvas, and it holds the textures it loaded when it started;
   * ink applied in PSD Edit mode, a layer renamed or turned off, a re-parse, a
   * file replaced by a drop all leave it drawing the version before. The
   * canvas re-places from the new manifest either way, so without this the
   * two halves of the same window disagree about the same file.
   *
   * Cheap when nothing is running, which is every one of these in Draw.
   */
  function psdChanged(): void {
    if (gameFrame.isRunning) gameFrame.reload();
  }
  // The console's level chip is a link when the line came from a file the
  // code modal can open. `code` is built further down, once there is a shell
  // to put it in; this only runs when something is clicked.
  const terminal = new Terminal((site) => {
    // A line in the drawer knows which file it was written in, and the shortest
    // way to say so is to show it — which means being in Code.
    setMode("code");
    code.openAt(site.path, site.line);
  });

  // Where you are standing, along the bottom of the left sidebar, and above it
  // the switches for the marks the canvas draws about itself. Both are built
  // before the panel they go in, and reach the scene through a closure because
  // the canvas is not up until the end of this function.
  const minimap = new Minimap(store, grid, {
    centreOn: (x, y) => handle?.scene.centreOn(x, y),
  });
  const overlays = new OverlaysPanel(minimap);

  const layers = new LayersPanel(
    store,
    {
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
          selection.kind === "background" ||
          selection.kind === "strokes"
            ? selection.layerId
            : activeLayerId;
        setActiveLayer(layerId);
        handle?.scene.setSelection(selection);
      },
      // A fact about the file rather than about the document, so it is asked
      // of the scene — see `PsdPlacements.anchored`.
      isAnchored: (key) => handle?.scene.psdAnchored(key) ?? true,
      psdLayers: (key) => handle?.scene.psdLayers(key) ?? [],
      onNewBackground: (layerId, anchor) =>
        openNewBackground(anchor, layerId, backgrounds),
    },
    overlays.root,
  );

  /** The two shortcuts into a pattern shape that are not the panel's own. */
  const shapes = createPatternShapes({
    store,
    grid,
    drawing: () => drawing,
    getSelection: () => handle?.scene.getSelection() ?? { kind: "none" },
    activeLayerId: () => activeLayerId,
    openMask: (layerId, shapeId, seed) => modes.mask.open(layerId, shapeId, seed),
  });

  /** What New Background needs: the project, the grid and a way to place. */
  const backgrounds: BackgroundDeps = {
    projectId: meta.id,
    store,
    grid,
    scene: () => handle?.scene ?? null,
    onSelect: (selection) => handle?.scene.setSelection(selection),
    focusLayer: (layerId) => {
      setActiveLayer(layerId);
      layers.render();
    },
    onPsdCreated: () => inspector.revealPsdLayers(),
  };

  // Every control in the properties sidebar, wired in `inspect-wiring.ts`.
  // Almost everything it reaches is built after it — the scene, the drawing
  // layer, the PSD file actions that need the panel back — so the deps are
  // read through rather than captured.
  const inspector: Inspector = new Inspector(
    store,
    grid,
    inspectorCallbacks({
      projectId: meta.id,
      os,
      store,
      grid,
      scene: () => handle?.scene ?? null,
      drawing: () => drawing,
      inspector: () => inspector,
      psdFile: () => psdFile,
      convert: () => convert,
      collider: () => collider,
      shapes,
      openShape: (layerId, shapeId) => modes.mask.open(layerId, shapeId),
      psdLayers: (key) => psdLayers(key),
      activeLayerId: () => activeLayerId,
      deleteSelection: () => deleteSelection(),
      deleteLayer: (layerId) => void deleteLayer(layerId),
      tools: () => tools,
    }),
  );

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
    onPsdChanged: psdChanged,
  });

  // The four ways something on the canvas becomes something else — a sketch
  // to a PSD or a boundary, a fill to a PSD, a copy to a file of its own.
  const convert = createConversions({
    projectId: meta.id,
    store,
    grid,
    scene: () => handle?.scene ?? null,
    drawing: () => drawing,
    file: psdFile,
  });

  // And the list of the file's layers, which is where all of those buttons
  // now are. Built through a factory rather than inline because the inspector
  // asks for one per key, and it needs half the shell to answer.
  const psdLayers = createPsdLayersFactory({
    projectId: meta.id,
    os,
    store,
    grid,
    file: psdFile,
    scene: () => handle?.scene ?? null,
    onExtrude: () => extrude.resume(),
    onEditPsd: (key, layer) => psdEdit.open(key, layer),
  });

  const actions = new SelectionActions(grid, {
    onFill: () => handle?.scene.fillSelection(inspector.fillPaint, false),
    onAddImage: () => {
      const selection = handle?.scene.getSelection();
      const scene = handle?.scene;
      if (selection?.kind !== "region" || !scene) return;
      addImageToRegion(meta.id, os, grid, scene, selection.from, selection.to);
    },
    onGeneratePsd: () => {
      const selection = handle?.scene.getSelection();
      const scene = handle?.scene;
      if (selection?.kind !== "region" || !scene) return;
      void generatePsdForRegion(meta.id, grid, scene, selection.from, selection.to)
        .then(() => inspector.revealPsdLayers());
    },
    onExtrude: () => extrude.open(),
    onPatternShape: () => shapes.fromSelection(),
  });

  // The four bars along the bottom of the canvas — a solid being pulled out
  // of the grid, a collider painted on it, a PSD layer drawn into, a pattern
  // layer's shape swept. The modes themselves are the scene's; see
  // editor/canvas-mode-ui.ts for what the shell owes them.
  const modes = createCanvasModeUis({
    projectId: meta.id,
    store,
    grid,
    host: canvasWrap,
    scene: () => handle?.scene ?? null,
    drawing: () => drawing,
    useSelectTool: () => tools.apply("select", false),
    usePencil: () => tools.apply("pencil", false),
    inkLayerId: () => activeLayerId,
    defaultZoom: () => render.options.defaultZoom,
    onPsdWritten: async (key, manifest) => {
      await handle?.scene.reloadPsd(key, manifest);
      inspector.reloadPsdLayers(key);
      psdChanged();
    },
    // An extrusion is a greybox to paint over, so Apply opens the file's own
    // layer list the way every other Create PSD does.
    onPsdCreated: () => inspector.revealPsdLayers(),
    // Back to the layer's own panel, where the shape list is.
    onMaskDone: (layerId) => handle?.scene.setSelection({ kind: "layer", layerId }),
  });
  const { extrude, collider, psdEdit } = modes;

  // The ink's tools and the boundary sweep hand the pointer to the drawing
  // layer; select, pan and point leave it with the game canvas and its gesture
  // arbiter. What each of them means to the pointer — a tap, and a long press,
  // which turns a brush round into an eraser — is `tool-routing.ts`; `tools`
  // is read through a closure because the bars are built before it.
  const rail = new ToolRail(
    (tool: ToolId) => tools.apply(tool),
    (tool: ToolId) => tools.hold(tool),
  );
  const tools = createToolRouting({
    rail,
    canvas: canvasWrap,
    scene: () => handle?.scene ?? null,
    drawing: () => drawing,
    inspector,
  });

  // Undo, the three sections, and the six things behind the menu — wired in
  // `header-wiring.ts`, the way the properties sidebar's controls are.
  const header = new EditorHeader(
    meta.name,
    `${meta.gridSize} px · ${meta.projection}`,
    headerCallbacks({
      meta,
      os,
      grid,
      leave: () => void leave(),
      history: () => history,
      setMode: (next) => setMode(next),
      intake: () => intake,
      scene: () => handle?.scene ?? null,
      openOptions: () => render.open(store.layers.length),
      reloadGame: () => gameFrame.isRunning && gameFrame.reload(),
    }),
  );

  // Fill / Undo corner / Cancel, floating beside a shape being tapped out with
  // the point-to-point fill. Chrome beside the work rather than rows in the
  // side panel, because a shape is built by looking at the canvas — see
  // `fill-bar.ts`, which also holds the wiring.
  const fillBar = createFillBarUi({
    drawing: () => drawing,
    onChanged: () => inspector.render(),
  });

  // What Play runs: the project's own `game/` tree, in a frame over the
  // canvas. Built for every project and shown only in play mode — see
  // setMode, and `editor/game-frame.ts` for why Play is the program rather
  // than a second implementation of it.
  const gameFrame = new GameFrame(meta.id);

  // The header is a row of the shell, not chrome floating over the canvas, so
  // only the tools and the selection bar are inside the canvas wrapper — the
  // rail hanging from the top-left corner and the drawing toolbar standing on
  // the bottom-left one. The two edge toggles go in too, from `createShell` —
  // they are layout.
  canvasWrap.append(
    rail.root,
    rail.drawBar,
    rail.label,
    actions.root,
    fillBar.root,
    gameFrame.root,
  );

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
    store,
    os,
    canvas: canvasWrap,
    scene: () => handle?.scene ?? null,
    enabled: () => mode === "draw",
    onPsdReplaced: async (key, manifest) => {
      await handle?.scene.reloadPsd(key, manifest);
      inspector.reloadPsdLayers(key);
      psdChanged();
    },
  });

  clear(container);
  container.appendChild(shell);
  const stopShortcuts = bindShortcuts({
    currentTool: () => rail.tool,
    applyTool: (tool) => tools.apply(tool, false),
    hasSelection: () => {
      const selection = handle?.scene.getSelection();
      return !!selection && selection.kind !== "none" && selection.kind !== "layer";
    },
    onDelete: () => deleteSelection(),
    onUndo: () => history?.undo(),
    onRedo: () => history?.redo(),
  });
  layout.restore();

  // Where the game's screen falls on this canvas: a crosshair on world 0,0,
  // and a dashed boundary around what it opens showing — `screen-guide.ts`.
  const guide = new ScreenGuide({
    main: layout.main,
    defaultZoom: () => render.options.defaultZoom,
  });
  canvasWrap.appendChild(guide.root);
  overlays.setGuide(guide);

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
      onViewport: (view) => {
        drawing?.sync(view);
        minimap.setViewport(view);
        guide.sync(view);
        // The shape is in world units and the bar is chrome, so the bar has to
        // be moved every time the camera does.
        fillBar.sync();
      },
      onDetachCopy: (layerId, placementId, key) =>
        void psdFile.detach(layerId, placementId, key),
      // The panels ask the plugin whether a file carries its anchor mark, and
      // the answer changes the moment the manifest arrives. Nothing about the
      // document moves when it does, so without this every row would keep
      // showing what was true before anything had been read.
      onPsdsLoaded: () => {
        layers.render();
        inspector.render();
      },
      onExtrudeChange: () => extrude.sync(),
      onColliderChange: () => collider.sync(),
      onPsdEditChange: () => psdEdit.sync(),
      onMaskChange: () => modes.mask.sync(),
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
    // The Boundary tool's sweep. The drawing layer knows nothing about grids,
    // so what arrives is the raw outline and the simplification is here.
    onZone: (points) =>
      addSweptZone(store, handle?.scene ?? null, activeLayerId, points),
    // The point-to-point fill gained or lost a corner, or stopped being shown
    // at all. Nothing in the document moved, so the two things looking at it
    // are told by hand: the panel, which counts the corners, and the bar
    // floating over the shape.
    onFillPoints: () => {
      inspector.render();
      fillBar.sync();
    },
    ...libraryPointer(grid),
  });
  drawing.style = libraryStyle(grid, drawing.style);
  canvasWrap.appendChild(drawing.root);
  drawing.sync(handle.scene.viewport());
  if (import.meta.env.DEV) {
    // Handles for the browser harness in harness/; dev builds only. The panel
    // is here as well as the scene because some of what it does is reached
    // from nowhere else — `revealPsdLayers` fires at the end of a conversion
    // that needs the Rust side to have written a file.
    const hooks = window as unknown as Record<string, unknown>;
    hooks.__idlewildScene = handle.scene;
    hooks.__idlewildInspector = inspector;
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
    inspector.setAdjusting(handle?.scene.adjustingUnit ?? null);
    actions.update(selection, handle?.scene.selectionScreenAnchor() ?? null);
    // Pattern Shape is the one button on that bar that is not about turning
    // space into content, and it only means anything with a pattern layer to
    // confine — so it comes and goes with the active layer's kind.
    actions.setPatternLayer(layerKind(store.layer(activeLayerId)) === "pattern");

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

  // Deleting a selection and deleting a layer, in `layer-actions.ts` beside
  // the sheet one of them puts up and the switch the other walks.
  const { deleteSelection, deleteLayer } = createDeletes({
    store,
    selection: () => handle?.scene.getSelection() ?? null,
    setSelection: (selection) => handle?.scene.setSelection(selection),
    setActiveLayer,
    redrawLayers: () => layers.render(),
    removeSelectedPlacement: () => handle?.scene.removeSelectedPlacement(),
    removeStrokes: (ids) => drawing?.removeStrokes(ids),
    clearSelection: () => handle?.scene.setSelection({ kind: "none" }),
  });

  /**
   * Draw, Code or Play.
   *
   * **Code shows what Play shows.** The project's own game runs over the
   * canvas in both, because a code editor beside a still picture of the game
   * is a code editor you cannot check anything in: save a file and the thing
   * in front of you restarts on it. What Code keeps that Play does not is the
   * left sidebar and the panel — so the scene can be switched and the project
   * read while the game runs, before a full test in Play. The inspector goes
   * down with the tools: it describes what is selected on a canvas nobody can
   * reach through a running game.
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
    // Code keeps the left sidebar, and turns it into a directory: the game is
    // over the canvas, so there is nothing in that column to act on, and what
    // is wanted beside the code is the names — scenes, layers, PSDs, and the
    // layers inside each file. See `editor/layer-directory.ts`.
    layers.setBrowsing(next === "code");

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
    await saveThumbnail(handle?.game ?? null, meta.id);
    await store.flush();
    header.destroy();
    overlays.destroy();
    guide.destroy();
    layers.destroy();
    inspector.destroy();
    gameFrame.destroy();
    modes.destroy();
    drawing?.destroy();
    drawing = null;
    code.destroy();
    terminal.destroy();
    layout.destroy();
    // Awaited: a game that has only been *asked* to go is a game still
    // holding psd-to-phaser's plugin key, and the next project opened would
    // boot without it — see `GameHandle.destroy`.
    await handle?.destroy();
    handle = null;
  }

  return teardown;
}
