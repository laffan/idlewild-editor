/**
 * Write lines into the open file at the caret, indented to match.
 *
 * What a row dragged out of the sidebar ends in: the caret is where the lines
 * go, wherever the row was let go, because a drop point over a running game
 * says nothing about where in a file the code belongs and the caret does. A
 * caret in the wrong place writes the lines in the wrong place — the person
 * moving it is the one who knows where `create` is.
 *
 * On a blank line the lines take its place; anywhere else they go on the
 * lines after it, so a drop never splits the line the caret is in.
 */

import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export function insertAtCaret(view: EditorView, lines: readonly string[]): void {
  const change = caretInsertion(view.state, lines);
  view.dispatch({
    changes: change,
    selection: { anchor: change.from + change.insert.length },
    scrollIntoView: true,
    userEvent: "input.drop",
  });
  view.focus();
}

/** Where the lines go and what is written there, for a state's caret. */
export function caretInsertion(
  state: EditorState,
  lines: readonly string[],
): { from: number; to: number; insert: string } {
  const line = state.doc.lineAt(state.selection.main.head);
  const blank = line.text.trim() === "";
  const indent = blank ? blankIndent(state, line.number, line.text) : leading(line.text);
  const body = lines.map((text) => (text ? indent + text : text)).join("\n");
  return blank
    ? { from: line.from, to: line.to, insert: body }
    : { from: line.to, to: line.to, insert: `\n${body}` };
}

/** A blank line's indent: its own, or the line above's, one deeper after `{`. */
function blankIndent(state: EditorState, number: number, own: string): string {
  if (own.length > 0) return own;
  for (let n = number - 1; n >= 1; n--) {
    const text = state.doc.line(n).text;
    if (text.trim() === "") continue;
    return leading(text) + (/[{([]\s*$/.test(text) ? "  " : "");
  }
  return "";
}

function leading(text: string): string {
  return /^\s*/.exec(text)?.[0] ?? "";
}
