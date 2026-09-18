/**
 * Words on the canvas.
 *
 * A `TextItem` is drawn with Phaser's own `Text`, which is the one thing on
 * this canvas that is neither `Graphics` nor a texture the pipeline made: text
 * is laid out by the browser, and re-implementing that over a `Graphics` would
 * be re-implementing a font renderer to get a worse one. Phaser's `Text`
 * renders through a 2D canvas, which is also what `lib/text-items.ts` measures
 * with — the same font string through the same engine — so what is on screen
 * is the box the document holds.
 *
 * One object per item, kept and updated rather than rebuilt: a `Text` allocates
 * a canvas and uploads a texture, and re-making one per frame while somebody
 * types into the inspector's field would be a keystroke's worth of that every
 * keystroke. The signature is what decides — the same bargain `fill-paint.ts`
 * strikes about its own textures.
 *
 * **It draws in its layer's slot**, like a fill and unlike a point: a word
 * written over a building is a note about the building and belongs over it,
 * but a word on a layer behind one is behind it, because that is what putting
 * it on that layer said. It sits at the front of the slot, over the fills and
 * the placements, since a note nobody can read is not a note.
 */

import type Phaser from "phaser";
import type { DocStore } from "../lib/doc-store";
import { LINE_HEIGHT, textsOf } from "../lib/text-items";
import type { TextItem } from "../lib/types";
import { DEPTH_STRIDE } from "./draw-order";

/** Where in a layer's slot the words go: over everything standing in it. */
const ABOVE_THE_LAYER = DEPTH_STRIDE - 2;

interface View {
  object: Phaser.GameObjects.Text;
  signature: string;
}

export class TextRender {
  private readonly scene: Phaser.Scene;
  private readonly store: DocStore;
  private readonly views = new Map<string, View>();

  constructor(scene: Phaser.Scene, store: DocStore) {
    this.scene = scene;
    this.store = store;
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
      view.object.destroy();
      this.views.delete(id);
    }
  }

  private sync(item: TextItem, depth: number, visible: boolean): void {
    const signature = JSON.stringify([
      item.text,
      item.size,
      item.color,
      item.font,
      item.align,
      Math.round(item.x),
      Math.round(item.y),
      Math.round(item.width),
    ]);
    const held = this.views.get(item.id);
    if (held && held.signature === signature) {
      held.object.setDepth(depth);
      held.object.setVisible(visible);
      return;
    }

    const object = held?.object ?? this.make(item);
    object.setPosition(item.x, item.y);
    object.setStyle({
      // Phaser wants the two halves of the shorthand rather than the
      // shorthand, and a `fontSize` in CSS pixels is world pixels here
      // because the camera scales the object rather than the text.
      fontFamily: item.font,
      fontSize: `${item.size}px`,
      color: item.color,
      align: item.align,
    });
    object.setText(item.text);
    // The box the document measured, so a centred line is centred on the same
    // width the outline is drawn at and the conversion crops to.
    object.setFixedSize(item.width, item.height);
    object.setLineSpacing(item.size * (LINE_HEIGHT - 1));
    object.setDepth(depth);
    object.setVisible(visible);
    this.views.set(item.id, { object, signature });
  }

  private make(item: TextItem): Phaser.GameObjects.Text {
    const object = this.scene.add.text(item.x, item.y, item.text, {});
    // Top-left, because that is what `x, y` means everywhere else in this
    // document — a placement's corner, a fill's bounds, a zone's outline.
    object.setOrigin(0, 0);
    return object;
  }

  destroy(): void {
    for (const view of this.views.values()) view.object.destroy();
    this.views.clear();
  }
}
