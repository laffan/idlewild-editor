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
 * cold is what the Add Image sheet does, because there no paste has happened.
 */

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
 * The first image on the clipboard.
 *
 * `files` covers a screenshot and anything copied out of another app; `items`
 * covers the same ground on the engines that populate only that, and both are
 * cheap to ask. A PSD arrives with whatever type its platform invented for it
 * — `image/vnd.adobe.photoshop` on some, nothing at all on others — so a
 * `.psd` name is accepted on its own account.
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
 * What the pasted file is called in the project.
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

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
