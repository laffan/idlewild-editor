/**
 * Colours and gradients behind everything, following the camera.
 *
 * A backdrop has no extent. It is not a very large rectangle somebody has to
 * remember to make larger — it is *wherever you are looking*, which on a grid
 * with no bound to hit is the only reading that does not eventually show its
 * own edge. So what is drawn each frame is the camera's own world view, and
 * the document holds two colours and an angle.
 *
 * Drawn in world space rather than with `setScrollFactor(0)`. A scroll factor
 * of zero pins an object to the camera but not to its *zoom*, so a backdrop
 * sized to the viewport in screen pixels shrinks away from the corners as
 * soon as anybody zooms out. Following `worldView` is the same answer with
 * none of that: the rectangle is exactly what the camera can see, at whatever
 * zoom it is seeing it.
 *
 * Gradients go in as Phaser's four corner colours, each corner sampled off
 * the gradient's own axis — which is what makes an angle mean anything at all
 * through an API that only takes four colours.
 */

import type Phaser from "phaser";
import type { DocStore } from "../lib/doc-store";
import { alphaOf, hexToNumber } from "../lib/color";
import { backgroundsOf, layerKind } from "../lib/layer-kinds";
import type { Background, Layer } from "../lib/types";
import { currentArtboards } from "../lib/print";
import { gradientAt, gradientCells, mix, spanOf, type Box } from "./gradient-span";

/** Kept in step with `doc-renderer.ts`: one layer's worth of depth. */
const DEPTH_STRIDE = 1000;

/**
 * How far behind its layer a backdrop sits.
 *
 * Inside the layer's own slot, under everything else on it — a background
 * layer can hold scenery as well as a colour, and the colour is behind the
 * scenery.
 *
 * It stays in the stack rather than being pushed under the whole document,
 * because where a background layer sits among the others is a thing somebody
 * chose and the exported game honours it. The editor's **lattice** is what
 * moves instead: it is scaffolding rather than content, it does not exist in
 * the game at all, and a flat colour over the whole view left nothing of it to
 * build on. `frontDepth` is what it follows — see `grid-renderer.ts`.
 */
const BEHIND = 1;

export class BackgroundRender {
  private readonly scene: Phaser.Scene;
  private readonly store: DocStore;
  /**
   * One graphics object per background layer, keyed by layer id.
   *
   * Not one shared between them. Depth is a property of the object rather
   * than of a shape drawn into it, so a single graphics could only hold one
   * answer — and two background layers with different depths is exactly what
   * a scene with a sky behind a parallax band is.
   */
  private readonly surfaces = new Map<string, Phaser.GameObjects.Graphics>();
  private signature = "";
  /** The front-most backdrop drawn, or null while there is none. */
  private front: number | null = null;
  /**
   * A colour still under the picker's thumb, drawn over what the document
   * says — see `preview`.
   */
  private previewing: { id: string; patch: Partial<Background> } | null = null;

  constructor(scene: Phaser.Scene, store: DocStore) {
    this.scene = scene;
    this.store = store;
  }

  /** Redraw when the view or the document has moved. Cheap every frame. */
  update(camera: Phaser.Cameras.Scene2D.Camera): void {
    const view = camera.worldView;
    // A print project's gradients span its artboards — see `gradient-span.ts`.
    const span = spanOf(currentArtboards());
    const next = [
      Math.round(view.x),
      Math.round(view.y),
      Math.round(view.width),
      Math.round(view.height),
      span ? `${span.x},${span.y},${span.width},${span.height}` : "",
      this.describe(),
    ].join("|");
    if (next === this.signature) return;
    this.signature = next;
    this.draw(view, span);
  }

  /** Force the next update to redraw — after a scene switch or an edit. */
  invalidate(): void {
    this.signature = "";
  }

