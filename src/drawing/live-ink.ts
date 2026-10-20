/**
 * A stroke in flight, drawn a frame at a time rather than all over again.
 *
 * The pencil used to re-lay its whole stroke every frame: clear the box it
 * covered, run the streamline from the first sample, and stamp every stamp
 * from the first one. One frame's work was therefore the length of the line
 * so far, and the work of the stroke was its length squared — which is the
 * lag that catches up with a quick hand, because a quick hand makes a long
 * line in few frames. The box being cleared grew with it, and WebKit uploads
 * whatever a frame dirtied, so the upload grew too.
 *
 * Almost all of a stroke is settled the moment the next sample arrives. The
 * streamline is a lag filter that runs forwards — each output is the last
 * one pulled towards the next sample — so every output but the final one is
 * fixed once there is a sample after it; the final one is the pointer itself,
 * and moves. And the walk that lays stamps along the result only needs to
 * know where it left off (`StampWalk`). So the settled part is stamped once,
 * onto the live canvas, and left there. The one segment still moving — the
 * **tail**, from the last settled point to the pointer — goes on a small
 * canvas of its own over the live one (`tail-canvas.ts`), which is cleared
 * and redrawn every frame. What reaches the screen is the same stamps in the
 * same order as the whole-stroke walk lays, so the line under the pen is the
 * line `apply` stamps into the document when it lands.
 *
 * **Nothing is ever read back out of the two big canvases.** A canvas used
 * as a `drawImage` source is snapshotted whole, and these are up to four
 * thousand pixels a side — taking a copy of the few pixels under the tail
 * would cost the whole surface, every frame. That is why the tail has a
 * canvas of its own rather than a backup.
 *
 * ## The two things that are not plain ink
 *
 * **A translucent colour, or the highlighter.** The whole-stroke path laid
 * these through `composited`: stamp the stroke at full strength into a
 * scratch canvas the size of the backing and lay that down once, at the
 * colour's alpha — every frame, over the whole stroke, with the scratch as a
 * `drawImage` source. Stamped opaque and shown through the opacity of the
 * group the live and tail canvases sit in is the same picture, because they
 * hold nothing else; and a multiply onto a canvas holding nothing is a plain
 * draw, so the highlighter's live preview was only ever its alpha.
 *
 * **An opaque eraser.** Its mark is a hole in the baked canvas. Taking a
 * stamp's worth out at a time leaves `dst × (1 − a₁) × (1 − a₂) …`, which is
 * exactly what taking the whole mark out at once leaves when the colour is
 * opaque — so the settled stamps are cut straight into the baked canvas as
 * they settle, and the stroke is handed to the document as already cut
 * (`Surface.adoptAppend`) rather than put back and cut a second time. The
 * tail is not previewed: a hole cannot be drawn on a canvas of its own, and
 * it is cut when the pen comes up. It is the last fraction of one sample's
 * travel, which at a Pencil's rate is a pixel or two. A translucent eraser
 * does not have that identity — per stamp it compounds — and takes the
 * whole-stroke path.
 *
 * ## What still takes the whole-stroke path
 *
 * Smoothing, because its last stage pulls every point towards the chord
 * between the two ends, and the far end is the pointer: nothing in a
 * smoothed stroke is settled until the pen comes up. The hold that
 * straightens a stroke, for the same reason once it fires. And a Pattern
 * brush, whose lattice cells are worked out over the whole path.
 */

import type { AtlasCache } from "./atlas";
import { lerp, streamlineWeight, type InkPoint, type StreamPoint } from "./geometry";
import { STREAMLINE, stampDot, stampSegments, type StampWalk } from "./render";
import type { Surface } from "./surface";
import { alphaOf, opaqueHex } from "../lib/color";
import type { StrokeStyle } from "./types";

/** Whether a style's stroke can be drawn a frame at a time — see above. */
export function paintsIncrementally(style: StrokeStyle): boolean {
  return (
    style.paint.kind === "color" &&
    (style.mode === "ink" || style.mode === "highlight") &&
    style.smoothing <= 0 &&
    (!style.erase || alphaOf(style.color) === 1)
  );
}

export interface LiveInk {
  /** Bring the canvas up to these samples — all of them, oldest first. */
  paint(points: readonly InkPoint[]): void;
  /**
   * The stroke is over. Puts the look of the live canvas back; the caller
   * clears it, as every session does at its end. An eraser cuts what was
   * still to cut, and the answer is true: the done canvas now carries the
   * whole mark, and the stroke should go in through `Surface.adoptAppend`.
   */
  end(points: readonly InkPoint[]): boolean;
  /**
   * Hand the stroke over to the whole-stroke path mid-gesture. True when an
   * eraser has cut into the done canvas, which then has to be laid again
   * before the whole-stroke preview cuts the same mark into it.
   */
  abandon(): boolean;
}

