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
import { backgroundsOf, layerKind } from "../lib/layer-kinds";
import type { Background } from "../lib/types";

/** Kept in step with `doc-renderer.ts`: one layer's worth of depth. */
const DEPTH_STRIDE = 1000;

/**
 * How far behind its layer a backdrop sits.
 *
 * Inside the layer's own slot, under everything else on it — a background
 * layer can hold scenery as well as a colour, and the colour is behind the
 * scenery. Below the lattice too, which is at -10,000: the editor's grid is
 * scaffolding to build on and a backdrop is part of what is being built.
 */
const BEHIND = 1;

export class BackgroundRender {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly store: DocStore;
  private signature = "";

  constructor(graphics: Phaser.GameObjects.Graphics, store: DocStore) {
    this.graphics = graphics;
    this.store = store;
    this.graphics.setDepth(-20_000);
  }

  /** Redraw when the view or the document has moved. Cheap every frame. */
  update(camera: Phaser.Cameras.Scene2D.Camera): void {
    const view = camera.worldView;
    const next = [
      Math.round(view.x),
      Math.round(view.y),
      Math.round(view.width),
      Math.round(view.height),
      this.describe(),
    ].join("|");
    if (next === this.signature) return;
    this.signature = next;
    this.draw(view);
  }

  /** Force the next update to redraw — after a scene switch or an edit. */
  invalidate(): void {
    this.signature = "";
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
      for (const background of backgroundsOf(layer)) {
        parts.push(
          `${index}:${background.kind}:${background.color ?? ""}:` +
            `${background.gradient?.from ?? ""}:${background.gradient?.to ?? ""}:` +
            `${background.gradient?.angle ?? 0}`,
        );
      }
    });
    return parts.join(";");
  }

  private draw(view: Phaser.Geom.Rectangle): void {
    const g = this.graphics;
    g.clear();

    const layers = this.store.layers;
    layers.forEach((layer, index) => {
      if (layerKind(layer) !== "background" || !layer.visible) return;
      const base = (layers.length - index) * DEPTH_STRIDE;
      // Depth is the graphics object's, not per shape, so the layer furthest
      // back wins the whole surface. Backdrops are painted back-most last in
      // the list, and the list is drawn in order, so the front-most is on top.
      g.setDepth(base - BEHIND);
      // Back-most last in the document, so it is painted first here.
      for (const background of [...backgroundsOf(layer)].reverse()) {
        paint(g, background, view);
      }
    });
  }
}

function paint(
  g: Phaser.GameObjects.Graphics,
  background: Background,
  view: Phaser.Geom.Rectangle,
): void {
  if (background.kind === "gradient" && background.gradient) {
    const { from, to, angle } = background.gradient;
    const [tl, tr, bl, br] = corners(from, to, angle);
    g.fillGradientStyle(tl, tr, bl, br, 1);
  } else {
    g.fillStyle(hexToNumber(background.color ?? "#2b3b4a"), 1);
  }
  g.fillRect(view.x, view.y, view.width, view.height);
}

/**
 * The four corner colours a gradient at this angle comes out as.
 *
 * Phaser's graphics take one colour per corner and interpolate between them,
 * which is a gradient at any angle if — and only if — each corner is the
 * colour the gradient's own axis has at that corner. So each corner is
 * projected onto the axis and the two stops mixed at the fraction that comes
 * back. Zero degrees is top to bottom, which is what a sky is.
 */
function corners(
  from: string,
  to: string,
  angle: number,
): [number, number, number, number] {
  const radians = ((angle - 90) * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
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

  const a = hexToNumber(from);
  const b = hexToNumber(to);
  const mixed = dots.map((dot) => mix(a, b, (dot - low) / span));
  return [mixed[0], mixed[1], mixed[2], mixed[3]];
}

/** Two packed colours, channel by channel. */
function mix(a: number, b: number, t: number): number {
  const at = Math.max(0, Math.min(1, t));
  const channel = (shift: number) => {
    const from = (a >> shift) & 0xff;
    const to = (b >> shift) & 0xff;
    return Math.round(from + (to - from) * at) & 0xff;
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** `#rrggbb`, or the accent for anything this cannot read. */
function hexToNumber(hex: string): number {
  const parsed = Number.parseInt(hex.replace("#", ""), 16);
  return Number.isFinite(parsed) ? parsed : 0xec3013;
}
