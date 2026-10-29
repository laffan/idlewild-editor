/**
 * A picture's pixels as the plan keeps them — see `plan-images.ts`.
 *
 * Baked once, as it lands: the grey-to-blue is done to the pixels rather than
 * by CSS filters on every frame, because a filter chain over a large image
 * costs the iPad every time the camera moves, and the picture never needs its
 * own colours back. Scaled down on the way to `MAX_SIDE`, since it is a guide
 * and the document carries it.
 */

import { h } from "../lib/dom";
import { PLAN_COLOR } from "../lib/plan";

/** The longest side a picture is kept at, in pixels. */
const MAX_SIDE = 1600;

/**
 * The picture as the plan keeps it: no larger than `MAX_SIDE`, its tones run
 * from white to the plan's blue, as a JPEG.
 *
 * Transparent pixels go over white first, which is what a multiply leaves
 * untouched — so a cut-out PNG keeps its shape on the plan. Each tone is the
 * mix of white and the blue by how dark the pixel was: white stays white and
 * vanishes under the multiply, and black comes out the full blue.
 */
export function bake(source: CanvasImageSource & { width: number; height: number }): string {
  const scale = Math.min(1, MAX_SIDE / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = h("canvas", { width: String(width), height: String(height) }) as HTMLCanvasElement;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return "";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height);
  tint(data.data, PLAN_COLOR);
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** Desaturate opaque RGBA in place and run its tones from white to `hex`. */
export function tint(pixels: Uint8ClampedArray, hex: string): void {
  const n = parseInt(hex.slice(1, 7), 16);
  const blue = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  for (let i = 0; i < pixels.length; i += 4) {
    // Rec. 709 luminance, as a fraction of white.
    const light = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255;
    pixels[i] = 255 * light + blue[0] * (1 - light);
    pixels[i + 1] = 255 * light + blue[1] * (1 - light);
    pixels[i + 2] = 255 * light + blue[2] * (1 - light);
    pixels[i + 3] = 255;
  }
}

/**
 * Baked plan tones back to the plan's blue on transparency, as strong as each
 * tone was dark: white goes entirely and the full blue stays. What a picture
 * becomes in a PSD, where nothing multiplies — see `psd-plan.ts`. The tones
 * run from white to the blue by darkness (`tint`), so the darkness is read
 * straight back off the red channel.
 */
export function toBlue(pixels: Uint8ClampedArray): void {
  const n = parseInt(PLAN_COLOR.slice(1, 7), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  for (let i = 0; i < pixels.length; i += 4) {
    const dark = Math.max(0, Math.min(1, (255 - pixels[i]) / (255 - r)));
    pixels[i + 3] = Math.round(pixels[i + 3] * dark);
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
  }
}
