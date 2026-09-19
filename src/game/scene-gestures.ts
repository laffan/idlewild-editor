/**
 * Who gets a touch on the canvas, and in what order.
 *
 * `Docs/gestures.md` is the long version; this is the table it describes. One
 * surface has five things that might want a pointer — a canvas mode, a tile
 * tool, a placed file being dragged, a marquee, the camera — and the whole of
 * the arbitration is which of them is asked first.
 *
 * **The order is the rule, and it is a precedence rather than a switch.**
 * Each layer of it answers *yes I took that* or falls through:
 *
 * 1. **A canvas mode**, if one is up. Extrude, collider, mask and PSD Edit
 *    take the canvas over outright — while one is up there is nothing else on
 *    the canvas to act on, so it is asked at every stage of every gesture.
 * 2. **A tile tool**, if one is in hand over a tile layer. A sweep with a
 *    tile picked is what the gesture means; a marquee there would be a box
 *    round ground that has nothing on it to select.
 * 3. **A drag** of whatever is already selected, which is what makes the
 *    finger that is on something move it.
 * 4. **Everything else**: a marquee, a pan, a pinch, which are the rig's own.
 *
 * Lifted out of `world-scene.ts` when it reached its seven hundred lines, and
 * it lifts cleanly — the scene keeps the handlers and this keeps the order.
 */

import type { Modifiers, RigEvents } from "./camera-rig";

/** What the order above is arbitrating between. */
export interface GestureHost {
  /** Whether the canvas is the thing in front of the user — false in Code
   *  and Play, where the project's own game is in a frame over it. */
  editing: () => boolean;
  tap: (screenX: number, screenY: number, adding: boolean) => void;
  doubleTap: (screenX: number, screenY: number) => void;
  /** Each of the three that can claim a drag, in the order they are asked. */
  modes: {
    beginDrag: (x: number, y: number) => boolean;
    moveDrag: (x: number, y: number) => boolean;
    endDrag: () => boolean;
  };
  tiles: {
    begin: (x: number, y: number) => boolean;
    move: (x: number, y: number) => boolean;
    end: () => boolean;
  };
  drag: {
    begin: (x: number, y: number, modifiers: Modifiers) => boolean;
    move: (x: number, y: number) => void;
    end: () => void;
  };
  marquee: {
    begin: (x: number, y: number, fromHold: boolean) => void;
    extend: (x: number, y: number) => void;
    end: () => void;
  };
  camera: {
    pan: (dx: number, dy: number) => void;
    zoomBy: (factor: number, cx: number, cy: number) => void;
    persist: () => void;
  };
}

export function sceneGestures(host: GestureHost): RigEvents {
  return {
    // ⌘ and ⇧ both mean *and this one as well*, which is the same gesture as
    // ⌘-clicking a row in the layer panel.
    onTap: (x, y, modifiers) => host.tap(x, y, modifiers.meta || modifiers.shift),
    onDoubleTap: (x, y) => host.doubleTap(x, y),
    onDragStart: (x, y, modifiers) =>
      host.editing() &&
      (host.modes.beginDrag(x, y) ||
        host.tiles.begin(x, y) ||
        host.drag.begin(x, y, modifiers)),
    onDragMove: (x, y) => {
      if (host.modes.moveDrag(x, y) || host.tiles.move(x, y)) return;
      host.drag.move(x, y);
    },
    onDragEnd: () => {
      if (host.modes.endDrag() || host.tiles.end()) return;
      host.drag.end();
    },
    onMarqueeStart: (x, y, fromHold) => host.marquee.begin(x, y, fromHold),
    onMarqueeMove: (x, y) => host.marquee.extend(x, y),
    onMarqueeEnd: () => host.marquee.end(),
    onPan: (dx, dy) => host.camera.pan(dx, dy),
    onZoom: (factor, cx, cy) => host.camera.zoomBy(factor, cx, cy),
    onChange: () => host.camera.persist(),
  };
}
