/**
 * A small canvas over the live one, for the end of a stroke that is still
 * moving.
 *
 * A stroke drawn a frame at a time (`live-ink.ts`) lays its settled part on
 * the live canvas once and leaves it there. The last segment — from the last
 * settled point to the pointer — changes every frame, so it cannot go on the
 * live canvas without something to take it off again, and the only way to
 * take a mark off a canvas is to put back the pixels that were under it.
 * Copying pixels *out* of the live canvas is the expensive thing on WebKit:
 * a canvas used as a `drawImage` source is snapshotted whole, which for a
 * backing four thousand pixels a side is the cost of the whole surface every
 * frame.
 *
 * So the tail is drawn somewhere it can simply be cleared: a canvas only as
 * big as the tail, moved over the right spot by a CSS transform. It sits in
 * the same group as the live canvas, and a translucent stroke's opacity is
 * set on the group (`Surface.setInkOpacity`), so the two composite into one
 * stroke before that opacity applies — on the canvases separately, the
 * overlap at the join would come out darker than the rest of the line.
 */

import type { Bounds } from "./types";

/** Grown in steps, because assigning `canvas.width` reallocates. */
const STEP = 256;

export class TailCanvas {
  readonly el = stageCanvas("draw-tail");
  private readonly ctx = context(this.el);
  /** What was painted last frame, in this canvas's own pixels. */
  private used: { width: number; height: number } | null = null;

  /**
   * Cover `rect` (backing pixels) and hand back the context in world
   * coordinates, cleared — or null when the rect is off the backing.
   *
   * `scale`, `anchorX` and `anchorY` are the backing's world mapping, and
   * `dpr` turns backing pixels into the CSS pixels the stage is laid out in.
   */
  begin(
    rect: Bounds | null,
    scale: number,
    anchorX: number,
    anchorY: number,
    dpr: number,
  ): CanvasRenderingContext2D | null {
    this.clear();
    const ctx = this.ctx;
    if (!rect) return null;
    const el = this.el;
    if (el.width < rect.width || el.height < rect.height) {
      el.width = Math.max(el.width, Math.ceil(rect.width / STEP) * STEP);
      el.height = Math.max(el.height, Math.ceil(rect.height / STEP) * STEP);
      el.style.width = `${el.width / dpr}px`;
      el.style.height = `${el.height / dpr}px`;
    }
    el.style.transform = `translate(${rect.x / dpr}px, ${rect.y / dpr}px)`;
    this.used = { width: rect.width, height: rect.height };
    ctx.setTransform(
      scale,
      0,
      0,
      scale,
      -anchorX * scale - rect.x,
      -anchorY * scale - rect.y,
    );
    return ctx;
  }

  /** Take whatever was drawn last off it. */
  clear(): void {
    if (!this.used) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.used.width, this.used.height);
    this.used = null;
  }

  /** Hand the backing store back — the live canvas's own rule, for the same reason. */
  release(): void {
    this.used = null;
    this.el.width = 1;
    this.el.height = 1;
    this.el.style.width = "1px";
    this.el.style.height = "1px";
  }
}

/** A canvas for the drawing stage, 1 × 1 until something sizes it. */
export function stageCanvas(className: string): HTMLCanvasElement {
  const el = document.createElement("canvas");
  el.className = className;
  el.width = 1;
  el.height = 1;
  return el;
}

export function context(el: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = el.getContext("2d");
  if (!ctx) throw new Error("The drawing layer needs a 2D canvas context");
  return ctx;
}
