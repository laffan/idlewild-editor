/**
 * The shape editor's pointer and keyboard.
 *
 * The gesture vocabulary is upstream's, kept whole because it is what anybody
 * who has used a vector editor already knows: drag a point, drag a handle,
 * click an edge to drop a point into it, ⌥-click a point to turn it from a
 * corner into a curve, ⇧-click to add a path to the selection, ⌥-drag to
 * duplicate, and hold ⌘ for the resize and rotate box.
 *
 * **Every drag works from a snapshot.** The paths as they were when the
 * pointer went down are copied once, and each move applies the whole delta to
 * that copy rather than a small delta to the live one. Applying increments is
 * what makes a drag drift — rounding, a missed event, a constraint that turns
 * on halfway through — and it is why a shift held mid-drag here snaps the
 * shape to the axis it *started* on rather than to wherever it has got to.
 */

import type { Point } from "../../lib/types";
import {
  anchorAt,
  boxHandles,
  controlAt,
  edgeAt,
  handleAt,
  pathAt,
  pathBounds,
  pathsBounds,
  toPx,
  toUnit,
} from "./geometry";
import {
  commitPen,
  duplicateSelected,
  insertPoint,
  movePath,
  rotatePath,
  scalePath,
  snapshotPaths,
  toggleCurve,
} from "./ops";
import {
  capture,
  HIT_PX,
  selectPath,
  selectedPaths,
  type EditPath,
  type Grip,
  type ShapeEditorState,
} from "./state";

export interface ShapePointer {
  /** Where a click would drop a new point, or null. */
  ghost: () => Point | null;
  destroy: () => void;
}

