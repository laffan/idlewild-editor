/**
 * What the header's buttons and its menu actually do.
 *
 * The same split `inspect-wiring.ts` makes, and for the same reason: the header
 * itself is a row of controls that knows nothing about a project — it says
 * whether either history button has anything to go back to and which of the
 * three sections is up, and everything else it only forwards. The destinations
 * behind the menu are the shell's, and half of them are built *after* the
 * header is, so every one of them is reached through a function called at the
 * moment a menu item is pressed rather than a value captured when the shell was
 * assembled.
 *
 * Nine of the ten are one line, and Import Assets is the tenth only because it
 * has to say where an import lands. Copy PSD and Paste Image both go through
 * `intake.ts`, where the keyboard's half of the same job already lives, so a
 * menu item and its keystroke cannot drift apart.
 */

import type { Grid } from "../lib/grid";
import type { EditorMode, ProjectMeta } from "../lib/types";
import type { WorldScene } from "../game/world-scene";
import { openExportAssets } from "./export-assets";
import type { HeaderCallbacks } from "./header";
import type { HistoryUi } from "./history";
import { openImportAssets } from "./import-assets";
import { pasteTargetFor, type Intake } from "./intake";
import { openPublish } from "./sheets";

export interface HeaderWiringDeps {
  meta: ProjectMeta;
  /** Which platform, which is what the file pickers ask. */
  os: string;
  grid: Grid;
  /** Leave the project: teardown, then the home screen. */
  leave: () => void;
  /** Which history ⌘Z would reach — null until the canvas is up. */
  history: () => HistoryUi | null;
  setMode: (mode: EditorMode) => void;
  /** Paste and copy, wired once in `intake.ts` for the keyboard as well. */
  intake: () => Intake;
  /** Where an import lands, which is the live scene. */
  scene: () => WorldScene | null;
  /** Project Options, which needs to say how many layers there are. */
  openOptions: () => void;
}

export function headerCallbacks(deps: HeaderWiringDeps): HeaderCallbacks {
  const { meta } = deps;
  return {
    onBack: () => deps.leave(),
    onUndo: () => deps.history()?.undo(),
    onRedo: () => deps.history()?.redo(),
    onMode: (next) => deps.setMode(next),
    onPasteImage: () => deps.intake().paste(),
    onCopyPsd: () => deps.intake().copy(),
    onPublish: () => openPublish(meta.id, meta.name),
    onExportAssets: () => openExportAssets(meta.id, meta.name),
    // The way in for several files at once, off the filesystem or out of
    // another project. It lands them the way a paste lands one, which is what
    // `pasteTargetFor` is — see `editor/import-assets.ts`.
    onImportAssets: () =>
      openImportAssets({
        projectId: meta.id,
        os: deps.os,
        grid: deps.grid,
        target: () => pasteTargetFor(deps.grid, deps.scene()),
      }),
    onOptions: () => deps.openOptions(),
  };
}
