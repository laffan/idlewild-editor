/**
 * What the canvas shows inside a box of world, as pixels — Include context's
 * picture (see `editor/psd-context.ts`).
 *
 * Rendered from the scene's own objects into an offscreen texture rather than
 * read off the screen, for three reasons: the box is usually partly off the
 * view, the screen is at whatever zoom somebody left it at, and the screen has
 * the editor's own marks on it. It is the technique `print.js` uses to print a
 * page, pointed at the editor's scene: each object is captured under a matrix
 * that maps the box onto the texture, and read back once.
 *
 * **What is left out** is everything that is the editor talking about the
 * canvas rather than the canvas: the lattice (named `CHROME_NAME` by
 * `grid-renderer.ts`), anything camera-locked (the modes' dims, and the
 * backdrops, which are sky rather than neighbours), and everything drawn at
 * `CHROME_DEPTH` or above — selection outlines, the marquee, the modes'
 * overlays, the pattern masks' outlines. And whatever the caller has hidden
 * for the length of the call, which is the PSD itself.
 */

import Phaser from "phaser";
import { isMaterial } from "./chrome";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The scene's material inside `box`, drawn into a `width × height` canvas —
 * smaller when the device cannot hold a texture that big. Null when it could
 * not be done.
 */
export async function captureBox(
  scene: Phaser.Scene,
  box: Box,
  width: number,
  height: number,
): Promise<HTMLCanvasElement | null> {
  const max = (scene.renderer as { getMaxTextureSize?: () => number }).getMaxTextureSize?.() ?? 4096;
  const fit = Math.min(1, max / width, max / height);
  const w = Math.max(1, Math.floor(width * fit));
  const h = Math.max(1, Math.floor(height * fit));
  const sx = w / box.width;
  const sy = h / box.height;

  let texture: Phaser.Textures.DynamicTexture | null = null;
  try {
    texture = scene.textures.addDynamicTexture(`__context-${Date.now()}-${Math.random()}`, w, h);
    if (!texture) return null;
    const list = scene.sys.displayList;
    list.depthSort();
    for (const object of list.list as Phaser.GameObjects.GameObject[]) {
      if (!isMaterial(object as never)) continue;
      // World onto the texture: the box's corner to 0,0, scaled to fit. The
      // object's own transform goes on top of this, as `print.js` relies on.
      const transform = new Phaser.GameObjects.Components.TransformMatrix(
        sx,
        0,
        0,
        sy,
        -box.x * sx,
        -box.y * sy,
      );
      texture.capture(object, { transform });
    }
    texture.render();
  } catch (err) {
    console.warn("Could not render the context:", err);
    texture?.destroy();
    return null;
  }

  const held = texture;
  const image = await new Promise<HTMLImageElement | null>((resolve) => {
    try {
      held.snapshot((snap) => resolve(snap instanceof HTMLImageElement ? snap : null));
    } catch {
      resolve(null);
    }
  });
  held.destroy();
  if (!image) return null;
  try {
    await image.decode();
  } catch {
    // Already decoded, or a data URL some engines decode synchronously.
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, w, h);
  return canvas;
}
