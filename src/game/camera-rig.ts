/**
 * The single gesture arbiter over the game canvas.
 *
 * The spec's edit-mode contract: one finger pans, two fingers zoom, holding
 * starts a grid selection, a tap selects. Because the drawing layer will sit
 * on top of this with its own engine, all pointer routing lives here and is
 * handed out as high-level events rather than being read in three places.
 */

export type RigPhase = "idle" | "pan" | "pinch" | "marquee" | "drag";

/** What was held when the drag began. */
export interface DragModifiers {
  alt: boolean;
  shift: boolean;
}

export interface RigEvents {
  /** A tap that did not turn into a pan, hold or pinch. */
  onTap: (screenX: number, screenY: number) => void;
  /**
   * A second tap in the same place, soon after the first.
   *
   * The first tap has already been reported, so this is what *follows* a
   * selection rather than replacing it: on the canvas it is what opens a
   * placed PSD up into its own layers.
   */
  onDoubleTap: (screenX: number, screenY: number) => void;
  /**
   * Asked once per pointer-down: is there a selected object under the finger
   * that should move instead of the camera? Returning true routes the gesture
   * to onDragMove / onDragEnd.
   *
   * The modifiers ride along because the answer depends on them — option
   * turns a drag into a drag of a fresh copy, and adding shift makes that
   * copy independent — and only the scene knows what a copy of the current
   * selection is.
   */
  onDragStart: (
    screenX: number,
    screenY: number,
    modifiers: DragModifiers,
  ) => boolean;
  onDragMove: (screenX: number, screenY: number) => void;
  onDragEnd: () => void;
  onMarqueeStart: (screenX: number, screenY: number) => void;
  onMarqueeMove: (screenX: number, screenY: number) => void;
  onMarqueeEnd: () => void;
  onPan: (dxScreen: number, dyScreen: number) => void;
  onZoom: (factor: number, centreX: number, centreY: number) => void;
  onChange: () => void;
}

const HOLD_MS = 320;
const MOVE_TOLERANCE = 8;
/** How long after a tap a second one still counts as a double. */
const DOUBLE_TAP_MS = 320;
/** And how far it may land from the first — a finger is not a mouse. */
const DOUBLE_TAP_PX = 24;

export class CameraRig {
  private readonly el: HTMLElement;
  private readonly events: RigEvents;
  private readonly pointers = new Map<number, { x: number; y: number }>();

  private phase: RigPhase = "idle";
  private holdTimer: number | null = null;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private pinchDistance = 0;
  /** The last tap, for deciding whether the next one doubles it. */
  private lastTap: { at: number; x: number; y: number } | null = null;
  /** Whether the drag in progress has actually gone anywhere. */
  private dragMoved = false;
  /** Set while a tool wants raw input (pencil, eraser, boundary). */
  private suspended = false;

