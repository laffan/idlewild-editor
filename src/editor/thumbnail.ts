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
 */

import type Phaser from "phaser";
import { snapshotPng } from "../game/snapshot";
import { projects } from "../lib/ipc";
import * as log from "../lib/log";

export async function saveThumbnail(
  game: Phaser.Game | null,
  projectId: string,
): Promise<void> {
  if (!game) return;
  try {
    const dataUrl = await snapshotPng(game);
    if (dataUrl) await projects.writeThumbnail(projectId, dataUrl);
  } catch (err) {
    log.warn("Could not save a thumbnail:", err);
  }
}
