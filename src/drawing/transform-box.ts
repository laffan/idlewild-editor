/**
 * The box a lasso selection wears: drag inside it to move what was caught, a
 * corner to scale it, the knob above it to turn it.
 *
 * In the drawing layer's own sheet, so it goes wherever that layer does — the
 * scene's ink, and the plan's (`editor/plan-mode.ts`) — and it takes the
 * pointer only on itself. Every gesture is one matrix (`transform.ts`): the
 * strokes are previewed through it as the pointer moves, once a frame, and
 * written once, on release, so a move is one step to undo however far it went.
 *
 * Corners scale in proportion — a sketch stretched one way is rarely what was
 * meant — and Shift lets each axis go its own way. The knob turns about the
 * middle of the box, in 15° steps with Shift. While a gesture is under way
 * the outline turns and grows with it; once it lands, the box is the bounds
 * of where the strokes now are.
 *
 * **A box can stand at an angle.** Strokes are re-measured after every turn,
 * so theirs is always square to the screen; a picture on the plan keeps its
 * angle (`editor/plan-images.ts`), so its box is its own rectangle turned by
 * `frame`. `bounds` is then in the frame's coordinates, a corner scales along
 * the picture's own sides, and the matrix handed back is still the world's.
 * And a host that can delete what it holds gets a × off the lower right
 * corner as the screen has it, for a hand with no keyboard.
 */

import { onFrame } from "./frame";
import type { Bounds } from "./types";
import {
  IDENTITY,
  applyPoint,
  compose,
  invert,
  rotationAbout,
  scalingAbout,
  translation,
  type Affine,
} from "./transform";

/** How far the turning knob stands above the box, on screen. */
const KNOB_GAP_PX = 28;
/** The smallest a proportional scale may shrink the selection to. */
const MIN_SCALE = 0.02;
const SNAP = Math.PI / 12;

export interface TransformBoxHost {
  /** The selection's bounds in the world, or null for nothing selected. */
  bounds(): Bounds | null;
  /** Whether the box should be offered — not while a brush is in hand. */
  offered(): boolean;
  /** World to the sheet's own pixels, and a pointer to the world. */
  toScreen(x: number, y: number): { x: number; y: number };
  toWorld(event: PointerEvent): { x: number; y: number };
  /** Draw the selection through `m` without writing it, or stop. */
  preview(m: Affine | null): void;
  /** Write the selection through `m`. */
  commit(m: Affine): void;
  /** Where `bounds` stands in the world, when not square to it — see above. */
  frame?(): Affine;
  /** Take the selection away: offered as a × off the lower right corner. */
  remove?(): void;
}

/** How far the × stands off the lower right corner, on screen, along the diagonal. */
const REMOVE_GAP_PX = 22;

const SVG = "http://www.w3.org/2000/svg";
const CORNERS = ["nw", "ne", "se", "sw"] as const;

export class TransformBox {
  readonly root: HTMLElement;
  private readonly host: TransformBoxHost;
  private readonly outline: SVGPolygonElement;
  private readonly stem: SVGLineElement;
  private readonly handles = new Map<(typeof CORNERS)[number], HTMLElement>();
  private readonly knob: HTMLElement;
  private readonly removeButton: HTMLElement | null = null;
  /** A move made somewhere else, shown through until it lands — see `showThrough`. */
  private outside: Affine | null = null;
  /** The gesture under way: the bounds it started from and where it has got to. */
  private gesture: { box: Bounds; m: Affine } | null = null;
  private readonly frame = onFrame(() => this.host.preview(this.gesture?.m ?? null));

