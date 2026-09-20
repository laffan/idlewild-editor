/**
 * Tile layers on this canvas: what is drawn, what a gesture does, and where
 * palettes come from.
 *
 * Three things that are one subject and were three fields on the scene until
 * `world-scene.ts` reached its seven hundred lines. They belong together for
 * a better reason than that, though: each of the three is useless without the
 * other two. Tiles are drawn from a palette, put down by a gesture that reads
 * one, and a palette only exists because a PSD landed on a tile layer.
 *
 * The scene keeps one field and hands this what it cannot work out for
 * itself — where the camera is looking, which layer is active, what a screen
 * point is in the world, and what the shell says is in hand.
 */

import type Phaser from "phaser";
import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import { layerKind } from "../lib/layer-kinds";
import {
  isMergedTileset,
  mergedArt,
  MERGED_FILE,
  propertyOf,
  syncTilesets,
  tilesetArt,
  tilesetsOf,
  tilesUnderBox,
} from "../lib/tile-layers";
import { textureKey, type ManifestLayer } from "../lib/manifest";
import { MERGED_LAYER, PSD_PROPERTY } from "../lib/tiled/types";
import * as log from "../lib/log";
import type { CellRange } from "../lib/pattern";
import type { Point, Rect, Selection } from "../lib/types";
import { TileMove } from "./tile-move";
import { TilePaint } from "./tile-paint";
import { EMPTY_HAND } from "../lib/tile-tools";
import { TileRender } from "./tile-render";
import type { WorldSceneConfig } from "./world-scene-config";

export interface TilingHost {
  scene: Phaser.Scene;
  /**
   * The element the pointer moves over, which is the one thing here that is
   * not the scene's own business.
   *
   * Phaser reports a pointer that is *down*; a preview has to follow one that
   * is merely over the canvas, and on a desktop that is most of the time. So
   * the hover comes straight off the element, and it is unbound in `destroy`
   * — a listener holding a scene that has gone is a listener drawing ghosts
   * into a destroyed renderer.
   */
  canvas: HTMLElement;
  store: DocStore;
  grid: Grid;
  /** What the shell says is in hand — see `WorldSceneConfig.tileVerb`. */
  config: WorldSceneConfig;
  /** The layer new work lands on. Read through: it moves as the user works. */
  activeLayerId: () => string;
  worldAt: (screenX: number, screenY: number) => Point;
  /** A loaded PSD's own layers — `PsdPlacements.layersOf`. */
  psdLayers: (psdKey: string) => ManifestLayer[];
  /**
   * How big a loaded PSD's own canvas is — `PsdPlacements.sizeOf`.
   *
   * What a **merged** palette is measured against, and not the union of the
   * file's artwork: a palette is cut on the project's grid from the file's
   * own corner, so a picture trimmed to its contents would shift every tile.
   */
  psdSize: (psdKey: string) => { width: number; height: number } | undefined;
  /** What is selected, and the way to say where a moved run ended up. */
  selection: () => Selection;
  setSelection: (selection: Selection) => void;
}

export class Tiling {
  /** The tiles on the canvas — `tile-render.ts`. */
  readonly render: TileRender;
  /** Putting them there, which is a tool's gesture rather than a mode. */
  readonly paint: TilePaint;
  /** Carrying a selected run somewhere else — `tile-move.ts`. */
  readonly dragging: TileMove;
  private readonly host: TilingHost;
  /** Files whose merged picture is being written — see `mergePalette`. */
  private readonly merging = new Set<string>();

  constructor(host: TilingHost) {
    this.host = host;
    this.render = new TileRender(host.scene, host.store, host.grid);
    this.paint = new TilePaint({
      store: host.store,
      grid: host.grid,
      activeLayerId: host.activeLayerId,
      worldAt: host.worldAt,
      hand: () => host.config.tileHand?.() ?? EMPTY_HAND,
      // What would land if the pointer went down, and the outline of a sweep
      // in flight. Chrome about a gesture rather than anything in the
      // document, which is why it goes to the renderer rather than the store.
      onPreview: (tiles, trace) => this.render.preview(tiles, trace),
      // A tile put down moves no camera, so the renderer would not notice
      // until something else did.
      onChanged: () => this.render.invalidate(),
    });
    this.dragging = new TileMove({
      store: host.store,
      grid: host.grid,
      worldAt: host.worldAt,
      selection: host.selection,
      setSelection: host.setSelection,
      onPreview: (tiles) => this.render.preview(tiles, []),
      onChanged: () => this.render.invalidate(),
    });
    host.canvas.addEventListener("pointermove", this.onHover);
    host.canvas.addEventListener("pointerleave", this.onLeave);
  }

