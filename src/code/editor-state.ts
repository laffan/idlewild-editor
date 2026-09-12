/**
 * The extensions a file gets in the code editor, and nothing else.
 *
 * Split from `code-modal.ts` because it is the one part of opening a file that
 * is about CodeMirror rather than about the modal: a language for the
 * extension, an undo history of its own, ⌘S, the dark theme, the design
 * system's code face, and the managed-line filter that keeps the editor's own
 * lines from being typed over.
 *
 * A **fresh state per file** rather than one across the modal: the history
 * goes with it, and undoing back past the file you are looking at into edits
 * made in another one is not a thing to want.
 *
 * Everything it has to say, it says through the callbacks. Nothing here reads
 * the modal, so the two can be understood a file at a time.
 */

import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { html as htmlLang } from "@codemirror/lang-html";
import { css as cssLang } from "@codemirror/lang-css";
import { oneDark } from "@codemirror/theme-one-dark";
import { managedExtension } from "./managed-view";

const languageCompartment = new Compartment();

export interface FileStateOptions {
  /** The path inside `game/`, which decides the language and the ownership. */
  path: string;
  content: string;
  /** The file as the scaffold wrote it, or null when it has no scaffold. */
  canonical: string | null;
  /** ⌘S, and the Save button's own route. */
  onSave: () => void;
  /** A managed block's Reset was pressed. */
  onReset: (blockId: string) => void;
  /** An edit to one of the editor's own lines was refused. */
  onRefused: () => void;
  /** The scaffold has blocks this file has never had. */
  onMissing: (ids: readonly string[]) => void;
  /** The document changed: it is dirty, and its history has moved. */
  onEdit: () => void;
  /**
   * The caret is somewhere new — a move, or a typed character, which is also
   * a move. What the reference panel follows in Automatic mode.
   */
  onCursor: () => void;
}

export function fileState(options: FileStateOptions): EditorState {
  const { path, canonical } = options;
  return EditorState.create({
    doc: options.content,
    extensions: [
      lineNumbers(),
      highlightActiveLine(),
      history(),
      keymap.of([
        {
          key: "Mod-s",
          preventDefault: true,
          run: () => {
            options.onSave();
            return true;
          },
        },
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      languageCompartment.of(languageFor(path)),
      oneDark,
      managedExtension({
        path,
        canonical,
        onReset: options.onReset,
        onRefused: options.onRefused,
        onMissing: options.onMissing,
      }),
      EditorView.updateListener.of((update) => {
        // Typing, undoing and redoing all move what the four history buttons
        // would do, and `docChanged` covers all three: an undo is a
        // transaction like any other.
        if (update.docChanged) options.onEdit();
        if (update.docChanged || update.selectionSet) options.onCursor();
      }),
      EditorView.theme({
        "&": { height: "100%" },
        // The design system's code face, not CodeMirror's default stack.
        ".cm-content, .cm-gutters": {
          fontFamily: "var(--font-mono)",
          fontSize: "13px",
        },
      }),
    ],
  });
}

function languageFor(path: string) {
  if (path.endsWith(".html")) return htmlLang();
  if (path.endsWith(".css")) return cssLang();
  return javascript();
}
