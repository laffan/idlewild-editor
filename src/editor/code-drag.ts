/**
 * Dragging a row of Code mode's sidebar onto the code, for the lines that
 * place it.
 *
 * A layer, a placed PSD, or one layer inside a placed PSD: pick its row up,
 * let go anywhere over the canvas area or the code panel, and the
 * `this.P2P.place` lines for it are written into the open file **at the
 * caret** — see `code/insert-snippet.ts` for why the caret and not the drop
 * point — and the file is saved, so a running game restarts with them. The lines are `code/placement-code.ts`'s, so a dragged row reads the
 * same as the scene it came from would if written out whole.
 *
 * Only a PSD to Phaser project takes them. Its scenes place their own artwork
 * in `create`, where these lines run; a Game scene draws the document from the
 * config already, and Phaser and Vanilla do not load psd-to-phaser at all.
 *
 * Pointer events rather than HTML5 drag-and-drop, for the reason the layer
 * panel gives: the iPad is a first-class target and `dragstart` never fires
 * for touch. A drag starts on a move that is more across than down, so the
 * column still scrolls under a finger moving down it — the rows say
 * `touch-action: pan-y` for exactly that.
 */

import { h } from "../lib/dom";
import * as log from "../lib/log";
import {
  barePlacement,
  declaredNames,
  piecesFor,
  placementCode,
  scenePieces,
  type CodeSource,
  type PlacementSource,
} from "../code/placement-code";
import { insertAtCaret } from "../code/insert-snippet";
import type { CodePanel } from "./code-panel";

export type { CodeSource };

export interface CodeDragDeps {
  /** Whether the project's scenes take placement code — PSD to Phaser. */
  takesCode: boolean;
  source: () => PlacementSource;
  code: () => CodePanel | null;
  /** Told once a drop has been written and saved. */
  afterDrop?: () => void;
  /** Where a drop counts: the canvas area, and the code panel itself. */
  targets: () => ReadonlyArray<Element | null>;
}

/** How far a pointer travels before a press becomes a drag, in CSS pixels. */
const THRESHOLD = 8;

/** Make a row draggable onto the code. Does nothing on a project that does not take it. */
export function attachCodeDrag(row: HTMLElement, source: CodeSource, label: string, deps: CodeDragDeps): void {
  if (!deps.takesCode) return;
  row.classList.add("code-draggable");
  row.addEventListener("pointerdown", (down) => {
    if (down.button !== 0) return;
    const startX = down.clientX;
    const startY = down.clientY;
    let ghost: HTMLElement | null = null;

    const move = (event: PointerEvent) => {
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!ghost) {
        if (Math.hypot(dx, dy) < THRESHOLD) return;
        // Down the column is a scroll, not a drag.
        if (Math.abs(dy) > Math.abs(dx)) return finish();
        ghost = h("div", { class: "code-drag-ghost", text: label });
        document.body.append(ghost);
        document.body.classList.add("code-dragging");
        try {
          row.setPointerCapture(event.pointerId);
        } catch {
          // A pointer that has already gone; the window listeners still hear it.
        }
      }
      event.preventDefault();
      ghost.style.transform = `translate(${event.clientX + 12}px, ${event.clientY + 8}px)`;
    };

    const up = (event: PointerEvent) => {
      const dragged = ghost !== null;
      finish();
      if (!dragged) return;
      // The click that follows a drag is not a tap on the row.
      row.addEventListener("click", (click) => click.stopImmediatePropagation(), {
        capture: true,
        once: true,
      });
      const over = document.elementFromPoint(event.clientX, event.clientY);
      if (over && deps.targets().some((target) => target?.contains(over))) drop(source, deps);
    };

    const finish = () => {
      ghost?.remove();
      ghost = null;
      document.body.classList.remove("code-dragging");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", finish);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", finish);
  });
}

/** Write the lines for `source` at the caret of the open file. */
function drop(source: CodeSource, deps: CodeDragDeps): void {
  const editing = deps.code()?.editing;
  if (!editing) {
    log.warn("Open a scene file and put the caret where the lines should go, then drop it there.");
    return;
  }
  const taken = declaredNames(editing.view.state.doc.toString());
  const pieces = piecesFor(scenePieces(deps.source()), source);
  const lines =
    pieces.length > 0
      ? placementCode(pieces, taken)
      : source.kind === "psd-layer"
        ? barePlacement(source.psdKey, source.path, taken)
        : [];
  if (lines.length === 0) {
    log.warn("Nothing on that row draws, so there is nothing to place.");
    return;
  }
  insertAtCaret(editing.view, lines);
  // Saved at once, so the game beside it restarts with the lines in it.
  void deps.code()?.save().then(() => deps.afterDrop?.());
}
