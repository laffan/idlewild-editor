/**
 * The picture the home screen shows for a project.
 *
 * Out of `editor.ts` for the 700-line rule rather than for anything about the
 * thumbnail, and it is a fair thing to lift: the whole of it is "take a
 * picture of the canvas and write it to the project", it closes over nothing
 * the shell owns, and `editor.ts` is otherwise wiring.
 *
 * **It never throws and never refuses to settle.** Leaving a project awaits
 * this, and a thumbnail is the least important thing in the app — a promise
 * that cannot settle is a project nobody can leave, with nothing on screen to
 * say why. `snapshotPng` answers with an empty string rather than hanging (see
 * `game/snapshot.ts`), and a failed write is a warning in the console rather
 * than a door held shut.
 *
 * **A print project's thumbnail is its Output preview** — the page as the
 * preview last showed it, framed the way the pane frames it. When nothing was
 * captured this time the project was open, the thumbnail it already has stays:
 * that is the last preview there was. Only a page that has never had one gets
 * a picture of the canvas instead.
 */

import type Phaser from "phaser";
import { snapshotPng } from "../game/snapshot";
import { projects } from "../lib/ipc";
import * as log from "../lib/log";

/** Where a print project's preview comes from — `GameFrame`. */
export interface PagePreview {
  readonly isPrint: boolean;
  thumbnailPng(): Promise<string>;
}

/** Long enough for a page's images to load; short enough to leave by. */
const PREVIEW_TIMEOUT_MS = 3_000;

export async function saveThumbnail(
  game: Phaser.Game | null,
  projectId: string,
  preview?: PagePreview,
): Promise<void> {
  try {
    if (preview?.isPrint) {
      const page = await settled(preview.thumbnailPng(), PREVIEW_TIMEOUT_MS);
      if (page) return await projects.writeThumbnail(projectId, page);
      if (await projects.thumbnail(projectId)) return;
    }
    if (!game) return;
    const dataUrl = await snapshotPng(game);
    if (dataUrl) await projects.writeThumbnail(projectId, dataUrl);
  } catch (err) {
    log.warn("Could not save a thumbnail:", err);
  }
}

/** The promise's answer, or empty once `ms` has passed or it has failed. */
function settled(promise: Promise<string>, ms: number): Promise<string> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(""), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve("");
      },
    );
  });
}
