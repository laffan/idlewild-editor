/**
 * What a paste puts on the canvas.
 *
 * The clipboard is already one of Add Image's three routes, but reaching it
 * meant opening a sheet and choosing it — and everything else in this editor
 * that could be a gesture is one. This half is only about the clipboard:
 * whether a paste is meant for the canvas at all, and which file on it is the
 * image. What happens to that file is `paste-actions.ts`.
 *
 * The browser's own `paste` event is what this listens for, rather than
 * `navigator.clipboard.read()`. The event carries the data with it, so there
 * is no permission prompt and nothing to fall back on. Reading the clipboard
 * cold is what the Add Image sheet does, because there no paste has happened
 * — and it is the *only* route on an iPad, where WKWebView delivers a paste
 * event only into an editable element and the canvas is never one. See
 * `editor/clipboard.ts`.
 */

import { isTyping } from "./shortcuts";

export interface PasteCallbacks {
  /** Whether a paste should be taken at all — false in play mode. */
  enabled: () => boolean;
  /** An image came off the clipboard, under the name it should be given. */
  onImage: (name: string, file: File) => void;
}

/** Anything the pipeline can turn into a PSD, which is everything it decodes. */
const IMAGE_TYPE = /^image\//;

/**
 * Take pastes on the document until the returned teardown is called.
 *
 * Ignored while the caret is in a field — a layer name, a numeric input, the
 * code editor — because there a paste means paste, and the code editor in
 * particular is a whole text editor that would otherwise never receive one.
 */
export function listenForPaste(callbacks: PasteCallbacks): () => void {
  const onPaste = (event: ClipboardEvent) => {
    if (!callbacks.enabled() || isTyping(event.target)) return;

    const file = imageFrom(event.clipboardData);
    if (!file) return;

    // Taken: the page must not also try to paste it somewhere.
    event.preventDefault();
    callbacks.onImage(pasteName(file), file);
  };

  document.addEventListener("paste", onPaste);
  return () => document.removeEventListener("paste", onPaste);
}

/**
 * The first image on a `DataTransfer` — a paste's, or a drop's.
 *
 * `files` covers a screenshot and anything copied out of another app; `items`
 * covers the same ground on the engines that populate only that, and both are
 * cheap to ask. A PSD arrives with whatever type its platform invented for it
 * — `image/vnd.adobe.photoshop` on some, nothing at all on others — so a
 * `.psd` name is accepted on its own account.
 *
 * A drop reads the same question off the same object, so `editor/drop.ts`
 * asks this rather than deciding again what counts as an image.
 */
export function imageFrom(data: DataTransfer | null): File | null {
  if (!data) return null;

  const wanted = (file: File | null): file is File =>
    !!file && (IMAGE_TYPE.test(file.type) || /\.psd$/i.test(file.name));

  for (const file of data.files) {
    if (wanted(file)) return file;
  }
  for (const item of data.items) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (wanted(file)) return file;
  }
  return null;
}

/**
 * What a pasted or dropped file is called in the project.
 *
 * A file copied out of Finder brings a name worth keeping; a screenshot on
 * the clipboard is `image.png` on every platform, and a project full of
 * `image`, `image-2`, `image-3` is worse than a timestamp nobody reads.
 */
export function pasteName(file: File): string {
  const stem = (file.name.split(/[\\/]/).pop() ?? "")
    .replace(/\.[^.]+$/, "")
    .trim();
  const anonymous = stem === "" || stem.toLowerCase() === "image";
  return anonymous ? `pasted-${Date.now().toString(36)}` : stem;
}

/** What ⌘V asks for where no paste event is coming. */
export interface PasteShortcutCallbacks {
  enabled: () => boolean;
  /** Go and read the clipboard, as *Paste Image* in the menu does. */
  onPaste: () => void;
}

/**
 * ⌘V as a keyboard shortcut rather than as a paste.
 *
 * On iPadOS the `paste` event above never arrives: WKWebView runs the Paste
 * editing command only against an editable element, and the canvas is never
 * one, so ⌘V over the canvas produces no event and — before this — did
 * nothing at all. The *keydown* is a different matter: WebKit dispatches key
 * events to the page before it decides what they mean, editable target or
 * not, so the keystroke is there to be read even though the paste is not.
 *
 * Which is enough, because the data never came from the event on that
 * platform anyway. The shell reads the pasteboard, and this only has to say
 * when to ask — the same thing the menu item says.
 *
 * Bound only where that is true. On a Mac the paste event arrives carrying
 * the file, which is strictly better than going and asking for it, and
 * binding both would import the same image twice.
 */
export function listenForPasteShortcut(
  callbacks: PasteShortcutCallbacks,
): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (!isPasteShortcut(event)) return;
    if (!callbacks.enabled() || isTyping(event.target)) return;

    event.preventDefault();
    callbacks.onPaste();
  };

  document.addEventListener("keydown", onKeyDown);
  return () => document.removeEventListener("keydown", onKeyDown);
}

/** Whether a keystroke is that shortcut, modifiers and repeats included. */
export function isPasteShortcut(event: KeyboardEvent): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return false;
  // Held down, ⌘V repeats. One press is one image.
  if (event.repeat) return false;
  // `code` is the physical key and `key` is what it produced; a keyboard laid
  // out for another language answers one of the two.
  return event.code === "KeyV" || event.key.toLowerCase() === "v";
}
