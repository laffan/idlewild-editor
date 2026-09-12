/**
 * Pixel-perfect rendering, applied to a game that is already running.
 *
 * Phaser reads `pixelArt` and `roundPixels` once, when the game is
 * constructed: `pixelArt` turns `antialias` off, and `antialias` is what every
 * texture source consults for its filter as it is created. So a project that
 * was made pixel-perfect gets both at boot — see `game/boot.ts` — and the
 * editor gets this, for the other case: someone has just ticked the box in
 * Project Options and the canvas beside them should say so without reopening
 * the project.
 *
 * That is two jobs. The config's own fields move, so every texture loaded from
 * here on comes in with the right filter, and every texture already in is
 * re-filtered — `TextureSource.setFilter` goes through to
 * `renderer.setTextureFilter`, so the change is live on WebGL rather than
 * waiting for a reload.
 *
 * The exported game does none of this. It reads the two values out of
 * `game.config.json` at boot, in `main.js` and the scene's `applyCamera`,
 * because a published game is never half-way through being reconfigured.
 */

import Phaser from "phaser";

/**
 * The parts of Phaser's resolved config this writes to.
 *
 * `Phaser.Core.Config` declares them readonly, which is right about what a
 * game should normally do to itself and wrong about this: they are plain
 * properties, read at the moment a texture is created, and the whole point
 * here is that a toggle reaches textures that have not loaded yet.
 */
interface MutableRenderConfig {
  pixelArt: boolean;
  antialias: boolean;
  roundPixels: boolean;
}

/**
 * Nearest-neighbour textures, or bilinear ones.
 *
 * Both halves matter. Without the config write, the next PSD to load comes in
 * smoothed; without the re-filter, everything already on the canvas stays
 * smoothed until the project is reopened.
 */
export function applyPixelArt(game: Phaser.Game, on: boolean): void {
  const config = game.config as unknown as MutableRenderConfig;
  config.pixelArt = on;
  config.antialias = !on;

  const mode = on
    ? Phaser.Textures.FilterMode.NEAREST
    : Phaser.Textures.FilterMode.LINEAR;
  game.textures.each((texture: Phaser.Textures.Texture) => {
    texture.setFilter(mode);
  }, game.textures);
}

/**
 * Whole-pixel drawing.
 *
 * On the camera, because that is where Phaser reads it per frame, and on the
 * manager too, so a camera added later starts out agreeing with the one that
 * is there. The config's copy moves for the same reason `applyPixelArt` writes
 * to it: it is what a new camera's default comes from.
 */
export function applyRoundPixels(game: Phaser.Game, scene: Phaser.Scene, on: boolean): void {
  (game.config as unknown as MutableRenderConfig).roundPixels = on;
  scene.cameras.roundPixels = on;
  for (const camera of scene.cameras.cameras) camera.roundPixels = on;
}
