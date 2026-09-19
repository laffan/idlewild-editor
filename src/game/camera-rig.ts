/**
 * The single gesture arbiter over the game canvas.
 *
 * The spec's edit-mode contract: one finger pans, two fingers zoom, holding
 * starts a grid selection, a tap selects. Because the drawing layer will sit
 * on top of this with its own engine, all pointer routing lives here and is
 * handed out as high-level events rather than being read in three places.
 */

export type RigPhase = "idle" | "pan" | "pinch" | "marquee" | "drag";

/**
 * What a one-finger drag on empty space does.
 *
 * The rail's tools, as the arbiter sees them. It used to be neither: a drag
 * always panned and only a hold started a selection, which made Select and
 * Pan the same tool with a delay between them and left no way to rubber-band
 * over several things at once.
 *
 * **Point** is a mode here even though nothing about a *drag* is different
 * under it, because two things about a drag are: there is no rubber band to
 * pull, and there is nothing to ask for by holding still. A tool whose whole
 * gesture is the tap should leave the other hand free, so a drag under it
 * moves the camera exactly as Pan does — and what the tap then means is the
 * scene's to decide, not this one's.
 *
 * **Tile** is here for the second half of that and not the first. A tile tool
 * claims the drag outright — the scene's `onDragStart` takes it before
 * anything else below a canvas mode — so what this mode is really saying is
 * *no marquee and no hold*: a box dragged round ground that has nothing on it
 * to select would be a gesture with no meaning, and a hold would open one
 * half a second into every sweep. See `game/tile-paint.ts`.
 */
export type RigMode = "select" | "pan" | "point" | "text" | "tile";

/**
 * What was held when the gesture began.
 *
 * One record for a drag and a tap, because they are the same question asked of
 * the same event — and keeping two would be two places to forget a key. A drag
 * reads `alt` and `shift`; a tap reads `shift` and `meta`. See
 * `game/world-scene.ts` for what each means where.
 */
export interface Modifiers {
  alt: boolean;
  shift: boolean;
  /** ⌘, or Ctrl standing in for it on a keyboard that has no Command key. */
  meta: boolean;
}

/** What was held when the drag began. The older name for the same record. */
export type DragModifiers = Modifiers;

export interface RigEvents {
  /**
   * A tap that did not turn into a pan, hold or pinch.
   *
   * The modifiers ride along for the reason they do on a drag: ⌘ and ⇧ change
   * what the tap *means* — adding to the selection rather than replacing it —
   * and only the scene knows what is selected to add to.
   */
  onTap: (screenX: number, screenY: number, modifiers: Modifiers) => void;
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
  /**
   * A selection box has started.
   *
   * `fromHold` says which of the two ways it began: a finger held still, or a
   * drag under the Select tool. They produce the same selection, and the
   * difference is what the editor makes of it — a held selection is somebody
   * asking for this much space and gets the action bar, a dragged one is
   * somebody reaching for what is inside it and does not.
   */
  onMarqueeStart: (screenX: number, screenY: number, fromHold: boolean) => void;
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
  /** What a drag on empty space means: the rail's tool, or space held down. */
  private mode: RigMode = "select";

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

  /**
   * Say what a drag means from here on.
   *
   * Changing it mid-gesture would be a surprise — a pan that turns into a
   * marquee halfway across the canvas — so it takes effect on the next
   * pointer-down, which is also what makes holding space feel like borrowing
   * the Pan tool rather than fighting the one already in use.
   */
  setMode(mode: RigMode): void {
    this.mode = mode;
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
      this.events.onDragStart(event.clientX, event.clientY, modifiersOf(event))
    ) {
      this.phase = "drag";
      this.dragMoved = false;
      return;
    }

    // A hold still opens a selection where the finger already is, so a single
    // space can be picked without dragging out a box around it. Under Pan and
    // Point there is nothing to hold for.
    if (this.mode === "select") {
      this.holdTimer = window.setTimeout(() => {
        this.holdTimer = null;
        this.phase = "marquee";
        this.events.onMarqueeStart(this.startX, this.startY, true);
      }, HOLD_MS);
    }
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
      this.clearHold();
      if (this.mode === "select") {
        // Straight into the box, from where the finger went down rather than
        // from where it is now — otherwise the first few pixels of every
        // marquee are lost and a small one selects nothing.
        this.phase = "marquee";
        this.events.onMarqueeStart(this.startX, this.startY, false);
        this.events.onMarqueeMove(event.clientX, event.clientY);
        this.lastX = event.clientX;
        this.lastY = event.clientY;
        return;
      }
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

    // What counts as a tap depends on the tool. Under Select it is a hold
    // that never got to fire — the timer was still pending, so the finger
    // neither moved nor stayed. Under Point and Text there is no hold to wait
    // on and the tap *is* the gesture, so a pointer that went down and came up
    // without becoming a pan is one. Pan reports none at all: the camera tool
    // picks nothing up, which is what makes it safe to hold space over
    // anything.
    const wasPending = this.holdTimer !== null;
    this.clearHold();
    const tapped =
      this.phase === "idle" &&
      (wasPending || this.mode === "point" || this.mode === "text");
    if (tapped) this.reportTap(event);
    this.phase = "idle";
  };

  private reportTap(event: PointerEvent): void {
    this.events.onTap(event.clientX, event.clientY, modifiersOf(event));
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

/**
 * What was held down, off the event that reported it.
 *
 * Ctrl stands in for ⌘ the way it does for undo in `editor/shortcuts.ts`: a
 * keyboard with no Command key is not locked out of the editor's own gestures.
 * Read at the moment of the press rather than tracked, because a key let go of
 * halfway through a gesture never changed what the gesture was.
 */
function modifiersOf(event: PointerEvent): Modifiers {
  return {
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey || event.ctrlKey,
  };
}
