/**
 * Publish, which is two screens and a rule for choosing between them.
 *
 * - **No destination yet** → `publish-setup.ts`, the two columns. You cannot
 *   publish before saying where, and there is nothing useful to show in the
 *   meantime.
 * - **A destination** → `publish-review.ts`, what is there beside what is
 *   here. Which is what Publish *means* once the question of where has been
 *   answered — and the way back to the first screen is a link in its head
 *   rather than a fork in this one.
 *
 * Splitting it that way is the point of the rework. Publish used to be a menu
 * of exits, with the destination and the two zip exports and a rehearsal all
 * on one sheet, and the app-wide settings reachable from inside a project's
 * settings. Exporting is a different verb — it hands you a file — and it is
 * its own item now; see `sheets::openExport`.
 *
 * This file is only the router. It is tiny on purpose: everything about how a
 * destination is chosen belongs to one module and everything about what gets
 * sent belongs to another, and a third that knew both would be the file every
 * future change had to go through.
 */

import { publish } from "../lib/ipc";
import { targetIsSet, EMPTY_TARGET } from "../lib/publish-target";
import { openPublishSetup } from "./publish-setup";
import { openPublishReview } from "./publish-review";
import * as log from "../lib/log";

export function openPublish(projectId: string): void {
  void route(projectId);
}

async function route(projectId: string): Promise<void> {
  let set = false;
  try {
    set = targetIsSet({ ...EMPTY_TARGET, ...(await publish.target(projectId)) });
  } catch (err) {
    // A project whose target cannot be read is a project that has not got one,
    // as far as this decision goes: the setup sheet reads it again itself and
    // is the screen that can do something about the failure.
    log.error("Could not read where this project publishes:", err);
  }

  if (set) {
    openPublishReview({
      projectId,
      onChangeTarget: () => openPublishSetup(projectId, () => openPublish(projectId)),
    });
    return;
  }
  // Straight into the review once a destination has been chosen: the question
  // somebody had when they pressed Publish is still waiting to be answered.
  openPublishSetup(projectId, () => openPublish(projectId));
}
