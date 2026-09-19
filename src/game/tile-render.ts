/**
 * A tile layer, drawn.
 *
 * The same bargain the lattice and the pattern renderer make: nothing about
 * what is on screen is stored, and everything is rebuilt from the camera over
 * exactly the spaces the viewport can see. A tile map here is infinite — see
 * `lib/tiled/chunks.ts` — so the alternative is an object per tile ever laid
 * down, which for a map somebody imported is tens of thousands of them for a
 * screen showing two hundred.
 *
 * **A tile is a patch of a tileset's texture.** psd-to-phaser loads a PSD's
 * layer as one image, and what a gid names is a rectangle inside it, so each
 * distinct tile gets a Phaser frame cut on that texture the first time it is
 * asked for — `frameFor` — and every copy of that tile afterwards is an Image
 * on the same frame. Frames are cheap and permanent; the objects come and go.
 *
 * **Where a tile stands is Tiled's rule, not ours.** The image's bottom edge
 * sits on the bottom edge of the space, and its left edge on the left edge of
 * the space's bounding box. That is what makes a tileset whose tiles are
 * taller than the grid overhang *upward* — which is how every isometric
 * tileset in the world is drawn, and how the map looked in Tiled before it
 * was brought here. Getting it wrong is not a small error: it is every wall
 * in the map sunk into the floor.
 */

import type Phaser from "phaser";
import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import { layerKind } from "../lib/layer-kinds";
import { tileLayer, tilesetsOf } from "../lib/tile-layers";
import { tilesInRange } from "../lib/tiled/chunks";
import {
  FLIPPED_HORIZONTALLY,
  FLIPPED_VERTICALLY,
  localId,
  tileFlags,
  tileRect,
} from "../lib/tiled/gid";
import { propertyOf } from "../lib/tile-layers";
import {
  PSD_LAYER_PROPERTY,
  PSD_PROPERTY,
  type TiledTileset,
} from "../lib/tiled/types";
import { textureKey } from "../lib/manifest";
import type { Cell } from "../lib/types";
import type { CellRange } from "../lib/pattern";
import * as log from "../lib/log";

/** Kept in step with `doc-renderer.ts`: one layer's worth of depth. */
const DEPTH_STRIDE = 1000;

/**
 * The most tiles on screen at once, across every tile layer.
 *
 * A ceiling rather than a budget, for the reason the pattern renderer's is:
 * the alternative to refusing is an editor that stops answering. A project
 * zoomed all the way out over an 8px grid asks for a great deal more ground
 * than anybody can see anything on, and the console says when it bites.
 */
const MAX_ON_SCREEN = 4000;

/** One live tile: the object, and what it is a copy of. */
interface Live {
  image: Phaser.GameObjects.Image;
  /** The gid and the depth it was made at, so a redraw can be skipped. */
  signature: string;
  /** The PSD behind it — what `dropKey` works from. See `PatternRender`. */
  psdKey: string;
}

export class TileRender {
  private readonly scene: Phaser.Scene;
  private readonly store: DocStore;
  private readonly grid: Grid;
  /** Keyed by layer and space. */
  private readonly live = new Map<string, Live>();
  private lastRange = "";
  private warned = false;
  /** Keys held off the canvas while their textures are being replaced. */
  private readonly offline = new Set<string>();

  constructor(scene: Phaser.Scene, store: DocStore, grid: Grid) {
    this.scene = scene;
    this.store = store;
    this.grid = grid;
  }

  /**
   * Force the next `sync` to rebuild, whatever the camera is doing.
   *
   * The range is the only thing `sync` compares, so a tile put down, a layer
   * hidden or a palette added has to say so — otherwise nothing would move
   * until the camera did, and painting would look like it had failed.
   */
  invalidate(): void {
    this.lastRange = "";
    this.warned = false;
  }

  /** Bring what is on screen in line with the document. Cheap per frame. */
  sync(range: CellRange): void {
    const layers = this.store.layers;
    const tilesets = tilesetsOf(this.store);
    const signature = [
      range.from.cx,
      range.from.cy,
      range.to.cx,
      range.to.cy,
      this.store.activeSceneId,
      // A tile put down does not move the camera, and a palette arriving does
      // not move the document's tiles — so both are part of what is compared.
      layers.map((l) => `${l.id}:${l.visible}:${l.tiles?.chunks?.length ?? 0}`).join(","),
      tilesets.length,
    ].join("|");
    if (signature === this.lastRange) return;

    const seen = new Set<string>();
    let drawn = 0;
    let missing = false;

    layers.forEach((layer, index) => {
      if (layerKind(layer) !== "tile" || !layer.visible) return;
      const base = (layers.length - index) * DEPTH_STRIDE;
      for (const tile of tilesInRange(tileLayer(layer), range.from, range.to)) {
        if (drawn >= MAX_ON_SCREEN) {
          if (!this.warned) {
            log.warn(
              `More than ${MAX_ON_SCREEN} tiles in view — the rest are not ` +
                "drawn. Zoom in, or the map is larger than it looks.",
            );
            this.warned = true;
          }
          break;
        }
        const key = `${layer.id}:${tile.x},${tile.y}`;
        const made = this.draw(key, tile.gid, { cx: tile.x, cy: tile.y }, base);
        if (made === "missing") {
          missing = true;
          continue;
        }
        seen.add(key);
        drawn++;
      }
    });

    for (const [key, held] of this.live) {
      if (seen.has(key)) continue;
      held.image.destroy();
      this.live.delete(key);
    }

    // A range with anything missing from it is deliberately not remembered,
    // so the next frame tries the whole thing again. A re-import spends
    // several frames between evicting a key's textures and finishing the load
    // that replaces them, and a tile skipped inside that window would stay
    // skipped until the camera moved — see `PatternRender.sync`.
    this.lastRange = missing ? "" : signature;
  }

