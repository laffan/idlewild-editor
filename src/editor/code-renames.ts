/**
 * A PSD or a layer renamed in the editor, renamed in the project's code.
 *
 * Every `.js` file of `game/` is read — scene files, `main.js`, anything the
 * author made — and rewritten where it names the file or the layer, by the
 * rules in `code/rename-refs.ts`. `Backups/` is left as it was saved. Each
 * file is changed the way `code-edit.ts` changes one, through the panel when
 * it is open there. Nothing here restarts a running game: the rename that
 * called this restarts it once these are written — see `psd-actions.ts`.
 */

import { gameFiles } from "../lib/ipc";
import * as log from "../lib/log";
import { renameKeyInCode, renameLayersInCode } from "../code/rename-refs";
import { createCodeEditor, type CodeEditDeps } from "./code-edit";

export type CodeRename =
  | { kind: "psd"; from: string; to: string; layerNames: readonly string[] }
  | { kind: "layers"; key: string; names: ReadonlyMap<string, string> };

export async function renameInCode(deps: CodeEditDeps, rename: CodeRename): Promise<void> {
  const files = await gameFiles.list(deps.projectId).catch(() => []);
  const editor = createCodeEditor(deps);
  const change = (text: string) =>
    rename.kind === "psd"
      ? renameKeyInCode(text, rename.from, rename.to, rename.layerNames)
      : renameLayersInCode(text, rename.key, rename.names);
  const changed: string[] = [];
  for (const file of files) {
    if (file.isDir || !file.path.endsWith(".js") || file.path.startsWith("Backups/")) continue;
    if (await editor.edit(file.path, change, { restart: false })) changed.push(file.path);
  }
  if (changed.length > 0) log.info(`Renamed in the code: ${changed.join(", ")}`);
}
