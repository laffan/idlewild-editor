/**
 * Touch gestures the shell needs. iPad-first: everything here works from
 * PointerEvents alone, so a finger, a trackpad and Apple Pencil all land in
 * the same code path.
 */

export interface LongPressOptions {
  /** Milliseconds held before firing. */
  delay?: number;
  /** Movement in CSS pixels that cancels the press. */
  tolerance?: number;
}

/**
 * Long-press, used by the home screen's rename/delete menu. Cancels on
 * movement, on a second pointer, and on pointer-up before the delay.
 */
export function onLongPress(
  el: HTMLElement,
  handler: (event: PointerEvent) => void,
  options: LongPressOptions = {},
): () => void {
  const delay = options.delay ?? 500;
  const tolerance = options.tolerance ?? 10;

  let timer: number | null = null;
  let startX = 0;
  let startY = 0;
  let fired = false;

  const cancel = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const down = (event: PointerEvent) => {
    if (!event.isPrimary) return cancel();
    fired = false;
    startX = event.clientX;
    startY = event.clientY;
    timer = window.setTimeout(() => {
      fired = true;
      timer = null;
      handler(event);
    }, delay);
  };

  const move = (event: PointerEvent) => {
    if (timer === null) return;
    if (
      Math.abs(event.clientX - startX) > tolerance ||
      Math.abs(event.clientY - startY) > tolerance
    ) {
      cancel();
    }
  };

  // A long press must not also read as a tap.
  const click = (event: MouseEvent) => {
    if (fired) {
      event.preventDefault();
      event.stopPropagation();
      fired = false;
    }
  };

  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", cancel);
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("pointerleave", cancel);
  el.addEventListener("click", click, true);

  return () => {
    cancel();
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", cancel);
    el.removeEventListener("pointercancel", cancel);
    el.removeEventListener("pointerleave", cancel);
    el.removeEventListener("click", click, true);
  };
}

/**
 * WebKit fires its own pinch-zoom gesture events on iPad, which would zoom
 * the whole app chrome. Phaser Bench suppresses these at boot; so do we.
 */
export function suppressPageZoom(): void {
  for (const name of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(name, (event) => event.preventDefault(), {
      passive: false,
    });
  }
  // Double-tap zoom slips past `touch-action` in some WebKit builds.
  let lastTouch = 0;
  document.addEventListener(
    "touchend",
    (event) => {
      const now = Date.now();
      if (now - lastTouch < 300) event.preventDefault();
      lastTouch = now;
    },
    { passive: false },
  );
}
