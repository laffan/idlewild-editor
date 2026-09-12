/**
 * The editor's keyboard.
 *
 * A handful of shortcuts, and what they have in common is that all of them
 * have to stand down for a text field — which is the reason they live
 * together rather than in the places that own them.
 *
 * Space borrows the Pan tool for as long as it is held. That is what makes a
 * Select tool which no longer pans bearable: the camera is one thumb away
 * from wherever you are, and the tool comes back the moment the key is up.
 * An iPad has no space bar, which is why Pan is a rail tool as well.
 *
 * ⌘Z and ⇧⌘Z are undo and redo, on the surface the focus is in — see
 * `editor/history.ts`, which decides that and owns the two header buttons
 * that do the same thing without a keyboard. An iPad with a hardware keyboard
 * sends both exactly as a Mac does, so there is one code path; an iPad
 * without one has the buttons, which is why they exist. Control stands in for
 * ⌘ so a keyboard that has no Command key is not locked out.
 *
 * `preventDefault` matters here rather than being tidy: WKWebView takes an
 * un-prevented ⌘Z as its own editing undo, and on iPadOS that surfaces as the
 * system's Undo over whatever field was last touched.
 */

import type { ToolId } from "../lib/types";

export interface ShortcutHost {
  /** What the rail is showing now. */
  currentTool: () => ToolId;
  /** Put a tool in the pointer's hands, silently. */
  applyTool: (tool: ToolId) => void;
  /** Whether Delete has anything to act on. */
  hasSelection: () => boolean;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

/** Listen until the returned teardown is called. */
export function bindShortcuts(host: ShortcutHost): () => void {
  /**
   * The tool space is standing in for, or null when it is not held.
   *
   * Remembered rather than re-read on release, because the rail shows Pan for
   * as long as the key is down — asking it afterwards would only ever answer
   * "pan".
   */
  let borrowed: ToolId | null = null;

  const release = () => {
    if (!borrowed) return;
    host.applyTool(borrowed);
    borrowed = null;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // A field owns its own undo, and CodeMirror — which is `contenteditable`,
    // not an input — owns the code editor's through its own keymap. Both are
    // the history this would have reached anyway.
    if (isTyping(event.target)) return;

    // ⌘Z / ⇧⌘Z. `key` comes through as an upper-case Z when shift is down, so
    // the letter is compared case-insensitively and shift is read separately.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      if (event.altKey) return;
      event.preventDefault();
      if (event.shiftKey) host.onRedo();
      else host.onUndo();
      return;
    }

    // Held, not toggled: auto-repeat fires this over and over, and only the
    // first one has a tool worth remembering.
    if (event.code === "Space" && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      if (borrowed || host.currentTool() === "pan") return;
      borrowed = host.currentTool();
      host.applyTool("pan");
      return;
    }

    if (event.key !== "Delete" && event.key !== "Backspace") return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (!host.hasSelection()) return;
    event.preventDefault();
    host.onDelete();
  };

  const onKeyUp = (event: KeyboardEvent) => {
    if (event.code !== "Space" || !borrowed) return;
    event.preventDefault();
    release();
  };

  // A window that loses focus mid-hold never sees the keyup, and the rail
  // would sit on Pan until somebody pressed space again to get out of it.
  const onBlur = () => release();

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  return () => {
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
  };
}

/**
 * Whether the keyboard belongs to something else.
 *
 * Space in a layer name is a space and Delete in the code editor deletes a
 * character, so this is asked once rather than once per shortcut.
 */
export function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