export function bindShapePointer(
  canvas: HTMLCanvasElement,
  state: ShapeEditorState,
  redraw: () => void,
): ShapePointer {
  let grip: Grip = { kind: "none" };
  let startUnit: Point = { x: 0, y: 0 };
  let before: EditPath[] = [];
  let beforeBox = { x: 0, y: 0, width: 0, height: 0 };
  let ghost: Point | null = null;
  let moved = false;

  const local = (event: PointerEvent): Point => {
    const rect = canvas.getBoundingClientRect();
    return toUnit({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  const onDown = (event: PointerEvent): void => {
    canvas.setPointerCapture(event.pointerId);
    const at = local(event);
    startUnit = at;
    moved = false;
    ghost = null;

    // The pen takes the tap before anything else, because while it is down
    // every tap is a corner — including one that lands on an existing path,
    // which is how a shape is traced over another.
    if (state.pen) {
      const first = state.pen[0];
      const close =
        state.pen.length >= 3 &&
        first &&
        Math.hypot(toPx(first).x - toPx(at).x, toPx(first).y - toPx(at).y) <= HIT_PX;
      if (close) commitPen(state);
      else state.pen.push(at);
      grip = { kind: "none" };
      redraw();
      return;
    }

    // ⌘ shows the box; once it is showing, its handles win every hit test
    // inside the shape, which is what makes a corner handle over a corner
    // point reachable at all.
    if (event.metaKey || event.ctrlKey) state.transforming = true;
    if (state.transforming) {
      const wanted = selectedPaths(state).map((i) => state.paths[i]);
      const box = wanted.length > 1 ? pathsBounds(wanted) : pathBounds(wanted[0]);
      const handle = handleAt(box, at);
      if (handle) {
        capture(state);
        grip = handle.kind === "rotate" ? { kind: "rotate" } : handle;
        before = snapshotPaths(state.paths);
        beforeBox = box;
        redraw();
        return;
      }
    }

    const control = controlAt(state, at);
    if (control) {
      capture(state);
      grip = { kind: "control", ...control };
      before = snapshotPaths(state.paths);
      redraw();
      return;
    }

    const anchor = anchorAt(state, at);
    if (anchor) {
      if (event.altKey) {
        state.current = anchor.path;
        state.selectedPaths = new Set([anchor.path]);
        state.selectedPoints = new Set([anchor.index]);
        toggleCurve(state);
        grip = { kind: "none" };
        redraw();
        return;
      }
      if (anchor.path !== state.current) {
        state.current = anchor.path;
        state.selectedPaths = new Set([anchor.path]);
        state.selectedPoints.clear();
      }
      if (event.shiftKey) state.selectedPoints.add(anchor.index);
      else if (!state.selectedPoints.has(anchor.index)) {
        state.selectedPoints = new Set([anchor.index]);
      }
      capture(state);
      grip = { kind: "point", ...anchor };
      before = snapshotPaths(state.paths);
      redraw();
      return;
    }

    const edge = edgeAt(state, at);
    if (edge) {
      insertPoint(state, edge.path, edge.index, edge.point);
      grip = { kind: "point", path: edge.path, index: edge.index + 1 };
      before = snapshotPaths(state.paths);
      redraw();
      return;
    }

    const inside = pathAt(state, at);
    if (inside !== null) {
      selectPath(state, inside, event.shiftKey);
      if (event.altKey) duplicateSelected(state, 0, 0);
      else capture(state);
      grip = { kind: "path", path: state.current };
      before = snapshotPaths(state.paths);
      redraw();
      return;
    }

    grip = { kind: "none" };
    state.selectedPoints.clear();
    redraw();
  };

  const onMove = (event: PointerEvent): void => {
    const at = local(event);

    if (grip.kind === "none") {
      const anchor = anchorAt(state, at);
      const edge = anchor ? null : edgeAt(state, at);
      const next = edge ? edge.point : null;
      if ((next === null) !== (ghost === null) || (next && ghost && (next.x !== ghost.x || next.y !== ghost.y))) {
        ghost = next;
        redraw();
      }
      return;
    }

    moved = true;
    let dx = at.x - startUnit.x;
    let dy = at.y - startUnit.y;
    // Shift constrains a move to the axis it has travelled furthest along.
    if (event.shiftKey && (grip.kind === "point" || grip.kind === "path")) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }

    state.paths = snapshotPaths(before);

    if (grip.kind === "point") {
      const path = state.paths[grip.path];
      if (!path) return;
      // Every selected point, so a run of them moves together — and the one
      // under the pointer even if the selection is somehow empty.
      const wanted = state.selectedPoints.size > 0 ? state.selectedPoints : new Set([grip.index]);
      for (const index of wanted) {
        const vertex = path.vertices[index];
        if (!vertex) continue;
        vertex.x += dx;
        vertex.y += dy;
      }
    } else if (grip.kind === "control") {
      const vertex = state.paths[grip.path]?.vertices[grip.index];
      if (vertex) {
        const held = before[grip.path].vertices[grip.index];
        const from = grip.side === "left" ? held.ctrlLeft : held.ctrlRight;
        const next = { x: (from?.x ?? 0) + dx, y: (from?.y ?? 0) + dy };
        if (grip.side === "left") vertex.ctrlLeft = next;
        else vertex.ctrlRight = next;
        // The other side follows, mirrored, unless alt is held — which is how
        // a smooth point stays smooth and how a cusp is made.
        if (!event.altKey) {
          const opposite = { x: -next.x, y: -next.y };
          if (grip.side === "left") vertex.ctrlRight = opposite;
          else vertex.ctrlLeft = opposite;
        }
      }
    } else if (grip.kind === "path") {
      for (const index of selectedPaths(state)) movePath(state.paths[index], dx, dy);
    } else if (grip.kind === "scale") {
      applyScale(state, grip.corner, beforeBox, at, event.shiftKey);
    } else if (grip.kind === "rotate") {
      const centre = {
        x: beforeBox.x + beforeBox.width / 2,
        y: beforeBox.y + beforeBox.height / 2,
      };
      let angle =
        Math.atan2(at.y - centre.y, at.x - centre.x) -
        Math.atan2(startUnit.y - centre.y, startUnit.x - centre.x);
      if (event.shiftKey) angle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      for (const index of selectedPaths(state)) rotatePath(state.paths[index], angle, centre);
    }

    redraw();
  };

  const onUp = (): void => {
    // A drag that never moved is a click, and a click should not be an undo
    // step of its own — the snapshot taken on the way down is dropped again.
    if (!moved && (grip.kind === "point" || grip.kind === "path")) state.past.pop();
    grip = { kind: "none" };
    before = [];
    redraw();
  };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", () => {
    if (grip.kind !== "none") return;
    if (!ghost) return;
    ghost = null;
    redraw();
  });

  return {
    ghost: () => ghost,
    destroy: () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
    },
  };
}

/**
 * Drag a corner or an edge of the transform box.
 *
 * The **opposite** handle is the fixed point, which is what makes a corner
 * drag feel like a corner drag: the other three stay where they are. Shift
 * locks the ratio, taking whichever axis moved further as the one that
 * decides.
 */
function applyScale(
  state: ShapeEditorState,
  corner: number,
  box: { x: number; y: number; width: number; height: number },
  at: Point,
  lockRatio: boolean,
): void {
  const handles = boxHandles(box);
  const handle = handles[corner];
  const anchor = handles[(corner + 4) % 8];
  if (!handle || !anchor) return;

  const spanX = handle.x - anchor.x;
  const spanY = handle.y - anchor.y;
  let sx = Math.abs(spanX) < 1e-6 ? 1 : (at.x - anchor.x) / spanX;
  let sy = Math.abs(spanY) < 1e-6 ? 1 : (at.y - anchor.y) / spanY;

  if (lockRatio && Math.abs(spanX) > 1e-6 && Math.abs(spanY) > 1e-6) {
    const both = Math.abs(sx) > Math.abs(sy) ? sx : sy;
    sx = both;
    sy = both;
  }
  // A scale through zero turns the shape inside out and a scale *at* zero
  // flattens it to a line nothing can grab again.
  const floor = (value: number) => (Math.abs(value) < 0.02 ? (value < 0 ? -0.02 : 0.02) : value);
  sx = floor(sx);
  sy = floor(sy);

  for (const index of selectedPaths(state)) scalePath(state.paths[index], sx, sy, anchor);
}