  /**
   * The two tile gestures, in the order a press is offered to them.
   *
   * **Painting first.** A tile tool in hand is unambiguous — a press means
   * put a tile down, wherever it lands — while a move is only ever offered
   * under Select, which is not a tool that paints. So the two never both
   * want the same press, and the order is a formality rather than a rule
   * somebody has to remember.
   */
  begin(screenX: number, screenY: number): boolean {
    return (
      this.paint.begin(screenX, screenY) || this.dragging.begin(screenX, screenY)
    );
  }

  move(screenX: number, screenY: number): boolean {
    return this.paint.move(screenX, screenY) || this.dragging.move(screenX, screenY);
  }

  end(): boolean {
    return this.paint.end() || this.dragging.end();
  }

  /**
   * What would land if the pointer went down where it is.
   *
   * Only for a pointer that is *not* pressed: while a gesture is running the
   * preview is the gesture's, pushed from `TilePaint` as it goes, and a
   * second opinion arriving from here would fight it every frame.
   */
  private readonly onHover = (event: PointerEvent): void => {
    if (event.buttons !== 0) return;
    this.paint.hover(event.clientX, event.clientY);
  };

  private readonly onLeave = (): void => this.paint.clearHover();

  /** Leaving would otherwise strand two listeners holding a dead scene. */
  destroy(): void {
    this.host.canvas.removeEventListener("pointermove", this.onHover);
    this.host.canvas.removeEventListener("pointerleave", this.onLeave);
    this.render.clear();
  }

  /**
   * Every PSD on a tile layer has a palette.
   *
   * A **sweep** rather than a hook on placing, which is the whole lesson of
   * the first version: a file carried onto a tile layer from the layer panel
   * never goes near `PsdPlacements.place`, so it vanished — the canvas
   * refuses to draw a tile layer's placements, and there was no palette to
   * show instead. Asking the document what is true keeps every route onto a
   * layer working, including the ones nobody has written yet.
   *
   * Called on every document change and again once the manifests are in,
   * because those are the two moments the answer can have moved: one puts the
   * file on the layer, the other is when anything is known about it.
   *
   * Silent on the undo stack for the reason `PsdPlacements.migrate` is — it
   * runs from inside a change handler, and what it writes belongs to whatever
   * edit brought the file onto the layer rather than being a step somebody
   * took. See `lib/tile-layers.ts`.
   */
  cutPalettes(): void {
    const { store, grid } = this.host;
    const cut = store.history.silence(() =>
      syncTilesets(store, grid, {
        layer: (key, path) => tilesetArt(this.host.psdLayers(key), path),
        merged: (key) => mergedArt(this.host.psdSize(key)),
      }),
    );
    // A merged palette's picture is not one psd-to-phaser loaded: it is
    // composited from the file and written beside the layer sprites, so the
    // scene has to ask for it and load it itself. Every merged palette in the
    // document rather than only the ones just cut — a project opened again
    // has all of its palettes and none of their textures, and `mergePalette`
    // returns on the first line for one that is already in.
    const fresh = new Set(
      cut.filter(isMergedTileset).map((set) => propertyOf(set, PSD_PROPERTY)),
    );
    for (const tileset of tilesetsOf(store)) {
      if (!isMergedTileset(tileset)) continue;
      const key = propertyOf(tileset, PSD_PROPERTY);
      if (key) void this.mergePalette(key, fresh.has(key));
    }
  }

