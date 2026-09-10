/**
 * The editor scene. In edit mode this is the canvas the user builds on; in
 * play mode the same scene grows a character and drives it with A*. It is one
 * scene, not two — the spec's play mode adds a character to the game rather
 * than rebooting it.
 */

import Phaser from "phaser";
import PsdToPhaser from "psd-to-phaser";
import type { DocStore } from "../lib/doc-store";
import { Grid, cellsInRange } from "../lib/grid";
import { parseManifest, placeableLayers } from "../lib/manifest";
import type { Cell, EditorMode, Placement, Selection } from "../lib/types";
import * as log from "../lib/log";
import { CameraRig } from "./camera-rig";
import { DocRenderer } from "./doc-renderer";
import { GridRenderer } from "./grid-renderer";
import { SelectionOverlay } from "./selection-overlay";
import { PlayController } from "./play-controller";
import {
  boxToPlacement,
  handleAt,
  HANDLE_SCREEN_PX,
  placementBox,
  resizeBox,
  type Box,
  type Corner,
} from "./resize";

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
}

/** What a drag gesture is moving, captured at pointer-down. */
type DragState =
  | {
      kind: "placement";
      layerId: string;
      id: string;
      grabCell: Cell;
      originCell: Cell;
      offsetX: number;
      offsetY: number;
    }
  | {
      kind: "fill";
      layerId: string;
      id: string;
      grabCell: Cell;
      cells: Cell[];
    }
  | {
      kind: "resize";
      layerId: string;
      id: string;
      corner: Corner;
      /** The box as it was at pointer-down, so the drag never compounds. */
      original: Box;
    };

const MIN_ZOOM = 0.1;
/** How long to wait on psd-to-phaser before placing anyway. */
const LOAD_TIMEOUT_MS = 15_000;
const MAX_ZOOM = 4;

export class WorldScene extends Phaser.Scene {
  private config!: WorldSceneConfig;
  private store!: DocStore;
  grid!: Grid;

  private rig!: CameraRig;
  private gridRenderer!: GridRenderer;
  private docRenderer!: DocRenderer;
  private overlay!: SelectionOverlay;
  private play!: PlayController;

  private mode: EditorMode = "edit";
  private selection: Selection = { kind: "none" };
  private marqueeAnchor: Cell | null = null;
  private drag: DragState | null = null;
  /** Set once the camera is where it should stay — restored, or user-moved. */
  private cameraPlaced = false;
  /** The layer new work lands on. */
  activeLayerId = "";

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
    this.cameras.main.setBackgroundColor("#d9e6ef");