  /**
   * Draw one backdrop as though `patch` were written, without writing it; null
   * goes back to what the document says.
   *
   * The picker's drag. Writing the document on every pointer move made each
   * tick of it a commit — the inspector rebuilt round the picker being dragged,
   * the layer list and the minimap redrawn, every placement and pattern on the
   * canvas refreshed, an undo step — and on an iPad, where a Pencil reports at
   * 120 Hz, the backdrop trailed the thumb by seconds. Now the drag changes
   * this and nothing else, and the release writes once. `update` runs every
   * frame and the preview is part of what it compares, so there is nothing to
   * invalidate.
   */
  preview(backgroundId: string, patch: Partial<Background> | null): void {
    this.previewing = patch ? { id: backgroundId, patch } : null;
  }

  /**
   * The depth of the front-most backdrop on screen, or null for none.
   *
   * What the lattice floats over. Read rather than computed twice because a
   * backdrop's depth is its layer's slot less `BEHIND`, and a second copy of
   * that arithmetic somewhere else is a second thing to keep in step.
   */
  frontDepth(): number | null {
    return this.front;
  }

  /**
   * What the document currently says, as one string.
   *
   * Compared rather than diffed: there are never many backdrops, and a
   * backdrop is two colours and an angle, so the whole state of the thing is
   * shorter than the code to tell whether it moved.
   */
  private describe(): string {
    const parts: string[] = [];
    this.store.layers.forEach((layer, index) => {
      if (layerKind(layer) !== "background" || !layer.visible) return;
      for (const background of this.backgroundsOf(layer)) {
        parts.push(
          `${layer.id}:${index}:${background.kind}:${background.color ?? ""}:` +
            `${background.gradient?.from ?? ""}:${background.gradient?.to ?? ""}:` +
            `${background.gradient?.angle ?? 0}`,
        );
      }
    });
    return parts.join(";");
  }

  private draw(view: Phaser.Geom.Rectangle, span: Box | null): void {
    const layers = this.store.layers;
    const seen = new Set<string>();
    this.front = null;

    layers.forEach((layer, index) => {
      if (layerKind(layer) !== "background" || !layer.visible) return;
      const backgrounds = this.backgroundsOf(layer);
      if (backgrounds.length === 0) return;
      seen.add(layer.id);

      const depth = (layers.length - index) * DEPTH_STRIDE - BEHIND;
      this.front = this.front === null ? depth : Math.max(this.front, depth);
      const g = this.surface(layer.id);
      g.clear();
      g.setDepth(depth);
      // Back-most last in the document, so it is painted first here and
      // whatever is in front of it goes over the top.
      for (const background of [...backgrounds].reverse()) {
        paint(g, background, view, span);
      }
    });

    // A layer that has stopped being a background one, gone invisible, or
    // lost its last backdrop leaves nothing behind.
    for (const [layerId, g] of this.surfaces) {
      if (seen.has(layerId)) continue;
      g.destroy();
      this.surfaces.delete(layerId);
    }
  }

  /** A layer's backdrops, with the one being previewed as it is previewed. */
  private backgroundsOf(layer: Layer): readonly Background[] {
    const held = backgroundsOf(layer);
    const previewing = this.previewing;
    if (!previewing) return held;
    return held.map((b) => (b.id === previewing.id ? { ...b, ...previewing.patch } : b));
  }

  private surface(layerId: string): Phaser.GameObjects.Graphics {
    const held = this.surfaces.get(layerId);
    if (held) return held;
    const made = this.scene.add.graphics();
    this.surfaces.set(layerId, made);
    return made;
  }

  /** Take every backdrop down — a scene switch is a different world. */
  clear(): void {
    for (const g of this.surfaces.values()) g.destroy();
    this.surfaces.clear();
    this.previewing = null;
    this.signature = "";
    this.front = null;
  }
}

