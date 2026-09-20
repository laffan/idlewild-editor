/**
 * Running a tidy against the editor that is open, and saying what happened.
 *
 * `tidy.ts` is Prettier and the one rule that makes using it safe here;
 * this is the half that knows there is an editor, a caret in it and a bar
 * under it. Split because `code-modal.ts` is at the line limit and because
 * the two halves fail differently: the rule is a pure function of two
 * strings, and everything below is a sequence of things to say to somebody.
 *
 * **Nothing it cannot do cleanly.** A file with no parser, a generated file
 * the editor writes end to end, and a file that does not parse are all left
 * exactly as they are — and so is one where the tidy would have reprinted a
 * line the editor owns, which is the case that would otherwise go wrong
 * quietly. Ownership is decided by the line still being one of the lines the
 * scaffold wrote, so a reprinted owned line does not break the file: it stops
 * being the editor's, silently, and the block around it starts to dissolve.
 */

import type { EditorView } from "@codemirror/view";
import { analyse, isGenerated } from "./managed-blocks";
import { managedEdit } from "./managed-view";
import { ownedLinesSurvive, tidy, tidyable } from "./tidy";

export interface TidyTarget {
  view: EditorView;
  /** The path inside `game/`: the parser, and whether the editor owns it. */
  path: string;
  /** The file as the scaffold wrote it, or null when it has no scaffold. */
  canonical: string | null;
  /** The line under the file's name in the code bar. */
  note: (text: string, clearAfterMs?: number) => void;
}

/**
 * Tidy the open file in place.
 *
 * `announce` is the difference between ⇧⌥F and a save: somebody who pressed
 * the shortcut is owed an answer either way, and a save is owed one only when
 * something it was told to do did not happen.
 */
export async function tidyInPlace(
  target: TidyTarget,
  announce: boolean,
): Promise<void> {
  const { view, path } = target;
  if (isGenerated(path)) {
    if (announce) target.note("The editor writes this file — it is already tidy.");
    return;
  }
  if (!tidyable(path)) {
    if (announce) target.note("Tidy has no formatter for this kind of file.");
    return;
  }

  const before = view.state.doc.toString();
  let after: string | null = null;
  try {
    after = await tidy(path, before);
  } catch (err) {
    // A missing brace, and a tidy is the first thing that reads the whole
    // file as code — so this is the ordinary case rather than a failure.
    // Said either way: a save that silently did not tidy would be a setting
    // nobody could tell was on.
    target.note(`Tidy: ${reason(err)}`, 6000);
    return;
  }
  if (after === null || after === before) {
    if (announce) target.note("Already tidy.");
    return;
  }

  if (!ownedLinesSurvive(before, after, analyse(path, before, target.canonical).owned)) {
    target.note("Tidy would rewrite lines the editor owns — left as it is.", 6000);
    return;
  }

  // The write goes in under `managedEdit`, as a Reset does: the filter over an
  // owned line refuses a change to it, and a reflow moves every line below the
  // first one. What makes that safe is the check above rather than the
  // annotation.
  //
  // The caret keeps its offset, clamped — the text around it has moved, and a
  // tidy that sent it to the top of the file would be a formatter nobody
  // presses twice.
  const at = Math.min(view.state.selection.main.head, after.length);
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: after },
    selection: { anchor: at },
    annotations: managedEdit.of(true),
  });
  if (announce) target.note("Tidied.");
}

/**
 * What Prettier said, in one line.
 *
 * Its message names the line and column and then draws the code under it with
 * a caret, which is three lines of a monospace diagram in a bar one line
 * tall. The first line is the sentence; the rest is for the editor to show by
 * having the caret there already.
 */
export function reason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.split("\n")[0].trim() || "could not read this file as code";
}
