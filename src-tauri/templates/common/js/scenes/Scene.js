import {
  applyCamera,
  loadDocument,
  paintBackgrounds,
  placeDocument,
  placePatterns,
  updateCanvas,
  whenPsdsReady,
} from "../shared/canvas.js";
import { spawnCharacter, updateCharacter } from "../shared/character.js";

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
    spawnCharacter(this);
  }

  update(time, delta) {
    updateCanvas(this);
    updateCharacter(this, delta);
  }
}
