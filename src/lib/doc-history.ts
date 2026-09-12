/**
 * Undo and redo, as snapshots of the whole document.
 *
 * This is the cheap way round precisely because of the hard rule above it:
 * **document objects are immutable once stored**, so every commit already
 * builds a new `GameDoc` that shares every untouched subtree with the one
 * before it. Remembering the previous object is a pointer copy, not a clone,
 * and a hundred of them cost about what a hundred pointers cost. Hush stores
 * a stack of engine snapshots for the same reason; this is that idea against
 * a document rather than against a canvas.
 *
 * The alternative — an inverse operation per mutation — would need one for
 * each of the thirty-odd methods on `DocStore` and a fresh one for every
 * method added after, and it only pays for itself when a snapshot is
 * expensive. Here it is not.
 *
 * Three things a caller can say about a write:
 *
 * - **nothing** — it is one step, and one press of undo takes it back.
 * - **`group`** — the writes inside are one step. A drag writes on every
 *   pointer move and a dropped PSD writes once per layer inside it; without
 *   this, undo would walk back through a drag a pixel at a time.
 * - **`silence`** — it is not the user's edit at all. The migrations that run
 *   when a project opens are the case: an undo stack that begins with
 *   "un-repair the document you just opened" is worse than no undo.
 *
 * And one thing the *editor* can say: `clear()`, for when something has
 * happened that a document snapshot cannot describe. Renaming a PSD moves a
 * file on disk, so the document as it stood before the rename names a file
 * that is no longer there — going back to it would be corruption rather than
 * an undo. The history stops at those rather than lying about them.
 */

import type { GameDoc } from "./types";

/** How many steps back the stack holds before it forgets the oldest. */
const HISTORY_LIMIT = 100;

export interface HistoryHost {
  /** The document as it stands. */
  current(): GameDoc;
  /**
   * Put a remembered document back, firing whatever an edit fires — the
   * panels and the canvas re-read on the same events either way.
   */
  restore(doc: GameDoc): void;
}

/**
 * The stack. Dispatches `change` whenever what undo and redo would do has
 * moved, which is what the header's two buttons listen to.
 */
export class DocHistory extends EventTarget {
  private readonly host: HistoryHost;
  private readonly limit: number;
  private readonly past: GameDoc[] = [];
  private readonly future: GameDoc[] = [];

  /** How many `group`s deep we are; only the outermost bounds a step. */
  private depth = 0;
  /** Whether the group we are in has already pushed its one entry. */
  private pushed = false;
  /** How many `silence`s deep we are. Nested, so a group inside one is quiet too. */
  private quiet = 0;
  /** Set while a restore is in flight, so it cannot record itself. */
  private restoring = false;

  constructor(host: HistoryHost, limit = HISTORY_LIMIT) {
    super();
    this.host = host;
    this.limit = limit;
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** What is on each stack. For tests and for anything that wants to say so. */
  get depths(): { undo: number; redo: number } {
    return { undo: this.past.length, redo: this.future.length };
  }

  /**
   * Remember where the document was, before a commit moves it.
   *
   * Called by `DocStore.commit` with the state that is about to be replaced,
   * which is why the store hands it a value rather than this reading one: by
   * the time anything else could ask, the new state is already in place.
   */
  record(before: GameDoc): void {
    if (this.quiet > 0 || this.restoring) return;
    if (this.depth > 0) {
      if (this.pushed) return;
      this.pushed = true;
    }
    this.past.push(before);
    // The oldest step goes rather than the newest: the far end of the stack
    // is the one nobody is about to press.
    if (this.past.length > this.limit) this.past.shift();
    // A new edit is a new branch. Whatever was undone is not coming back.
    this.future.length = 0;
    // At most once per group: every later `record` inside one returns above.
    this.announce();
  }

  undo(): boolean {
    const previous = this.past.pop();
    if (previous === undefined) return false;
    this.future.push(this.host.current());
    this.apply(previous);
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (next === undefined) return false;
    this.past.push(this.host.current());
    this.apply(next);
    return true;
  }

  /**
   * Everything written until `end` is one step.
   *
   * Paired rather than a callback because the two ends of a drag are two
   * events: `begin` is a pointer-down and `end` is the release, and there is
   * no function that spans them. `group` is the callback form, for the
   * writes that do happen in one place.
   */
  begin(): void {
    if (this.depth === 0) this.pushed = false;
    this.depth += 1;
  }

  /**
   * Close the innermost group; the outermost one ends the step.
   *
   * A group that wrote nothing leaves no step behind, and that falls out
   * rather than being checked for: the entry is pushed by the first write
   * inside the group, so a drag that never left the space it started on
   * pushes nothing at all. Safe to call when no group is open: a gesture can
   * be both cancelled and ended, and only the first of the two closes it.
   */
  end(): void {
    if (this.depth === 0) return;
    this.depth -= 1;
    if (this.depth === 0) this.pushed = false;
  }

  /** `begin`/`end` around a call, including if it throws. */
  group<T>(run: () => T): T {
    this.begin();
    try {
      return run();
    } finally {
      this.end();
    }
  }

  /** Write without leaving a step. For migrations and boot-time repairs. */
  silence<T>(run: () => T): T {
    this.quiet += 1;
    try {
      return run();
    } finally {
      this.quiet -= 1;
    }
  }

  /**
   * Forget everything, because something happened that a snapshot cannot
   * describe — see the note at the top of this file.
   */
  clear(): void {
    if (this.past.length === 0 && this.future.length === 0) return;
    this.past.length = 0;
    this.future.length = 0;
    this.announce();
  }

  private apply(doc: GameDoc): void {
    this.restoring = true;
    try {
      this.host.restore(doc);
    } finally {
      this.restoring = false;
    }
    this.announce();
  }

  private announce(): void {
    this.dispatchEvent(new CustomEvent("change"));
  }
}
