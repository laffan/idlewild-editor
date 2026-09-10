/**
 * The editor scene. In edit mode this is the canvas the user builds on; in
 * play mode the same scene grows a character and drives it with A*. It is one
 * scene, not two — the spec's play mode adds a character to the game rather
 * than rebooting it.
 */

import Phaser from "phaser";
import type { DocStore } from "../lib/doc-store";
import { Grid, cellsInRange } from "../lib/grid";
import type { Cell, EditorMode, Placement, Selection } from "../lib/types";
import * as log from "../lib/log";
import { CameraRig, type RigMode } from "./camera-rig";
import { DocRenderer, pickPlacementsIn } from "./doc-renderer";
import { GridRenderer } from "./grid-renderer";
import { SelectionOverlay } from "./selection-overlay";
import { DropTargets, type PlacedTarget } from "./drop-target";
import { PlayController, type PlayMode } from "./play-controller";
import { PlatformerController } from "./play-platformer";
import type { PlayInput } from "./platformer";
import { DragController } from "./drag";
import { PsdPlacements } from "./psd-placements";
import { instanceMembers, instanceOf } from "./instance";
import type { Viewport } from "../drawing";


export interface WorldSceneConfig {
  store: DocStore;
  assetBase: string;
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
   * An option-shift drag has just made a copy that should not reference the
   * original's PSD. The editor owns the duplication because it owns the IPC.
   */
  onDetachCopy?: (layerId: string, placementId: string, key: string) => void;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

export class WorldScene extends Phaser.Scene {
  private config!: WorldSceneConfig;
  private store!: DocStore;
  grid!: Grid;

  private rig!: CameraRig;
  private gridRenderer!: GridRenderer;
  private docRenderer!: DocRenderer;
  private overlay!: SelectionOverlay;
  private drops!: DropTargets;
  private play!: PlayMode;
  /** Held movement, written by the editor's play pad and its keyboard. */
  private playInput: PlayInput = { left: false, right: false, jump: false };

  private mode: EditorMode = "edit";
  private selection: Selection = { kind: "none" };
  private marqueeAnchor: Cell | null = null;
  /**
   * Whether the region selected was *asked for*, rather than dragged through.
   *
   * A finger held still means "this much space" — Fill, Add Image and
   * Generate PSD are what it is for, and the action bar offers them. A drag
   * under the Select tool means "whatever is in here", and its region is only
   * what is left when the box caught nothing: putting a bar of things to make
   * over it interrupts a gesture that was about picking things up.
   */
  private held = false;
  private drag!: DragController;
  private psds!: PsdPlacements;
  /** Set once the camera is where it should stay — restored, or user-moved. */
  private cameraPlaced = false;
  /** The last camera state pushed to `onViewport`, to skip idle frames. */
  private lastView = "";
  /** The layer new work lands on. */
  activeLayerId = "";
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
    this.docRenderer = new DocRenderer(this, this.store, this.grid);
    this.overlay = new SelectionOverlay(this.add.graphics(), this.grid);
    this.drops = new DropTargets(this.add.graphics(), this.store);
    // Which play mode this project has is a property of the project, decided
    // when it was created and carried in the document ever since.
    this.play =
      this.store.genre === "platformer"
        ? new PlatformerController(this, this.store, this.grid)
        : new PlayController(this, this.store, this.grid);
    this.drag = new DragController({
      store: this.store,
      grid: this.grid,
      worldAt: (x, y) => this.worldAt(x, y),
      zoom: () => this.cameras.main.zoom,
      getSelection: () => this.selection,
      setSelection: (selection) => this.setSelection(selection),
      adjustingInstance: () => this.adjusting,
      render: (layerId, placement) => this.psds.placeOne(layerId, placement),
      detachCopy: (layerId, placementId, key) =>
        this.config.onDetachCopy?.(layerId, placementId, key),
      onDragStateChange: (dragging) => this.config.onDragStateChange(dragging),
    });

    const saved = this.store.doc.camera;
    if (saved) {
      this.cameras.main.setZoom(saved.zoom);
      this.cameras.main.centerOn(saved.x, saved.y);
      this.cameraPlaced = true;
    } else {
      this.cameras.main.centerOn(0, 0);
      // Scale.RESIZE settles a frame or two after create(), and centring
      // against the pre-resize viewport leaves the origin off-screen. Keep
      // re-centring until the user takes the camera themselves.
      this.scale.on(Phaser.Scale.Events.RESIZE, this.recentreUntilTouched, this);
    }