  /**
   * Write a merged palette's picture, and get its texture into the scene.
   *
   * Two things psd-to-phaser does for a layer sprite and does not do for
   * this: the file does not exist until the Rust side composites it, and
   * nothing loads it afterwards because the plugin has never heard of it. So
   * both are here, keyed on the texture the renderer will ask for — see
   * `TileRender.frameFor`, which looks it up by `textureKey`.
   *
   * Guarded by `merging` rather than by the texture alone, because
   * `cutPalettes` runs on every document change and the write takes as long
   * as compositing a PSD does: without it a palette cut once would be written
   * again on every keystroke in a layer name.
   */
  private async mergePalette(psdKey: string, fresh: boolean): Promise<void> {
    const texture = textureKey(psdKey, MERGED_LAYER);
    if (this.merging.has(psdKey) || this.host.scene.textures.exists(texture)) {
      return;
    }
    this.merging.add(psdKey);
    try {
      // A palette cut just now has no picture yet; one cut in an earlier
      // session almost certainly has, and compositing every PSD in a project
      // again on every open would be seconds of work to produce files that
      // are already there. So the write is skipped and the load is what
      // finds out — and a load that fails is the one case worth paying for.
      if (fresh) await this.host.config.mergePsdArt?.(psdKey);
      try {
        await this.loadMerged(psdKey, texture);
      } catch (err) {
        if (fresh) throw err;
        await this.host.config.mergePsdArt?.(psdKey);
        await this.loadMerged(psdKey, texture);
      }
      // The palette is in the document either way; what has just arrived is
      // the picture it is cut out of, so every tile standing on it can be
      // drawn now.
      this.render.invalidate();
    } catch (err) {
      log.error(`Could not merge ${psdKey}.psd into one palette:`, err);
    } finally {
      this.merging.delete(psdKey);
    }
  }

  /** The merged picture, into the scene's texture manager. */
  private loadMerged(psdKey: string, texture: string): Promise<void> {
    const { scene } = this.host;
    if (scene.textures.exists(texture)) return Promise.resolve();
    const url = `${this.host.config.assetBase}/assets/${psdKey}/${MERGED_FILE}`;
    return new Promise((resolve, reject) => {
      // Phaser's loader is a queue with global events, so both handlers are
      // taken off again the moment either fires: a second palette merged in
      // the same session would otherwise resolve this one's promise.
      const done = () => {
        scene.load.off("filecomplete-image-" + texture, done);
        scene.load.off("loaderror", failed);
        resolve();
      };
      const failed = (file: { key?: string }) => {
        if (file?.key !== texture) return;
        scene.load.off("filecomplete-image-" + texture, done);
        scene.load.off("loaderror", failed);
        reject(new Error(`${url} did not load`));
      };
      scene.load.once("filecomplete-image-" + texture, done);
      scene.load.on("loaderror", failed);
      scene.load.image(texture, url);
      scene.load.start();
    });
  }

  /**
   * What a dragged box caught, when the box was dragged over a tile layer.
   *
   * Null on every other kind of layer, which is what lets the marquee ask
   * unconditionally: there are no placed images to catch on a tile layer —
   * its placements are its palettes and are never on the canvas at all — and
   * everywhere else there are no tiles.
   *
   * Null too when the box touched no tiles. A drag over empty ground has
   * always meant a selection of nothing, and a tile layer is no exception.
   */
  caughtIn(box: Rect): Selection | null {
    const layerId = this.host.activeLayerId();
    const layer = this.host.store.layer(layerId);
    if (layerKind(layer) !== "tile") return null;
    const cells = tilesUnderBox(layer, this.host.grid, box);
    return cells.length > 0 ? { kind: "tiles", layerId, cells } : null;
  }

  /** Bring what is on screen in line with the document. Cheap per frame. */
  sync(range: CellRange): void {
    this.render.sync(range);
  }

  /** A tile put down, a layer hidden, a palette added: rebuild next frame. */
  invalidate(): void {
    this.render.invalidate();
  }

  /** Both halves of the window where a file's textures are being replaced. */
  dropKey(psdKey: string): void {
    this.render.dropKey(psdKey);
    // A merged palette's texture is this file's own rather than one
    // psd-to-phaser loaded, so nothing else evicts it — and a re-parse has
    // just rewritten the picture it was made from. Left in place it would be
    // the artwork as it was before the edit, for ever.
    const texture = textureKey(psdKey, MERGED_LAYER);
    if (this.host.scene.textures.exists(texture)) {
      this.host.scene.textures.remove(texture);
    }
  }

  restoreKey(psdKey: string): void {
    this.render.restoreKey(psdKey);
    // And back again, for a file that has one. `cutPalettes` will not ask —
    // the palette is already in the document — so the reload is asked for
    // here, where the file is known to have just landed.
    const held = this.host.store.doc.tilesets ?? [];
    const merged = held.some(
      (set) => isMergedTileset(set) && propertyOf(set, PSD_PROPERTY) === psdKey,
    );
    // Not `fresh`: the picture has already been rebuilt by the re-parse that
    // cleared the directory — `psd_flatten::refresh` runs at the end of every
    // processing run — so this is a load rather than a second composite.
    if (merged) void this.mergePalette(psdKey, false);
  }

  /** A scene switch, or the layer ceasing to be one. */
  clear(): void {
    this.render.clear();
  }
}
