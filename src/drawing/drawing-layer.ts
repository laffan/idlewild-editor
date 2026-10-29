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
import { StrokeStore, type StrokeSource } from "./stroke-store";
import { Surface, type Backdrop, type Viewport } from "./surface";
import {
  beginDraw,
  beginErase,
  beginFill,
  beginLasso,
  beginZone,
  type ToolSession,
} from "./tools";
import { PointFill } from "./fill-points";
import { AxisLock } from "./axis-lock";
import { strokesBox } from "./geometry";
import { TransformBox } from "./transform-box";
import { transformSome, type Affine } from "./transform";
import { HoverCursor, previews } from "./hover-cursor";
import { setInking } from "./inking";
import { TouchNav } from "./touch-nav";
import {
  FINGER_HOLD_MS,
  FINGER_SLOP_PX,
  Hold,
  PEN_HOLD_MS,
  PEN_HOLD_TOOLS,
  PEN_SLOP_PX,
  TAP_MS,
} from "./hold-lasso";
import { beginShapeStamp, freeStampBox, type StampBox, type StampBoxAt } from "./tools-stamp";
import {
  DEFAULT_STYLE,
  type DrawingTool,
  type FillMode,
  type StrokeStyle,
} from "./types";

/** The brushes that lay a line, which Shift keeps to one axis — `axis-lock.ts`. */
const LOCKS = new Set<DrawingTool | null>(["pencil", "pattern", "shape"]);

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
  /**
   * The box a shape stamp at this world point would fill — a grid space,
   * where the grid snaps.
   *
   * The Shape brush's whole geometry, asked of the shell rather than worked
   * out here: this layer knows nothing about projections and an isometric
   * space is a diamond. Optional, because PSD Edit mode builds a drawing layer
   * of its own that has no grid behind it at all; without one the brush falls
   * back to a lattice of its own stamp size.
   */
  stampBoxAt?: StampBoxAt;
  /**
   * A held pen or finger has borrowed the Lasso (`"lasso"`), or the tool it
   * was borrowed from is back (null) — see `hold-lasso.ts`. For a bar that
   * shows which tool is in hand; the layer gives the tool back on its own.
   */
  onBorrow?: (tool: DrawingTool | null) => void;
}

export class DrawingLayer {
  readonly root: HTMLElement;

  private styleValue: StrokeStyle = { ...DEFAULT_STYLE };

  /**
   * What the next stroke will be drawn with — the brush, the size, the
   * smoothing, the colour and the stroke mode.
   *
   * A property with a setter rather than a plain field, for one case:
   * **a shape half tapped out is already on screen in the colour it will land
   * in**, so picking a new colour has to reach it. Everything else here is
   * about a stroke that does not exist yet and has nothing to repaint, which
   * is why this was a field for so long. Assigning is how the shell changes
   * it — the inspector's picker fires continuously while it is dragged — so
   * the repaint belongs on the assignment rather than at each of the three
   * call sites, one of which would eventually be added without it.
   */
  get style(): StrokeStyle {
    return this.styleValue;
  }

  set style(next: StrokeStyle) {
    this.styleValue = next;
    if (this.showsPointFill()) this.pointFill.repaint(next);
  }

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
  /** Shift's one-axis hold on the stroke under way, for the brushes in `LOCKS`. */
  private lock: AxisLock | null = null;
  /** What the lasso caught, and the box it wears — see `transform-box.ts`. */
  private selection: ReadonlySet<string> = new Set();
  private readonly transform: TransformBox;

  /** The tool painted where the pointer hovers — see `hover-cursor.ts`. */
  private readonly hover: HoverCursor;

  private readonly nav: TouchNav;
  /** What a held pen or finger lent the Lasso from — see `hold-lasso.ts`. */
  private borrowed: DrawingTool | null = null;
  private readonly hold = new Hold();
  /** A lone finger, while it might still be a tap: one gives the tool back. */
  private fingerDown: { id: number; at: number; x: number; y: number } | null = null;

  /**
   * `source` draws somewhere other than a layer — the scene's plan, see
   * `editor/plan-mode.ts`. `layerId` is then not read.
   */
  constructor(
    doc: DocStore,
    layerId: string,
    callbacks: DrawingCallbacks,
    source: StrokeSource | null = null,
  ) {
    this.callbacks = callbacks;
    this.atlas = createAtlasCache();
    this.store = new StrokeStore(doc, layerId, source);
    this.surface = new Surface(this.atlas);
    this.root = this.surface.root;
    this.nav = new TouchNav(this.root, callbacks);
    this.hover = new HoverCursor({
      surface: this.surface,
      atlas: this.atlas,
      tool: () => this.tool,
      style: () => this.style,
      busy: () => this.session !== null,
      stampBox: (wx, wy) => this.stampBox(wx, wy),
    });
    this.pointFill = new PointFill(this.surface, this.store, () =>
      this.callbacks.onFillPoints(this.pointFill.count),
    );

    this.transform = new TransformBox({
      bounds: () => strokesBox(this.strokesById([...this.selection])),
      offered: () => this.tool === null || this.tool === "lasso",
      toScreen: (x, y) => this.surface.worldToScreen(x, y),
      toWorld: (event) => this.local(event),
      preview: (m) => this.previewTransform(m),
      commit: (m) => {
        this.working = null;
        this.store.replace(transformSome(this.store.strokes, this.selection, m));
      },
    });
    this.root.appendChild(this.transform.root);

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
      this.transform.refresh();
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
    this.hover.drop();
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
    this.transform.refresh();
  }

