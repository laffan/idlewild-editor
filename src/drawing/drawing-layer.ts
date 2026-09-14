/**
 * The drawing layer: Hush's notebook ink, superimposed over the game canvas.
 *
 * It is superimposed rather than merged because Hush's freehand layer has
 * its own renderer, camera and hit-testing, and none of them are Phaser's.
 * What crosses between them is narrow: a viewport in, camera gestures and a
 * stroke selection out.
 *
 * **Fingers never draw.** A pen or a mouse runs the active tool; touch pans
 * and pinches, and is forwarded to the game camera so the two layers move
 * together. That is Hush's rule on iPad and it is the whole reason the
 * Pencil feels like a pencil there: you can rest a hand, pan with it, and
 * keep drawing without ever switching tools.
 *
 * **A document change is not an ink change.** The store fires `change` for
 * every edit anywhere in the project — a placement dragged, a density typed,
 * a layer renamed — and this layer used to answer every one of them by
 * re-laying every stroke on its layer. Hush's first shim invariant is that
 * unrelated mutations cost the engine nothing, and it is kept here the way it
 * is kept there: by identity. The strokes array is replaced on every edit to
 * it and on no other edit, so `Surface.apply` can tell "nothing happened to
 * the ink" from "one stroke was added" from "something else" with a reference
 * compare, and does the least of the three that will do.
 */

import type { DocStore } from "../lib/doc-store";
import type { Stroke } from "../lib/types";
import { createAtlasCache, type AtlasCache } from "./atlas";
import { StrokeStore } from "./stroke-store";
import { Surface, type Viewport } from "./surface";
import {
  beginDraw,
  beginErase,
  beginFill,
  beginLasso,
  beginZone,
  drawEraserCursor,
  type ToolSession,
} from "./tools";
import { PointFill } from "./fill-points";
import {
  DEFAULT_STYLE,
  type DrawingTool,
  type FillMode,
  type StrokeStyle,
} from "./types";

export interface DrawingCallbacks {
  /** Two-finger navigation, in screen pixels, for the game camera. */
  onPan: (dxScreen: number, dyScreen: number) => void;
  onZoom: (factor: number, screenX: number, screenY: number) => void;
  /** The lasso settled on these strokes; an empty list is a dismissal. */
  onSelect: (ids: string[]) => void;
  /**
   * A boundary was swept. The polygon is in world pixels and unsimplified —
   * how coarse a boundary may be is a fact about the grid, which this layer
   * knows nothing about. An empty list is a tap, and means nothing was drawn.
   */
  onZone: (points: readonly { x: number; y: number }[]) => void;
  /**
   * The point-to-point fill's shape changed — a corner added, moved, taken
   * back, or the lot laid down. What is passed is how many corners are down,
   * which is all the inspector needs to offer or withhold its two buttons.
   */
  onFillPoints: (count: number) => void;
}

export class DrawingLayer {
  readonly root: HTMLElement;
  style: StrokeStyle = { ...DEFAULT_STYLE };

  /**
   * How long a still hold inside a stroke straightens the rest of it, in
   * milliseconds. Zero is off, which is everywhere but PSD Edit mode — see
   * `DrawOptions.straightenAfterMs`.
   */
  straightenHoldMs = 0;

  /** Exposed so an export renders with the brush PNGs this layer has
   *  already decoded, rather than rebuilding the cache from its fallbacks. */
  readonly atlas: AtlasCache;

  private readonly surface: Surface;
  private readonly store: StrokeStore;
  private readonly callbacks: DrawingCallbacks;
  private readonly unlistenAtlas: () => void;

  private tool: DrawingTool | null = null;
  /** Which half of the sweep fill is in hand — see `types.ts`. */
  private fill: FillMode = "draw";
  /** The point-to-point fill's half-built shape, which outlives a gesture. */
  private readonly pointFill: PointFill;
  private session: ToolSession | null = null;
  private sessionPointer: number | null = null;
  /** The erase drag's uncommitted stroke list; null outside one. */
  private working: Stroke[] | null = null;

  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchSpread = 0;
  private lastPanX = 0;
  private lastPanY = 0;

