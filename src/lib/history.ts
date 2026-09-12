/**
 * Undo and redo, as a stack of snapshots of whatever is being edited.
 *
 * Three things hold one: the document (`DocStore`), and each of the two modes
 * that take the canvas over — a solid being pulled out of the grid, and a
 * collider being painted on one. They are separate stacks because they are
 * separate pieces of work: nothing a mode does reaches the document until
 * Apply, so a press of ⌘Z inside one has to mean *that*, and the document's
 * own history has to still be there afterwards.
 *
 * Snapshots are the cheap way round precisely because of the hard rule at the
 * top of README-TECHNICAL: **values are immutable once stored**, so every
 * change already builds a new one that shares every untouched part with the
 * one before it. Remembering the previous value is a pointer copy, not a
 * clone, and a hundred of them cost about what a hundred pointers cost. That
 * is the one thing this asks of a `T` — that a change replaces it rather than
 * writing through it — and it is what the identity test in `end` reads.
 *
 * The alternative — an inverse operation per mutation — would need one for
 * each of the thirty-odd methods on `DocStore` and a fresh one for every
 * method added after, and it only pays for itself when a snapshot is
 * expensive. Here it is not.
 *
 * Three things a caller can say about a change:
 *
 * - **nothing** — it is one step, and one press of undo takes it back.
 * - **`group`** — the changes inside are one step. A drag writes on every
 *   pointer move, a dropped PSD writes once per layer inside it, and a face
 *   pulled out of a solid is rebuilt from its base on every frame of the
 *   gesture; without this, undo would walk back through a drag a pixel at a
 *   time.
 * - **`silence`** — it is not the user's edit at all. The migrations that run
 *   when a project opens are the case: an undo stack that begins with
 *   "un-repair the document you just opened" is worse than no undo.
 *
 * And one thing the *editor* can say: `clear()`, for when something has
 * happened that a snapshot cannot describe. Renaming a PSD moves a file on
 * disk, so the document as it stood before the rename names a file that is no
 * longer there — going back to it would be corruption rather than an undo.
 * Leaving a canvas mode is the same statement about a shape that no longer
 * exists. The history stops at those rather than lying about them.
 */

/** How many steps back the stack holds before it forgets the oldest. */
const HISTORY_LIMIT = 100;

export interface HistoryHost<T> {
  /** The value as it stands. */
  current(): T;
  /**
   * Put a remembered value back, doing whatever an edit does — the panels and
   * the canvas re-read on the same events either way, and a mode redraws.
   */
  restore(value: T): void;
}

/**
 * The stack. Dispatches `change` whenever what undo and redo would do has
 * moved, which is what the header's two buttons listen to.
 */
export class UndoHistory<T> extends EventTarget {
  private readonly host: HistoryHost<T>;
  private readonly limit: number;
  private readonly past: T[] = [];
  private readonly future: T[] = [];

  /** How many `group`s deep we are; only the outermost bounds a step. */
  private depth = 0;
  /** Whether the group we are in has already pushed its one entry. */
  private pushed = false;
  /** How many `silence`s deep we are. Nested, so a group inside one is quiet too. */
  private quiet = 0;
  /** Set while a restore is in flight, so it cannot record itself. */
  private restoring = false;

  constructor(host: HistoryHost<T>, limit = HISTORY_LIMIT) {
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
   * Remember where the value was, before a change moves it.
   *
   * Handed the value that is about to be replaced rather than reading one,
   * because by the time anything else could ask, the new one is already in
   * place — `DocStore.commit` is the shape of every caller.
   */
  record(before: T): void {
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
   * A group that changed nothing leaves no step behind. Usually that falls
   * out — the entry is pushed by the first change inside the group, so a
   * gesture that never wrote pushes nothing at all — but a gesture can also
   * come back to where it began, which is what a face pulled ten spaces out
   * and ten back is. The test for that is identity, which is exactly what the
   * immutability rule buys: an unchanged value is the *same object*.
   *
   * Safe to call when no group is open: a gesture can be both cancelled and
   * ended, and only the first of the two closes it.
   */
  end(): void {
    if (this.depth === 0) return;
    this.depth -= 1;
    if (this.depth > 0) return;
    if (this.pushed && this.past[this.past.length - 1] === this.host.current()) {
      this.past.pop();
      this.announce();
    }
    this.pushed = false;
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

  private apply(value: T): void {
    this.restoring = true;
    try {
      this.host.restore(value);
    } finally {
      this.restoring = false;
    }
    this.announce();
  }

  private announce(): void {
    this.dispatchEvent(new CustomEvent("change"));
  }
}
