import {
  applyCamera,
  loadDocument,
  paintBackgrounds,
  placeDocument,
  placePatterns,
  updateCanvas,
} from "../shared/canvas.js";

// Everything the editor drew, on screen, and nothing above it.
//
// This is the whole of a Blank PSD to Phaser scene: the PSDs load, the camera
// goes where the editor's does, the backdrops and fills are painted, the placed
// files land in their draw order, and the pattern layers keep generating as the
// camera moves. There is no character, no navigation and no physics, because
// what moves in this world is the part you have not written yet.
//
// The five calls in `create` are `js/shared/canvas.js`, which is the editor's
// and is the same file a Top Down or a Platformer project gets. Delete any of
// them and that part stops happening; there is nothing marked in this file, so
// all of it is yours.
export default class __SCENE_CLASS__ extends Phaser.Scene {
  constructor() {
    super("__SCENE_CLASS__");
  }

  preload() {
    loadDocument(this);
  }

  create() {
    applyCamera(this);
    paintBackgrounds(this);
    placeDocument(this);
    placePatterns(this);
  }

  update() {
    // The document is placed once the PSDs have finished arriving, which is
    // after `create` has run — see `placeDocument`. This is what notices.
    updateCanvas(this);
  }
}