function paint(
  g: Phaser.GameObjects.Graphics,
  background: Background,
  view: Phaser.Geom.Rectangle,
  span: Box | null,
): void {
  if (background.kind === "gradient" && background.gradient && span) {
    paintSpanned(g, background.gradient, view, span);
    return;
  }
  if (background.kind === "gradient" && background.gradient) {
    const { from, to, angle } = background.gradient;
    const [tl, tr, bl, br] = gradientCorners(from, to, angle);
    // Per-corner alpha, which Phaser takes and which a gradient needs: the two
    // stops can have different opacities, and a single number for the pair
    // would make a fade to nothing into a flat wash at the average of the two.
    const [al, ar, bll, brr] = gradientAlphas(from, to, angle);
    g.fillGradientStyle(tl, tr, bl, br, al, ar, bll, brr);
  } else {
    const color = background.color ?? "#2b3b4a";
    g.fillStyle(hexToNumber(color), alphaOf(color));
  }
  g.fillRect(view.x, view.y, view.width, view.height);
}

/** A gradient over a print project's artboards, cell by cell — `gradient-span.ts`. */
function paintSpanned(
  g: Phaser.GameObjects.Graphics,
  gradient: { from: string; to: string; angle?: number },
  view: Box,
  span: Box,
): void {
  const at = gradientAt(gradient.angle ?? 0, span);
  const from = hexToNumber(gradient.from);
  const to = hexToNumber(gradient.to);
  const a = alphaOf(gradient.from);
  const b = alphaOf(gradient.to);
  for (const cell of gradientCells(view, span)) {
    const ts = [
      at(cell.x, cell.y),
      at(cell.x + cell.width, cell.y),
      at(cell.x, cell.y + cell.height),
      at(cell.x + cell.width, cell.y + cell.height),
    ];
    const [tl, tr, bl, br] = ts.map((t) => mix(from, to, t));
    const [al, ar, bll, brr] = ts.map((t) => a + (b - a) * t);
    g.fillGradientStyle(tl, tr, bl, br, al, ar, bll, brr);
    g.fillRect(cell.x, cell.y, cell.width, cell.height);
  }
}

/**
 * The four corner colours a gradient at this angle comes out as.
 *
 * Phaser's graphics take one colour per corner and interpolate between them,
 * which is a gradient at any angle if — and only if — each corner is the
 * colour the gradient's own axis has at that corner. So each corner is
 * projected onto the axis and the two stops mixed at the fraction that comes
 * back. Zero degrees runs top to bottom — `from` at the top — which is what a
 * sky is.
 */
export function gradientCorners(
  from: string,
  to: string,
  angle: number,
): [number, number, number, number] {
  const a = hexToNumber(from);
  const b = hexToNumber(to);
  return cornerMix(angle, (t) => mix(a, b, t)) as [
    number,
    number,
    number,
    number,
  ];
}

/**
 * The same projection over the two stops' **opacity**.
 *
 * Written beside the colours rather than folded into them because Phaser wants
 * them apart, and because a gradient's opacity is a real thing to want: a sky
 * that fades to nothing over the horizon is two stops of one colour where only
 * the alpha moves.
 */
export function gradientAlphas(
  from: string,
  to: string,
  angle: number,
): [number, number, number, number] {
  const a = alphaOf(from);
  const b = alphaOf(to);
  return cornerMix(angle, (t) => a + (b - a) * t) as [
    number,
    number,
    number,
    number,
  ];
}

/** Each corner's place along the gradient's axis, handed to `at`. */
function cornerMix(angle: number, at: (t: number) => number): number[] {
  // The direction the gradient *runs*, written out rather than derived: zero
  // is down, ninety is right, and the arrows on the control say so. Screen
  // y counts downward, which is why this is sin/cos rather than cos/sin.
  const radians = (angle * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = Math.cos(radians);
  // A unit square about its own centre: the projection only needs the
  // corners' *directions*, since the fraction is normalised over the span.
  const box: Array<[number, number]> = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [-0.5, 0.5],
    [0.5, 0.5],
  ];
  const dots = box.map(([x, y]) => x * dx + y * dy);
  const low = Math.min(...dots);
  const high = Math.max(...dots);
  const span = high - low || 1;

  return dots.map((dot) => at((dot - low) / span));
}