export function liveInk(
  surface: Surface,
  atlas: AtlasCache,
  style: StrokeStyle,
): LiveInk {
  const weight = streamlineWeight(STREAMLINE);
  const { size, brushId, erase } = style;
  // How far a stamp reaches past the path: half the brush, turned, and some.
  const pad = size + 2;
  const color = opaqueHex(style.color);

  /** The streamline's settled outputs — every one but the pointer's. */
  const stream: StreamPoint[] = [];
  /** How many raw samples the streamline has been run over. */
  let consumed = 0;
  let px = 0;
  let py = 0;
  /** Segments below this index are down for good. */
  let laid = 1;
  let walk: StampWalk = { carry: 0, index: 0 };
  /** What `surface.generation` was when the mark was laid; -1 is never. */
  let generation = -1;
  /** The whole mark's world box, for the clear that ends the stroke. */
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  if (!erase) {
    surface.setInkOpacity(alphaOf(style.color) * (style.mode === "highlight" ? 0.5 : 1));
  }

  const reach = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  const settle = (x: number, y: number, pressure: number): void => {
    stream.push({ point: [x, y], pressure });
    px = x;
    py = y;
    reach(x, y);
  };

  /**
   * Run the streamline over the samples that have stopped being the last
   * one — `streamlinePoints`, a sample at a time — and answer the pointer's
   * own point, if it is not where the settled line already ends.
   */
  const advance = (raw: readonly InkPoint[]): StreamPoint | null => {
    const n = raw.length;
    if (stream.length === 0) {
      settle(raw[0].x, raw[0].y, raw[0].pressure);
      consumed = 1;
    }
    for (; consumed < n - 1; consumed++) {
      const p = raw[consumed];
      const nx = lerp(px, p.x, weight);
      const ny = lerp(py, p.y, weight);
      if (nx === px && ny === py) continue;
      settle(nx, ny, p.pressure);
    }
    const last = raw[n - 1];
    if (n < 2 || (last.x === px && last.y === py)) return null;
    reach(last.x, last.y);
    return { point: [last.x, last.y], pressure: last.pressure };
  };

  /** Lay the settled segments not yet down, where this kind of mark goes. */
  const laySettled = (): void => {
    if (stream.length <= laid) return;
    const tinted = atlas.get(brushId, color);
    if (erase) {
      const done = surface.continueDone();
      done.save();
      done.globalCompositeOperation = "destination-out";
      stampSegments(done, stream, laid, stream.length, size, tinted, walk);
      done.restore();
      surface.endEraseFrame();
    } else {
      stampSegments(surface.continueLive(), stream, laid, stream.length, size, tinted, walk);
    }
    laid = stream.length;
  };

  return {
    paint(raw) {
      if (raw.length === 0) return;
      const end = advance(raw);

      if (surface.generation !== generation) {
        // The first frame, or the baked canvas was laid again under the mark —
        // a re-anchor moves the world as well. Clear and lay the lot, once.
        surface.beginLive();
        generation = surface.generation;
        laid = 1;
        walk = { carry: 0, index: 0 };
      }
      laySettled();
      surface.endLive({
        x: minX - pad,
        y: minY - pad,
        width: maxX - minX + pad * 2,
        height: maxY - minY + pad * 2,
      });
      if (erase) return;

      // The tail, on its own canvas, with a copy of the walk.
      const anchor = stream[stream.length - 1];
      if (!end && stream.length > 1) {
        surface.beginTail(null);
        return;
      }
      const tip = end ?? anchor;
      const tail = surface.beginTail({
        x: Math.min(anchor.point[0], tip.point[0]) - pad,
        y: Math.min(anchor.point[1], tip.point[1]) - pad,
        width: Math.abs(tip.point[0] - anchor.point[0]) + pad * 2,
        height: Math.abs(tip.point[1] - anchor.point[1]) + pad * 2,
      });
      if (!tail) return;
      const tinted = atlas.get(brushId, color);
      const loose = { ...walk };
      if (end) stampSegments(tail, [anchor, end], 1, 2, size, tinted, loose);
      else stampDot(tail, anchor, size, tinted, loose);
      tail.setTransform(1, 0, 0, 1, 0, 0);
    },

    abandon() {
      surface.setInkOpacity(1);
      surface.beginTail(null);
      return erase && laid > 1;
    },

    end(raw) {
      surface.setInkOpacity(1);
      if (!erase || raw.length === 0) return false;
      // Whatever arrived since the last frame, then the tail, cut for good —
      // the stream is now the whole of what `streamlinePoints` would give.
      const end = advance(raw);
      if (surface.generation !== generation) {
        laid = 1;
        walk = { carry: 0, index: 0 };
      }
      if (end) stream.push(end);
      if (stream.length === 1) {
        const done = surface.continueDone();
        done.save();
        done.globalCompositeOperation = "destination-out";
        stampDot(done, stream[0], size, atlas.get(brushId, color), walk);
        done.restore();
        surface.endEraseFrame();
        return true;
      }
      laySettled();
      return true;
    },
  };
}
