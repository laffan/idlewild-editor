/**
 * The two things `lib/` borrows from an open project, and gives back.
 *
 * The colour picker lives in `lib/` because it is one control used in five
 * places, and two of the things it can do are only possible while a project
 * is open: the eyedropper has to read the engine's canvas, and **Browse
 * Palettes** opens a panel beside the inspector. Neither belongs to the
 * picker, and the picker cannot reach either — `lib/` knows nothing about the
 * game or the shell, which is the whole reason it is `lib/`.
 *
 * So the shell lends them. Each is registered on the way in and taken back on
 * the way out, and the taking back is the load-bearing half: a sampler still
 * holding a destroyed renderer is a picker that throws the next time anybody
 * uses the eyedropper on the home screen.
 *
 * Lifted out of `editor.ts` when it reached its seven hundred lines, and it
 * lifts cleanly: two registrations, one teardown, and nothing else in that
 * file reads any of it.
 */

import type Phaser from "phaser";
import { setEngineSampler } from "../lib/eyedropper";
import { setPaletteBrowser } from "../lib/palette";
import { enginePixelSampler } from "../game/sample-pixel";
import { createPaletteBrowser } from "./palette-browser";

export interface LendsHost {
  /** The running game, whose canvas the eyedropper reads. */
  game: Phaser.Game;
  /** Where the palette browser opens: over the main area, beside the panel. */
  main: HTMLElement;
  sidebar: HTMLElement;
}

export interface Lends {
  /** Hand everything back. Safe to call once, from `teardown`. */
  destroy: () => void;
}

export function lendToPicker(host: LendsHost): Lends {
  const unregisterSampler = setEngineSampler(enginePixelSampler(host.game));
  const palettes = createPaletteBrowser({
    main: host.main,
    sidebar: host.sidebar,
  });
  const unregisterBrowser = setPaletteBrowser({
    toggle: () => palettes.toggle(),
    isOpen: () => palettes.isOpen(),
  });

  return {
    destroy: () => {
      unregisterSampler();
      unregisterBrowser();
      palettes.destroy();
    },
  };
}
