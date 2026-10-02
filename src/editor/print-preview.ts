/**
 * A captured page, drawn in the browser — the Output preview and its
 * thumbnails.
 *
 * `ExportForPrint()` sends the page as a list of things to draw (see
 * `templates/print/js/shared/print.js`), and nothing is written until Save.
 * So the preview cannot be a written file: it is the same list drawn here,
 * onto a canvas, from the screen-resolution copies in `assets/` the game was
 * already using — each sprite cut from its file and placed with its matrix,
 * each raster the game rendered laid over the whole page. It is the page's
 * geometry exactly, at screen resolution; Save writes the same list at the
 * project's DPI from the full-resolution twins.
 *
 * Alpha and blend modes are the canvas's own. A multiply tint is drawn
 * without its tint: the preview is for where things are, and the written file
 * is where colour is exact.
 */

import type { PrintPage } from "../lib/ipc";

/** Canvas's names for the blend modes `print.js` sends, where it has one. */
const BLENDS: Record<string, GlobalCompositeOperation> = {
  Multiply: "multiply",
  Screen: "screen",
  Overlay: "overlay",
  Darken: "darken",
  Lighten: "lighten",
  ColorDodge: "color-dodge",
  ColorBurn: "color-burn",
  HardLight: "hard-light",
  SoftLight: "soft-light",
  Difference: "difference",
  Exclusion: "exclusion",
  Hue: "hue",
  Saturation: "saturation",
  Color: "color",
  Luminosity: "luminosity",
};

/** Decoded images by URL, shared by every page drawn in this editor session. */
const images = new Map<string, Promise<HTMLImageElement | null>>();

function load(src: string): Promise<HTMLImageElement | null> {
  let held = images.get(src);
  if (!held) {
    held = new Promise((resolve) => {
      // No `crossOrigin`: nothing reads these pixels back, so a tainted
      // canvas costs nothing, and asking for CORS would fail on a server
      // that does not send the header.
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = src;
    });
    // A data URL is one page's raster, used once; caching it would keep every
    // snapshot's pixels alive for the life of the editor.
    if (!src.startsWith("data:")) images.set(src, held);
  }
  return held;
}

/**
 * Draw a page onto a canvas `longest` pixels on its long side, over white.
 * `base` is where the project is served — `http://127.0.0.1:<port>/<id>`.
 */
export async function drawPage(
  page: PrintPage,
  base: string,
  longest: number,
): Promise<HTMLCanvasElement> {
  const { width, height } = page.page;
  const scale = longest / Math.max(width, height, 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const bg = page.background;
  if (bg && bg[3] > 0) {
    ctx.fillStyle = `rgba(${bg[0]}, ${bg[1]}, ${bg[2]}, ${bg[3]})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Loaded together, drawn in order: the order is the page.
  const sources = await Promise.all(
    page.items.map((item) =>
      item.kind === "asset"
        ? load(`${base}/assets/${item.path ?? ""}`)
        : item.data
          ? load(item.data)
          : Promise.resolve(null),
    ),
  );
  page.items.forEach((item, i) => {
    const image = sources[i];
    if (!image) return;
    const [a, b, c, d, e, f] = item.matrix;
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, item.alpha ?? 1));
    ctx.globalCompositeOperation = BLENDS[item.blend ?? ""] ?? "source-over";
    ctx.setTransform(a * scale, b * scale, c * scale, d * scale, e * scale, f * scale);
    if (item.kind === "asset" && item.crop) {
      const [cx, cy, cw, ch] = item.crop;
      // The crop is in the screen copy's pixels; the file may have been
      // replaced by one of a different size since the page was read.
      const [sw, sh] = item.size ?? [image.naturalWidth, image.naturalHeight];
      const rx = image.naturalWidth / (sw || 1);
      const ry = image.naturalHeight / (sh || 1);
      ctx.drawImage(image, cx * rx, cy * ry, cw * rx, ch * ry, 0, 0, 1, 1);
    } else {
      ctx.drawImage(image, 0, 0, 1, 1);
    }
    ctx.restore();
  });
  return canvas;
}
