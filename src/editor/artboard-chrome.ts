/**
 * What an artboard wears on the canvas besides its frame and its label: the
 * rulers along its top and left edges, the guides pulled from them, and —
 * while Resize is on in the inspector — handles on its edges and corners.
 *
 * **Rulers.** Shown on every artboard while the project's Show ruler switch is
 * on, outside the sheet so they never cover the page, in the artboard's own
 * unit (`ruler-scale.ts`). Hovering one draws a blue guide across the sheet
 * where it would go, with its place beside it; a tap or a click puts it there,
 * and leaves a handle on the ruler. The handle drags the guide; ⌘-click on it,
 * or dragging it off either end of the ruler, takes it away — the second is
 * the iPad's way, which has no ⌘ under a finger. Guides are stored on the
 * artboard in whole points from its corner (`Artboard.guidesX`, `guidesY`),
 * so they move with it, and only the editor draws them.
 *
 * **Resize.** A handle on each edge and corner of the picked artboard. The
 * frame follows the drag (`ScreenGuide.previewBoard`) and the size is written
 * once, on release, as a custom sheet — dragging the left or top edge moves
 * the corner as well, so the opposite edge stays where it was.
 *
 * Everything here lives in the artboard labels' layer — over the ink, under
 * the rail, see `screen-guide.ts` — and is redrawn with it on every camera
 * move. The drags listen on the window rather than on the element pressed,
 * because the elements are rebuilt as they move.
 */

import { h } from "../lib/dom";
import { currentOutput, PAGE_RANGE, type PlacedArtboard } from "../lib/print";
import type { Viewport } from "../drawing";
import { changePage } from "./print-page";
import { RULER_PX, guideLabel, pointAt, rulerScale, tickLabel } from "./ruler-scale";

/** `x`: a vertical guide, from the top ruler. `y`: a horizontal one, from the left. */
type Axis = "x" | "y";

/** How far past either end of its ruler a handle is dragged to take it away. */
const OFF_END_PX = 16;
/** How far a press may wander and still be a tap. */
const TAP_SLOP_PX = 6;

const TICK = "rgb(32 30 29 / 0.7)";
const TEXT = "rgb(32 30 29 / 0.85)";

/** An artboard at a size and place it has not been written at yet. */
export interface BoardPreview {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ArtboardChromeHost {
  /** Draw an artboard mid-resize, or stop. */
  preview: (board: BoardPreview | null) => void;
}

const EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;
export type Edge = (typeof EDGES)[number];

export class ArtboardChrome {
  readonly root: HTMLElement;
  private readonly host: ArtboardChromeHost;
  private readonly groups = new Map<string, HTMLElement>();
  private view: Viewport | null = null;
  private boards: PlacedArtboard[] = [];
  /** The width and height of the layer, kept by an observer. */
  private size = { width: 0, height: 0 };
  private readonly observer: ResizeObserver;
  /** The artboard whose edges carry handles, while Resize is on. */
  private resizingId: string | null = null;
  /** Where a guide would go — the pointer over a ruler, or pressing one. */
  private hover: { id: string; axis: Axis; value: number } | null = null;
  /** A guide being dragged by its handle, before it is written. */
  private moving: { id: string; axis: Axis; index: number; value: number; off: boolean } | null =
    null;
  /** A ruler is being pressed, so the pointer leaving it does not take the guide away. */
  private pressing = false;

  constructor(host: ArtboardChromeHost) {
    this.host = host;
    this.root = h("div", { class: "artboard-chrome" });
    this.observer = new ResizeObserver(() => {
      this.size = { width: this.root.clientWidth, height: this.root.clientHeight };
      this.redraw();
    });
    this.observer.observe(this.root);
  }

  destroy(): void {
    this.observer.disconnect();
    this.root.remove();
  }

  get rulers(): boolean {
    return currentOutput()?.rulers === true;
  }

  get resizing(): string | null {
    return this.resizingId;
  }

  /** Put handles on one artboard's edges, or take them away. */
  setResizing(id: string | null): void {
    this.resizingId = id;
    this.redraw();
  }

  /** Every artboard, where the camera has them. Called by `ScreenGuide`. */
  draw(view: Viewport, boards: PlacedArtboard[]): void {
    this.view = view;
    this.boards = boards;
    const rulers = this.rulers;
    this.root.parentElement?.classList.toggle("with-rulers", rulers);
    for (const [id, group] of this.groups) {
      if (!boards.some((b) => b.id === id)) {
        group.remove();
        this.groups.delete(id);
      }
    }
    for (const board of boards) {
      const wanted = rulers || board.id === this.resizingId;
      let group = this.groups.get(board.id);
      if (!wanted) {
        group?.remove();
        this.groups.delete(board.id);
        continue;
      }
      if (!group) {
        group = h("div", { class: "artboard-chrome-board" });
        this.groups.set(board.id, group);
        this.root.appendChild(group);
      }
      this.drawBoard(group, view, board, rulers);
    }
  }

