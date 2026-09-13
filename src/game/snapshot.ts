/**
 * A PNG of what the canvas is showing, for the home screen's thumbnail.
 *
 * A fact about the *game* rather than about the scene — the renderer takes the
 * picture, and nothing in the scene is consulted — so it sits here rather than
 * as a method on `WorldScene`, which has the 700-line rule to answer to.
 *
 * `renderer.snapshot` hands back either an `HTMLImageElement` or a colour, and
 * the colour case is what a snapshot of a context that has gone looks like.
 * Both are answered with a string, because the caller writes it to disk and
 * "no thumbnail" is a thing a project is allowed to have.
 *
 * And it is answered with a string *eventually, whatever happens*, which is
 * the other half of that sentence. The callback is queued for the end of the
 * next render pass, so a pass that never finishes — one object in the scene
 * drawing against a texture that has been destroyed is enough — means it is
 * never called at all. Leaving the project awaits this, so a promise that
 * cannot settle is a project nobody can leave: the Back button stops working
 * and there is nothing on screen to say why. A thumbnail is the least
 * important thing in this app and it must not be able to hold the door shut.
 */

import type Phaser from "phaser";

/**
 * How long to wait for a render pass that may never come.
 *
 * Generous: a heavy scene under software rendering takes a few frames, and
 * cutting a working snapshot short would replace the picture with nothing.
 */
const SNAPSHOT_TIMEOUT_MS = 2_000;

export function snapshotPng(game: Phaser.Game): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;
    const answer = (value: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(value);
    };
    const timer = window.setTimeout(() => answer(""), SNAPSHOT_TIMEOUT_MS);

    try {
      game.renderer.snapshot((image) => {
        answer(image instanceof HTMLImageElement ? image.src : "");
      });
    } catch {
      // A renderer that refuses the request outright is the same answer as
      // one that never comes back: no picture, and nothing to wait for.
      answer("");
    }
  });
}
