/**
 * A pattern layer, drawn.
 *
 * The same bargain the lattice makes, for the same reason: nothing is stored,
 * everything is recomputed from the camera over exactly the spaces the
 * viewport can see. A pattern is a rule rather than a list — see
 * `lib/pattern.ts` — so the only thing that ever exists is the handful of
 * copies currently on screen, and panning is a matter of making the ones that
 * have come into view and destroying the ones that have gone out.
 *
 * **The placements on a pattern layer are its palette.** They are what the
 * pattern is made of, not things standing anywhere, so nothing here reads the
 * `x`/`y` a placement carries as a position. What it reads is the *offset*
 * from the space the file was anchored to, which is what makes a copy of a
 * tree stand on its space exactly the way the original did — and what makes
 * resizing the file in the inspector resize every copy of it.
 *
 * `doc-renderer.ts` skips those placements for the same reason: drawing them
 * where the document happens to hold them would put one of every element in a
 * heap at the anchor, underneath the pattern made of them.
 */

import type Phaser from "phaser";
import type PsdToPhaser from "psd-to-phaser";
import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import { layerKind, patternSpec } from "../lib/layer-kinds";
import {
  patternInstances,
  type CellRange,
  type PatternElement,
} from "../lib/pattern";
import type { Layer, Placement, Point } from "../lib/types";
import type { PlacedObject } from "./doc-renderer";
import * as log from "../lib/log";

/** Kept in step with `doc-renderer.ts`: one layer's worth of depth. */
const DEPTH_STRIDE = 1000;

/**
 * The most copies on screen at once, across every pattern layer.
 *
 * A ceiling rather than a budget: the alternative to refusing is an editor
 * that stops answering while it makes four thousand Phaser groups, and a
 * density typed one digit too long is an easy thing to do. The console says
 * when it bites, because a pattern that silently stops half way across the
 * screen looks like a bug in the pattern.
 */
const MAX_ON_SCREEN = 1200;

/** The accent, which is what every mark the editor makes is drawn in. */
const SHAPE_COLOR = 0xec3013;
/** One screen pixel, before the camera's zoom is divided out of it. */
const HAIRLINE = 1;

interface Live {
  object: PlacedObject;
  /** What it is a copy of, so a palette change can be told from a pan. */
  signature: string;
  /**
   * The file behind it, held outright rather than read back out of the
   * signature. `dropKey` is the one thing here that has to be exactly right
   * — everything it fails to destroy goes on drawing against a texture that
   * has gone — and picking a field out of a composed string is not the way
   * to be exactly right about anything.
   */
  psdKey: string;
}

export class PatternRender {
  private readonly scene: Phaser.Scene;
  private readonly store: DocStore;
  private readonly grid: Grid;
  /**
   * The shapes a pattern is confined to, outlined.
   *
   * Chrome about the document rather than part of it, like a selection's
   * outline: it says where the rule is allowed to apply, and it is stroked at
   * a width divided by the zoom so it reads the same at 1x and at 4x.
   */
  private readonly shapes: Phaser.GameObjects.Graphics;
  /** Keyed by layer and instance — see `PatternInstance.id`. */
  private readonly live = new Map<string, Live>();
  private lastRange = "";
  private warned = false;

  constructor(scene: Phaser.Scene, store: DocStore, grid: Grid) {
    this.scene = scene;
    this.store = store;
    this.grid = grid;
    this.shapes = scene.add.graphics();
    // Over the pattern it confines and under the selection overlay, which is
    // where every other outline the editor draws about the document sits.
    this.shapes.setDepth(890_000);
  }

  /**
   * Force the next `sync` to rebuild, whatever the camera is doing.
   *
   * The range is the only thing `sync` compares, so a change to the *rule* —
   * a density typed, a shape added, a file placed on the layer — has to say
   * so or the pattern would not move until the camera did.
   */
  invalidate(): void {
    this.lastRange = "";
    this.warned = false;
  }

  /** Bring what is on screen in line with the rule. Cheap to call per frame. */
  sync(range: CellRange): void {
    const signature = [
      range.from.cx,
      range.from.cy,
      range.to.cx,
      range.to.cy,
    ].join(",");
    if (signature === this.lastRange) return;
    this.lastRange = signature;
    this.drawShapes();

    const seen = new Set<string>();
    const layers = this.store.layers;
    let made = 0;

    layers.forEach((layer, index) => {
      if (layerKind(layer) !== "pattern" || !layer.visible) return;
      const elements = paletteOf(layer, this.grid);
      if (elements.length === 0) return;

      const base = (layers.length - index) * DEPTH_STRIDE;
      const room = MAX_ON_SCREEN - made;
      const instances = patternInstances(
        patternSpec(layer),
        elements,
        range,
        Math.max(0, room),
      );
      made += instances.length;

      for (const instance of instances) {
        const key = `${layer.id}:${instance.id}`;
        seen.add(key);
        const world = this.grid.cellToWorld(instance.cell);
        const { element } = instance;
        // A copy is identified by what it is and where — so a palette edited
        // under a pattern that has not moved is still rebuilt, and a pan over
        // ground you have already seen is not.
        const shape = `${element.psdKey}/${element.path}/${element.width}x${element.height}`;

        const held = this.live.get(key);
        const x = world.x + element.offsetX;
        const y = world.y + element.offsetY;
        if (held && held.signature === shape) {
          place(held.object, element, x, y, base);
          continue;
        }
        if (held) destroy(held.object);

        const object = this.make(element);
        if (!object) continue;
        place(object, element, x, y, base);
        this.live.set(key, { object, signature: shape, psdKey: element.psdKey });
      }
    });

    if (made >= MAX_ON_SCREEN && !this.warned) {
      this.warned = true;
      log.warn(
        `A pattern is showing the first ${MAX_ON_SCREEN} elements in view — ` +
          "turn the density down, or zoom in, to see the rest of it.",
      );
    }

    for (const [key, held] of this.live) {
      if (seen.has(key)) continue;
      destroy(held.object);
      this.live.delete(key);
    }
  }

