/**
 * Fingers on the drawing surface: one pans, two pan and pinch — and the
 * wheel, which is the same two things from a mouse or a trackpad.
 *
 * Fingers never draw (see `drawing-layer.ts`), so everything a touch does
 * here is navigation, handed to the game camera in screen pixels so the two
 * layers move together. Split out of the layer when it reached its seven
 * hundred lines; nothing in it knows about tools.
 *
 * Every pointer is counted, the pen's included, because a finger landing
 * while the pen is down is the second of two and starts a pinch.
 */

export interface TouchNavCallbacks {
  onPan: (dxScreen: number, dyScreen: number) => void;
  onZoom: (factor: number, screenX: number, screenY: number) => void;
}

export class TouchNav {
  private readonly root: HTMLElement;
  private readonly callbacks: TouchNavCallbacks;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchSpread = 0;
  private lastPanX = 0;
  private lastPanY = 0;

  constructor(root: HTMLElement, callbacks: TouchNavCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
  }

  /** How many pointers are down, of any kind. */
  get count(): number {
    return this.pointers.size;
  }

  down(event: PointerEvent): void {
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (event.pointerType !== "touch") return;
    if (this.pointers.size === 2) {
      this.pinchSpread = this.spread();
    } else if (this.pointers.size === 1) {
      this.lastPanX = event.clientX;
      this.lastPanY = event.clientY;
    }
  }

  /** A finger moved: navigate. False for a pointer this never saw go down. */
  move(event: PointerEvent): boolean {
    if (!this.pointers.has(event.pointerId)) return false;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.navigate();
    return true;
  }

  up(event: PointerEvent): void {
    this.pointers.delete(event.pointerId);
    if (event.pointerType !== "touch") return;
    if (this.pointers.size === 1) {
      // Keep panning with whichever finger is left rather than stalling.
      const [remaining] = [...this.pointers.values()];
      this.lastPanX = remaining.x;
      this.lastPanY = remaining.y;
    }
    this.pinchSpread = 0;
  }

  /**
   * Stop following a finger without it having come up — it has been handed
   * to a tool (a held finger lassos; see `hold-lasso.ts`).
   */
  forget(pointerId: number): void {
    this.pointers.delete(pointerId);
  }

  /** A scroll or a trackpad pinch, which WebKit reports as a ctrl-wheel. */
  wheel(event: WheelEvent): void {
    event.preventDefault();
    const rect = this.root.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (event.ctrlKey || event.metaKey) {
      this.callbacks.onZoom(Math.exp(-event.deltaY / 220), x, y);
    } else {
      this.callbacks.onPan(-event.deltaX, -event.deltaY);
    }
  }

  private navigate(): void {
    if (this.pointers.size >= 2) {
      const spread = this.spread();
      const centre = this.centre();
      if (this.pinchSpread > 0 && spread > 0) {
        // From the sheet's corner, as the wheel's is: the camera zooms about
        // a point on the canvas, and `centre` is on the page.
        const rect = this.root.getBoundingClientRect();
        this.callbacks.onZoom(spread / this.pinchSpread, centre.x - rect.left, centre.y - rect.top);
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