  /** One tile, made or moved. "missing" means its texture is not in yet. */
  private draw(
    key: string,
    gid: number,
    cell: Cell,
    base: number,
  ): "drawn" | "missing" | "skipped" {
    const held = localId(tilesetsOf(this.store), gid);
    if (!held) return "skipped";
    const psdKey = propertyOf(held.tileset, PSD_PROPERTY);
    const layerPath = propertyOf(held.tileset, PSD_LAYER_PROPERTY) ?? "root";
    if (!psdKey || this.offline.has(psdKey)) return "missing";

    const frame = this.frameFor(psdKey, layerPath, held.tileset, held.id);
    if (!frame) return "missing";

    // Two cells on the same isometric diagonal are at the same screen height
    // and never overlap, so they share a depth; one further down the screen
    // draws in front. On an orthogonal grid tiles do not overlap at all and
    // the rule costs nothing. Clamped so a tile a long way from the origin
    // cannot climb out of its layer's own slot.
    const reach = DEPTH_STRIDE / 2 - 1;
    const rank = Math.max(-reach, Math.min(reach, cell.cx + cell.cy));
    const stand = this.standing(cell);
    const flags = tileFlags(gid);
    const signature = `${gid}:${base + rank}:${stand.x},${stand.y}`;

    const live = this.live.get(key);
    if (live && live.signature === signature) return "drawn";
    if (live) live.image.destroy();

    const image = this.scene.add.image(stand.x, stand.y, frame.texture, frame.name);
    // Bottom-left, which is what makes Tiled's placement rule one assignment
    // rather than an offset worked out per tileset.
    image.setOrigin(0, 1);
    image.setDepth(base + rank);
    image.setFlip(
      (flags & FLIPPED_HORIZONTALLY) !== 0,
      (flags & FLIPPED_VERTICALLY) !== 0,
    );
    this.live.set(key, { image, signature, psdKey });
    return "drawn";
  }

  /**
   * Where a tile's bottom-left corner goes.
   *
   * The bottom-left of the space's **bounding box**, which on an orthogonal
   * grid is the bottom-left of the square and on an isometric one is the left
   * vertex's x with the bottom vertex's y. Both come straight off `Grid`, so
   * the projection is asked once here rather than guessed at per tileset.
   */
  private standing(cell: Cell): { x: number; y: number } {
    const at = this.grid.cellToWorld(cell);
    if (this.grid.projection === "isometric") {
      return { x: at.x - this.grid.tileWidth / 2, y: at.y + this.grid.tileHeight / 2 };
    }
    return { x: at.x, y: at.y + this.grid.cell };
  }

  /**
   * The Phaser frame for one tile of one tileset, cut on first use.
   *
   * Cut rather than composed: psd-to-phaser loads the palette's artwork as a
   * single texture, and a frame is a rectangle on it — no pixels are copied
   * and nothing is uploaded twice, so a tileset of four hundred tiles is one
   * texture and four hundred entries in a map. They are never taken off
   * again, because a texture going away takes its frames with it.
   */
  private frameFor(
    psdKey: string,
    layerPath: string,
    tileset: TiledTileset,
    id: number,
  ): { texture: string; name: string } | null {
    const texture = textureKey(psdKey, layerPath);
    if (!this.scene.textures.exists(texture)) return null;
    const held = this.scene.textures.get(texture);
    const name = `tile-${tileset.firstgid}-${id}`;
    if (!held.has(name)) {
      const box = tileRect(tileset, id);
      // A tileset cut from a PSD is measured in the file's own pixels, and
      // the texture is that file — so the two agree by construction. A
      // tileset that came in from a map somebody else made may not, and a
      // frame running off the edge of a texture is a Phaser warning per
      // sprite per frame, so it is refused here instead.
      if (
        box.x + box.width > held.source[0].width ||
        box.y + box.height > held.source[0].height
      ) {
        return null;
      }
      held.add(name, 0, box.x, box.y, box.width, box.height);
    }
    return { texture, name };
  }

  /**
   * Take every tile made from one PSD down, before its textures go.
   *
   * The same hazard `PatternRender.dropKey` exists for, and the same answer:
   * an Image drawing against a frame whose source has been destroyed is not a
   * blank sprite, it is a throw inside the renderer on every frame from then
   * on. `offline` is what keeps the rebuild from happening inside the window
   * where the old textures have gone and the new ones have not arrived.
   */
  dropKey(psdKey: string): void {
    this.offline.add(psdKey);
    for (const [key, held] of this.live) {
      if (held.psdKey !== psdKey) continue;
      held.image.destroy();
      this.live.delete(key);
    }
    this.lastRange = "";
  }

  /** The file is back: build from it again, frames and all. */
  restoreKey(psdKey: string): void {
    this.offline.delete(psdKey);
    this.lastRange = "";
  }

  /** Take every tile down — a scene switch, or the layer stopping being one. */
  clear(): void {
    for (const held of this.live.values()) held.image.destroy();
    this.live.clear();
    this.lastRange = "";
  }
}
