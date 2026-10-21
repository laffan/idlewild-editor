/**
 * Changing a file in the project's code from outside the code panel.
 *
 * Everything the editor writes into code it does not own — a placement as it
 * is placed, a reset, a dragged sprite's numbers, a renamed PSD — goes through
 * here, so it lands the same way: through the panel when the panel has the
 * file open, as one minimal change, so the history and the caret survive and
 * the panel's own save runs; straight to disk when it does not. One change at
 * a time, in the order asked for.
 */

import type { EditorView } from "@codemirror/view";
import { gameFiles } from "../lib/ipc";
import * as log from "../lib/log";
import type { CodePanel } from "./code-panel";
import type { GameFrame } from "./game-frame";

export interface CodeEditDeps {
  projectId: string;
  code: CodePanel;
  gameFrame: GameFrame;
}

export interface CodeEditor {
  /**
   * Change one file and save it. A running game restarts on a write to disk
   * unless `restart` is false — for a caller changing several files at once,
   * which restarts it once itself. Resolves true when the file changed.
   */
  edit: (
    path: string,
    change: (text: string) => string | null,
    options?: { restart?: boolean },
  ) => Promise<boolean>;
}

export function createCodeEditor(deps: CodeEditDeps): CodeEditor {
  const { projectId, code, gameFrame } = deps;
  let queue: Promise<unknown> = Promise.resolve();

  return {
    edit(path, change, options = {}) {
      const run = queue.then(async () => {
        const open = code.editing;
        if (open?.path === path) {
          if (!replaceIn(open.view, change(open.view.state.doc.toString()))) return false;
          await code.save();
          return true;
        }
        const text = await gameFiles.read(projectId, path).catch(() => null);
        const next = text === null ? null : change(text);
        if (next === null || next === text) return false;
        await gameFiles.write(projectId, path, next);
        if (options.restart !== false && gameFrame.isRunning) gameFrame.reload();
        return true;
      });
      queue = run.catch(() => false);
      return run.catch((err) => {
        log.error(`Could not update ${path}:`, err);
        return false;
      });
    },
  };
}

/**
 * Put `next` into an editor as the one change between it and what is there,
 * so the caret and the history move as little as they can. False when there
 * is nothing to change.
 */
export function replaceIn(view: EditorView, next: string | null, caret?: number): boolean {
  const text = view.state.doc.toString();
  if (next === null || next === text) return false;
  let from = 0;
  while (from < text.length && from < next.length && text[from] === next[from]) from++;
  let end = 0;
  while (
    end < text.length - from &&
    end < next.length - from &&
    text[text.length - 1 - end] === next[next.length - 1 - end]
  ) {
    end++;
  }
  view.dispatch({
    changes: { from, to: text.length - end, insert: next.slice(from, next.length - end) },
    ...(caret !== undefined ? { selection: { anchor: caret } } : {}),
  });
  return true;
}
