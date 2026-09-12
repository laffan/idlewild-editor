/**
 * Where the code panel sits in the shell, and what each placement means.
 *
 * The modal itself is `code/code-modal.ts` — the file tree, the editor and the
 * reference along the bottom. What it cannot decide for itself is where in the
 * page it sits, because that is a fact about the editor's layout rather than
 * about editing code. So the modal reports the placement and this acts on it.
 *
 * There are four, and they are four different jobs:
 *
 * - **Bottom** — a row between the canvas and the console, the original dock.
 *   Code about the thing above it, with the console under both.
 * - **Left** and **right** — a column of the main row, beside the canvas. A
 *   wide screen has the room, and a file is taller than it is wide: the editor
 *   gets the height of the whole window rather than a strip of it.
 * - **Full** — over the shell, header included. A code editor wants the room,
 *   and the canvas underneath is not what you are looking at while you are
 *   reading a file end to end.
 *
 * Each is a divider on a different edge, so each remembers its own size: a
 * height for the bottom dock, a width for the two columns. The divider is
 * rebuilt on each move rather than kept, which is also what restores that
 * size.
 *
 * Code mode opens it — see `editor.ts`. Which placement it opens in is
 * remembered, and **bottom** is the answer for anyone who has not said: code
 * in this editor is code about the thing beside it, and that is the placement
 * that says so with the least moved.
 */

import { CodeModal, type CodePlacement } from "../code/code-modal";
import { createResizer, type Resizer } from "./resizer";

const PLACEMENT_KEY = "codePlacement";
/** What the panel was before there were four answers rather than two. */
const LEGACY_PINNED_KEY = "codePinned";

export interface CodePanelSlots {
  projectId: string;
  /** The editor shell: what a full-screen panel covers, and the bottom row's parent. */
  shell: HTMLElement;
  /** The console drawer. The bottom dock is the row above it. */
  beforeConsole: HTMLElement;
  /** The row holding the sidebars and the canvas: where a column dock goes. */
  main: HTMLElement;
  /** The canvas wrapper, which a column dock sits to the left or right of. */
  canvas: HTMLElement;
  /** A file in `game/` was written — the shell decides what that means. */
  onSaved?: (path: string) => void;
  /**
   * The panel's own Close was pressed.
   *
   * The shell's business rather than this one's: Code is a section, and closing
   * the panel means leaving it rather than sitting in an empty one. Without a
   * handler the panel simply takes itself down.
   */
  onClose?: () => void;
}

export class CodePanel {
  private readonly slots: CodePanelSlots;
  private modal: CodeModal | null = null;
  private resizer: Resizer | null = null;
  /**
   * What undo and redo would do in here has moved — either because the file
   * was typed in, or because the panel opened or closed and there is now a
   * different history to reach. Set by `editor/history.ts`.
   */
  onHistoryChange: () => void = () => {};

  constructor(slots: CodePanelSlots) {
    this.slots = slots;
  }

  get open(): boolean {
    return this.modal !== null;
  }

  /** Put it up, in whichever placement it was left. Safe to call twice. */
  show(): void {
    if (this.modal) return;
    const modal = new CodeModal(
      this.slots.projectId,
      () => {
        if (this.slots.onClose) this.slots.onClose();
        else this.hide();
      },
      (placement) => this.place(placement),
      this.slots.onSaved ?? (() => {}),
    );
    this.modal = modal;
    modal.onHistoryChange = () => this.onHistoryChange();
    // Appended before it is placed: a placement moves the panel into a row or
    // a column of the shell, and there has to be something to move.
    this.slots.shell.appendChild(modal.root);
    modal.setPlacement(readPlacement());
    this.onHistoryChange();
  }

  /**
   * Take it down, leaving the shell as it was. Safe to call when it is not up.
   *
   * A dirty file is written on the way out. The modal already saves when you
   * open another file in it, and leaving the section is the same kind of
   * moment: an edit that vanished because the header was pressed would be the
   * editor losing work it had been shown. `save` reads the document before it
   * awaits the write, so tearing the view down straight afterwards is safe.
   */
  hide(): void {
    void this.modal?.save();
    this.modal?.destroy();
    this.modal = null;
    this.resizer?.destroy();
    this.resizer = null;
    this.onHistoryChange();
  }