  /**
   * Switch tools. A null tool hands input back to the game canvas entirely:
   * the surface stops taking pointer events and the grid tools resume.
   */
  setTool(tool: DrawingTool | null): void {
    // The shell re-picks its tool whenever the selection moves, as the lasso's
    // catch does; only a different tool replaces a borrowed Lasso.
    if (this.borrowed && tool === this.borrowed) return;
    this.borrowed = null;
    if (tool === this.tool) return;
    this.endSession();
    this.tool = tool;
    this.surface.clearLive();
    // A half-built erasing shape has a hole cut into the baked canvas rather
    // than a preview on the live one, and the line below only puts it back if
    // the shape is still being shown. Putting it back first costs nothing —
    // `repaint` re-cuts it — and is what stops a hole outliving the tool.
    this.surface.endErase();
    this.surface.setInteractive(tool !== null);
    this.transform.refresh();
    // Every tool that paints its own pointer hides the system one — a
    // crosshair sitting on top of a six-pixel tip is most of what you were
    // trying to look at. See `previews`, and `cursor.ts` for what is drawn
    // instead.
    this.root.classList.toggle(
      "paints-cursor",
      tool !== null && previews(tool),
    );
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
    this.transform.refresh();
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
   * Put artwork under the ink, or take it away — see `Surface.backdrop`.
   *
   * PSD Edit mode's alone. It is here rather than on the surface's own face
   * because the surface is private to this layer, and because the strokes to
   * re-bake with are this layer's business.
   */
  setBackdrop(backdrop: Backdrop | null): void {
    this.surface.setBackdrop(backdrop, this.strokes());
  }

  /** Re-lay every stroke from scratch: a brush's PNG has replaced its
   *  procedural tip, or the layer — and so which strokes there are — changed. */
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

  /** The strokes the lasso caught — or the canvas selected — on this layer. */
  select(ids: readonly string[]): void {
    this.selection = new Set(ids);
    this.transform.refresh();
  }

  /** Draw the selection moved through `m`, or as it is — the box's preview. */
  private previewTransform(m: Affine | null): void {
    this.working = m ? transformSome(this.store.strokes, this.selection, m) : null;
    this.surface.repaint(this.strokes());
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

  private local(
    event: PointerEvent,
    rect = this.root.getBoundingClientRect(),
  ): { x: number; y: number } {
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
    this.nav.down(event);

    if (event.pointerType === "touch") {
      // A second finger always wins: whatever the first was doing, this is
      // now navigation.
      if (this.nav.count === 2) {
        this.hold.disarm();
        this.fingerDown = null;
        this.endSession();
      } else if (this.nav.count === 1) {
        const { pointerId: id, timeStamp: at, clientX: x, clientY: y } = event;
        this.fingerDown = { id, at, x, y };
        if (this.tool && !this.session && this.holdsLasso()) {
          this.hold.arm(event, FINGER_HOLD_MS, FINGER_SLOP_PX, () => this.lassoFrom(event));
        }
      }
      return;
    }

    if (!this.tool || this.session) return;
    // The pen is back on the page, away from the box — it draws with what it
    // had before the hold lent the Lasso, and what was caught is let go.
    if (this.borrowed) {
      this.select([]);
      this.callbacks.onSelect([]);
      this.giveBack();
    }
    this.hover.drop();
    this.root.setPointerCapture(event.pointerId);
    this.sessionPointer = event.pointerId;
    const { x, y } = this.local(event);
    this.lock = LOCKS.has(this.tool) ? new AxisLock(x, y) : null;
    this.session = this.open(this.tool, x, y, this.pressure(event));
    setInking(this, true);
    if (event.pointerType === "pen" && PEN_HOLD_TOOLS.has(this.tool) && this.holdsLasso()) {
      this.hold.arm(event, PEN_HOLD_MS, PEN_SLOP_PX, () => this.lassoFrom(event));
    }
    event.preventDefault();
  };

  /** Whether a still hold lassos here, rather than meaning something else. */
  private holdsLasso(): boolean {
    return this.straightenHoldMs === 0;
  }

  /**
   * A hold has fired: throw away what the pen began, or stop the finger
   * panning, and sweep a lasso from where it went down with the same contact.
   */
  private lassoFrom(down: PointerEvent): void {
    if (down.pointerType === "touch") {
      this.nav.forget(down.pointerId);
      this.fingerDown = null;
      this.root.setPointerCapture(down.pointerId);
    } else {
      this.session?.cancel?.();
      this.session = null;
    }
    if (this.tool !== "lasso") {
      this.borrowed = this.tool;
      this.enter("lasso");
      this.callbacks.onBorrow?.("lasso");
    }
    const { x, y } = this.local(down);
    this.lock = null;
    this.sessionPointer = down.pointerId;
    this.session = this.open("lasso", x, y, 0.5);
    setInking(this, true);
  }

  /** Hand back the tool a hold borrowed the Lasso from, if one did. */
  private giveBack(): void {
    const tool = this.borrowed;
    if (!tool) return;
    this.borrowed = null;
    this.enter(tool);
    this.callbacks.onBorrow?.(null);
  }

  /** The tool in hand changes under a gesture rather than from the bar. */
  private enter(tool: DrawingTool): void {
    this.tool = tool;
    this.root.classList.toggle("paints-cursor", previews(tool));
    this.transform.refresh();
  }

  private open(
    tool: DrawingTool,
    x: number,
    y: number,
    pressure: number,
  ): ToolSession {
    // The Pattern brush is the pencil's own session. What makes it a Pattern
    // brush is the style it carries, not the gesture — see `paint-render.ts`,
    // which turns the path into the lattice cells it passed over.
    if (tool === "pencil" || tool === "pattern") {
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
    if (tool === "shape") {
      return beginShapeStamp(
        this.store,
        this.surface,
        this.atlas,
        this.style,
        this.style.stampGrid === false ? null : (wx, wy) => this.stampBox(wx, wy),
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
    return beginLasso(this.store, this.surface, (ids) => {
      this.select(ids);
      this.callbacks.onSelect(ids);
      // A borrowed Lasso that caught nothing has nothing to stay for.
      if (ids.length === 0) this.giveBack();
    }, x, y);
  }

  /** Where a stamp goes: off the grid, in a grid space, or — on a layer with no
   *  grid — on a lattice of its own size from the world origin, as patterns are. */
  private stampBox(x: number, y: number): StampBox | null {
    if (this.style.stampGrid === false) return freeStampBox(this.style, x, y);
    const asked = this.callbacks.stampBoxAt?.(x, y);
    if (asked) return asked;
    const { width, height } = this.style.stamp;
    return {
      x: Math.floor(x / width) * width,
      y: Math.floor(y / height) * height,
      width,
      height,
    };
  }

  private onMove = (event: PointerEvent): void => {
    this.hold.move(event);
    if (event.pointerType === "touch") {
      const tap = this.fingerDown;
      if (tap && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > FINGER_SLOP_PX) {
        this.fingerDown = null;
      }
      // A held finger is sweeping a lasso rather than panning.
      if (!(this.session && event.pointerId === this.sessionPointer)) {
        this.nav.move(event);
        return;
      }
    }

    if (!this.session || event.pointerId !== this.sessionPointer) {
      // What the tool would lay down, where it would land — `hover-cursor.ts`.
      if (!this.session && this.tool && previews(this.tool)) {
        this.hover.show(this.local(event));
      }
      return;
    }
    // Coalesced events are the difference between a smooth curve and a
    // polyline on a 120 Hz Pencil against a 60 Hz frame. One layout read for
    // all of them: the surface does not move between samples of one event.
    const moves = event.getCoalescedEvents?.() ?? [];
    const rect = this.root.getBoundingClientRect();
    for (const move of moves.length ? moves : [event]) {
      const at = this.local(move, rect);
      const { x, y } = this.lock?.apply(at.x, at.y, move.shiftKey) ?? at;
      this.session.move(x, y, this.pressure(move));
    }
    event.preventDefault();
  };

  private onUp = (event: PointerEvent): void => {
    this.nav.up(event);
    if (this.hold.waiting(event.pointerId)) this.hold.disarm();

    if (event.pointerType === "touch" && event.pointerId !== this.sessionPointer) {
      const tap = this.fingerDown;
      this.fingerDown = null;
      // A finger tapped on the surface lets go of what a hold caught, and
      // gives back the tool the Lasso was borrowed from.
      if (tap?.id === event.pointerId && event.timeStamp - tap.at < TAP_MS && this.borrowed) {
        this.select([]);
        this.callbacks.onSelect([]);
        this.giveBack();
      }
      return;
    }

    if (event.pointerId !== this.sessionPointer) return;
    if (this.root.hasPointerCapture(event.pointerId)) {
      this.root.releasePointerCapture(event.pointerId);
    }
    this.endSession();
  };

  private onWheel = (event: WheelEvent): void => {
    // A scroll moves the camera, so the canvas under the ink has to draw again.
    if (this.session) setInking(this, false);
    this.nav.wheel(event);
  };

  private endSession(): void {
    this.hold.disarm();
    setInking(this, false);
    // Let go first: what an end reports can reach `setTool`, which ends this.
    const session = this.session;
    this.session = null;
    this.sessionPointer = null;
    session?.end();
    this.working = null;
  }
}