  constructor(host: TransformBoxHost) {
    this.host = host;
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("class", "stroke-transform-lines");
    this.outline = document.createElementNS(SVG, "polygon");
    this.outline.setAttribute("class", "stroke-transform-outline");
    this.stem = document.createElementNS(SVG, "line");
    this.stem.setAttribute("class", "stroke-transform-stem");
    svg.append(this.stem, this.outline);
    this.knob = document.createElement("div");
    this.knob.className = "stroke-transform-knob";
    this.knob.title = "Turn — Shift for 15° steps";
    this.root = document.createElement("div");
    this.root.className = "stroke-transform hidden";
    this.root.append(svg, this.knob);
    for (const corner of CORNERS) {
      const handle = document.createElement("div");
      handle.className = `stroke-transform-handle ${corner}`;
      handle.title = "Scale — Shift to stretch";
      this.handles.set(corner, handle);
      this.root.appendChild(handle);
      handle.addEventListener("pointerdown", (e) =>
        this.begin(e, (box, _from, at, free) => {
          // Along the box's own sides: the pointer into the frame, the scale
          // there, and the result back out into the world.
          const frame = this.standing();
          const local = applyPoint(invert(frame), at.x, at.y);
          return compose(compose(invert(frame), scaleFrom(box, corner, local, free)), frame);
        }),
      );
    }
    if (host.remove) {
      const remove = document.createElement("button");
      remove.className = "stroke-transform-remove";
      remove.title = "Remove (Delete)";
      remove.setAttribute("aria-label", "Remove");
      remove.textContent = "×";
      remove.addEventListener("pointerdown", (e) => e.stopPropagation());
      remove.addEventListener("click", (e) => {
        e.stopPropagation();
        host.remove?.();
      });
      this.removeButton = remove;
      this.root.appendChild(remove);
    }
    this.outline.addEventListener("pointerdown", (e) =>
      this.begin(e, (_box, from, at) => translation(at.x - from.x, at.y - from.y)),
    );
    this.knob.addEventListener("pointerdown", (e) =>
      this.begin(e, (box, from, at, free) => {
        const { x: cx, y: cy } = applyPoint(this.standing(), box.x + box.width / 2, box.y + box.height / 2);
        let angle = Math.atan2(at.y - cy, at.x - cx) - Math.atan2(from.y - cy, from.x - cx);
        if (free) angle = Math.round(angle / SNAP) * SNAP;
        return rotationAbout(cx, cy, angle);
      }),
    );
  }

  /** Put the box where the selection is now. */
  refresh(): void {
    const box = this.gesture?.box ?? this.host.bounds();
    const shown = box !== null && this.host.offered();
    this.root.classList.toggle("hidden", !shown);
    if (!shown || !box) return;
    const m = compose(this.standing(), this.gesture?.m ?? this.outside ?? IDENTITY);
    const corner = (x: number, y: number) => {
      const w = applyPoint(m, x, y);
      return this.host.toScreen(w.x, w.y);
    };
    const at = {
      nw: corner(box.x, box.y),
      ne: corner(box.x + box.width, box.y),
      se: corner(box.x + box.width, box.y + box.height),
      sw: corner(box.x, box.y + box.height),
    };
    this.outline.setAttribute("points", CORNERS.map((c) => `${at[c].x},${at[c].y}`).join(" "));
    for (const c of CORNERS) {
      this.handles.get(c)!.style.transform = `translate(${at[c].x}px, ${at[c].y}px)`;
    }
    // The knob stands off the top edge's middle, along the box's own "up".
    const top = { x: (at.nw.x + at.ne.x) / 2, y: (at.nw.y + at.ne.y) / 2 };
    const side = { x: at.nw.x - at.sw.x, y: at.nw.y - at.sw.y };
    const length = Math.hypot(side.x, side.y) || 1;
    const knob = { x: top.x + (side.x / length) * KNOB_GAP_PX, y: top.y + (side.y / length) * KNOB_GAP_PX };
    this.stem.setAttribute("x1", String(top.x));
    this.stem.setAttribute("y1", String(top.y));
    this.stem.setAttribute("x2", String(knob.x));
    this.stem.setAttribute("y2", String(knob.y));
    this.knob.style.transform = `translate(${knob.x}px, ${knob.y}px)`;
    if (this.removeButton) {
      // Off whichever corner is lowest and furthest right on screen — the
      // box's own lower right until it is turned past it — out along the line
      // from the box's middle, so it never sits on a handle.
      const corner = CORNERS.map((c) => at[c]).reduce((a, b) => (b.x + b.y > a.x + a.y ? b : a));
      const middle = { x: (at.nw.x + at.se.x) / 2, y: (at.nw.y + at.se.y) / 2 };
      const out = { x: corner.x - middle.x, y: corner.y - middle.y };
      const reach = Math.hypot(out.x, out.y) || 1;
      const x = corner.x + (out.x / reach) * REMOVE_GAP_PX;
      const y = corner.y + (out.y / reach) * REMOVE_GAP_PX;
      this.removeButton.style.transform = `translate(${x}px, ${y}px)`;
    }
  }

