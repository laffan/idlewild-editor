/**
 * The editor's keyboard.
 *
 * Two shortcuts, and they have nothing to do with each other except that both
 * have to stand down for a text field — which is the reason they live
 * together rather than in the two places that own them.
 *
 * Space borrows the Pan tool for as long as it is held. That is what makes a
 * Select tool which no longer pans bearable: the camera is one thumb away
 * from wherever you are, and the tool comes back the moment the key is up.
 * An iPad has no space bar, which is why Pan is a rail tool as well.
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
    if (isTyping(event.target)) return;

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
