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
import type { Cell, EditorMode, Placement, Selection } from "../lib/types";
import * as log from "../lib/log";
import { CameraRig } from "./camera-rig";
import { DocRenderer } from "./doc-renderer";
import { GridRenderer } from "./grid-renderer";
import { SelectionOverlay } from "./selection-overlay";
import { PlayController } from "./play-controller";

export interface WorldSceneConfig {
  store: DocStore;
  assetBase: string;
  onSelectionChange: (selection: Selection) => void;
  onCameraChange: () => void;
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
  private play!: PlayController;

  private mode: EditorMode = "edit";
  private selection: Selection = { kind: "none" };
  private marqueeAnchor: Cell | null = null;
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
    } else {
      this.cameras.main.centerOn(0, 0);
    }

    this.rig = new CameraRig(this.game.canvas, {
      onTap: (x, y) => this.handleTap(x, y),
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
    this.overlay.render(this.selection, this.store);
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
  }

  private persistCamera(): void {
    const camera = this.cameras.main;
    this.store.setCamera(camera.midPoint.x, camera.midPoint.y, camera.zoom);
    this.config.onCameraChange();
  }

  centreOnOrigin(): void {
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

  setSelection(selection: Selection): void {
    this.selection = selection;
    this.overlay.render(selection, this.store);
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
   * Register a processed PSD with psd-to-phaser and place it. The manifest is
   * already on disk; the plugin loads it over the asset server.
   */
  async placePsd(key: string, width: number, height: number, at: Cell): Promise<void> {
    const layer = this.store.layer(this.activeLayerId);
    if (!layer || layer.locked) {
      log.warn("The active layer is locked");
      return;
    }

    const world = this.grid.cellToWorld(at);
    const placement = this.store.addPlacement(layer.id, {
      psdKey: key,
      layerPath: "root",
      x: world.x - width / 2,
      y: world.y - height / 2,
      width,
      height,
      anchor: at,
    });

    await this.loadPsd(key);
    this.placeOne(layer.id, placement);
    this.setSelection({
      kind: "placement",
      layerId: layer.id,
      placementId: placement.id,
    });
  }

  private plugin(): PsdToPhaser | undefined {
    return (this as unknown as Record<string, PsdToPhaser | undefined>).P2P;
  }

  /** Ask psd-to-phaser to load a key, resolving when its assets are in. */
  private loadPsd(key: string): Promise<void> {
    const p2p = this.plugin();
    if (!p2p) {
      log.error("psd-to-phaser is not registered on this scene");
      return Promise.resolve();
    }
    if (p2p.getData(key)) return Promise.resolve();

    return new Promise((resolve) => {
      const done = () => {
        this.load.off(Phaser.Loader.Events.COMPLETE, done);
        resolve();
      };
      this.load.on(Phaser.Loader.Events.COMPLETE, done);
      p2p.load.load(this, key, `${this.config.assetBase}/assets/${key}`);
      this.load.start();
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
        this.placeOne(layer.id, placement);
      }
    }
    this.refresh();
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
    this.rig.destroy();
    this.docRenderer.destroy();
  }
}
