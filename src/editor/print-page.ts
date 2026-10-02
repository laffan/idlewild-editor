/**
 * Changing the open print project's sheet, from wherever it is changed.
 *
 * Three places change it — Page Setup, the frame dragged on the canvas, and
 * the format switch in the Output preview's bar — and all of them want the
 * same three things to follow: the change written (`set_project_page`, which
 * rewrites the config the game reads), the editor's copy of the meta brought
 * level, and everyone watching the sheet told (`onPageChange`), so the frame
 * on the canvas moves and a running Output restarts on the new page.
 *
 * Writes are queued, so a size typed a digit at a time lands in the order it
 * was typed, and listeners hear once per write that landed — after it landed,
 * because a game restarted any earlier would come back on the old config.
 */

import { projects } from "../lib/ipc";
import * as log from "../lib/log";
import { openProject, setOpenProject, type Output } from "../lib/print";

let queue: Promise<void> = Promise.resolve();

export function changePage(patch: Partial<Omit<Output, "kind" | "dpi">>): Promise<void> {
  const meta = openProject();
  if (!meta) return Promise.resolve();
  queue = queue.then(async () => {
    try {
      const written = await projects.setPage(meta.id, patch);
      meta.output = written.output;
      setOpenProject(meta);
    } catch (err) {
      log.error("Could not change the page:", err);
    }
  });
  return queue;
}
