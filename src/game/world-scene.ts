/**
 * The editor scene: the canvas the user builds on.
 *
 * It used to grow a character in play mode and drive it with A*, which made
 * Play a performance the editor gave *about* the document — and left the
 * project's own `WorldScene.js`, the one in the code modal, never running at
 * all. Play now loads that program instead, in a frame over this canvas (see
 * `editor/game-frame.ts`), so this scene's only part in play mode is to put
 * its tools down.
 */

import Phaser from "phaser";
import type { DocStore } from "../lib/doc-store";
import { Grid } from "../lib/grid";
import type { Cell, EditorMode, Selection } from "../lib/types";
import * as log from "../lib/log";
import { CameraRig, type RigMode } from "./camera-rig";
import { SceneCamera } from "./scene-camera";
import { DocRenderer } from "./doc-renderer";
import { GridRenderer } from "./grid-renderer";
import { BackgroundRender } from "./background-render";
import { PatternRender } from "./pattern-render";
import { SelectionOverlay } from "./selection-overlay";
import { DropTargets, type PlacedTarget } from "./drop-target";
import { Marquee } from "./marquee";
import { DragController } from "./drag";
import { CanvasModes } from "./canvas-modes";
import { PsdPlacements } from "./psd-placements";
import { fillRegion } from "./fill-region";
import type { Paint } from "../lib/paint";
import { selectionLayer } from "../lib/selection";
import { patternSpec } from "../lib/layer-kinds";
import { unitOf } from "./unit";
import {
  doomedPlacements,
  inAdjustedInstance,
  selectedPlacement,
  toggleUnit,
} from "./adjusting";
import type { Viewport } from "../drawing";

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
   * Every PSD the open scene places has loaded.
   *
   * The panels ask the plugin what is in a file — whether it carries an
   * anchor mark — and the answer changes the moment the manifest arrives.
   * Nothing about the *document* changes when it does, so without this the
   * rows would keep showing what was true before anything had been read.
   */
  onPsdsLoaded?: () => void;
}

export class WorldScene extends Phaser.Scene {
  private config!: WorldSceneConfig;
  private store!: DocStore;
  grid!: Grid;

  private rig!: CameraRig;
  /** The camera, its clamp and its place in the document — `scene-camera.ts`. */
  private cam!: SceneCamera;
  private gridRenderer!: GridRenderer;
  /** Colours and gradients behind everything — `background-render.ts`. */
  private backgrounds!: BackgroundRender;
  /** A pattern layer, worked out from the camera — `pattern-render.ts`. */
  private patterns!: PatternRender;
  private docRenderer!: DocRenderer;
  private overlay!: SelectionOverlay;
  private drops!: DropTargets;
  private marquee!: Marquee;

  /**
   * Whether the canvas is the thing in front of the user: true in Draw, false
   * in Code and Play, which both put the project's own game in a frame over
   * it. Which mode it *is* stays the shell's business — see `setMode`.
   */
  private editing = true;
  private selection: Selection = { kind: "none" };
  private drag!: DragController;
  /** The modes that take the canvas over — see `canvas-modes.ts`. */
  modes!: CanvasModes;
  private psds!: PsdPlacements;
  /** The layer new work lands on. */
  activeLayerId = "";
  /** The rail's tool, as the gesture arbiter sees it — see `setGestureMode`. */
  private gestureMode: RigMode = "select";
  /**
   * The placed PSD whose layers are being moved individually.
   *
   * Null is the normal state, where a PSD is one thing: tapping any of its
   * layers selects it and dragging moves the lot. A double-tap opens the unit
   * under the finger up, and it stays open until the selection leaves it.
   */
  private adjusting: string | null = null;

  constructor() {
    super("World");
  }

  init(config: WorldSceneConfig): void {
    this.config = config;
    this.store = config.store;
    this.grid = new Grid(config.store.projection, config.store.gridSize);
    this.activeLayerId = config.store.layers[0]?.id ?? "";
  }

