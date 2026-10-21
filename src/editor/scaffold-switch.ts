/**
 * Project Options' Scaffolding: moving a project onto another scaffold.
 *
 * Possible because Draw is an asset editor rather than the program: what a
 * scaffold decides is the code in `game/`, and the artwork beside it is the
 * same whichever one wrote that code. So a switch writes the new scaffold's
 * files, takes away the old one's, and leaves the PSDs alone.
 *
 * **It is a switch with a warning, and a backup behind it.** Every file it
 * overwrites or takes away is copied into `game/Backups/` first, at the path
 * it had — your edits to the old scaffold's files, and any file of your own
 * that happens to share a name with one of the new scaffold's. The sheet says
 * so before anything is written, and the console names the backup after. See
 * `scaffold_switch.rs` for the rules.
 *
 * Switching onto PSD to Phaser writes each scene's placements into its
 * `create` as code — `code/placement-code.ts` — which is the one time the
 * editor writes a scene's placements out whole. From then on the scene file
 * is yours; what is placed afterwards is written in as it is placed, and the
 * sidebar's rows drag in whatever else is wanted — see `code-sync.ts`.
 *
 * The editor is closed and opened again around the switch, because the open
 * one holds the document with the old scaffold in it and would write it back.
 */

import { h } from "../lib/dom";
import { openSheet } from "../lib/sheet";
import { optionGroup, optionsPage } from "../lib/options-list";
import { scaffoldPicker } from "../lib/scaffold-picker";
import { projects } from "../lib/ipc";
import * as log from "../lib/log";
import { sceneCode } from "../code/placement-code";
import { scaffoldLabel, type ProjectMeta, type Scaffold } from "../lib/types";
import type { DocStore } from "../lib/doc-store";
import type { WorldScene } from "../game/world-scene";
import { scaffoldNote } from "../home/new-project";

export interface ScaffoldSwitchDeps {
  meta: ProjectMeta;
  store: DocStore;
  /** The scene, whose parsed manifests say what is inside a placed group. */
  scene: () => WorldScene | null;
  /** Close the editor, run the switch, and open the project again. */
  reopen: (run: () => Promise<ProjectMeta>) => Promise<void>;
}

export function openScaffoldSwitch(deps: ScaffoldSwitchDeps): void {
  const { meta, store } = deps;
  const from: Scaffold = meta.genre ?? "topdown";
  let to: Scaffold = from;

  const sheet = openSheet({ title: "Change Scaffolding", subtitle: meta.name, width: 600 });
  const picker = scaffoldPicker(from, (value) => {
    to = value;
    switchButton.textContent = to === from ? "Rewrite" : "Switch";
  });
  picker.setPlatformerEnabled(meta.projection !== "isometric");

  const warning = h(
    "div",
    { class: "scaffold-switch-warning" },
    h("p", {
      text:
        "This writes the new scaffold's files into the project's code and " +
        "takes away the old scaffold's. Any file of yours that shares a name " +
        "with one of Idlewild's is overwritten, and code written against the " +
        "old scaffold may stop working.",
    }),
    h("p", {
      text:
        "Nothing is lost: every file that is overwritten or taken away is " +
        "copied into Backups/ first, at the path it had, for you to salvage " +
        "code from. Picking the scaffold the project already has writes its " +
        "files afresh the same way.",
    }),
  );

  sheet.body.appendChild(
    optionsPage([
      optionGroup({
        title: "Scaffolding",
        hint: () => scaffoldNote(to),
        rows: picker.rows,
      }),
    ]),
  );
  sheet.body.appendChild(warning);

  const switchButton = h("button", {
    class: "btn btn-primary",
    text: "Rewrite",
    onClick: () => {
      sheet.close();
      // Worked out now, while the scene and its manifests are up: the editor
      // is closed before the switch runs.
      const placements: Record<string, string> = {};
      if (to === "p2p") {
        for (const scene of store.scenes) {
          placements[scene.id] = sceneCode({
            layers: scene.layers,
            isometric: store.projection === "isometric",
            psdLayers: (key) => deps.scene()?.psdLayers(key) ?? [],
            colliders: store.colliders,
          });
        }
      }
      void deps.reopen(async () => {
        try {
          const report = await projects.switchScaffold(meta.id, to, placements);
          log.info(
            `Scaffolding is now ${scaffoldLabel(to)}.` +
              (report.backup
                ? ` ${report.backedUp.length} file(s) were backed up to ${report.backup}/.`
                : ""),
          );
          return report.meta;
        } catch (err) {
          // Nothing was switched, or not all of it: open what is on disk.
          log.error("Could not change the scaffolding:", err);
          return (await projects.meta(meta.id).catch(() => null)) ?? meta;
        }
      });
    },
  }) as HTMLButtonElement;

  sheet.actions.append(
    switchButton,
    h("button", { class: "btn btn-ghost", text: "Cancel", onClick: sheet.close }),
  );
}
