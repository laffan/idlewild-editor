/**
 * Words on the canvas.
 *
 * **Drawn as a texture rather than with Phaser's `Text`**, which is the one
 * decision in this file and it is about agreement rather than about speed. A
 * note is converted into a PSD sooner or later, and what that conversion
 * writes has to be what was on screen — so both go through
 * `rasteriseText` in `lib/text-items.ts`, the one place text becomes pixels.
 * Phaser's `Text` would have been a second layout engine to keep in step: its
 * line advance is the font's own ascent plus descent plus a spacing value, and
 * matching that from outside Phaser means guessing at metrics it measured for
 * itself. A note whose lines sit further apart on the canvas than in the file
 * it becomes is exactly the kind of difference nobody sees until the artwork
 * has been painted over.
 *
 * It is the same bargain `fill-paint.ts` strikes for a patterned fill, down to
 * the signature: one texture per note, rebuilt only when something about that
 * note changes, so panning, zooming and editing anything else cost nothing.
 * Drawn at `EXPORT_SCALE` and displayed at the box's own size, so a note stays
 * sharp as the camera comes in — the same "twice the pixels, same geometry"
 * every conversion in this editor makes.
 *
 * **It draws in its layer's slot**, like a fill and unlike a point: a word
 * written over a building is a note about the building and belongs over it,
 * but a word on a layer behind one is behind it, because that is what putting
 * it on that layer said. It sits at the front of the slot, over the fills and
 * the placements, since a note nobody can read is not a note.
 */

import type Phaser from "phaser";
import type { DocStore } from "../lib/doc-store";
import { planeFor, rasteriseText, textsOf } from "../lib/text-items";
import type { Grid } from "../lib/grid";
import type { TextItem } from "../lib/types";
import { DEPTH_STRIDE } from "./draw-order";

/** Where in a layer's slot the words go: over everything standing in it. */
const ABOVE_THE_LAYER = DEPTH_STRIDE - 2;

/**
 * Pixels per world pixel in a note's texture.
 *
 * `EXPORT_SCALE`'s value, and deliberately not an import of it: that constant
 * is the editor's answer about what a *conversion* draws at, and this is the
 * canvas making the same bargain for its own reasons. Nothing in `game/`
 * imports from `editor/`.
 */
const TEXTURE_SCALE = 2;

interface View {
  image: Phaser.GameObjects.Image;
  key: string;
  signature: string;
}

export class TextRender {
  private readonly scene: Phaser.Scene;
  private readonly store: DocStore;
  private readonly grid: Grid;
  private readonly views = new Map<string, View>();

  constructor(scene: Phaser.Scene, store: DocStore, grid: Grid) {
    this.scene = scene;
    this.store = store;
    this.grid = grid;
  }

  /** Bring every word on screen into line with the document. */
  render(): void {
    const seen = new Set<string>();
    const layers = this.store.layers;

    layers.forEach((layer, index) => {
      const depth = (layers.length - index) * DEPTH_STRIDE + ABOVE_THE_LAYER;
      for (const item of textsOf(layer)) {
        seen.add(item.id);
        this.sync(item, depth, layer.visible);
      }
    });

    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      this.drop(id, view);
    }
  }

  private sync(item: TextItem, depth: number, visible: boolean): void {
    // The position is not in it: a note that has only been dragged keeps its
    // texture and is moved, which is what makes a drag cost nothing.
    const signature = JSON.stringify([
      item.text,
      item.size,
      item.color,
      item.font,
      item.align,
      // A note laid into the grid's plane is a different picture from the same
      // words drawn flat, so the switch is part of what the texture is of.
      item.tracksGrid === true,
      Math.round(item.width),
      Math.round(item.height),
    ]);

    const held = this.views.get(item.id);
    if (held && held.signature === signature) {
      this.place(held.image, item, depth, visible);
      return;
    }
    if (held) this.drop(item.id, held);

    const drawn = rasteriseText(item, TEXTURE_SCALE, planeFor(item, this.grid));
    if (!drawn) return;

    const key = `text:${item.id}:${Date.now().toString(36)}`;
    // `addCanvas` keeps a reference to the element rather than copying it, so
    // each note gets a canvas of its own — the same rule `fill-paint.ts` keeps.
    if (!this.scene.textures.addCanvas(key, drawn)) return;

    const image = this.scene.add.image(0, 0, key);
    image.setOrigin(0, 0);
    this.place(image, item, depth, visible);
    this.views.set(item.id, { image, key, signature });
  }

  /** Where it sits, how big it is drawn, and whether it is drawn at all. */
  private place(
    image: Phaser.GameObjects.Image,
    item: TextItem,
    depth: number,
    visible: boolean,
  ): void {
    image.setPosition(item.x, item.y);
    // The box the document measured, so the words fill exactly the rectangle a
    // tap picks them up from and a conversion crops to.
    image.setDisplaySize(item.width, item.height);
    image.setDepth(depth);
    image.setVisible(visible);
  }

  private drop(id: string, view: View): void {
    view.image.destroy();
    this.scene.textures.remove(view.key);
    this.views.delete(id);
  }

  destroy(): void {
    for (const [id, view] of [...this.views]) this.drop(id, view);
  }
}