  create(): void {
    // Named so the host object below can read the scene's live state through
    // a getter rather than a value copied at construction.
    const sceneRef = this;
    this.cameras.main.setBackgroundColor("#d9e6ef");

    this.gridRenderer = new GridRenderer(this.add.graphics(), this.grid);
    this.backgrounds = new BackgroundRender(this, this.store);
    // The same gate `placeOne` asks, so the two can never disagree about
    // whether a file is ready. Read lazily: `psds` is built further down.
    this.patterns = new PatternRender(
      this,
      this.store,
      this.grid,
      (key, path) => this.psds.canPlace(key, path),
      // A pattern layer's shapes are chrome about that layer, so they show
      // while it is the subject and go when it is not — the same rule a
      // placement's outline keeps. Nothing while mask mode is up: that mode
      // draws the same shapes itself, live, and the document's copy of the
      // one being edited is by then the version before the edit.
      () => (this.modes.mask.active ? null : selectionLayer(this.selection)),
    );
    this.docRenderer = new DocRenderer(this, this.store, this.grid);
    this.overlay = new SelectionOverlay(this.add.graphics(), this.grid);
    this.drops = new DropTargets(this.add.graphics(), this.store);
    this.marquee = new Marquee(this.add.graphics(), this.grid);
    this.drag = new DragController({
      store: this.store,
      grid: this.grid,
      worldAt: (x, y) => this.worldAt(x, y),
      zoom: () => this.cameras.main.zoom,
      getSelection: () => this.selection,
      setSelection: (selection) => this.setSelection(selection),
      adjustingUnit: () => this.adjusting,
      render: (layerId, placement) => this.psds.placeOne(layerId, placement),
      detachCopy: (layerId, placementId, key) =>
        this.config.onDetachCopy?.(layerId, placementId, key),
      onDragStateChange: (dragging) => this.config.onDragStateChange(dragging),
    });
    this.modes = new CanvasModes({
      scene: this,
      grid: this.grid,
      zoom: () => this.cameras.main.zoom,
      camera: () => this.cameras.main,
      worldAt: (x, y) => this.worldAt(x, y),
      clearSelection: () => {
        this.marquee.cancel();
        this.setSelection({ kind: "none" });
      },
      // Everything else on the layer, so a shape is not edited blind against
      // the boundaries it sits beside — see `mask-render.ts`.
      otherShapes: (layerId, shapeId) =>
        patternSpec(this.store.layer(layerId)).shapes.filter(
          (shape) => shape.id !== shapeId,
        ),
      onExtrudeChange: () => this.config.onExtrudeChange?.(),
      onColliderChange: () => this.config.onColliderChange?.(),
      onPsdEditChange: () => this.config.onPsdEditChange?.(),
      onMaskChange: () => this.config.onMaskChange?.(),
    });

    // Where the camera is, what it is allowed to do, and where that is
    // written down — see `scene-camera.ts`. Built after the renderers it
    // tells about a move, and before the arbiter that drives it.
    this.cam = new SceneCamera({
      scene: this,
      store: this.store,
      defaultZoom: () => this.config.defaultZoom(),
      onInvalidate: () => {
        this.gridRenderer.invalidate();
        // A pattern shape's outline is stroked at a width divided by the
        // zoom, like the lattice, so a zoom that leaves the same spaces on
        // screen still has to redraw it.
        this.patterns.invalidate();
      },
      onScaled: () => {
        // Selection chrome is sized against the zoom, so it has to be redrawn.
        this.overlay.render(
          this.selection,
          this.store,
          this.cam.zoom,
          this.adjusting,
        );
        this.modes.refresh();
      },
      onChange: () => this.config.onCameraChange(),
      onViewport: this.config.onViewport,
    });

    this.rig = new CameraRig(this.game.canvas, {
      onTap: (x, y) => this.handleTap(x, y),
      onDoubleTap: (x, y) => this.handleDoubleTap(x, y),
      // The two canvas modes are asked before anything else at every stage:
      // whichever is up owns the pointer, and what it does with a drag — paint
      // a space, pull the face it is already holding — is the mode itself.
      onDragStart: (x, y, modifiers) =>
        this.editing &&
        (this.modes.beginDrag(x, y) || this.drag.begin(x, y, modifiers)),
      onDragMove: (x, y) => {
        if (!this.modes.moveDrag(x, y)) this.drag.move(x, y);
      },
      onDragEnd: () => {
        if (!this.modes.endDrag()) this.drag.end();
      },
      onMarqueeStart: (x, y, fromHold) => this.beginMarquee(x, y, fromHold),
      onMarqueeMove: (x, y) => this.extendMarquee(x, y),
      onMarqueeEnd: () => this.endMarquee(),
      onPan: (dx, dy) => this.cam.pan(dx, dy),
      onZoom: (factor, cx, cy) => this.cam.zoomBy(factor, cx, cy),
      onChange: () => this.cam.persist(),
    });

    this.psds = new PsdPlacements({
      scene: this,
      store: this.store,
      grid: this.grid,
      docRenderer: this.docRenderer,
      assetBase: this.config.assetBase,
      // Read through, not captured: the active layer changes as the user
      // works, and a PSD is placed on whichever one is current.
      get activeLayerId() {
        return sceneRef.activeLayerId;
      },
      setSelection: (selection) => this.setSelection(selection),
      reselect: () => this.setSelection(this.selection),
      refresh: () => this.refresh(),
      onPsdsLoaded: () => this.config.onPsdsLoaded?.(),
      releaseKey: (key) => sceneRef.patterns.dropKey(key),
      restoreKey: (key) => sceneRef.patterns.restoreKey(key),
    });

    this.store.addEventListener("change", () => {
      // A pattern's rule and a backdrop's colours live in the document, and
      // both are drawn from the camera rather than from a record — so neither
      // has anything to notice a change on its own.
      this.patterns.invalidate();
      this.backgrounds.invalidate();
      this.refresh();
    });
    // A different scene is not a changed document, it is a different canvas.
    this.store.addEventListener("scene", () => this.reloadScene());
    // A placement the document draws and the canvas has none of — see there.
    this.docRenderer.setPlacer((id, p) => this.psds.placeOne(id, p));
    this.psds.migrate();
    void this.psds.loadAll();
    this.refresh();
  }

