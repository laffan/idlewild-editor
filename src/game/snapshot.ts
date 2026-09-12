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
 */

import type Phaser from "phaser";

export function snapshotPng(game: Phaser.Game): Promise<string> {
  return new Promise((resolve) => {
    game.renderer.snapshot((image) => {
      resolve(image instanceof HTMLImageElement ? image.src : "");
    });
  });
}
