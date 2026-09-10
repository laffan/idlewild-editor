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
import { parseManifest, placeableLayers, placedPosition } from "../lib/manifest";
import type { Cell, EditorMode, Placement, Selection } from "../lib/types";
import * as log from "../lib/log";
import { CameraRig } from "./camera-rig";
import { DocRenderer } from "./doc-renderer";
import { GridRenderer } from "./grid-renderer";
import { SelectionOverlay } from "./selection-overlay";
import { PlayController } from "./play-controller";
import { DragController } from "./drag";
import { evictPsd, loadPsd, reconcilePlacements } from "./psd-loader";
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
  private play!: PlayController;

  private mode: EditorMode = "edit";
  private selection: Selection = { kind: "none" };
  private marqueeAnchor: Cell | null = null;
  private drag!: DragController;
  /** Set once the camera is where it should stay — restored, or user-moved. */
  private cameraPlaced = false;
  /** The last camera state pushed to `onViewport`, to skip idle frames. */
  private lastView = "";
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
    this.drag = new DragController({
      store: this.store,
      grid: this.grid,
      worldAt: (x, y) => this.worldAt(x, y),
      zoom: () => this.cameras.main.zoom,
      getSelection: () => this.selection,
      setSelection: (selection) => this.setSelection(selection),
      render: (layerId, placement) => this.placeOne(layerId, placement),
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
      onDragStart: (x, y, modifiers) =>
        this.mode !== "play" && this.drag.begin(x, y, modifiers),
      onDragMove: (x, y) => this.drag.move(x, y),
      onDragEnd: () => this.drag.end(),
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
    this.publishViewport();
    if (this.mode === "play") this.play.update();
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
   *
   * The PSD's `P | anchor` mark is what lands on the anchor cell. A file
   * without one falls back to its canvas centre, which is where an import
   * has always gone; a file with one keeps its position through the artist
   * resizing the canvas or moving the artwork inside it, because the mark
   * moves with them and the centre does not.
   *
   * `scale` is how big the artwork is displayed against its own pixels —
   * see `editor/import-anchor.ts` for why an import arrives at a half of it.
   */
  async placePsd(
    key: string,
    manifestJson: string,
    at: Cell,
    scale = 1,
  ): Promise<void> {
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

    const world = this.grid.cellToWorld(at);
    await this.loadPsd(key);

    let last: Placement | null = null;
    for (const entry of layers) {
      const width = entry.width || manifest.width;
      const height = entry.height || manifest.height;
      const at2 = placedPosition(world, manifest, entry, scale, scale);
      const placement = this.store.addPlacement(layer.id, {
        psdKey: key,
        layerPath: entry.path,
        x: at2.x,
        y: at2.y,
        width: width * scale,
        height: height * scale,
        // The size the manifest exported at, which the displayed size is
        // measured against — so a re-import can keep this scale.
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

  /**
   * Swap in a re-imported PSD under the key it already had.
   *
   * Every cache holding the old file is dropped first — see `evictPsd` — and
   * the placements pointing at the key are brought in line with the new
   * manifest before anything is drawn, so an edit lands where the old
   * artwork was standing.
   *
   * `renames` is for the one edit that changes a layer's name rather than
   * its pixels: the inspector's layer list. It says which paths moved, so a
   * renamed layer is recognised rather than mourned.
   */
  async reloadPsd(
    key: string,
    manifestJson: string,
    renames?: ReadonlyMap<string, string>,
  ): Promise<void> {
    reconcilePlacements(
      this.store,
      this.grid,
      key,
      parseManifest(manifestJson),
      renames,
    );

    this.docRenderer.detachKey(key);
    evictPsd(this, this.plugin(), key);
    await this.loadPsd(key);

    for (const layer of this.store.layers) {
      for (const placement of layer.placements) {
        if (placement.psdKey === key) this.placeOne(layer.id, placement);
      }
    }
    this.docRenderer.render();
  }

  /**
   * Point one placement at a different PSD and redraw it.
   *
   * What breaking a reference does: the copy is byte-identical, so the
   * layer path and the geometry carry over untouched and only the key
   * changes. Everything else still reading the original is left alone,
   * which is the whole point of doing it per placement.
   */
  async repointPlacement(
    selection: Extract<Selection, { kind: "placement" }>,
    key: string,
    manifestJson: string,
  ): Promise<void> {
    const placement = this.store
      .layer(selection.layerId)
      ?.placements.find((p) => p.id === selection.placementId);
    if (!placement) return;

    const manifest = parseManifest(manifestJson);
    const entry =
      manifest.all.find((l) => l.path === placement.layerPath) ??
      placeableLayers(manifest)[0];
    if (!entry) {
      log.warn(`${key}.psd has nothing matching ${placement.layerPath}`);
      return;
    }

    this.docRenderer.detachOne(placement.id);
    this.store.updatePlacement(selection.layerId, selection.placementId, {
      psdKey: key,
      layerPath: entry.path,
    });

    await this.loadPsd(key);
    const updated = this.store
      .layer(selection.layerId)
      ?.placements.find((p) => p.id === selection.placementId);
    if (updated) this.placeOne(selection.layerId, updated);
    this.docRenderer.render();
  }

  private plugin(): PsdToPhaser | undefined {
    return (this as unknown as Record<string, PsdToPhaser | undefined>).P2P;
  }

  private loadPsd(key: string): Promise<void> {
    return loadPsd(this, this.plugin(), key, this.config.assetBase);
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
    this.drag.cancel();
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
