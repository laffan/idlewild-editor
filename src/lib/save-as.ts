/**
 * Leaving with a file, in the order the platform actually works in.
 *
 * Every exit that hands you a file — the site zip, the `.idlewild`, the assets
 * zip, a PSD copy, a pattern, a shape, a selection — used to be written the
 * same way: ask the save dialog where, then write there. That is right on
 * macOS and it is the wrong order on an iPad, where it wrote a **0-byte file**
 * every time.
 *
 * iOS has no save dialog. It has an *export* picker, which answers "copy this
 * file to somewhere the person picks", and the plugin fakes a save dialog out
 * of one by exporting an empty placeholder and handing back where the copy
 * landed — a path in another process's container, which this app has no right
 * to write to. The write failed; the placeholder was what you found in Files.
 *
 * So on iOS the two steps swap: the file is built *first*, at the one path the
 * export picker is already going to look at, and the picker copies it out with
 * rights the app does not have. Nothing is written outside the sandbox at any
 * point, and the destination never has to be reachable from here at all. See
 * `save_staging.rs` for why that path is the one it is, and
 * `Docs/exports.md` for the whole of it.
 *
 * ```text
 * macOS   ask where  →  build the file there
 * iPadOS  build the file here  →  ask where  →  iOS copies it
 * ```
 *
 * `saveAs` is where both orders live, so no exit has to know which one it is
 * in: hand it a name, a filter and a `write`, and it calls `write` with a path
 * that is correct on the platform it is running on.
 */

import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { files } from "./ipc";
import * as log from "./log";

export interface SaveAsOptions {
  /** The bare file name, extension and all. Never a path — see `staging_path`. */
  fileName: string;
  /** What the desktop dialog offers. Neither mobile picker reads extensions. */
  filter: { name: string; extensions: string[] };
  /**
   * What the console calls this, in the sentence that says it worked and in
   * the one that says it did not. "Exported site", "Saved the pattern".
   */
  what: string;
  /** Build the file at `path`. The only thing an exit has to supply. */
  write: (path: string) => Promise<void>;
}

/**
 * Build a file and hand it over, whichever order this platform needs.
 *
 * Answers the destination it was given, or `null` when the picker was backed
 * out of — a cancelled export is not a failure and is not logged as one.
 * Failures are logged here rather than thrown, because every caller did the
 * same thing with them and doing it once is how they stay consistent.
 *
 * **The delay moves on iOS, and it has to.** Building before the picker means
 * a large project spends its seconds before the picker appears rather than
 * after it closes. That is the cost of the copy being iOS's; there is no
 * arrangement where a zip is both built after the question and written where
 * the answer points. The console says what is being built, so the wait is
 * something happening rather than nothing.
 */
export async function saveAs(options: SaveAsOptions): Promise<string | null> {
  const { fileName, filter, what, write } = options;
  try {
    const staged = await files.stageSave(fileName);

    if (staged === null) {
      // Where the dialog names a destination this app may write to, which is
      // every desktop platform: ask first, so nothing is built for an export
      // that is then backed out of.
      const path = await saveFileDialog({
        defaultPath: fileName,
        filters: [filter],
      });
      if (!path) return null;
      await write(path);
      log.info(`${what} → ${path}`);
      return path;
    }

    // iOS. Build it where the export picker looks, then let iOS do the copy.
    try {
      log.info(`${what}: building ${fileName}…`);
      await write(staged);
      const path = await saveFileDialog({
        defaultPath: fileName,
        filters: [filter],
      });
      // Measured before it is cleared, whether or not the picker was used:
      // the size of the file iOS was handed is the only honest thing this
      // platform can report about the one that arrived.
      const done = await files.stagedSaveDone(staged);
      if (done.note) log.warn(`${what}: ${done.note}`);
      if (!path) return null;
      log.info(`${what} → ${path} (${size(done.bytes)})`);
      return path;
    } catch (err) {
      // Clear the staged file even when the build threw half way through it,
      // so the next export does not find a truncated one waiting.
      await files.stagedSaveDone(staged).catch(() => undefined);
      throw err;
    }
  } catch (err) {
    log.error(`${what} failed:`, err);
    return null;
  }
}

/** Bytes, as a person reads them. */
function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