  /**
   * The active scene has changed: everything on the canvas is now about
   * somewhere else.
   *
   * Nothing half-done survives the move — a drag, a marquee, a solid being
   * pulled or a collider being painted, and an opened-up PSD are all about
   * objects on their way out. Then `render()` does the demolition for free:
   * the renderer keys placements by id and destroys every one it no longer
   * finds in the document, which after a switch is all of them. `loadAll` puts
   * the new scene's up, loading any PSD this session has not needed yet.
   */
  reloadScene(): void {
    this.drag.cancel();
    this.markDrop(null);
    this.marquee.cancel();
    this.modes.stop();
    this.adjusting = null;
    this.setSelection({ kind: "none" });
    this.activeLayerId = this.store.layers[0]?.id ?? "";
    // Every copy and every backdrop on screen belongs to the scene that has
    // just been left.
    this.patterns.clear();
    this.backgrounds.clear();

    this.docRenderer.render();
    void this.psds.loadAll();

    // Where you were standing in the scene you are arriving in — or the
    // origin, for one nobody has looked at yet.
    this.cam.arrive();
  }

  override update(_time: number, _delta: number): void {
    this.gridRenderer.update(this.cameras.main);
    // Both of these are worked out from the camera rather than stored, the
    // way the lattice is: a backdrop is wherever you are looking, and a
    // pattern is a rule evaluated over the spaces the viewport can see.
    this.backgrounds.update(this.cameras.main);
    // And the lattice floats over whatever backdrop is front-most: a flat
    // colour across the whole view is the one thing on this canvas that can
    // leave the editor with no ground to build on. See `setBackdropDepth`.
    this.gridRenderer.setBackdropDepth(this.backgrounds.frontDepth());
    this.patterns.sync(this.gridRenderer.visibleRange(this.cameras.main));
    // PSD Edit mode's dim is cut out of what the camera can see, so it follows the
    // camera the way the lattice does — a pan moves it as surely as a zoom.
    // A no-op while the mode is down.
    this.modes.psdEdit.refresh();
    this.cam.publish();
  }

