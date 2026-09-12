/**
 * The project's rendering options, and what changing one actually does.
 *
 * Three settings live here — pixel art, whole-pixel drawing, the zoom a scene
 * opens at — and each has two halves. One is the canvas in front of you, which
 * has to change now or the sheet is a form with no feedback. The other is
 * `meta.json`, where it is written, and `game.config.json`, which Rust
 * regenerates from it so the project's own code reads the same answer on its
 * next start.
 *
 * Split out of `editor.ts` because it is the whole of that pair and none of
 * the shell: the editor hands it the project and a way to reach the live game,
 * and gets back a sheet it can open.
 *
 * The character controller is not here. It was lines in a file and the file
 * became the project's own the moment it was written, so Project Options
 * reports it rather than offering it — see `sheets.ts`.
 */

import { applyPixelArt, applyRoundPixels } from "../game/render-options";
import type { GameHandle } from "../game/boot";
import { projects } from "../lib/ipc";
import * as log from "../lib/log";
import { projectOptions, type GameOptions, type ProjectMeta } from "../lib/types";
import { openProjectOptions, type RenderOptions } from "./sheets";

export interface RenderSettings {
  /** The options as they stand: what boot is given, and what the sheet opens on. */
  readonly options: GameOptions;
  /** Open Project Options. Whatever is changed in it is applied and written. */
  open: (layerCount: number) => void;
}

export function createRenderSettings(
  meta: ProjectMeta,
  game: () => GameHandle | null,
): RenderSettings {
  let options = projectOptions(meta);

  const apply = (next: RenderOptions): void => {
    const handle = game();
    if (handle) {
      if (next.pixelArt !== options.pixelArt) {
        applyPixelArt(handle.game, next.pixelArt);
      }
      if (next.roundPixels !== options.roundPixels) {
        applyRoundPixels(handle.game, handle.scene, next.roundPixels);
      }
      if (next.defaultZoom !== options.defaultZoom) {
        // Through the scene's own zoom rather than the camera's, so the move is
        // centred and recorded: the camera rides the scene in the document, and
        // a zoom the document did not hear about would be undone by the next
        // scene switch. A default you cannot see is a number you cannot judge.
        const camera = handle.scene.cameras.main;
        handle.scene.zoomAt(
          next.defaultZoom / camera.zoom,
          camera.width / 2,
          camera.height / 2,
        );
      }
    }
    options = { ...options, ...next };

    // The meta is the record and the config is derived from it, both in Rust.
    // A failure is worth saying: the canvas has already changed, so silence
    // would leave the editor and the project disagreeing about the project.
    void projects
      .setOptions(meta.id, next)
      .then((written) => {
        meta.options = written.options;
      })
      .catch((err) => {
        log.error("Could not save the project's rendering options:", err);
      });
  };

  return {
    get options() {
      return options;
    },
    open: (layerCount) =>
      openProjectOptions({ ...meta, options }, layerCount, apply),
  };
}