  constructor(el: HTMLElement, events: RigEvents) {
    this.el = el;
    this.events = events;

    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onUp);
    el.addEventListener("wheel", this.onWheel, { passive: false });
  }

  destroy(): void {
    this.clearHold();
    this.el.removeEventListener("pointerdown", this.onDown);
    this.el.removeEventListener("pointermove", this.onMove);
    this.el.removeEventListener("pointerup", this.onUp);
    this.el.removeEventListener("pointercancel", this.onUp);
    this.el.removeEventListener("wheel", this.onWheel);
  }

  /** Hand raw input to another layer (the drawing engine) without tearing
   *  the rig down — camera state has to survive a tool switch. */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    if (suspended) this.reset();
  }

  get currentPhase(): RigPhase {
    return this.phase;
  }

  private reset(): void {
    this.clearHold();
    this.pointers.clear();
    if (this.phase === "marquee") this.events.onMarqueeEnd();
    if (this.phase === "drag") this.events.onDragEnd();
    this.phase = "idle";
  }

  private clearHold(): void {
    if (this.holdTimer !== null) {
      window.clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  private onDown = (event: PointerEvent): void => {
    if (this.suspended) return;
    this.el.setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size === 2) {
      // A second finger always wins: cancel any pan or pending hold.
      this.clearHold();
      if (this.phase === "marquee") this.events.onMarqueeEnd();
      if (this.phase === "drag") this.events.onDragEnd();
      this.phase = "pinch";
      this.pinchDistance = this.spread();
      return;
    }

    if (this.pointers.size > 2) return;

    this.startX = event.clientX;
    this.startY = event.clientY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.phase = "idle";

    // Dragging a selected object wins over both panning and the hold: the
    // finger is already on something the user picked.
    if (
      this.events.onDragStart(event.clientX, event.clientY, {
        alt: event.altKey,
        shift: event.shiftKey,
      })
    ) {
      this.phase = "drag";
      this.dragMoved = false;
      return;
    }

    this.holdTimer = window.setTimeout(() => {
      this.holdTimer = null;
      this.phase = "marquee";
      this.events.onMarqueeStart(this.startX, this.startY);
    }, HOLD_MS);
  };

  private onMove = (event: PointerEvent): void => {
    if (this.suspended) return;
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.phase === "pinch") {
      const spread = this.spread();
      if (this.pinchDistance > 0 && spread > 0) {
        const centre = this.centre();
        this.events.onZoom(spread / this.pinchDistance, centre.x, centre.y);
        this.events.onChange();
      }
      this.pinchDistance = spread;
      return;
    }

    if (this.phase === "marquee") {
      this.events.onMarqueeMove(event.clientX, event.clientY);
      return;
    }

    if (this.phase === "drag") {
      if (
        Math.hypot(event.clientX - this.startX, event.clientY - this.startY) >
        MOVE_TOLERANCE
      ) {
        this.dragMoved = true;
      }
      this.events.onDragMove(event.clientX, event.clientY);
      return;
    }

    const movedX = event.clientX - this.startX;
    const movedY = event.clientY - this.startY;
    if (
      this.phase === "idle" &&
      Math.hypot(movedX, movedY) > MOVE_TOLERANCE
    ) {
      // Moved before the hold matured: this is a pan, not a selection.
      this.clearHold();
      this.phase = "pan";
    }

    if (this.phase === "pan") {
      this.events.onPan(event.clientX - this.lastX, event.clientY - this.lastY);
      this.events.onChange();
    }

    this.lastX = event.clientX;
    this.lastY = event.clientY;
  };

  private onUp = (event: PointerEvent): void => {
    if (this.suspended) return;
    this.el.releasePointerCapture?.(event.pointerId);
    this.pointers.delete(event.pointerId);

    if (this.phase === "pinch") {
      // Keep panning with whichever finger is left rather than dropping input.
      if (this.pointers.size === 1) {
        const [remaining] = [...this.pointers.values()];
        this.lastX = remaining.x;
        this.lastY = remaining.y;
        this.startX = remaining.x;
        this.startY = remaining.y;
        this.phase = "pan";
      } else if (this.pointers.size === 0) {
        this.phase = "idle";
      }
      return;
    }

    if (this.phase === "marquee") {
      this.phase = "idle";
      this.events.onMarqueeEnd();
      return;
    }

    if (this.phase === "drag") {
      this.phase = "idle";
      this.events.onDragEnd();
      // A drag that never went anywhere is a tap, and has to be reported as
      // one or an object that is already selected can never be tapped again:
      // the pointer-down is claimed by the drag before the tap is considered,
      // so a second click on it would never reach `onDoubleTap`.
      if (!this.dragMoved) this.reportTap(event);
      return;
    }

    const wasPending = this.holdTimer !== null;
    this.clearHold();
    if (wasPending && this.phase === "idle") this.reportTap(event);
    this.phase = "idle";
  };

  private reportTap(event: PointerEvent): void {
    this.events.onTap(event.clientX, event.clientY);
    if (this.doublesLastTap(event)) {
      // Reported after the tap, not instead of it: the first tap picked the
      // thing, and this says what to do with what is now picked.
      this.lastTap = null;
      this.events.onDoubleTap(event.clientX, event.clientY);
    } else {
      this.lastTap = { at: Date.now(), x: event.clientX, y: event.clientY };
    }
  }

  private doublesLastTap(event: PointerEvent): boolean {
    const previous = this.lastTap;
    if (!previous) return false;
    return (
      Date.now() - previous.at <= DOUBLE_TAP_MS &&
      Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <=
        DOUBLE_TAP_PX
    );
  }

  private onWheel = (event: WheelEvent): void => {
    if (this.suspended) return;
    event.preventDefault();
    // Trackpad pinch reaches WebKit as a ctrl-wheel; a plain wheel scrolls.
    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-event.deltaY / 220);
      this.events.onZoom(factor, event.clientX, event.clientY);
    } else {
      this.events.onPan(-event.deltaX, -event.deltaY);
    }
    this.events.onChange();
  };

  private spread(): number {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private centre(): { x: number; y: number } {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return { x: 0, y: 0 };
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
}
