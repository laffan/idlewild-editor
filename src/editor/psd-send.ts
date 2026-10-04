/**
 * What goes into a PSD with it when it leaves — the two boxes on the Open PSD
 * / Share PSD control.
 *
 * **Include palette** is the app-wide *Attach palette to PSDs* (in the
 * colour picker) made per file: a file nobody has ticked or unticked follows
 * that switch, as every file did before, and one that has been is its own.
 * **Include context** puts the canvas around the file into it — see
 * `psd-context.ts` — and is off until ticked.
 *
 * Kept in `meta.json` by `psd_send.rs`, beside Pixel Art Rescale's factors,
 * and read here off the open project for the reason `pixelScaleOf` is.
 */

import { psd } from "../lib/ipc";
import * as log from "../lib/log";
import { palette } from "../lib/palette";
import { openProject } from "../lib/print";

export interface SendChoice {
  palette: boolean;
  context: boolean;
}

/** One file's two answers, defaults filled in. */
export function sendChoiceOf(key: string): SendChoice {
  const held = openProject()?.psdSend?.[key];
  return {
    palette: held?.palette ?? palette.attach,
    context: held?.context === true,
  };
}

/** Change one of them, on disk and in the open project's copy. */
export async function setSendChoice(
  projectId: string,
  key: string,
  patch: Partial<SendChoice>,
): Promise<void> {
  try {
    const written = await psd.setSend(projectId, key, patch);
    const meta = openProject();
    if (meta) meta.psdSend = written.psdSend;
  } catch (err) {
    log.error(`Could not save what goes into ${key}.psd:`, err);
  }
}

/** A file renamed or copied took its answers with it — here as on disk. */
export function carrySendChoice(from: string, to: string, moved: boolean): void {
  const meta = openProject();
  const held = meta?.psdSend?.[from];
  if (!meta || !held) return;
  const next = { ...meta.psdSend, [to]: held };
  if (moved) delete next[from];
  meta.psdSend = next;
}