  /** How the world maps onto the screen right now. */
  viewport(): Viewport {
    return this.cam.viewport();
  }

  /** Camera moves the drawing layer asks for while it owns the pointer. */
  panScreen(dxScreen: number, dyScreen: number): void {
    this.cam.pan(dxScreen, dyScreen);
    this.cam.persist();
  }

  zoomAt(factor: number, screenX: number, screenY: number): void {
    this.cam.zoomBy(factor, screenX, screenY);
    this.cam.persist();
  }

  /** Stand somewhere else at the zoom you are at — what the minimap asks for. */
  centreOn(worldX: number, worldY: number): void {
    this.cam.centreOn(worldX, worldY);
  }

  /** Repaint from the document. Cheap: everything here is retained state. */
  refresh(): void {
    this.docRenderer.render();
    this.overlay.render(
      this.selection,
      this.store,
      this.cameras.main.zoom,
      this.adjusting,
    );
  }

  // ── selection ─────────────────────────────────────────────────────────────

  private worldAt(screenX: number, screenY: number): Phaser.Math.Vector2 {
    const rect = this.game.canvas.getBoundingClientRect();
    return this.cameras.main.getWorldPoint(
      screenX - rect.left,
      screenY - rect.top,
    );
  }

  private handleTap(screenX: number, screenY: number): void {
    // The running game is a frame over this canvas and takes its own input;
    // nothing down here is meant for it.
    if (!this.editing) return;
    const world = this.worldAt(screenX, screenY);

    // While a collider is being drawn, a tap paints the space under the
    // finger; while a shape is being extruded, it takes hold of one of the
    // shape's faces. Either way it never reaches the document underneath.
    if (this.modes.tap(screenX, screenY)) return;

    // Under the Point tool a tap puts one down rather than picking up what is
    // already there — the only tool for which a tap on empty space makes
    // something. It still falls through when the layer will not take it, so
    // the tap clears the selection rather than doing nothing at all.
    if (this.gestureMode === "point" && this.addPoint(world)) return;

    this.setSelection(this.docRenderer.pickAt(world, this.activeLayerId));
  }

  /**
   * Put a named place on the active layer, on the space that was tapped.
   *
   * The space rather than the pixel, because a point is a thing standing on
   * one and the space is what the game reads it back as. A blank project's
   * space is a single pixel, so there it is the pixel that was tapped.
   */
  private addPoint(world: Phaser.Math.Vector2): boolean {
    const layer = this.store.layer(this.activeLayerId);
    if (!layer || layer.locked) {
      log.warn("The active layer is locked");
      return false;
    }
    const point = this.store.addPoint(layer.id, this.grid.worldToCell(world));
    this.setSelection({ kind: "point", layerId: layer.id, pointId: point.id });
    return true;
  }

  private beginMarquee(
    screenX: number,
    screenY: number,
    fromHold: boolean,
  ): void {
    if (!this.editing) return;
    if (this.modes.beginSelect(screenX, screenY)) return;
    this.setSelection(this.marquee.begin(this.worldAt(screenX, screenY), fromHold));
  }

  private extendMarquee(screenX: number, screenY: number): void {
    if (this.modes.extendSelect(screenX, screenY)) return;
    const next = this.marquee.extend(
      this.worldAt(screenX, screenY),
      this.cameras.main.zoom,
    );
    if (next) this.setSelection(next);
  }

  /** What the box caught — `game/marquee.ts` decides, this applies it. */
  private endMarquee(): void {
    if (this.modes.endSelect()) return;
    const next = this.marquee.end(this.store.layers);
    if (next) this.setSelection(next);
  }

