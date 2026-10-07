/**
 * What goes into a PSD with it when it leaves — the two boxes on the Open PSD
 * / Share PSD control.
 *
 * **Include palette** writes the working palette into the file as its topmost
 * layer, so the colours are there to sample in the other app. It is the only
 * place that is decided: there used to be an app-wide *Attach palette to
 * PSDs* switch under the colour picker that a file nobody had ticked followed,
 * and two controls for one strip was one too many. A file nobody has ticked
 * is off.
 * **Include context** puts the canvas around the file into it — see
 * `psd-context.ts` — and is off until ticked.
 *
 * Kept in `meta.json` by `psd_send.rs`, beside Pixel art upscale's factors,
 * and read here off the open project for the reason `pixelScaleOf` is.
 */

import { psd } from "../lib/ipc";
import * as log from "../lib/log";
import { openProject } from "../lib/print";

export interface SendChoice {
  palette: boolean;
  context: boolean;
}

/** One file's two answers, defaults filled in. */
export function sendChoiceOf(key: string): SendChoice {
  const held = openProject()?.psdSend?.[key];
  return {
    palette: held?.palette === true,
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