  constructor(doc: DocStore, layerId: string, callbacks: DrawingCallbacks) {
    this.callbacks = callbacks;
    this.atlas = createAtlasCache();
    this.store = new StrokeStore(doc, layerId);
    this.surface = new Surface(this.atlas);
    this.root = this.surface.root;
    this.pointFill = new PointFill(this.surface, this.store, () =>
      this.callbacks.onFillPoints(this.pointFill.count),
    );

    // A brush's PNG replaces its procedural tip mid-session; the ink already
    // on screen was baked with the fallback and has to be laid again.
    this.unlistenAtlas = this.atlas.onLoad(() => this.repaint());

    doc.addEventListener("change", () => {
      // An erase drag is already painting from its working copy; letting the
      // document's own change event repaint would undo the preview.
      //
      // `apply` rather than `repaint`: most changes are not about ink at all,
      // and the one that usually is — a stroke finished — is an append, which
      // is stamped rather than re-laid. See the note at the top.
      if (!this.working) this.surface.apply(this.strokes());
    });

    const el = this.root;
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onUp);
    el.addEventListener("pointerleave", this.onLeave);
    el.addEventListener("wheel", this.onWheel, { passive: false });
  }

  /**
   * The pointer left the surface — for the eraser's disc, which is painted on
   * the live canvas rather than being a cursor, that means stop painting it.
   *
   * **Unless a shape is half tapped out.** That also lives on the live canvas,
   * and it is the one thing there that is meant to outlive the pointer: the
   * whole point of the point-to-point fill is that you can go and do something
   * else — reach for the panel, pan with a finger — and come back to it. A
   * blanket clear here made the shape vanish every time the pointer crossed
   * into the sidebar and come back on the next camera move, which is exactly
   * the flicker it looked like.
   */
  private onLeave = (): void => {
    if (this.session) return;
    if (this.showsPointFill() && this.pointFill.count > 0) {
      this.pointFill.repaint(this.style);
      return;
    }
    this.surface.clearLive();
  };

  /**
   * The layer strokes land on — the editor's active layer.
   *
   * A full repaint rather than `apply`, and it has to be: the backing holds
   * the *other* layer's ink, and a new layer whose list happens to extend the
   * old one's would otherwise be stamped on top of it.
   */
  setLayer(layerId: string): void {
    // A shape half tapped out is about the layer it was being tapped out on.
    this.pointFill.clear();
    this.store.setLayer(layerId);
    this.repaint();
  }

  /**
   * Switch tools. A null tool hands input back to the game canvas entirely:
   * the surface stops taking pointer events and the grid tools resume.
   */
  setTool(tool: DrawingTool | null): void {
    if (tool === this.tool) return;
    this.endSession();
    this.tool = tool;
    this.surface.clearLive();
    this.surface.setInteractive(tool !== null);
    this.root.classList.toggle("erasing", tool === "eraser");
    // A shape half tapped out survives a change of tool but stops being
    // *drawn*, which is not the same thing. It has to survive because holding
    // space borrows Pan — every tool in this editor can be interrupted that
    // way, and losing four carefully placed corners to a thumb on the space
    // bar would make the mode unusable. It has to stop being drawn because a
    // polygon left hanging over the canvas while somebody draws with the
    // pencil is a mark nothing explains.
    if (this.showsPointFill()) this.pointFill.repaint(this.style);
    // The count has not changed, but whether it is *shown* has — and the bar
    // floating over the shape follows the second of those, not the first.
    this.callbacks.onFillPoints(this.pointFill.count);
  }

  get activeTool(): DrawingTool | null {
    return this.tool;
  }

  /** Which half of the sweep fill the pointer is aiming. */
  get fillMode(): FillMode {
    return this.fill;
  }

  setFillMode(mode: FillMode): void {
    if (mode === this.fill) return;
    this.endSession();
    // Switching aim mid-shape would leave corners nothing can commit.
    this.pointFill.clear();
    this.fill = mode;
    this.callbacks.onFillPoints(this.pointFill.count);
  }

  /** How many corners the point-to-point fill currently has down. */
  get fillPointCount(): number {
    return this.pointFill.count;
  }

  /** Lay the tapped-out shape down. False when there is no shape yet. */
  fillPoints(): boolean {
    return this.pointFill.fill(this.style);
  }

  /** Throw the tapped-out shape away. */
  clearFillPoints(): void {
    this.pointFill.clear();
  }

  /** Take the last corner back off, which is what a mis-tap needs. */
  undoFillPoint(): void {
    this.pointFill.undoPoint(this.style);
  }

  /** Follow the game camera. Cheap unless the backing has to move. */
  sync(view: Viewport): void {
    this.surface.sync(view, this.strokes());
    // A re-anchor clears the live canvas, and a shape half tapped out lives
    // there rather than in the ink. Nothing else on that layer has to survive
    // a pan, because nothing else on it outlives the gesture that drew it.
    if (!this.session && this.showsPointFill()) this.pointFill.repaint(this.style);
  }

  /** Whether the half-built shape is the thing the live canvas is showing. */
  private showsPointFill(): boolean {
    return this.tool === "fill" && this.fill === "points";
  }

  /**
   * Where the half-built shape is on screen, for the bar that floats over it.
   *
   * Null when there is no shape or when it is not being shown — it survives a
   * change of tool but stops being drawn, and a bar offering to fill something
   * invisible would be a bar about nothing. In the canvas column's own
   * coordinates, which are the surface's: it is `inset: 0` inside it.
   */
  fillPointsAnchor(): { x: number; y: number; width: number } | null {
    if (!this.showsPointFill()) return null;
    const box = this.pointFill.box();
    if (!box) return null;
    const at = this.surface.worldToScreen(box.x, box.y);
    return { x: at.x, y: at.y, width: box.width * this.surface.screenPerWorldUnit };
  }

  /**
   * Re-lay every stroke from scratch.
   *
   * Two callers, and both of them mean it. A brush's PNG replacing its
   * procedural tip changes what every stroke drawn with it looks like, and a
   * change of layer changes which strokes there are — neither is describable
   * as a diff against what is on the backing.
   */
  repaint(): void {
    this.surface.repaint(this.strokes());
  }

  strokesById(ids: readonly string[]): Stroke[] {
    const wanted = new Set(ids);
    return this.store.strokes.filter((s) => wanted.has(s.id));
  }

  removeStrokes(ids: readonly string[]): void {
    this.store.remove(ids);
  }

  destroy(): void {
    this.endSession();
    this.unlistenAtlas();
    this.atlas.destroy();
    const el = this.root;
    el.removeEventListener("pointerdown", this.onDown);
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("pointercancel", this.onUp);
    el.removeEventListener("pointerleave", this.onLeave);
    el.removeEventListener("wheel", this.onWheel);
    this.surface.destroy();
  }

  // ── input ─────────────────────────────────────────────────────────────────

  private strokes(): readonly Stroke[] {
    return this.working ?? this.store.strokes;
  }

  private local(event: PointerEvent): { x: number; y: number } {
    const rect = this.root.getBoundingClientRect();
    return this.surface.screenToWorld(
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
  }

  /**
   * Pressure, following Hush's reading of it. A pen that reports a real
   * value is scaled up a little because few people press as hard as the
   * digitiser's full range; anything that reports the 0.5 default — a mouse,
   * a finger — is left there rather than being made to look like a light
   * touch.
   */
  private pressure(event: PointerEvent): number {
    const raw = event.pressure;
    if (raw > 0 && raw !== 0.5 && raw < 1) return Math.min(1, raw * 1.25);
    return raw === 1 ? 1 : 0.5;
  }

  private onDown = (event: PointerEvent): void => {
    this.pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    if (event.pointerType === "touch") {
      // A second finger always wins: whatever the first was doing, this is
      // now navigation.
      if (this.pointers.size === 2) {
        this.endSession();
        this.pinchSpread = this.spread();
      } else if (this.pointers.size === 1) {
        this.lastPanX = event.clientX;
        this.lastPanY = event.clientY;
      }
      return;
    }

    if (!this.tool || this.session) return;
    this.root.setPointerCapture(event.pointerId);
    this.sessionPointer = event.pointerId;
    const { x, y } = this.local(event);
    this.session = this.open(this.tool, x, y, this.pressure(event));
    event.preventDefault();
  };

  private open(
    tool: DrawingTool,
    x: number,
    y: number,
    pressure: number,
  ): ToolSession {
    if (tool === "pencil") {
      return beginDraw(
        this.store,
        this.surface,
        this.atlas,
        this.style,
        x,
        y,
        pressure,
        { straightenAfterMs: this.straightenHoldMs },
      );
    }
    if (tool === "eraser") {
      return beginErase(
        this.store,
        this.surface,
        (next) => {
          this.working = next;
        },
        x,
        y,
      );
    }
    if (tool === "fill") {
      return this.fill === "points"
        ? this.pointFill.begin(x, y, this.style)
        : beginFill(this.store, this.surface, this.style, x, y);
    }
    if (tool === "zone") {
      return beginZone(this.surface, this.callbacks.onZone, x, y);
    }
    return beginLasso(this.store, this.surface, this.callbacks.onSelect, x, y);
  }

  private onMove = (event: PointerEvent): void => {
    if (event.pointerType === "touch") {
      if (!this.pointers.has(event.pointerId)) return;
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.navigate();
      return;
    }

    if (!this.session || event.pointerId !== this.sessionPointer) {
      // The eraser paints its own disc instead of a system cursor, so it has
      // to keep painting it while merely hovering — otherwise the pointer
      // disappears until the moment you press.
      if (!this.session && this.tool === "eraser") {
        const { x, y } = this.local(event);
        drawEraserCursor(this.surface, x, y);
      }
      return;
    }
    // Coalesced events are the difference between a smooth curve and a
    // polyline on a 120 Hz Pencil against a 60 Hz frame.
    const moves = event.getCoalescedEvents?.() ?? [];
    for (const move of moves.length ? moves : [event]) {
      const { x, y } = this.local(move);
      this.session.move(x, y, this.pressure(move));
    }
    event.preventDefault();
  };

  private onUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);

    if (event.pointerType === "touch") {
      if (this.pointers.size === 1) {
        // Keep panning with whichever finger is left rather than stalling.
        const [remaining] = [...this.pointers.values()];
        this.lastPanX = remaining.x;
        this.lastPanY = remaining.y;
      }
      this.pinchSpread = 0;
      return;
    }

    if (event.pointerId !== this.sessionPointer) return;
    if (this.root.hasPointerCapture(event.pointerId)) {
      this.root.releasePointerCapture(event.pointerId);
    }
    this.endSession();
  };

  private endSession(): void {
    this.session?.end();
    this.session = null;
    this.sessionPointer = null;
    this.working = null;
  }

  private navigate(): void {
    if (this.pointers.size >= 2) {
      const spread = this.spread();
      const centre = this.centre();
      if (this.pinchSpread > 0 && spread > 0) {
        this.callbacks.onZoom(spread / this.pinchSpread, centre.x, centre.y);
      }
      this.pinchSpread = spread;
      // The midpoint carries the pan while two fingers are down, so a
      // two-finger drag moves the camera as well as scaling it.
      this.callbacks.onPan(centre.x - this.lastPanX, centre.y - this.lastPanY);
      this.lastPanX = centre.x;
      this.lastPanY = centre.y;
      return;
    }

    const [only] = [...this.pointers.values()];
    if (!only) return;
    this.callbacks.onPan(only.x - this.lastPanX, only.y - this.lastPanY);
    this.lastPanX = only.x;
    this.lastPanY = only.y;
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = this.root.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    // WebKit reports a trackpad pinch as a ctrl-wheel; a plain wheel scrolls.
    if (event.ctrlKey || event.metaKey) {
      this.callbacks.onZoom(Math.exp(-event.deltaY / 220), x, y);
    } else {
      this.callbacks.onPan(-event.deltaX, -event.deltaY);
    }
  };

  private spread(): number {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private centre(): { x: number; y: number } {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return { x: this.lastPanX, y: this.lastPanY };
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
}