  setSelection(selection: Selection): void {
    // Layer adjustment belongs to the unit it was opened on. Selecting
    // anything else closes it, so the mode never outlives what it is about
    // and a PSD is one thing again the moment you look away from it.
    if (
      this.adjusting &&
      !inAdjustedInstance(this.store, selection, this.adjusting)
    ) {
      this.adjusting = null;
    }
    this.selection = selection;
    this.overlay.render(
      selection,
      this.store,
      this.cameras.main.zoom,
      this.adjusting,
    );
    this.config.onSelectionChange(selection);
  }

  /** Which unit is open for layer-by-layer editing, if any. */
  get adjustingUnit(): string | null {
    return this.adjusting;
  }

  /** Open the placed PSD under the finger up into its layers, or close it. */
  private handleDoubleTap(screenX: number, screenY: number): void {
    if (!this.editing) return;
    // Two taps under the Point tool are two points, not a request to open
    // whatever the second one happened to land on. A second tap inside
    // collider mode is a second space painted, for the same reason.
    if (this.gestureMode === "point" || this.modes.collider.active) return;
    const world = this.worldAt(screenX, screenY);
    const hit = this.docRenderer.pick(world.x, world.y);
    if (!hit) return;

    const next = toggleUnit(hit, this.adjusting);
    this.adjusting = next.adjusting;
    log.info(next.message);
    this.setSelection(next.selection);
  }

  /** Open the selected PSD up into its layers, from outside the canvas. */
  startAdjusting(): void {
    const placement = selectedPlacement(this.store, this.selection);
    if (!placement) return;
    this.adjusting = unitOf(placement);
    this.refresh();
    this.config.onSelectionChange(this.selection);
  }

  /** Remove what is selected, when it is a placed PSD — see `adjusting.ts`. */
  removeSelectedPlacement(): void {
    if (this.selection.kind !== "placement") return;
    const doomed = doomedPlacements(this.store, this.selection, this.adjusting);
    for (const member of doomed) {
      this.store.removePlacement(this.selection.layerId, member.id);
    }
    if (doomed.length > 0) this.setSelection({ kind: "none" });
  }

  /** Leave layer adjustment without changing what is selected. */
  stopAdjusting(): void {
    if (!this.adjusting) return;
    this.adjusting = null;
    this.overlay.render(this.selection, this.store, this.cameras.main.zoom, null);
    this.config.onSelectionChange(this.selection);
  }

  getSelection(): Selection {
    return this.selection;
  }

  /** The grid space at the middle of the view — where a paste lands. */
  centreCell(): Cell {
    const camera = this.cameras.main;
    return this.grid.worldToCell({ x: camera.midPoint.x, y: camera.midPoint.y });
  }

  /** The grid space under a point on the page — where a drop lands. */
  cellAt(clientX: number, clientY: number): Cell {
    return this.grid.worldToCell(this.worldAt(clientX, clientY));
  }

  /** The placed PSD under a point on the page — what a drop would replace. */
  placedAt(clientX: number, clientY: number): PlacedTarget | null {
    if (!this.editing) return null;
    const world = this.worldAt(clientX, clientY);
    return this.drops.at(world.x, world.y);
  }

  /**
   * Which placed unit the canvas is treating specially while a mode has it.
   *
   * `suppress` keeps one off the canvas — extrude's, because a solid being
   * carried on with stands on exactly the ground its own flat artwork covers.
   * `reveal` is the inverse and is PSD Edit mode's: on a pattern layer a placement
   * is the palette a rule scatters and is drawn nowhere, and PSD Edit mode frames
   * exactly the space it is anchored to. Both leave the document untouched,
   * so ending a mode is a matter of clearing them again.
   */
  suppressInstance(instance: string | null): void {
    this.docRenderer.suppressInstance(instance);
  }

  revealInstance(instance: string | null): void {
    // Only on a change, and that is not tidiness: PSD Edit mode derives this on
    // every progress line the pipeline emits while a PSD is being written, so
    // being told the same thing again has to cost nothing. Revealing decides
    // that a unit *may* be drawn; `placeUnit` is what makes it, because on a
    // pattern layer nothing ever has.
    if (!this.docRenderer.revealInstance(instance)) return;
    if (instance) this.psds.placeUnit(instance);
  }

