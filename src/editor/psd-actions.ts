/**
 * Sending a PSD out to an editor, and taking the edited file back.
 *
 * These are the two halves of one round trip. Re-parsing on its own was a
 * button with nothing to re-parse: the PSD sat inside the app's store, and
 * nothing between one parse and the next could change it.
 *
 * The way back differs by platform, because the platforms differ.
 *
 * On desktop the editor opens the file where it lies in the project store and
 * saves over it, so the file on disk is already the edited one and all that
 * is left to do is parse it again — asking the user to go and find it would
 * be busywork. On iPadOS an app cannot hand another app its document and get
 * the edits back, so the file goes out through the share sheet, is edited
 * wherever it lands, and has to be picked to come home.
 */

import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { psd, publish } from "../lib/ipc";
import * as log from "../lib/log";
import { isMobile } from "../lib/platform";
import { openReplacePsd } from "./sheets";

/**
 * What the second PSD button is called here. The two are different actions —
 * one re-reads a file that never moved, the other takes a file back — and
 * the label is the only thing that says which.
 */
export function refreshPsdLabel(os: string): string {
  return isMobile(os) ? "Re-import" : "Re-parse";
}

/**
 * And the first. On desktop the file is opened where it lies; on mobile it
 * goes out through the share sheet, and calling that "Open" promises an
 * editor the tap does not open.
 */
export function openPsdLabel(os: string): string {
  return isMobile(os) ? "Share PSD" : "Open PSD";
}

/**
 * Hand `<key>.psd` to the OS.
 *
 * On desktop that is the registered editor, opened through the shell so the
 * webview never needs a filesystem scope over the store. On mobile it is the
 * share sheet, which shares a `File` the page holds rather than a path — so
 * the bytes come across and are wrapped here.
 */
export async function openPsdExternally(
  projectId: string,
  key: string,
  os: string,
): Promise<void> {
  if (!isMobile(os)) {
    await psd.openExternally(projectId, key);
    log.info(`Opened ${key}.psd — Re-parse it when you have saved your edits`);
    return;
  }

  const file = new File([await psdBlob(projectId, key)], `${key}.psd`, {
    type: PSD_MIME,
  });

  // `canShare` is the only honest test: WKWebView exposes `share` well before
  // it will accept files, and a share it refuses throws after the sheet has
  // already been dismissed.
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `${key}.psd` });
      log.info(`Shared ${key}.psd — Re-import it when you have saved your edits`);
      return;
    } catch (err) {
      // Swiping the share sheet away rejects the promise, and backing out of
      // a sheet is not a failure — it was logged as one, in red, every time.
      if (isAbort(err)) return;
      throw err;
    }
  }

  await savePsdCopy(projectId, key);
}

/**
 * Whether a rejection is the user dismissing something.
 *
 * `AbortError` is what both the share sheet and the file pickers throw when
 * they are backed out of. It arrives as a `DOMException` on iPadOS and as a
 * plain object across the Tauri bridge, so the name is read off whatever it
 * is rather than matched on a class.
 */
function isAbort(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name?: unknown }).name === "AbortError"
  );
}

/**
 * The fallback when the share sheet will not take a file: write a copy
 * wherever the document picker points. It is the same round trip, one step
 * longer.
 */
async function savePsdCopy(projectId: string, key: string): Promise<void> {
  const path = await saveFileDialog({
    defaultPath: `${key}.psd`,
    filters: [{ name: "Photoshop document", extensions: ["psd"] }],
  });
  if (!path) return;
  await publish.saveBytes(path, await psd.bytes(projectId, key));
  log.info(`Saved a copy to ${path} — Re-import it when you have edited it`);
}

/**
 * Bring a PSD's edits back into the project and return the fresh manifest.
 *
 * Desktop re-parses the file in place: it never moved, so there is nothing
 * to go and find. Mobile asks *where the file came back from* — Files, the
 * photo library or the clipboard — rather than guessing, which is what it
 * used to do, and it guessed the photo library every time. Returns null when
 * the sheet or the picker is backed out of; a cancelled pick is not an error
 * and should not be logged as one.
 */
export async function refreshPsd(
  projectId: string,
  key: string,
  os: string,
): Promise<string | null> {
  if (!isMobile(os)) {
    const manifest = await psd.reprocess(projectId, key);
    log.info(`Re-parsed ${key}.psd`);
    return manifest;
  }
  return openReplacePsd(projectId, key, os);
}

const PSD_MIME = "image/vnd.adobe.photoshop";

async function psdBlob(projectId: string, key: string): Promise<Blob> {
  const base64 = await psd.bytes(projectId, key);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: PSD_MIME });
}
