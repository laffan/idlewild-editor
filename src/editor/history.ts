/**
 * Undo and redo, as the shell presents them: two buttons in the header, two
 * keystrokes, and the question of which history a press means.
 *
 * There are several, and they are genuinely separate:
 *
 * - **the document's** — a stack of `GameDoc` snapshots on `DocStore`.
 * - **the code editor's** — CodeMirror's own, per open file. It has always
 *   been there over ⌘Z; what did not exist is a rule for when a press means
 *   it, and with the code panel pinned both surfaces are on screen at once.
 * - **the canvas mode's**, while one is up. Extrude and collider mode hold
 *   their work in their own objects until Apply, so the document's history
 *   has nothing to take back between one pull and the next: a stack that
 *   skipped over them would be a stack with a hole in it exactly where the
 *   work is.
 *
 * **The rule is where you last worked, and then what owns the canvas.** Type
 * in the editor and ⌘Z is the editor's. Otherwise it is the canvas's — and if
 * a mode owns the canvas it is that mode's, because while one is up there is
 * nothing else on the canvas to edit. Leaving the mode hands it back, with
 * the document's history exactly as the session left it.
 *
 * The header itself is excluded from the reckoning, or pressing the button
 * would count as working in the header and make the *next* press mean
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
  /** The scene, which is up by the time this is built. */
  scene: WorldScene;
}

export interface HistoryUi {
  undo: () => void;
  redo: () => void;
  destroy: () => void;
}

/**
 * All this needs of a stack: whether it can move, and moving it.
 *
 * The three it routes between hold different things — a document, a solid, a
 * set of grid spaces — and none of that reaches this far, so it asks for the
 * four members it uses rather than for `UndoHistory<something>`.
 */
interface Steppable extends EventTarget {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  undo(): boolean;
  redo(): boolean;
}

/** What the button titles call each surface. */
const CANVAS = "the canvas";
const CODE = "the open file";
const EXTRUDE = "the extrusion";
const COLLIDER = "the collider";

export function createHistoryUi(options: HistoryUiOptions): HistoryUi {
  const { store, code, header, scene } = options;
  const modes = scene.modes;

  /** Where a press goes. Set by where the work is, not by what is on screen. */
  let inCode = false;

  /**
   * The stack a press on the canvas side reaches, and what to call it.
   *
   * A mode wins over the document beneath it: while one is up there is
   * nothing else on the canvas to edit, and the document has not moved since
   * the session began. The code editor is not here because it is not one of
   * these — it is CodeMirror's own history, reached through the panel.
   */
  function canvas(): { history: Steppable; what: string } {
    const { extrude, collider } = modes;
    if (extrude.active) return { history: extrude.history, what: EXTRUDE };
    if (collider.active) return { history: collider.history, what: COLLIDER };
    return { history: store.history, what: CANVAS };
  }

  /**
   * Whether the caret is somewhere the code editor's history is the answer.
   *
   * `code.open` as well as `inCode`, because a panel that has gone takes the
   * focus with it: the DOM the caret was in is not in the page any more, and
   * nothing is going to say so.
   */
  function typing(): boolean {
    if (inCode && !code.open) inCode = false;
    return inCode;
  }

  const sync = (): void => {
    if (typing()) {
      header.setHistory(code.canUndo, code.canRedo, CODE);
      return;
    }
    const { history, what } = canvas();
    header.setHistory(history.canUndo, history.canRedo, what);
  };

  /** Somebody worked on something. Was it the code editor, or the canvas? */
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
    if (typing()) {
      if (!code.undo()) log.warn("Nothing to undo in this file");
      sync();
      return;
    }
    step("undo");
  }

  function redo(): void {
    if (typing()) {
      if (!code.redo()) log.warn("Nothing to redo in this file");
      sync();
      return;
    }
    step("redo");
  }

  /**
   * Move whichever canvas stack is in charge, and say so when it will not.
   *
   * A mode that has nothing left says so rather than falling through to the
   * document: the work underneath is not what the press meant, and Cancel is
   * how you go back past the start of a session.
   */
  function step(way: "undo" | "redo"): void {
    const { history, what } = canvas();
    if (history[way]()) {
      settle();
      return;
    }
    const inMode = what === EXTRUDE || what === COLLIDER;
    log.warn(
      inMode
        ? `Nothing to ${way} in ${what} — Cancel leaves it`
        : `Nothing to ${way}`,
    );
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
    if (!selectionAlive(store, scene.getSelection())) {
      scene.setSelection({ kind: "none" });
    }
    sync();
  }

  // Every stack this routes between, so the buttons follow whichever moved.
  const stacks: Steppable[] = [
    store.history,
    modes.extrude.history,
    modes.collider.history,
  ];
  for (const history of stacks) history.addEventListener("change", sync);
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
      for (const history of stacks) history.removeEventListener("change", sync);
      code.onHistoryChange = () => {};
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("pointerdown", onPointerDown, true);
    },
  };
}