  /** Outline what a drop would replace, or clear the outline. */
  markDrop(target: PlacedTarget | null): void {
    this.drops.mark(target, this.cameras.main.zoom);
  }

  /** Screen position for the floating action bar over a region selection. */
  selectionScreenAnchor(): { x: number; y: number; width: number } | null {
    if (this.selection.kind !== "region" || !this.marquee.held) return null;
    const bounds = this.grid.rangeBounds(this.selection.from, this.selection.to);
    const camera = this.cameras.main;
    const rect = this.game.canvas.getBoundingClientRect();
    return {
      x: rect.left + (bounds.x - camera.worldView.x) * camera.zoom,
      y: rect.top + (bounds.y - camera.worldView.y) * camera.zoom,
      // The width comes too, so the bar can sit over the middle of the
      // selection rather than over its left-hand corner.
      width: bounds.width * camera.zoom,
    };
  }

  // ── content ───────────────────────────────────────────────────────────────

  /** Fill the current region selection on the active layer. */
  fillSelection(paint: Paint, walkable: boolean): void {
    if (this.selection.kind !== "region") return;
    const next = fillRegion(
      this.store,
      this.grid,
      this.activeLayerId,
      this.selection,
      paint,
      walkable,
    );
    if (next) this.setSelection(next);
  }

  // ── the scene's face on a PSD ─────────────────────────────────────────────
  //
  // Delegation and nothing else. A PSD is placed from the editor shell and
  // from both of the drawing layer's conversions, so the scene is where they
  // all reach — but what each of these means is documented where it is done,
  // in `psd-placements.ts` and `doc-renderer.ts`, and saying it twice is how
  // the two copies come to disagree.

  placePsd(key: string, json: string, at: Cell, scale = 1): Promise<boolean> {
    return this.psds.place(key, json, at, scale);
  }

  previewPsdVisibility(key: string | null, names: readonly string[]): void {
    this.docRenderer.previewVisibility(key, names);
  }

  reloadPsd(
    key: string,
    manifestJson: string,
    renames?: ReadonlyMap<string, string>,
  ): Promise<void> {
    return this.psds.reload(key, manifestJson, renames);
  }

  renamePsd(from: string, to: string): Promise<void> {
    return this.psds.rename(from, to);
  }

  psdAnchored(key: string): boolean {
    return this.psds.anchored(key);
  }

  repointPlacement(
    selection: Extract<Selection, { kind: "placement" }>,
    key: string,
    manifestJson: string,
  ): Promise<void> {
    return this.psds.repoint(selection, key, manifestJson);
  }

  // ── modes ─────────────────────────────────────────────────────────────────

  /**
   * Code and Play differ in what the shell keeps on screen, not in anything
   * the scene does: both run the game in a frame over this canvas, so both
   * mean the same thing here. Nothing half-built survives the trip — a drag,
   * a marquee, a solid being pulled — and a drop highlight left behind would
   * never be cleared, because nothing can be dropped on a running game.
   */
  setMode(mode: EditorMode): void {
    const editing = mode === "draw";
    if (editing === this.editing) return;
    this.editing = editing;
    if (editing) return;

    this.drag.cancel();
    this.markDrop(null);
    this.marquee.cancel();
    this.modes.stop();
    this.setSelection({ kind: "none" });
  }

  /** Let a tool take raw pointer input — the drawing layer's entry point. */
  /** What a drag on empty space does: rubber-band, or move the camera. */
  setGestureMode(mode: RigMode): void {
    // Kept as well as handed on, because a tap means something different
    // under the Point tool and the rig reports every tap the same way.
    this.gestureMode = mode;
    this.rig.setMode(mode);
  }

  suspendGestures(suspended: boolean): void {
    this.rig.setSuspended(suspended);
  }

  shutdownScene(): void {
    this.cam.destroy();
    this.rig.destroy();
    this.drops.destroy();
    this.marquee.destroy();
    this.modes.destroy();
    this.docRenderer.destroy();
  }
}