  /**
   * Drop every copy made from one PSD, before its textures go.
   *
   * A re-import, a rename and a repoint all evict the textures behind a key
   * and load them again — and a copy here is a Phaser group holding sprites
   * on exactly those textures. Left alone it goes on being drawn against a
   * frame whose source has been destroyed, which is not a blank sprite: it is
   * `frame.source.resolution` of null, thrown inside the renderer, every
   * frame from then on. The render pass dies part-way through, so the lattice
   * stops being drawn, and anything waiting on a completed pass — the
   * thumbnail a project is closed by, for one — waits for ever.
   *
   * `invalidate` is not enough on its own. A copy is kept when the file it
   * came from still looks the same, and after a re-import that is exactly the
   * case: the same key, the same layer path, the same size, and a texture
   * that has gone. So this destroys, and the rebuild happens on the next
   * frame from the rule, which costs nothing.
   */
  dropKey(psdKey: string): void {
    for (const [key, held] of this.live) {
      if (held.psdKey !== psdKey) continue;
      destroy(held.object);
      this.live.delete(key);
    }
    this.lastRange = "";
  }

  /** Take every copy down — a scene switch, or the layer stopping being one. */
  clear(): void {
    for (const held of this.live.values()) destroy(held.object);
    this.live.clear();
    this.shapes.clear();
    this.lastRange = "";
  }

  /**
   * Outline every pattern shape in the open scene.
   *
   * Cell by cell rather than as one union outline: the spaces *are* the
   * shape — a drawn one is baked down to them when it is made — and the
   * divisions say which spaces, which is the thing somebody adjusting a
   * boundary wants to see. A shape that was drawn keeps its own line on top,
   * so what it was is still legible under what it became.
   */
  private drawShapes(): void {
    const g = this.shapes;
    g.clear();
    const hair = HAIRLINE / this.scene.cameras.main.zoom;

    for (const layer of this.store.layers) {
      if (layerKind(layer) !== "pattern" || !layer.visible) continue;
      for (const shape of patternSpec(layer).shapes) {
        g.lineStyle(hair, SHAPE_COLOR, 0.5);
        for (const cell of shape.cells ?? []) {
          outline(g, this.grid.cellPolygon(cell));
        }
        if (shape.points && shape.points.length > 2) {
          g.lineStyle(hair * 2, SHAPE_COLOR, 0.9);
          outline(g, shape.points);
        }
      }
    }
  }

  private make(element: PatternElement): PlacedObject | null {
    const p2p = (this.scene as unknown as Record<string, PsdToPhaser | undefined>)
      .P2P;
    if (!p2p) return null;
    try {
      const object = p2p.place(this.scene, element.psdKey, element.path);
      return (object as unknown as PlacedObject) ?? null;
    } catch (err) {
      log.error(`Could not scatter ${element.psdKey}:`, err);
      return null;
    }
  }
}

/**
 * What a pattern layer has to scatter.
 *
 * One entry per placement on the layer, and the geometry is relative to the
 * space each file was anchored to rather than absolute — see the note at the
 * top. A file placed twice on the same pattern layer is two entries, which is
 * how somebody weights a scatter towards one element without a control for it.
 */
export function paletteOf(layer: Layer, grid: Grid): PatternElement[] {
  return layer.placements.map((placement) => element(placement, grid));
}

function element(placement: Placement, grid: Grid): PatternElement {
  const anchor = grid.cellToWorld(placement.anchor);
  // The ratio `applyScale` reads off a placement: a PSD resized in the
  // inspector resizes every copy of it in the pattern, which is the only
  // reading under which that control means anything on a pattern layer.
  const naturalWidth = placement.naturalWidth || placement.width || 1;
  const naturalHeight = placement.naturalHeight || placement.height || 1;
  return {
    path: placement.layerPath,
    psdKey: placement.psdKey,
    width: placement.width,
    height: placement.height,
    scaleX: placement.width / naturalWidth,
    scaleY: placement.height / naturalHeight,
    offsetX: placement.x - anchor.x,
    offsetY: placement.y - anchor.y,
  };
}

function place(
  object: PlacedObject,
  element: PatternElement,
  x: number,
  y: number,
  depth: number,
): void {
  object.setPosition(x, y);
  // Sprites are placed with `setOrigin(0, 0)`, so a scale is taken about the
  // top-left — the corner `x`/`y` describes, which is what keeps a scaled
  // copy standing exactly where the unscaled one would have.
  object.setScale(element.scaleX, element.scaleY);
  object.setDepth(depth);
}

function destroy(object: PlacedObject): void {
  object.destroy(true);
}

function outline(g: Phaser.GameObjects.Graphics, points: readonly Point[]): void {
  if (points.length < 2) return;
  g.beginPath();
  g.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
  g.closePath();
  g.strokePath();
}