    this.rig = new CameraRig(this.game.canvas, {
      onTap: (x, y) => this.handleTap(x, y),
      onDoubleTap: (x, y) => this.handleDoubleTap(x, y),
      onDragStart: (x, y, modifiers) =>
        this.mode !== "play" && this.drag.begin(x, y, modifiers),
      onDragMove: (x, y) => this.drag.move(x, y),
      onDragEnd: () => this.drag.end(),
      onMarqueeStart: (x, y, fromHold) => this.beginMarquee(x, y, fromHold),
      onMarqueeMove: (x, y) => this.extendMarquee(x, y),
      onMarqueeEnd: () => this.endMarquee(),
      onPan: (dx, dy) => this.pan(dx, dy),
      onZoom: (factor, cx, cy) => this.zoom(factor, cx, cy),
      onChange: () => this.persistCamera(),
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
    });

    this.store.addEventListener("change", () => this.refresh());
    this.psds.migrateInstances();
    void this.psds.loadAll();
    this.refresh();
  }

  override update(_time: number, delta: number): void {
    this.gridRenderer.update(this.cameras.main);
    this.publishViewport();
    if (this.mode === "play") this.play.update(delta, this.playInput);
  }

  /**
   * Take the movement currently held down.
   *
   * The editor shell owns the play pad and the keyboard, because both are
   * chrome rather than scene content — see `editor/play-pad.ts`. A top-down
   * project has nothing to do with it and ignores it.
   */
  setPlayInput(input: PlayInput): void {
    this.playInput = input;
  }

  /** How the world maps onto the screen right now. */
  viewport(): Viewport {
    const camera = this.cameras.main;
    const topLeft = camera.getWorldPoint(0, 0);
    return {
      originX: topLeft.x,
      originY: topLeft.y,
      zoom: camera.zoom,
      width: camera.width,
      height: camera.height,
    };
  }

  /**
   * Push the camera out when it has moved.
   *
   * Driven from `update` rather than from the gesture arbiter because the
   * camera also moves without a gesture — a window resize, a re-centre, the
   * restore on open — and a stage left behind by any of those shows its ink
   * in the wrong place. The string compare is what keeps an idle frame free.
   */
  private publishViewport(): void {
    if (!this.config.onViewport) return;
    const view = this.viewport();
    const key = `${view.originX}|${view.originY}|${view.zoom}|${view.width}|${view.height}`;
    if (key === this.lastView) return;
    this.lastView = key;
    this.config.onViewport(view);
  }

  /** Camera moves the drawing layer asks for while it owns the pointer. */
  panScreen(dxScreen: number, dyScreen: number): void {
    this.pan(dxScreen, dyScreen);
    this.persistCamera();
  }

