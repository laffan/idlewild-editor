/**
 * The camera: its clamp, its moves, and where it is remembered.
 *
 * Split out of `world-scene.ts`, which is the hub everything on the canvas
 * hangs from. The camera is the one part of it with a life of its own — it
 * arrives from the document, it is written back to the document as it moves,
 * and it outlives every tool that borrows it. Nothing here knows what is on
 * the canvas; what it needs told about — the lattice, the chrome sized
 * against the zoom — it is handed as callbacks.
 *
 * **The camera rides the scene.** A scene is a place, and coming back to one
 * is coming back to where you were standing in it, so every move the user
 * makes is written to the document. A move the document does not hear about
 * is a move the next scene switch undoes.
 */

import Phaser from "phaser";
import type { DocStore } from "../lib/doc-store";
import { ZOOM_RANGE } from "../lib/types";
import type { Viewport } from "../drawing";

const MIN_ZOOM = 0.1;
// As far in as Project Options may set a project, or the setting lies: this
// was 4 while the sheet took 8, so 6× reached the game and 4× the canvas.
const MAX_ZOOM = ZOOM_RANGE.max;

export interface SceneCameraConfig {
  scene: Phaser.Scene;
  store: DocStore;
  /**
   * The zoom a scene with no camera of its own opens at. Asked for rather
   * than handed over: Project Options changes it under a running editor, and
   * a number taken once is a scene still opening at what the editor booted at.
   */
  defaultZoom: () => number;
  /** The lattice is recomputed from the camera, so a jump or a zoom voids it. */
  onInvalidate: () => void;
  /** A zoom: everything drawn *about* the document is sized against it. */
  onScaled: () => void;
  /** The camera has moved, and the document has been told. */
  onChange: () => void;
  /**
   * Where the camera is now. The drawing layer's stage is slaved to this: its
   * ink is baked in world coordinates and presented with a transform, so it
   * has to be told where the camera is, and told only when there is something
   * to tell.
   */
  onViewport?: (view: Viewport) => void;
}

export class SceneCamera {
  private readonly config: SceneCameraConfig;
  private readonly camera: Phaser.Cameras.Scene2D.Camera;
  /** Set once the camera is where it should stay — restored, or user-moved. */
  private placed = false;
  /** The last state pushed to `onViewport`, so an idle frame costs nothing. */
  private lastView = "";

  constructor(config: SceneCameraConfig) {
    this.config = config;
    this.camera = config.scene.cameras.main;

    const saved = config.store.activeScene.camera;
    if (saved) {
      this.camera.setZoom(saved.zoom);
      this.camera.centerOn(saved.x, saved.y);
      this.placed = true;
      return;
    }

    this.camera.setZoom(config.defaultZoom());
    this.camera.centerOn(0, 0);
    // Scale.RESIZE settles a frame or two after create(), and centring
    // against the pre-resize viewport leaves the origin off-screen. Keep
    // re-centring until the user takes the camera themselves.
    config.scene.scale.on(
      Phaser.Scale.Events.RESIZE,
      this.recentreUntilTouched,
      this,
    );
  }

  get zoom(): number {
    return this.camera.zoom;
  }

  /** How the world maps onto the screen right now. */
  viewport(): Viewport {
    const topLeft = this.camera.getWorldPoint(0, 0);
    return {
      originX: topLeft.x,
      originY: topLeft.y,
      zoom: this.camera.zoom,
      width: this.camera.width,
      height: this.camera.height,
    };
  }

  /**
   * Push the camera out when it has actually moved.
   *
   * Driven from the scene's `update` rather than from the gesture arbiter,
   * because the camera also moves without a gesture — a window resize, a
   * re-centre, the restore on open, a tap on the minimap — and anything
   * slaved to it is left in the wrong place by any of those. The string
   * compare is what keeps an idle frame free.
   */
  publish(): void {
    const push = this.config.onViewport;
    if (!push) return;
    const view = this.viewport();
    const key = `${view.originX}|${view.originY}|${view.zoom}|${view.width}|${view.height}`;
    if (key === this.lastView) return;
    this.lastView = key;
    push(view);
  }

  /** Move by a distance on screen, whatever the zoom makes of it in world. */
  pan(dxScreen: number, dyScreen: number): void {
    this.camera.scrollX -= dxScreen / this.camera.zoom;
    this.camera.scrollY -= dyScreen / this.camera.zoom;
  }

  /** Scale about a point on screen, keeping what is under it fixed. */
  zoomBy(factor: number, screenX: number, screenY: number): void {
    const before = this.camera.getWorldPoint(screenX, screenY);
    this.camera.setZoom(
      Phaser.Math.Clamp(this.camera.zoom * factor, MIN_ZOOM, MAX_ZOOM),
    );
    const after = this.camera.getWorldPoint(screenX, screenY);
    this.camera.scrollX += before.x - after.x;
    this.camera.scrollY += before.y - after.y;
    this.config.onInvalidate();
    this.config.onScaled();
  }

  /**
   * Stand somewhere else, at the zoom you are already at.
   *
   * What the minimap moves the camera with: a tap on it names a place, not a
   * scale, and coming back zoomed differently from how you left would make
   * the map unreadable as a way of getting about.
   */
  centreOn(worldX: number, worldY: number): void {
    this.camera.centerOn(worldX, worldY);
    this.config.onInvalidate();
    this.persist();
  }

  /** Back to the origin, at the zoom a scene opens at. */
  centreOnOrigin(): void {
    this.camera.setZoom(this.config.defaultZoom());
    this.camera.centerOn(0, 0);
    this.config.onInvalidate();
    this.persist();
  }

  /**
   * Arrive in the scene that is now open: where you were standing in it, or
   * the origin for one nobody has looked at yet.
   *
   * Not persisted — arriving is not a move, and writing the camera back here
   * would put a scene switch in the document as an edit.
   */
  arrive(): void {
    const saved = this.config.store.activeScene.camera;
    this.placed = true;
    this.camera.setZoom(saved?.zoom ?? this.config.defaultZoom());
    this.camera.centerOn(saved?.x ?? 0, saved?.y ?? 0);
    this.config.onInvalidate();
    this.config.onChange();
  }

  /** Write where the camera is standing into the scene it is standing in. */
  persist(): void {
    // Any camera movement from here on is the user's; stop re-centring.
    this.placed = true;
    this.config.store.setCamera(
      this.camera.midPoint.x,
      this.camera.midPoint.y,
      this.camera.zoom,
    );
    this.config.onChange();
  }

  /** Re-centre on the origin while the viewport is still settling. */
  private recentreUntilTouched(): void {
    if (this.placed) return;
    this.camera.centerOn(0, 0);
    this.config.onInvalidate();
  }

  destroy(): void {
    this.config.scene.scale.off(
      Phaser.Scale.Events.RESIZE,
      this.recentreUntilTouched,
      this,
    );
  }
}