  private redraw(): void {
    if (this.view) this.draw(this.view, this.boards);
  }

  private drawBoard(group: HTMLElement, view: Viewport, board: PlacedArtboard, rulers: boolean): void {
    const zoom = view.zoom || 1;
    const left = (board.x - view.originX) * zoom;
    const top = (board.y - view.originY) * zoom;
    const width = board.width * zoom;
    const height = board.height * zoom;
    group.style.transform = `translate(${left}px, ${top}px)`;
    const parts: HTMLElement[] = [];
    if (rulers) {
      parts.push(
        h("div", { class: "artboard-ruler-corner" }),
        this.ruler(board, "x", left, width, zoom),
        this.ruler(board, "y", top, height, zoom),
        ...this.guides(board, zoom, width, height),
      );
    }
    if (board.id === this.resizingId) parts.push(...this.handles(board, zoom, width, height));
    group.replaceChildren(...parts);
  }

  /** The guides on one artboard, its handles, and the one the pointer is offering. */
  private guides(board: PlacedArtboard, zoom: number, width: number, height: number): HTMLElement[] {
    const out: HTMLElement[] = [];
    for (const axis of ["x", "y"] as const) {
      const list = this.guideList(board, axis);
      for (const [index, value] of list.entries()) {
        const moving = this.moving?.id === board.id && this.moving.axis === axis && this.moving.index === index;
        const at = moving ? this.moving!.value : value;
        const off = moving && this.moving!.off;
        out.push(this.line(axis, at * zoom, width, height, off ? "removing" : ""));
        out.push(this.handle(board, axis, index, at * zoom, off));
        if (moving) out.push(this.tag(axis, at * zoom, off ? "Remove" : guideLabel(at, board.unit)));
      }
    }
    const hover = this.hover;
    if (hover && hover.id === board.id && !this.moving) {
      out.push(this.line(hover.axis, hover.value * zoom, width, height, "preview"));
      out.push(this.tag(hover.axis, hover.value * zoom, guideLabel(hover.value, board.unit)));
    }
    return out;
  }

  private guideList(board: PlacedArtboard, axis: Axis): number[] {
    return (axis === "x" ? board.guidesX : board.guidesY) ?? [];
  }

  private line(axis: Axis, at: number, width: number, height: number, state: string): HTMLElement {
    const line = h("div", { class: `artboard-guide ${axis === "x" ? "v" : "h"} ${state}`.trim() });
    if (axis === "x") {
      line.style.transform = `translateX(${at}px)`;
      line.style.height = `${height}px`;
    } else {
      line.style.transform = `translateY(${at}px)`;
      line.style.width = `${width}px`;
    }
    return line;
  }

  private tag(axis: Axis, at: number, text: string): HTMLElement {
    const tag = h("div", { class: "artboard-guide-tag", text });
    tag.style.transform = axis === "x" ? `translate(${at + 4}px, 4px)` : `translate(4px, ${at + 4}px)`;
    return tag;
  }

