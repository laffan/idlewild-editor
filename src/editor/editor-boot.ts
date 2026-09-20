/**
 * The two things the editor does once the canvas is up, neither of which
 * anything waits for.
 *
 * They were the tail of `openEditor` and they are not part of opening a
 * project: one is a diagnostic that resolves some time after the editor is
 * already usable, and the other only exists in a dev build. Both read as
 * setup while they sit in the middle of the assembly, which is the argument
 * for moving them — that function is the shell's wiring, and a reader
 * following it should not have to work out which lines are load-bearing.
 */

import { checkAssetServer } from "../lib/ipc";
import * as log from "../lib/log";

/**
 * Ask the asset server whether it is answering this page, and say so.
 *
 * Not awaited by the caller, deliberately: it is a loopback request that
 * separates *the server is unreachable from here* from *that one file is
 * missing*, and the editor is usable either way. What it buys is the
 * difference between a PSD that imports and then places empty — the symptom —
 * and one line naming the cause.
 */
export function reportAssetServer(base: string): void {
  void checkAssetServer(base).then((trouble) => {
    if (trouble) {
      log.error(
        `The asset server at ${base} is not answering this page — ${trouble}. ` +
          "Every PSD will import and then place empty.",
      );
    } else {
      log.info(`Asset server ready at ${base}`);
    }
  });
}

/**
 * Handles for the browser harness in `harness/`, in a dev build only.
 *
 * The inspector is here as well as the scene because some of what it does is
 * reached from nowhere else — `revealPsdLayers` fires at the end of a
 * conversion that needs the Rust side to have written a file first.
 *
 * The gate is the caller's, so that `import.meta.env` is read where Vite can
 * see it rather than behind a function it would have to inline.
 */
export function exposeDevHooks(scene: unknown, inspector: unknown): void {
  const hooks = window as unknown as Record<string, unknown>;
  hooks.__idlewildScene = scene;
  hooks.__idlewildInspector = inspector;
}
