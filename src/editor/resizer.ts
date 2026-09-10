/**
 * Draggable dividers for the sidebars and the console drawer.
 *
 * Ported in spirit from Phaser Bench's `layout.js`, with pointer events
 * instead of mouse events so a finger and an Apple Pencil work the same.
 * Sizes persist per-install in localStorage — they are a per-viewer
 * convenience, not project state.
 */

const STORAGE_PREFIX = "idlewild.layout.";

export type ResizeAxis = "width" | "height";

export interface ResizerOptions {
  /** The element being resized. */
  target: HTMLElement;
  axis: ResizeAxis;
  /** Which side of the target the handle sits on. */
  edge: "start" | "end";
  min: number;
  max: number;
  /** localStorage key suffix; omit to skip persistence. */
  storageKey?: string;
  onResize?: (size: number) => void;
}

export interface Resizer {
  handle: HTMLElement;
  /** Apply the stored size, or the element's current one. */
  restore: () => void;
  destroy: () => void;
}

export function createResizer(options: ResizerOptions): Resizer {
  const { target, axis, edge, min, max } = options;

  const handle = document.createElement("div");
  handle.className = `resize-handle ${axis === "width" ? "vertical" : "horizontal"}`;
  handle.setAttribute("role", "separator");
  handle.setAttribute(
    "aria-orientation",
    axis === "width" ? "vertical" : "horizontal",
  );
  handle.tabIndex = 0;

  const clamp = (value: number) => Math.max(min, Math.min(max, value));

  const apply = (size: number, persist: boolean) => {
    const next = clamp(size);
    target.style[axis] = `${next}px`;
    if (persist && options.storageKey) {
      try {
        localStorage.setItem(STORAGE_PREFIX + options.storageKey, String(next));
      } catch {
        // Private browsing and blocked site data both throw here; the layout
        // simply falls back to its default next time.
      }
    }
    options.onResize?.(next);
  };

  let startPointer = 0;
  let startSize = 0;
  let dragging = false;

  const onDown = (event: PointerEvent) => {
    if (!event.isPrimary) return;
    dragging = true;
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("dragging");
    startPointer = axis === "width" ? event.clientX : event.clientY;
    startSize =
      axis === "width" ? target.offsetWidth : target.offsetHeight;
    event.preventDefault();
  };

  const onMove = (event: PointerEvent) => {
    if (!dragging) return;
    const current = axis === "width" ? event.clientX : event.clientY;
    // A handle on the start edge grows the target as the pointer moves back.
    const delta =
      edge === "start" ? startPointer - current : current - startPointer;
    apply(startSize + delta, false);
    event.preventDefault();
  };

  const onUp = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    handle.releasePointerCapture(event.pointerId);
    handle.classList.remove("dragging");
    apply(axis === "width" ? target.offsetWidth : target.offsetHeight, true);
  };

  // Keyboard resizing, so the divider is not pointer-only.
  const onKey = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 40 : 12;
    const grow = axis === "width" ? "ArrowRight" : "ArrowDown";
    const shrink = axis === "width" ? "ArrowLeft" : "ArrowUp";
    if (event.key !== grow && event.key !== shrink) return;
    const direction = event.key === grow ? 1 : -1;
    const sign = edge === "start" ? -direction : direction;
    const size = axis === "width" ? target.offsetWidth : target.offsetHeight;
    apply(size + sign * step, true);
    event.preventDefault();
  };

  handle.addEventListener("pointerdown", onDown);
  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onUp);
  handle.addEventListener("pointercancel", onUp);
  handle.addEventListener("keydown", onKey);

  const restore = () => {
    if (!options.storageKey) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_PREFIX + options.storageKey);
    } catch {
      stored = null;
    }
    const size = Number(stored);
    if (Number.isFinite(size) && size > 0) apply(size, false);
  };

  return {
    handle,
    restore,
    destroy: () => {
      handle.removeEventListener("pointerdown", onDown);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      handle.removeEventListener("keydown", onKey);
      handle.remove();
    },
  };
}