    this.gridRenderer = new GridRenderer(this.add.graphics(), this.grid);
    this.docRenderer = new DocRenderer(this, this.store, this.grid);
    this.overlay = new SelectionOverlay(this.add.graphics(), this.grid);
    this.play = new PlayController(this, this.store, this.grid);

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
      onDragStart: (x, y) => this.beginDrag(x, y),
      onDragMove: (x, y) => this.moveDrag(x, y),
      onDragEnd: () => this.endDrag(),
      onMarqueeStart: (x, y) => this.beginMarquee(x, y),
      onMarqueeMove: (x, y) => this.extendMarquee(x, y),
      onMarqueeEnd: () => this.endMarquee(),
      onPan: (dx, dy) => this.pan(dx, dy),
      onZoom: (factor, cx, cy) => this.zoom(factor, cx, cy),
      onChange: () => this.persistCamera(),
    });

    this.store.addEventListener("change", () => this.refresh());
    void this.loadPlacements();
    this.refresh();
  }

  override update(): void {
    this.gridRenderer.update(this.cameras.main);
    if (this.mode === "play") this.play.update();
  }

  /** Repaint from the document. Cheap: everything here is retained state. */
  refresh(): void {
    this.docRenderer.render();
    this.overlay.render(this.selection, this.store, this.cameras.main.zoom);
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
    this.overlay.render(this.selection, this.store, camera.zoom);
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
      this.play.moveTo(this.grid.worldToCell(world));
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

    const cell = this.grid.worldToCell(world);
    const layer = this.store.layer(this.activeLayerId);
    const fill = layer && !layer.locked ? this.store.fillAt(layer.id, cell) : undefined;
    if (fill && layer) {
      this.setSelection({ kind: "fill", layerId: layer.id, fillId: fill.id });
      return;
    }

    this.setSelection({ kind: "none" });
  }

  private beginMarquee(screenX: number, screenY: number): void {
    if (this.mode === "play") return;
    const cell = this.grid.worldToCell(this.worldAt(screenX, screenY));
    this.marqueeAnchor = cell;
    this.setSelection({ kind: "region", from: cell, to: cell });
  }

  private extendMarquee(screenX: number, screenY: number): void {
    if (!this.marqueeAnchor) return;
    const cell = this.grid.worldToCell(this.worldAt(screenX, screenY));
    this.setSelection({ kind: "region", from: this.marqueeAnchor, to: cell });
  }

  private endMarquee(): void {
    this.marqueeAnchor = null;
  }

  // ── dragging ──────────────────────────────────────────────────────────────

  /**
   * Begin dragging whatever is selected, if the pointer went down on it.
   *
   * Only the current selection is draggable: a pointer-down anywhere else
   * still pans, which keeps the camera reachable everywhere and means a drag
   * is always something the user deliberately picked first.
   */
  private beginDrag(screenX: number, screenY: number): boolean {
    if (this.mode === "play") return false;

    // Copy to a local so TypeScript narrows the union past the closure.
    const selection = this.selection;
    const world = this.worldAt(screenX, screenY);
    const grabCell = this.grid.worldToCell(world);

    if (selection.kind === "placement") {
      const layer = this.store.layer(selection.layerId);
      if (!layer || layer.locked) return false;
      const placement = layer.placements.find(
        (p) => p.id === selection.placementId,
      );
      if (!placement) return false;

      // A corner handle resizes; the body moves. Handles are drawn at a
      // constant screen size, so the world-space target scales with zoom.
      const box = placementBox(placement);
      const corner = handleAt(
        box,
        world,
        HANDLE_SCREEN_PX / this.cameras.main.zoom,
      );
      if (corner) {
        this.drag = {
          kind: "resize",
          layerId: layer.id,
          id: placement.id,
          corner,
          original: box,
        };
        this.config.onDragStateChange(true);
        return true;
      }

      if (
        world.x < placement.x ||
        world.x > placement.x + placement.width ||
        world.y < placement.y ||
        world.y > placement.y + placement.height
      ) {
        return false;
      }

      const anchorWorld = this.grid.cellToWorld(placement.anchor);
      this.drag = {
        kind: "placement",
        layerId: layer.id,
        id: placement.id,
        grabCell,
        originCell: placement.anchor,
        offsetX: placement.x - anchorWorld.x,
        offsetY: placement.y - anchorWorld.y,
      };
      this.config.onDragStateChange(true);
      return true;
    }

    if (selection.kind === "fill") {
      const layer = this.store.layer(selection.layerId);
      if (!layer || layer.locked) return false;
      const fill = layer.fills.find((f) => f.id === selection.fillId);
      if (!fill) return false;
      if (!fill.cells.some((c) => c.cx === grabCell.cx && c.cy === grabCell.cy)) {
        return false;
      }

      this.drag = {
        kind: "fill",
        layerId: layer.id,
        id: fill.id,
        grabCell,
        cells: fill.cells,
      };
      this.config.onDragStateChange(true);
      return true;
    }

    return false;
  }

  private moveDrag(screenX: number, screenY: number): void {
    const drag = this.drag;
    if (!drag) return;

    const world = this.worldAt(screenX, screenY);

    if (drag.kind === "resize") {
      // Resizing works in pixels, not cells: an image's size is a property of
      // the image, and the grid has nothing to say about it.
      const box = resizeBox(drag.original, drag.corner, world);
      this.store.updatePlacement(drag.layerId, drag.id, {
        ...boxToPlacement(box),
        anchor: this.grid.worldToCell({
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
        }),
      });
      return;
    }

    const cell = this.grid.worldToCell(world);
    const dx = cell.cx - drag.grabCell.cx;
    const dy = cell.cy - drag.grabCell.cy;

    if (drag.kind === "placement") {
      // Snap to the grid: the anchor cell moves whole, and the placement
      // keeps whatever offset it had inside that cell.
      const anchor = {
        cx: drag.originCell.cx + dx,
        cy: drag.originCell.cy + dy,
      };
      const anchorWorld = this.grid.cellToWorld(anchor);
      this.store.updatePlacement(drag.layerId, drag.id, {
        anchor,
        x: anchorWorld.x + drag.offsetX,
        y: anchorWorld.y + drag.offsetY,
      });
    } else {
      this.store.updateFill(drag.layerId, drag.id, {
        cells: drag.cells.map((c) => ({ cx: c.cx + dx, cy: c.cy + dy })),
      });
    }
  }

  private endDrag(): void {
    if (!this.drag) return;
    this.drag = null;
    this.config.onDragStateChange(false);
  }

  setSelection(selection: Selection): void {
    this.selection = selection;
    this.overlay.render(selection, this.store, this.cameras.main.zoom);
    this.config.onSelectionChange(selection);
  }

  getSelection(): Selection {
    return this.selection;
  }

  /** Screen position for the floating action bar over a region selection. */
  selectionScreenAnchor(): { x: number; y: number } | null {
    if (this.selection.kind !== "region") return null;
    const bounds = this.grid.rangeBounds(this.selection.from, this.selection.to);
    const camera = this.cameras.main;
    const rect = this.game.canvas.getBoundingClientRect();
    return {
      x: rect.left + (bounds.x - camera.worldView.x) * camera.zoom,
      y: rect.top + (bounds.y - camera.worldView.y) * camera.zoom,
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
    const cells = [...cellsInRange(this.selection.from, this.selection.to)];
    const fill = this.store.addFill(layer.id, {
      cells,
      kind: "color",
      color,
      walkable,
    });
    this.setSelection({ kind: "fill", layerId: layer.id, fillId: fill.id });
  }

  /**
   * Register a processed PSD with psd-to-phaser and place it.
   *
   * One placement per top-level manifest layer, each keeping its offset
   * within the PSD so a multi-layer document arrives as the composition its
   * author built. There is no "root" path — `place()` resolves by walking
   * the manifest's layers by name, so it must be given a real one.
   */
  async placePsd(key: string, manifestJson: string, at: Cell): Promise<void> {
    const layer = this.store.layer(this.activeLayerId);
    if (!layer || layer.locked) {
      log.warn("The active layer is locked");
      return;
    }

    const manifest = parseManifest(manifestJson);
    const layers = placeableLayers(manifest);
    if (layers.length === 0) {
      log.warn(`${key}.psd has no placeable layers — check the naming convention`);
      return;
    }

    // Centre the PSD's own canvas on the anchor cell, then offset each layer
    // by where it sits inside that canvas.
    const world = this.grid.cellToWorld(at);
    const originX = world.x - manifest.width / 2;
    const originY = world.y - manifest.height / 2;

    await this.loadPsd(key);

    let last: Placement | null = null;
    for (const entry of layers) {
      const width = entry.width || manifest.width;
      const height = entry.height || manifest.height;
      const placement = this.store.addPlacement(layer.id, {
        psdKey: key,
        layerPath: entry.path,
        x: originX + entry.x,
        y: originY + entry.y,
        width,
        height,
        naturalWidth: width,
        naturalHeight: height,
        anchor: at,
      });
      this.placeOne(layer.id, placement);
      last = placement;
    }

    if (last) {
      this.setSelection({
        kind: "placement",
        layerId: layer.id,
        placementId: last.id,
      });
    }
  }

  private plugin(): PsdToPhaser | undefined {
    return (this as unknown as Record<string, PsdToPhaser | undefined>).P2P;
  }

  /**
   * Ask psd-to-phaser to load a key, resolving when its textures are in.
   *
   * The signal is the plugin's own `psdLoadComplete`, not the Phaser loader's
   * COMPLETE: P2P loads `data.json` first and only queues the sprites once it
   * has parsed that, so the loader can complete a whole pass before any image
   * has been asked for. `psdLoadComplete` carries no key, so loads are run
   * one at a time.
   */
  private loadPsd(key: string): Promise<void> {
    const p2p = this.plugin();
    if (!p2p) {
      log.error("psd-to-phaser is not registered on this scene");
      return Promise.resolve();
    }
    if (p2p.getData(key)) return Promise.resolve();

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.events.off("psdLoadComplete", finish);
        this.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
        window.clearTimeout(timer);
        resolve();
      };
      const onError = (file: Phaser.Loader.File) => {
        log.error(`Could not load ${file.key} for ${key}: ${file.url}`);
        finish();
      };

      // A PSD whose layers all lazy-load never emits the event, so never
      // block the editor on it indefinitely.
      const timer = window.setTimeout(() => {
        if (!settled) log.warn(`${key} did not finish loading; placing anyway`);
        finish();
      }, LOAD_TIMEOUT_MS);

      this.events.once("psdLoadComplete", finish);
      this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
      // P2P starts the loader itself when it is not already running.
      p2p.load.load(this, key, `${this.config.assetBase}/assets/${key}`);
    });
  }

  private placeOne(layerId: string, placement: Placement): void {
    const p2p = this.plugin();
    if (!p2p) return;
    try {
      const object = p2p.place(this, placement.psdKey, placement.layerPath);
      this.docRenderer.attach(layerId, placement, object);
    } catch (err) {
      log.error(`Could not place ${placement.psdKey}:`, err);
    }
  }

  /** On open, bring back every placement the document already holds. */
  private async loadPlacements(): Promise<void> {
    const keys = new Set<string>();
    for (const layer of this.store.layers) {
      for (const placement of layer.placements) keys.add(placement.psdKey);
    }
    for (const key of keys) {
      try {
        await this.loadPsd(key);
      } catch (err) {
        log.error(`Could not load ${key}:`, err);
      }
    }

    for (const layer of this.store.layers) {
      for (const placement of layer.placements) {
        this.placeOne(layer.id, this.migrateLayerPath(layer.id, placement));
      }
    }
    this.refresh();
  }

  /**
   * Rewrite the placeholder path early builds wrote.
   *
   * Those saved `layerPath: "root"`, which psd-to-phaser resolves by looking
   * for a layer of that name and never finds — the placement came back as an
   * empty group. Repoint it at the PSD's first real top-level layer.
   */
  private migrateLayerPath(layerId: string, placement: Placement): Placement {
    if (placement.layerPath !== "root") return placement;

    const data = this.plugin()?.getData(placement.psdKey);
    const layers = (data?.original as { layers?: Array<{ name?: string }> })
      ?.layers;
    const name = layers?.[0]?.name;
    if (!name) {
      log.warn(`${placement.psdKey} has no top-level layer to place`);
      return placement;
    }

    log.info(`Repointed ${placement.psdKey} from "root" to "${name}"`);
    this.store.updatePlacement(layerId, placement.id, { layerPath: name });
    return { ...placement, layerPath: name };
  }

  // ── modes ─────────────────────────────────────────────────────────────────

  setMode(mode: EditorMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode === "play") {
      this.setSelection({ kind: "none" });
      this.play.start();
    } else {
      this.play.stop();
    }
  }

  /** Let a tool take raw pointer input — the drawing layer's entry point. */
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
    this.docRenderer.destroy();
  }
}