  /** Where the box stands in the world: square to it, unless the host says. */
  private standing(): Affine {
    return this.host.frame?.() ?? IDENTITY;
  }

  /**
   * Show the box moved through `m` by a gesture the host is running itself —
   * a press that picked something up and carried it in one movement — or as
   * it stands again, with null.
   */
  showThrough(m: Affine | null): void {
    this.outside = m;
    this.refresh();
  }

  /** Whether a gesture is under way — the layer holds its own repaints meanwhile. */
  get busy(): boolean {
    return this.gesture !== null;
  }

  private begin(
    down: PointerEvent,
    shape: (box: Bounds, from: { x: number; y: number }, at: { x: number; y: number }, free: boolean) => Affine,
  ): void {
    const box = this.host.bounds();
    if (!box) return;
    // The sheet under the box would otherwise take this as the start of a
    // stroke, or the first finger of a pan.
    down.preventDefault();
    down.stopPropagation();
    const from = this.host.toWorld(down);
    this.gesture = { box, m: IDENTITY };
    this.root.classList.add("busy");
    const move = (e: PointerEvent) => {
      if (e.pointerId !== down.pointerId || !this.gesture) return;
      this.gesture = { box, m: shape(box, from, this.host.toWorld(e), e.shiftKey) };
      this.refresh();
      this.frame.request();
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== down.pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      this.frame.cancel();
      const m = this.gesture?.m ?? IDENTITY;
      this.gesture = null;
      this.root.classList.remove("busy");
      if (e.type === "pointerup" && !isIdentity(m)) this.host.commit(m);
      else this.host.preview(null);
      this.refresh();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }
}

/**
 * A corner dragged to `at`: scaled about the opposite corner, in proportion
 * unless `free`, never turned inside out.
 */
export function scaleFrom(
  box: Bounds,
  corner: "nw" | "ne" | "se" | "sw",
  at: { x: number; y: number },
  free: boolean,
): Affine {
  const ax = corner.includes("w") ? box.x + box.width : box.x;
  const ay = corner.includes("n") ? box.y + box.height : box.y;
  const v0 = { x: (corner.includes("w") ? box.x : box.x + box.width) - ax, y: (corner.includes("n") ? box.y : box.y + box.height) - ay };
  const v = { x: at.x - ax, y: at.y - ay };
  if (free) {
    const sx = v0.x !== 0 ? Math.max(MIN_SCALE, v.x / v0.x) : 1;
    const sy = v0.y !== 0 ? Math.max(MIN_SCALE, v.y / v0.y) : 1;
    return scalingAbout(ax, ay, sx, sy);
  }
  const length = v0.x * v0.x + v0.y * v0.y;
  const s = length > 0 ? Math.max(MIN_SCALE, (v.x * v0.x + v.y * v0.y) / length) : 1;
  return scalingAbout(ax, ay, s, s);
}

function isIdentity(m: Affine): boolean {
  return m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-9);
}