  zoomAt(factor: number, screenX: number, screenY: number): void {
    this.zoom(factor, screenX, screenY);
    this.persistCamera();
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

  // ── camera ────────────────────────────────────────────────────────────────

  private pan(dxScreen: number, dyScreen: number): void {
    const camera = this.cameras.main;
    camera.scrollX -= dxScreen / camera.zoom;
    camera.scrollY -= dyScreen / camera.zoom;
  }

  private zoom(factor: number, screenX: number, screenY: number): void {
    const camera = this.cameras.main;
    const before = camera.getWorldPoint(screenX, screenY);
    camera.setZoom(
      Phaser.Math.Clamp(camera.zoom * factor, MIN_ZOOM, MAX_ZOOM),
    );
    // Keep the point under the fingers fixed while the scale changes.
    const after = camera.getWorldPoint(screenX, screenY);
    camera.scrollX += before.x - after.x;
    camera.scrollY += before.y - after.y;
    this.gridRenderer.invalidate();
    // Selection chrome is sized against the zoom, so it has to be redrawn.
    this.overlay.render(this.selection, this.store, camera.zoom, this.adjusting);
  }

  /** Re-centre on the origin while the viewport is still settling. */
  private recentreUntilTouched(): void {
    if (this.cameraPlaced) return;
    this.cameras.main.centerOn(0, 0);
    this.gridRenderer.invalidate();
  }

  private persistCamera(): void {
    // Any camera movement from here on is the user's; stop re-centring.
    this.cameraPlaced = true;
    const camera = this.cameras.main;
    this.store.setCamera(camera.midPoint.x, camera.midPoint.y, camera.zoom);
    this.config.onCameraChange();
  }

  centreOnOrigin(): void {
    this.cameraPlaced = true;
    this.cameras.main.setZoom(1);
    this.cameras.main.centerOn(0, 0);
    this.gridRenderer.invalidate();
    this.persistCamera();
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
    const world = this.worldAt(screenX, screenY);

    if (this.mode === "play") {
      this.play.tap(world);
      return;
    }

    // Tapping an image selects it; otherwise fall through to the grid.
    const hit = this.docRenderer.pick(world.x, world.y);
    if (hit) {
      this.setSelection({
        kind: "placement",
        layerId: hit.layerId,
        placementId: hit.placement.id,
      });
      return;
    }

    // Then a boundary. Ahead of fills because a boundary is a thing someone
    // made and a fill is the ground it was made over — and behind images
    // because a boundary is usually drawn around them and would otherwise
    // swallow every tap meant for what is standing inside it.
    const zone = this.docRenderer.pickZone(world.x, world.y);
    if (zone) {
      this.setSelection({
        kind: "zone",
        layerId: zone.layerId,
        zoneId: zone.zone.id,
      });
      return;
    }

    const cell = this.grid.worldToCell(world);
    const layer = this.store.layer(this.activeLayerId);
    const fill = layer && !layer.locked ? this.store.fillAt(layer.id, cell) : undefined;
    if (fill && layer) {
      this.setSelection({ kind: "fill", layerId: layer.id, fillId: fill.id });
      return;
    }

    this.setSelection({ kind: "none" });
  }

  private beginMarquee(
    screenX: number,
    screenY: number,
    fromHold: boolean,
  ): void {
    if (this.mode === "play") return;
    const cell = this.grid.worldToCell(this.worldAt(screenX, screenY));
    this.marqueeAnchor = cell;
    this.held = fromHold;
    this.setSelection({ kind: "region", from: cell, to: cell });
  }

  private extendMarquee(screenX: number, screenY: number): void {
    if (!this.marqueeAnchor) return;
    const cell = this.grid.worldToCell(this.worldAt(screenX, screenY));
    this.setSelection({ kind: "region", from: this.marqueeAnchor, to: cell });
  }

  /**
   * What the box caught.
   *
   * A marquee over images is a way of picking several of them up; a marquee
   * over empty grid is a way of saying "this much space", which is what Fill,
   * Add Image and Generate PSD act on. Both are the same gesture, and the
   * answer is decided by what is under it at the end rather than by a
   * modifier nobody would find.
   */
  private endMarquee(): void {
    const anchor = this.marqueeAnchor;
    this.marqueeAnchor = null;
    if (!anchor || this.selection.kind !== "region") return;

    // The marquee's own shape, which under an isometric template is a
    // diamond — the box around it reaches a long way past what was dragged.
    const outline = this.grid.rangePolygon(this.selection.from, this.selection.to);
    const caught = pickPlacementsIn(this.store.layers, outline);
    if (!caught) return;
    this.setSelection({
      kind: "placements",
      layerId: caught.layerId,
      ids: caught.ids,
    });
  }

  setSelection(selection: Selection): void {
    // Layer adjustment belongs to the unit it was opened on. Selecting
    // anything else closes it, so the mode never outlives what it is about
    // and a PSD is one thing again the moment you look away from it.
    if (this.adjusting && !this.inAdjustedInstance(selection)) {
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

  private inAdjustedInstance(selection: Selection): boolean {
    if (selection.kind !== "placement") return false;
    const placement = this.store
      .layer(selection.layerId)
      ?.placements.find((p) => p.id === selection.placementId);
    return !!placement && instanceOf(placement) === this.adjusting;
  }

  /** Which unit is open for layer-by-layer editing, if any. */
  get adjustingInstance(): string | null {
    return this.adjusting;
  }

  /**
   * Open the placed PSD under the finger up into its own layers, or close it.
   *
   * The first tap of the double has already selected something, so this only
   * has to decide what that selection means from here on.
   */
  private handleDoubleTap(screenX: number, screenY: number): void {
    if (this.mode === "play") return;
    const world = this.worldAt(screenX, screenY);
    const hit = this.docRenderer.pick(world.x, world.y);
    if (!hit) return;

    const instance = instanceOf(hit.placement);
    this.adjusting = this.adjusting === instance ? null : instance;
    log.info(
      this.adjusting
        ? `${hit.placement.psdKey}.psd — adjusting layers; tap away to finish`
        : `${hit.placement.psdKey}.psd — moving as one again`,
    );
    this.setSelection({
      kind: "placement",
      layerId: hit.layerId,
      placementId: hit.placement.id,
    });
  }

  /** Open the selected PSD up into its layers, from outside the canvas. */
  startAdjusting(): void {
    if (this.selection.kind !== "placement") return;
    const placement = this.selectedPlacement();
    if (!placement) return;
    this.adjusting = instanceOf(placement);
    this.refresh();
    this.config.onSelectionChange(this.selection);
  }

  /**
   * Remove what is selected, when it is a placed PSD.
   *
   * The unit, unless it has been opened up — deleting one layer of a PSD that
   * moves as one thing would leave the rest of it behind looking broken, and
   * "Remove from layer" on something drawn as a single outline should remove
   * what that outline is around.
   */
  removeSelectedPlacement(): void {
    if (this.selection.kind !== "placement") return;
    const placement = this.selectedPlacement();
    if (!placement) return;

    const doomed =
      this.adjusting === instanceOf(placement)
        ? [placement]
        : instanceMembers(
            this.store.layers,
            this.selection.layerId,
            instanceOf(placement),
          );
    for (const member of doomed) {
      this.store.removePlacement(this.selection.layerId, member.id);
    }
    this.setSelection({ kind: "none" });
  }

  private selectedPlacement(): Placement | undefined {
    // Copied to a local so TypeScript narrows the union past the callback.
    const selection = this.selection;
    if (selection.kind !== "placement") return undefined;
    return this.store
      .layer(selection.layerId)
      ?.placements.find((p) => p.id === selection.placementId);
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
    if (this.mode === "play") return null;
    const world = this.worldAt(clientX, clientY);
    return this.drops.at(world.x, world.y);
  }

  /** Outline what a drop would replace, or clear the outline. */
  markDrop(target: PlacedTarget | null): void {
    this.drops.mark(target, this.cameras.main.zoom);
  }

  /** Screen position for the floating action bar over a region selection. */
  selectionScreenAnchor(): { x: number; y: number; width: number } | null {
    if (this.selection.kind !== "region" || !this.held) return null;
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
  fillSelection(color: string, walkable: boolean): void {
    if (this.selection.kind !== "region") return;
    const layer = this.store.layer(this.activeLayerId);
    if (!layer || layer.locked) {
      log.warn("The active layer is locked");
      return;
    }
    // A snapping project fills the spaces it covers, so an irregular run of
    // them stays irregular. A blank one fills the rectangle that was dragged:
    // its cells are single pixels, and one record per covered pixel would put
    // a hundred thousand of them in a document that means "this box".
    const shape = this.grid.snaps
      ? { cells: [...cellsInRange(this.selection.from, this.selection.to)] }
      : {
          cells: [],
          rect: this.grid.rangeBounds(this.selection.from, this.selection.to),
        };
    const fill = this.store.addFill(layer.id, {
      ...shape,
      kind: "color",
      color,
      walkable,
    });
    this.setSelection({ kind: "fill", layerId: layer.id, fillId: fill.id });
  }

  /**
   * Register a processed PSD with psd-to-phaser and place it.
   *
   * The work is `game/psd-placements.ts`; these four are the scene's face on
   * it, because a PSD is placed from the editor shell and from both of the
   * drawing layer's conversions.
   */
  placePsd(
    key: string,
    manifestJson: string,
    at: Cell,
    scale = 1,
  ): Promise<void> {
    return this.psds.place(key, manifestJson, at, scale);
  }

  /** Swap in a re-imported PSD under the key it already had. */
  reloadPsd(
    key: string,
    manifestJson: string,
    renames?: ReadonlyMap<string, string>,
  ): Promise<void> {
    return this.psds.reload(key, manifestJson, renames);
  }

  /** Move every placement on one PSD key over to another. */
  renamePsd(from: string, to: string): Promise<void> {
    return this.psds.rename(from, to);
  }

  /** Point one placement at a different PSD and redraw it. */
  repointPlacement(
    selection: Extract<Selection, { kind: "placement" }>,
    key: string,
    manifestJson: string,
  ): Promise<void> {
    return this.psds.repoint(selection, key, manifestJson);
  }

  // ── modes ─────────────────────────────────────────────────────────────────

  setMode(mode: EditorMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.drag.cancel();
    // Nothing can be dropped on a running game, so a highlight left over
    // from a drag that ended in Play would never be cleared.
    this.markDrop(null);
    if (mode === "play") {
      this.setSelection({ kind: "none" });
      this.play.start();
    } else {
      this.play.stop();
    }
  }

  /** Let a tool take raw pointer input — the drawing layer's entry point. */
  /** What a drag on empty space does: rubber-band, or move the camera. */
  setGestureMode(mode: RigMode): void {
    this.rig.setMode(mode);
  }

  suspendGestures(suspended: boolean): void {
    this.rig.setSuspended(suspended);
  }

  /** A PNG of the current view, for the home screen's thumbnail. */
  snapshot(): Promise<string> {
    return new Promise((resolve) => {
      this.game.renderer.snapshot((image) => {
        resolve(
          image instanceof HTMLImageElement ? image.src : "",
        );
      });
    });
  }

  shutdownScene(): void {
    this.scale.off(Phaser.Scale.Events.RESIZE, this.recentreUntilTouched, this);
    this.rig.destroy();
    this.drops.destroy();
    this.docRenderer.destroy();
  }
}
