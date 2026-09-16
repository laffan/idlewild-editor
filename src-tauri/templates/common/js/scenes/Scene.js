import {
  applyCamera,
  layersOf,
  loadDocument,
  paintBackgrounds,
  placeDocument,
  placePatterns,
  sceneOf,
  updateCanvas,
} from "../shared/canvas.js";
import { spawnCharacter, updateCharacter } from "../shared/character.js";

/**
 * __SCENE_NAME__ — one of this project's scenes, and yours.
 *
 * **Nothing in this file is the editor's.** Every line is yours to change,
 * delete or replace, and nothing here will be rewritten under you. What the
 * editor maintains is in `js/shared/`: `canvas.js` puts the document on
 * screen and `character.js` wires up whatever walks it. This file is the six
 * calls that run them, in the order they have to run in.
 *
 * It used to be one file with all of that in it, interleaved with your own
 * code and told apart by a colour. Separating them by *file* is the honest
 * version: the scaffold is somewhere you can read it, this is somewhere you
 * can write.
 *
 * **One file per scene in the project.** Add a scene in the editor's sidebar
 * and a file appears beside this one; rename it and the file, the class and
 * the Phaser key all follow. `js/scenes/index.js` is the list `main.js`
 * registers, and the editor keeps that in step too — so switching scene in
 * your own code is `this.scene.start("SomeOtherScene")`, under the name you
 * gave it.
 *
 * `sceneOf(this)` is this scene as the document has it — its id, its name,
 * where play begins and its layers — and `layersOf(this)` is the layers on
 * their own. Both are imported above and unused; they are the two things
 * anything you write here is most likely to want.
 */
export default class __SCENE_CLASS__ extends Phaser.Scene {
  constructor() {
    super("__SCENE_CLASS__");
  }

  preload() {
    // The grid, and every PSD the project places. Nothing is placed yet:
    // the files are still arriving, and `placeDocument` waits for them.
    loadDocument(this);
  }

  create() {
    applyCamera(this);
    paintBackgrounds(this);
    placeDocument(this);
    placePatterns(this);
    spawnCharacter(this);
  }

  update(time, delta) {
    // The backdrops and the pattern layers follow the camera, so both are a
    // frame's work rather than something placed once.
    updateCanvas(this);
    updateCharacter(this, delta);
  }
}