  /** The shell is going away. */
  destroy(): void {
    this.hide();
  }

  // ── the open file's history, for the two buttons in the header ────────────

  undo(): boolean {
    return this.modal?.undo() ?? false;
  }

  redo(): boolean {
    return this.modal?.redo() ?? false;
  }

  get canUndo(): boolean {
    return this.modal?.canUndo ?? false;
  }

  get canRedo(): boolean {
    return this.modal?.canRedo ?? false;
  }

  /** Whether the focus is in here, which is what decides who ⌘Z belongs to. */
  contains(node: Node | null): boolean {
    return this.modal?.contains(node) ?? false;
  }

  /** Open a file at a line, putting the panel up first if it is not. */
  openAt(path: string, line: number): void {
    this.show();
    void this.modal?.openAt(path, line);
  }

  /**
   * The document has been saved, so the generated config on disk has moved.
   * If that is what is on screen, show the new one.
   */
  refreshGenerated(): void {
    void this.modal?.refreshGenerated();
  }

  /**
   * Move the panel to one of its four places.
   *
   * Docked, the divider writes an inline `height` or `width` on the panel.
   * Over the shell, it is `position: absolute; inset: 0` — and an absolutely
   * positioned box given top, bottom *and* a height is over-constrained, so
   * the browser drops `bottom` and the panel hangs from the top of the shell at
   * whatever size it was docked at. Every move therefore takes both inline
   * sizes off first, and the new placement's divider puts its own back.
   */
  private place(placement: CodePlacement): void {
    const modal = this.modal;
    if (!modal) return;
    writePlacement(placement);

    this.resizer?.destroy();
    this.resizer = null;
    modal.root.style.removeProperty("height");
    modal.root.style.removeProperty("width");

    if (placement === "full") {
      this.slots.shell.appendChild(modal.root);
      return;
    }

    if (placement === "bottom") {
      this.resizer = createResizer({
        target: modal.root,
        axis: "height",
        edge: "start",
        min: 140,
        max: 720,
        storageKey: "codeHeight",
      });
      this.slots.shell.insertBefore(this.resizer.handle, this.slots.beforeConsole);
      this.slots.shell.insertBefore(modal.root, this.slots.beforeConsole);
      this.resizer.restore();
      return;
    }

    // A column beside the canvas. The divider sits between the two, which is
    // the panel's end edge on the left and its start edge on the right.
    const left = placement === "left";
    this.resizer = createResizer({
      target: modal.root,
      axis: "width",
      edge: left ? "end" : "start",
      min: 260,
      max: 900,
      storageKey: "codeWidth",
    });
    if (left) {
      this.slots.main.insertBefore(modal.root, this.slots.canvas);
      this.slots.main.insertBefore(this.resizer.handle, this.slots.canvas);
    } else {
      // Whatever follows the canvas is the inspector's own divider, and the
      // panel goes in front of it. `insertBefore(…, null)` appends, which is
      // the right answer if nothing follows the canvas at all.
      const after = this.slots.canvas.nextSibling;
      this.slots.main.insertBefore(this.resizer.handle, after);
      this.slots.main.insertBefore(modal.root, after);
    }
    this.resizer.restore();
  }
}

/**
 * Which placement the panel was left in.
 *
 * Bottom for anyone who has not said — and for anyone whose only answer is the
 * old pinned/floating flag, where "not pinned" was today's full screen.
 */
function readPlacement(): CodePlacement {
  try {
    const stored = window.localStorage.getItem(PLACEMENT_KEY);
    if (stored === "bottom" || stored === "left" || stored === "right") return stored;
    if (stored === "full") return "full";
    return window.localStorage.getItem(LEGACY_PINNED_KEY) === "false"
      ? "full"
      : "bottom";
  } catch {
    return "bottom";
  }
}

function writePlacement(placement: CodePlacement): void {
  try {
    window.localStorage.setItem(PLACEMENT_KEY, placement);
  } catch {
    // Private browsing, or a quota. It still moves for this session.
  }
}
