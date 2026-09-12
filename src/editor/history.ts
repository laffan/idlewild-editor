/**
 * Undo and redo, as the shell presents them: two buttons in the header, two
 * keystrokes, and the question of which of two histories a press means.
 *
 * There are two, and they are genuinely separate. The document's is a stack
 * of `GameDoc` snapshots (`lib/doc-history.ts`); the code editor's is
 * CodeMirror's own, per open file, and it has always been there over ⌘Z. What
 * did not exist is a rule for which one a press reaches — and with the code
 * panel pinned, both are on screen at once.
 *
 * **The rule is where you last worked.** Type in the editor and ⌘Z is the
 * editor's; touch the canvas, a panel or a sheet and it is the document's.
 * That is what a person means by it: undo acts on the thing you are working
 * in. The header itself is excluded from the reckoning, or pressing the
 * button would count as working in the header and make the *next* press mean
 * something else — and the buttons swallow their own `mousedown` so a press
 * does not take the caret out of the editor either. Closing the code panel
 * hands it back to the document.
 *
 * Read from two events rather than one, because half the editor cannot take
 * focus at all: `focusin` catches the caret moving between fields and a tab
 * through the panels, and a captured `pointerdown` catches everything else —
 * the Phaser canvas and the drawing surface are not focusable, so putting a
 * pencil on one fires no focus event of any kind and ⌘Z would go on meaning
 * the file you were last typing in.
 *
 * The keyboard half is in `shortcuts.ts` with the rest of the editor's keys;
 * this is what it calls. ⌘Z inside CodeMirror never reaches either, because
 * the content is `contenteditable` and `isTyping` stands the global handler
 * down — CodeMirror's own keymap has it, and it is the same history this
 * would have reached. The buttons are the path that has to be explicit, since
 * a press of one leaves the caret exactly where it was.
 */

import type { DocStore } from "../lib/doc-store";
import type { WorldScene } from "../game/world-scene";
import { selectionAlive } from "../lib/selection";
import * as log from "../lib/log";
import type { CodePanel } from "./code-panel";
import type { EditorHeader } from "./header";

export interface HistoryUiOptions {
  store: DocStore;
  code: CodePanel;
  header: EditorHeader;
  /** Null until the game has booted, which is after this is built. */
  scene: () => WorldScene | null;
}

export interface HistoryUi {
  undo: () => void;
  redo: () => void;
  destroy: () => void;
}

/** What the button titles call each surface. */
const CANVAS = "the canvas";
const CODE = "the open file";

export function createHistoryUi(options: HistoryUiOptions): HistoryUi {
  const { store, code, header } = options;

  /** Where a press goes. Set by where the work is, not by what is on screen. */
  let inCode = false;

  const sync = (): void => {
    // A panel that has gone takes the focus with it: the DOM the caret was in
    // is not in the document any more, and nothing is going to say so.
    if (inCode && !code.open) inCode = false;
    if (inCode) {
      header.setHistory(code.canUndo, code.canRedo, CODE);
      return;
    }
    header.setHistory(store.history.canUndo, store.history.canRedo, CANVAS);
  };

  /** Somebody worked on something. Which of the two was it? */
  const worked = (target: EventTarget | null): void => {
    if (!(target instanceof Node)) return;
    // The two buttons are not a surface. Excluding the whole header also
    // keeps the Edit/Play toggle and the menu from reassigning ⌘Z.
    if (header.root.contains(target)) return;
    const next = code.contains(target);
    if (next === inCode) return;
    inCode = next;
    sync();
  };

  const onFocusIn = (event: FocusEvent): void => worked(event.target);
  const onPointerDown = (event: PointerEvent): void => worked(event.target);

  function undo(): void {
    if (inCode && code.open) {
      if (!code.undo()) log.warn("Nothing to undo in this file");
      sync();
      return;
    }
    if (!store.history.undo()) {
      log.warn("Nothing to undo");
      return;
    }
    settle();
  }

  function redo(): void {
    if (inCode && code.open) {
      if (!code.redo()) log.warn("Nothing to redo in this file");
      sync();
      return;
    }
    if (!store.history.redo()) {
      log.warn("Nothing to redo");
      return;
    }
    settle();
  }

  /**
   * What the canvas owes a document that has just moved under it.
   *
   * The panels and the renderers re-read on `change`, which a restore fires
   * like any edit — but the *selection* is the editor's rather than the
   * document's, and it can be left naming a placement the undo has taken
   * away. The inspector would go on describing it and the overlay would
   * outline nothing, so it is dropped instead.
   */
  function settle(): void {
    const scene = options.scene();
    if (scene && !selectionAlive(store, scene.getSelection())) {
      scene.setSelection({ kind: "none" });
    }
    sync();
  }

  store.history.addEventListener("change", sync);
  code.onHistoryChange = sync;
  document.addEventListener("focusin", onFocusIn);
  // Captured, so a canvas or an overlay that stops the event on its way up
  // cannot hide where the pointer went.
  document.addEventListener("pointerdown", onPointerDown, true);
  sync();

  return {
    undo,
    redo,
    destroy: () => {
      store.history.removeEventListener("change", sync);
      code.onHistoryChange = () => {};
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("pointerdown", onPointerDown, true);
    },
  };
}
