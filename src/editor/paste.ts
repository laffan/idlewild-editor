/**
 * Pasting an image into the canvas.
 *
 * The clipboard is already one of Add Image's three routes, but reaching it
 * meant opening a sheet and choosing it — and everything else in this editor
 * that could be a gesture is one. A paste is an import: the bytes become a
 * PSD, go through psd-to-json, and land in the middle of what you are looking
 * at, on the layer you are working on.
 *
 * The browser's own `paste` event is what this listens for, rather than
 * `navigator.clipboard.read()`. The event carries the data with it, so there
 * is no permission prompt and nothing to fall back on. Reading the clipboard
 * cold is what the Add Image sheet does, because there no paste has happened.
 */

import { psd } from "../lib/ipc";
import type { ImportResult } from "../lib/ipc";
import * as log from "../lib/log";

export interface PasteCallbacks {
  /** Whether a paste should be taken at all — false in play mode. */
  enabled: () => boolean;
  /** The bytes became a PSD and went through the pipeline. */
  onImported: (result: ImportResult) => void;
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
export function listenForPaste(
  projectId: string,
  callbacks: PasteCallbacks,
): () => void {
  const onPaste = (event: ClipboardEvent) => {
    if (!callbacks.enabled() || isTyping(event.target)) return;

    const file = imageFrom(event.clipboardData);
    if (!file) return;

    // Taken: the page must not also try to paste it somewhere.
    event.preventDefault();
    void importPasted(projectId, file, callbacks.onImported);
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

async function importPasted(
  projectId: string,
  file: File,
  onImported: (result: ImportResult) => void,
): Promise<void> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // No marks: a paste has no grid selection behind it, so the artwork is
    // centred on the space it lands on — which the shell picks as the middle
    // of the view.
    const result = await psd.importBytes(projectId, pasteName(file), toBase64(bytes));
    log.info(`Pasted ${result.key} (${result.width}×${result.height})`);
    onImported(result);
  } catch (err) {
    log.error("Could not paste that:", err);
  }
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

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