  /** A guide's handle on its ruler: drag it, ⌘-click it, or drag it off. */
  private handle(board: PlacedArtboard, axis: Axis, index: number, at: number, off: boolean): HTMLElement {
    const handle = h("div", {
      class: `artboard-guide-handle ${axis === "x" ? "v" : "h"}${off ? " removing" : ""}`,
      title: "Drag to move · ⌘-click or drag off the end to remove",
    });
    handle.style.transform = axis === "x" ? `translateX(${at}px)` : `translateY(${at}px)`;
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const list = this.guideList(board, axis);
      if (event.metaKey || event.ctrlKey) {
        void this.writeGuides(board, axis, list.filter((_, i) => i !== index));
        return;
      }
      this.moving = { id: board.id, axis, index, value: list[index], off: false };
      this.track(event, (e) => {
        const offset = this.offsetAlong(board, axis, e);
        const length = (axis === "x" ? board.width : board.height) * this.zoom();
        const off = offset < -OFF_END_PX || offset > length + OFF_END_PX;
        const value = this.clampTo(board, axis, pointAt(offset, this.zoom()));
        this.moving = { id: board.id, axis, index, value, off };
        this.redraw();
      }, () => {
        const moved = this.moving;
        if (!moved) return;
        const next = moved.off
          ? list.filter((_, i) => i !== index)
          : list.map((v, i) => (i === index ? moved.value : v));
        void this.writeGuides(board, axis, next).then(() => {
          this.moving = null;
          this.redraw();
        });
      });
    });
    return handle;
  }

  /** The top ruler (`x`) or the left one (`y`), with its ticks drawn for the part on screen. */
  private ruler(board: PlacedArtboard, axis: Axis, start: number, length: number, zoom: number): HTMLElement {
    const ruler = h("div", { class: `artboard-ruler ${axis === "x" ? "top" : "left"}` });
    if (axis === "x") ruler.style.width = `${length}px`;
    else ruler.style.height = `${length}px`;
    // Only the part of the ruler the canvas can see: a sheet at 16× is tens of
    // thousands of pixels long, and a canvas that size is not worth having.
    const visible = axis === "x" ? this.size.width : this.size.height;
    const from = Math.max(0, -start);
    const to = Math.min(length, visible - start);
    if (to > from) ruler.appendChild(this.ticks(board, axis, from, to, zoom));

    ruler.addEventListener("pointermove", (event) => {
      if (this.moving || event.buttons) return;
      this.offer(board, axis, event);
    });
    ruler.addEventListener("pointerleave", () => {
      if (this.hover && !this.pressing) {
        this.hover = null;
        this.redraw();
      }
    });
    ruler.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const sx = event.clientX;
      const sy = event.clientY;
      let wandered = false;
      this.pressing = true;
      this.offer(board, axis, event);
      this.track(event, (e) => {
        if (Math.hypot(e.clientX - sx, e.clientY - sy) > TAP_SLOP_PX) wandered = true;
        this.offer(board, axis, e);
      }, (e) => {
        this.pressing = false;
        const offered = this.hover;
        // A press dragged well away from the ruler is a change of mind.
        const away = wandered && this.distanceFromRuler(board, axis, e) > RULER_PX * 3;
        this.hover = e.pointerType === "mouse" && !away ? offered : null;
        if (!offered || away) return this.redraw();
        const list = this.guideList(board, axis);
        if (list.includes(offered.value)) return this.redraw();
        void this.writeGuides(board, axis, [...list, offered.value]);
      });
    });
    return ruler;
  }

  private offer(board: PlacedArtboard, axis: Axis, event: PointerEvent): void {
    const value = this.clampTo(board, axis, pointAt(this.offsetAlong(board, axis, event), this.zoom()));
    if (this.hover?.id === board.id && this.hover.axis === axis && this.hover.value === value) return;
    this.hover = { id: board.id, axis, value };
    this.redraw();
  }

  private ticks(board: PlacedArtboard, axis: Axis, from: number, to: number, zoom: number): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.className = "artboard-ruler-ticks";
    const along = to - from;
    const ratio = window.devicePixelRatio || 1;
    const [w, hgt] = axis === "x" ? [along, RULER_PX] : [RULER_PX, along];
    canvas.width = Math.ceil(w * ratio);
    canvas.height = Math.ceil(hgt * ratio);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${hgt}px`;
    canvas.style.transform = axis === "x" ? `translateX(${from}px)` : `translateY(${from}px)`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return canvas;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.strokeStyle = TICK;
    ctx.fillStyle = TEXT;
    ctx.lineWidth = 1;
    ctx.font = "9px system-ui, sans-serif";
    ctx.textBaseline = "top";

    const scale = rulerScale(board.unit, zoom);
    const divisions = Math.max(1, Math.round(scale.majorPt / scale.minorPt));
    const first = Math.ceil(from / zoom / scale.minorPt);
    const last = Math.floor(to / zoom / scale.minorPt);
    ctx.beginPath();
    for (let k = first; k <= last; k++) {
      const pt = k * scale.minorPt;
      const at = Math.round(pt * zoom - from) + 0.5;
      const major = k % divisions === 0;
      const half = !major && divisions % 2 === 0 && k % (divisions / 2) === 0;
      const tick = major ? RULER_PX : half ? RULER_PX * 0.5 : RULER_PX * 0.3;
      // Ticks stand on the edge against the sheet: the bottom of the top
      // ruler and the right of the left one.
      if (axis === "x") {
        ctx.moveTo(at, RULER_PX);
        ctx.lineTo(at, RULER_PX - tick);
      } else {
        ctx.moveTo(RULER_PX, at);
        ctx.lineTo(RULER_PX - tick, at);
      }
      if (major) {
        const label = tickLabel(pt, board.unit);
        if (axis === "x") {
          ctx.fillText(label, at + 2, 1);
        } else {
          ctx.save();
          ctx.translate(1, at + 2);
          ctx.rotate(Math.PI / 2);
          ctx.fillText(label, 0, -RULER_PX + 7);
          ctx.restore();
        }
      }
    }
    ctx.stroke();
    return canvas;
  }

  /** The eight handles on a sheet being resized. */
  private handles(board: PlacedArtboard, zoom: number, width: number, height: number): HTMLElement[] {
    return EDGES.map((edge) => {
      const handle = h("div", { class: `artboard-resize ${edge}` });
      const x = edge.includes("w") ? 0 : edge.includes("e") ? width : width / 2;
      const y = edge.includes("n") ? 0 : edge.includes("s") ? height : height / 2;
      handle.style.transform = `translate(${x}px, ${y}px)`;
      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const start = { x: board.x, y: board.y, width: board.width, height: board.height };
        const sx = event.clientX;
        const sy = event.clientY;
        let rect = start;
        this.track(event, (e) => {
          rect = resized(start, edge, (e.clientX - sx) / zoom, (e.clientY - sy) / zoom);
          this.host.preview({ id: board.id, ...rect });
        }, () => {
          const same =
            rect.x === start.x && rect.y === start.y && rect.width === start.width && rect.height === start.height;
          if (same) return this.host.preview(null);
          void changePage({
            artboard: board.id,
            paper: "custom",
            customWidth: rect.width,
            customHeight: rect.height,
            x: rect.x,
            y: rect.y,
          }).then(() => this.host.preview(null));
        });
      });
      return handle;
    });
  }

  private writeGuides(board: PlacedArtboard, axis: Axis, list: number[]): Promise<void> {
    return changePage(axis === "x" ? { artboard: board.id, guidesX: list } : { artboard: board.id, guidesY: list });
  }

  private zoom(): number {
    return this.view?.zoom || 1;
  }

  /** How far along an artboard's edge a pointer is, in screen pixels from its corner. */
  private offsetAlong(board: PlacedArtboard, axis: Axis, event: PointerEvent): number {
    const view = this.view;
    if (!view) return 0;
    const rect = this.root.getBoundingClientRect();
    return axis === "x"
      ? event.clientX - rect.left - (board.x - view.originX) * view.zoom
      : event.clientY - rect.top - (board.y - view.originY) * view.zoom;
  }

  /** How far a pointer is from the ruler's band, across it. */
  private distanceFromRuler(board: PlacedArtboard, axis: Axis, event: PointerEvent): number {
    const view = this.view;
    if (!view) return 0;
    const rect = this.root.getBoundingClientRect();
    const across =
      axis === "x"
        ? event.clientY - rect.top - (board.y - view.originY) * view.zoom
        : event.clientX - rect.left - (board.x - view.originX) * view.zoom;
    // The band runs from -RULER_PX to 0 across.
    return across > 0 ? across : Math.max(0, -RULER_PX - across);
  }

  private clampTo(board: PlacedArtboard, axis: Axis, value: number): number {
    return Math.max(0, Math.min(axis === "x" ? board.width : board.height, value));
  }

  /** Follow a press until it lets go, wherever the pointer goes. */
  private track(
    down: PointerEvent,
    move: (event: PointerEvent) => void,
    up: (event: PointerEvent) => void,
  ): void {
    const id = down.pointerId;
    const onMove = (e: PointerEvent) => {
      if (e.pointerId === id) move(e);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      up(e);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }
}

/**
 * A sheet with one edge or corner dragged by `dx, dy` points: whole points,
 * no smaller or larger than a sheet may be, and the edges not dragged left
 * where they were.
 */
export function resized(
  start: { x: number; y: number; width: number; height: number },
  edge: Edge,
  dx: number,
  dy: number,
): { x: number; y: number; width: number; height: number } {
  const fit = (v: number) => Math.round(Math.min(PAGE_RANGE.max, Math.max(PAGE_RANGE.min, v)));
  let { x, y, width, height } = start;
  if (edge.includes("e")) width = fit(start.width + dx);
  if (edge.includes("s")) height = fit(start.height + dy);
  if (edge.includes("w")) {
    width = fit(start.width - dx);
    x = start.x + start.width - width;
  }
  if (edge.includes("n")) {
    height = fit(start.height - dy);
    y = start.y + start.height - height;
  }
  return { x, y, width, height };
}
