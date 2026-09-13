/**
 * Acting on several projects at once.
 *
 * Rename, duplicate and delete have always been on a card's long-press menu,
 * one card at a time. That is right for rename, which is about one thing by
 * definition, and wrong for the other two the moment there is a shelf of
 * experiments on the home screen: clearing out six of them was six long
 * presses and six confirmations, and the confirmation is the part that makes it
 * feel like six separate decisions rather than one.
 *
 * So **Select** turns the grid into a set of choices and this is what the two
 * bulk buttons do. The single-card menu stays exactly as it was — it is the
 * faster path for one, and it is the only path to Rename.
 *
 * Both of these are **sequential**, not parallel. Duplicating a project copies
 * its source PSDs and its processed assets, and six of those at once is six
 * concurrent walks of the same store — so they go one at a time, and the console
 * says what happened rather than a progress bar saying how far through it is.
 * A failure part-way through does not abandon the rest: five projects copied and
 * one refused is a better answer than one copied and five silently dropped.
 */

import { projects } from "../lib/ipc";
import { confirmSheet } from "../lib/sheet";
import * as log from "../lib/log";

/** "1 project" / "4 projects", which is said in four places. */
export function describeCount(n: number): string {
  return `${n} ${n === 1 ? "project" : "projects"}`;
}

/**
 * Copy each of these projects.
 *
 * Answers how many landed, so the caller can say so once rather than per
 * project — a console line per copy is the shape of the loop rather than the
 * shape of what was asked for.
 */
export async function duplicateProjects(
  ids: readonly string[],
): Promise<number> {
  let made = 0;
  for (const id of ids) {
    try {
      await projects.duplicate(id);
      made++;
    } catch (err) {
      log.error("Could not duplicate:", err);
    }
  }
  if (made > 0) log.info(`Duplicated ${describeCount(made)}`);
  return made;
}

/**
 * Delete each of these projects, asking once.
 *
 * **Once** is the point. Six confirmations for one decision is what makes
 * clearing out a shelf of experiments feel like six decisions, and a sheet that
 * names the count is a truer question than a sheet that names a project six
 * times running.
 *
 * Answers how many went, or null if the question was declined — the caller has
 * to tell "nothing was deleted because you said no" from "nothing was deleted
 * because all six failed".
 */
export async function deleteProjects(
  ids: readonly string[],
  names: readonly string[],
): Promise<number | null> {
  if (ids.length === 0) return 0;
  const ok = await confirmSheet(
    ids.length === 1 ? "Delete project" : `Delete ${describeCount(ids.length)}`,
    // Named while the list is short enough to read, counted when it is not:
    // "these 14 projects" is a number somebody can check, and fourteen titles
    // is a wall nobody reads.
    names.length <= 4
      ? `${names.map((n) => `“${n}”`).join(", ")} and everything in them will ` +
        "be removed. This cannot be undone."
      : `${describeCount(ids.length)} and everything in them will be removed. ` +
        "This cannot be undone.",
  );
  if (!ok) return null;

  let gone = 0;
  for (const id of ids) {
    try {
      await projects.remove(id);
      gone++;
    } catch (err) {
      log.error("Could not delete:", err);
    }
  }
  if (gone > 0) log.info(`Deleted ${describeCount(gone)}`);
  return gone;
}
