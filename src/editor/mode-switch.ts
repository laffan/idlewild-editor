/**
 * Draw, Code or Play — the header's toggle, and what each of them does to the
 * shell.
 *
 * **Code shows what Play shows.** The project's own game runs over the canvas
 * in both, because a code editor beside a still picture of the game is a code
 * editor you cannot check anything in: save a file and the thing in front of
 * you restarts on it. What Code keeps that Play does not is the left sidebar
 * and the panel — so the scene can be switched and the project read while the
 * game runs, before a full test in Play. The inspector goes down with the
 * tools: it describes what is selected on a canvas nobody can reach through a
 * running game.
 *
 * Code is a section rather than a panel that happens to be open: entering it
 * puts the panel up wherever it was last docked, and leaving takes it down.
 * Anything that wants a file on screen — a console line naming where it was
 * written — asks for the mode first.
 *
 * Its own file for the reason `header-wiring.ts` and `inspect-wiring.ts` are:
 * `editor.ts` is the shell's *assembly*, and what the three modes mean is a
 * rule about the shell rather than a step in building one. The mode itself
 * lives here too, behind a getter, because four other places read it and the
 * one thing worse than a variable in the middle of a long function is the same
 * variable in two files.
 */

import type { DocStore } from "../lib/doc-store";
import type { EditorMode } from "../lib/types";
import type { CodePanel } from "./code-panel";
import type { GameFrame } from "./game-frame";
import type { EditorHeader } from "./header";
import type { LayersPanel } from "./layers-panel";
import type { WorldScene } from "../game/world-scene";
import * as log from "../lib/log";

export interface ModeSwitchDeps {
  store: DocStore;
  header: EditorHeader;
  /** The shell's root, which carries the two mode classes. */
  shell: HTMLElement;
  layers: LayersPanel;
  code: CodePanel;
  gameFrame: GameFrame;
  /** The canvas, or null before it has booted. */
  scene: () => WorldScene | null;
}

export interface ModeSwitch {
  /** Which of the three the editor is in. */
  mode: () => EditorMode;
  setMode: (next: EditorMode) => void;
  /**
   * Start the game, or start it again — what a scene switch asks for.
   *
   * The document is flushed first, and awaited: the config the game reads is
   * rewritten by the document's save, so starting without waiting would run
   * the project against whatever the last debounce happened to have written.
   */
  runGame: () => void;
}

export function createModeSwitch(deps: ModeSwitchDeps): ModeSwitch {
  let mode: EditorMode = "draw";

  const runGame = (): void => {
    void deps.store.flush().then(() => {
      // The canvas may have been come back to while that was in flight.
      if (mode !== "draw") void deps.gameFrame.start();
    });
  };

  return {
    mode: () => mode,
    runGame,
    setMode(next: EditorMode): void {
      mode = next;
      deps.header.setMode(next);
      deps.shell.classList.toggle("play-mode", next === "play");
      deps.shell.classList.toggle("code-mode", next === "code");
      deps.scene()?.setMode(next);
      // Code keeps the left sidebar, and turns it into a directory: the game
      // is over the canvas, so there is nothing in that column to act on, and
      // what is wanted beside the code is the names — scenes, layers, PSDs,
      // and the layers inside each file. See `editor/layer-directory.ts`.
      deps.layers.setBrowsing(next === "code");

      if (next === "code") deps.code.show();
      else deps.code.hide();

      if (next === "draw") {
        deps.gameFrame.stop();
        return;
      }
      log.info(
        next === "play"
          ? "Play — running this project's own code"
          : "Code — the game is running beside it; a save restarts it",
      );
      runGame();
    },
  };
}
