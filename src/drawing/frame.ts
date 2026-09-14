/**
 * One repaint per frame, however many samples arrived in it.
 *
 * Hush's delta #24 applied to the ink itself. `getCoalescedEvents` is drained
 * on every pointer move — it is the difference between a curve and a polyline
 * on a 120 Hz Pencil against a 60 Hz frame — so a single `pointermove` hands
 * the tool two, four, sometimes eight samples. Painting on each of them
 * repainted the whole in-flight stroke that many times *inside one frame*,
 * and nothing between the first and the last was ever presented: the browser
 * composites once, so every repaint but the final one was thrown away
 * unlooked at.
 *
 * The cost of throwing it away was not nothing. A repaint of an in-flight
 * stroke is a smoothing pass over every sample so far, a streamline over the
 * result, a clear, and one `drawImage` per stamp — so the work inside a frame
 * grew with the number of coalesced samples *times* the length of the stroke.
 * That is the quadratic anyone drawing a long line was feeling, and it is why
 * it got worse the longer the line got rather than the more strokes there
 * were.
 *
 * So a session marks itself dirty and the browser decides when to look. What
 * this is **not** is a throttle: nothing is dropped, because the samples are
 * all recorded before the frame runs and the repaint reads the whole list.
 * The line under the pointer is the same line; it is drawn once.
 */

export interface FramePaint {
  /** Ask for a repaint on the next frame. Idempotent within one. */
  request(): void;
  /**
   * Repaint now, if one is pending.
   *
   * For the two moments a frame is too late: the hold timer that straightens
   * a stroke fires when nothing is moving, so nothing else would repaint it;
   * and a gesture that ends has to leave the canvas in the state the document
   * is about to be given.
   */
  flush(): void;
  /** Drop a pending repaint — the session is over, or its ink is gone. */
  cancel(): void;
}

/**
 * Wrap a paint function so it runs at most once per animation frame.
 *
 * `requestAnimationFrame` rather than a timer, because the thing being paced
 * is a repaint and the frame is exactly when a repaint is worth anything.
 * Falls back to running inline where there is no rAF, which is the test
 * environment rather than any browser this ships to.
 */
export function onFrame(paint: () => void): FramePaint {
  const raf =
    typeof requestAnimationFrame === "function" ? requestAnimationFrame : null;
  let pending = 0;
  let dirty = false;

  const run = (): void => {
    pending = 0;
    if (!dirty) return;
    dirty = false;
    paint();
  };

  return {
    request() {
      dirty = true;
      if (!raf) {
        run();
        return;
      }
      if (pending) return;
      pending = raf(run);
    },
    flush() {
      if (!dirty) return;
      if (pending && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(pending);
      }
      run();
    },
    cancel() {
      dirty = false;
      if (pending && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(pending);
      }
      pending = 0;
    },
  };
}
