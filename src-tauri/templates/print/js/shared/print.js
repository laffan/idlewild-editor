// ExportForPrint(), and the page it prints.
//
// A print project is a Phaser game whose screen is a sheet of paper: one
// world pixel is one PostScript point, the page's top-left corner is the
// world's origin, and the game is the size of the sheet. Everything on screen
// is drawn from the screen-resolution copies of the PSDs in `assets/`, which
// is what keeps code that moves five hundred sprites about quick to write and
// quick to run.
//
// `ExportForPrint()` is the moment the page is printed. It stops the game —
// every tween, every animation, every update — so what is on screen stays
// exactly as it was, and then it reads the page off the running scenes:
//
// - an image or sprite drawn from a file in `assets/` is sent as *that file*
//   and where it stands — position, rotation, scale, flip, alpha, tint and
//   blend mode — so the PDF can draw the full-resolution twin of the same
//   file in the same place, from `print/` beside it;
// - anything else that draws — Graphics, shapes, text, particles — has no
//   file behind it, so it is rendered here, at the project's DPI, and sent as
//   pixels.
//
// Inside the editor's Export section the page goes to the editor, which
// writes the PDF and previews it. Anywhere else — a published site, a file
// opened from disk — there is no editor to send it to, and the game simply
// stops where it is. This file is the editor's; it is written into every
// print project and read by `js/main.js`.

/** What the editor listens for, and what it sends to ask for a page. */
const PAGE_MESSAGE = "idlewild-print";
const REQUEST_MESSAGE = "idlewild-print-request";

/** PDF's names for Phaser's blend modes, where PDF has one. */
const BLENDS = {
  2: "Multiply",
  3: "Screen",
  4: "Overlay",
  5: "Darken",
  6: "Lighten",
  7: "ColorDodge",
  8: "ColorBurn",
  9: "HardLight",
  10: "SoftLight",
  11: "Difference",
  12: "Exclusion",
  13: "Hue",
  14: "Saturation",
  15: "Color",
  16: "Luminosity",
};

/**
 * Put `ExportForPrint` on the page, for this game and this sheet.
 *
 * `config.print` is the sheet as the editor wrote it into the generated
 * config: its size in points and its DPI.
 */
export function installPrint(game, config) {
  const sheet = config.print ?? { width: 612, height: 792, dpi: 300 };
  let printed = false;
  rememberSources();

  window.ExportForPrint = (options = {}) => {
    if (printed) return;
    printed = true;
    freeze(game);
    const page = readPage(game, sheet, options);
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ source: PAGE_MESSAGE, ...page }, "*");
    }
    console.info(
      `ExportForPrint(): the page is printed — ${page.items.length} ` +
        `item${page.items.length === 1 ? "" : "s"} on a ` +
        `${sheet.width} × ${sheet.height} pt sheet at ${sheet.dpi} DPI.`,
    );
    if (page.skipped > 0) {
      console.warn(
        `ExportForPrint(): ${page.skipped} object${page.skipped === 1 ? "" : "s"} ` +
          "could not be read and were left off the page.",
      );
    }
  };

  // The Export section's own button asks for the page the same way a line of
  // code does, so a project that never calls it can still be printed.
  window.addEventListener("message", (event) => {
    if (event.data?.source === REQUEST_MESSAGE) window.ExportForPrint();
  });
}

/**
 * Which file each texture was loaded from, by texture key.
 *
 * A texture cannot say so itself: Phaser fetches an image as a blob and hands
 * the texture an object URL that is revoked the moment it has decoded, so the
 * only place the file's real address is ever written down is the loader's
 * own record of the request. Every loader in the game passes through this one
 * method as a file finishes, which is what makes it the place to listen —
 * psd-to-phaser's sprites, and anything the project's own code loads, alike.
 */
const sources = new Map();

function rememberSources() {
  const proto = Phaser.Loader.LoaderPlugin.prototype;
  if (proto.__idlewildPrint) return;
  const original = proto.fileProcessComplete;
  proto.fileProcessComplete = function (file) {
    if (file?.type === "image" && typeof file.src === "string") {
      sources.set(file.key, file.src);
    }
    return original.call(this, file);
  };
  proto.__idlewildPrint = true;
}

/** Stop everything that moves, so the page on screen is the page printed. */
function freeze(game) {
  for (const scene of game.scene.getScenes(true)) {
    scene.tweens?.pauseAll();
    scene.time && (scene.time.paused = true);
    scene.physics?.pause?.();
    scene.matter?.pause?.();
  }
  game.anims?.pauseAll();
  game.sound?.pauseAll?.();
  if (typeof game.pause === "function") game.pause();
  else game.loop.sleep();
}

/** Every visible thing on the page, back to front, as the editor wants it. */
function readPage(game, sheet, options) {
  const scale = Math.max(1, (options.dpi ?? sheet.dpi) / 72);
  const items = [];
  let skipped = 0;
  // Consecutive things with no file behind them are rendered together, in
  // order, so a fill under a sprite under a line of text stays in that order.
  let run = [];

  const flush = (scene, camera) => {
    if (run.length === 0) return;
    const raster = rasterise(scene, camera, run, sheet, scale);
    if (raster === null) skipped += run.length;
    else if (raster) items.push(raster);
    run = [];
  };

  let background = null;
  for (const scene of game.scene.getScenes(true)) {
    if (!scene.sys.settings.visible) continue;
    const camera = scene.cameras.main;
    if (!background && camera.backgroundColor?.alpha > 0) {
      const c = camera.backgroundColor;
      background = [c.red, c.green, c.blue, c.alpha / 255];
    }
    scene.sys.displayList.depthSort();
    walk(scene.sys.displayList.list, null, 1, (object, parent, alpha) => {
      const asset = assetItem(object, camera, parent, alpha);
      if (asset) {
        flush(scene, camera);
        items.push(asset);
      } else {
        run.push(object);
      }
    });
    flush(scene, camera);
  }

  return {
    page: { width: sheet.width, height: sheet.height, dpi: sheet.dpi },
    background,
    items,
    skipped,
  };
}

/** Visit every drawable object in order, into containers and layers. */
function walk(list, parent, alpha, visit) {
  for (const object of list) {
    if (!object.visible || object.alpha === 0) continue;
    const children = object.list;
    if (Array.isArray(children)) {
      // A Container carries a transform; a Layer does not.
      const isContainer = typeof object.getWorldTransformMatrix === "function";
      walk(
        children,
        isContainer ? object : parent,
        alpha * (object.alpha ?? 1),
        visit,
      );
      continue;
    }
    if (typeof object.renderWebGL !== "function") continue;
    visit(object, parent, alpha);
  }
}

/** The camera-space matrix an object is drawn with, as six numbers. */
function cameraMatrix(object, camera, parent) {
  const calc = Phaser.GameObjects.GetCalcMatrix(
    object,
    camera,
    parent ? parent.getWorldTransformMatrix() : undefined,
    true,
  ).calc;
  return [calc.a, calc.b, calc.c, calc.d, calc.e, calc.f];
}

/** Multiply two six-number matrices: first `m`, then `n` on top of it. */
function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/**
 * An image drawn from a file in `assets/`, or null for anything else.
 *
 * The matrix maps the frame's own unit square — its top-left at 0,0 and its
 * bottom-right at 1,1 — onto the page, in points. That is the same quad
 * Phaser's renderer builds: the frame's offset and the display origin, the
 * flip as a negative scale, and the object's own transform under the camera's.
 */
function assetItem(object, camera, parent, alpha) {
  const frame = object.frame;
  const texture = object.texture;
  // One file per texture: a multi-atlas has several, and which one a frame
  // came from is not something the loader's record says.
  if (!frame || !texture || texture.source?.length !== 1) return null;
  const src = sources.get(texture.key) ?? frame.source?.image?.src;
  const path = typeof src === "string" ? assetPath(src) : null;
  if (!path) return null;
  if (object.isCropped) return null;

  let x = -object.displayOriginX + frame.x;
  let y = -object.displayOriginY + frame.y;
  let flipX = 1;
  let flipY = 1;
  if (object.flipX) {
    if (!frame.customPivot) x += -frame.realWidth + object.displayOriginX * 2;
    flipX = -1;
  }
  if (object.flipY) {
    if (!frame.customPivot) y += -frame.realHeight + object.displayOriginY * 2;
    flipY = -1;
  }

  const placed = cameraMatrix(object, camera, parent);
  // `GetCalcMatrix` applied the object's own scale; the flip is a scale too.
  const flipped = multiply(placed, [flipX, 0, 0, flipY, 0, 0]);
  const quad = multiply(flipped, [frame.cutWidth, 0, 0, frame.cutHeight, x, y]);

  return {
    kind: "asset",
    path,
    crop: [frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight],
    size: [frame.source.width, frame.source.height],
    matrix: quad,
    alpha: alpha * object.alpha,
    blend: BLENDS[object.blendMode] ?? "Normal",
    tint: tintOf(object),
  };
}

/** The part of an asset URL after `assets/`, or null when it is not one. */
function assetPath(src) {
  let path;
  try {
    path = new URL(src, location.href).pathname;
  } catch {
    return null;
  }
  const at = path.lastIndexOf("/assets/");
  return at < 0 ? null : decodeURIComponent(path.slice(at + "/assets/".length));
}

/** A single multiply tint, as 0xRRGGBB, or null for none. */
function tintOf(object) {
  if (object.tintFill) return null;
  const tint = object.tintTopLeft;
  if (typeof tint !== "number" || tint === 0xffffff) return null;
  const same =
    object.tintTopRight === tint &&
    object.tintBottomLeft === tint &&
    object.tintBottomRight === tint;
  return same ? tint : null;
}

/**
 * Render a run of objects with no file behind them, at print resolution.
 *
 * Null when it could not be done, undefined when it drew nothing at all.
 *
 * One page-sized texture per run, drawn at `scale` pixels to the point — less
 * when the device cannot hold a texture that big — and read back as a PNG.
 * Text is re-rendered at the same resolution first, because a line of text
 * drawn at screen resolution and scaled up is a blurred line of text.
 */
function rasterise(scene, camera, objects, sheet, scale) {
  const max = scene.renderer.getMaxTextureSize?.() ?? 4096;
  const fit = Math.min(scale, max / sheet.width, max / sheet.height);
  const width = Math.max(1, Math.floor(sheet.width * fit));
  const height = Math.max(1, Math.floor(sheet.height * fit));

  let texture;
  try {
    texture = scene.textures.addDynamicTexture(
      `__print-${Date.now()}-${Math.random()}`,
      width,
      height,
    );
    for (const object of objects) {
      if (typeof object.setResolution === "function" && object.style) {
        object.setResolution(fit);
      }
      const transform = new Phaser.GameObjects.Components.TransformMatrix();
      transform.copyWithScrollFactorFrom(
        camera.matrix,
        camera.scrollX,
        camera.scrollY,
        object.scrollFactorX ?? 1,
        object.scrollFactorY ?? 1,
      );
      const scaled = new Phaser.GameObjects.Components.TransformMatrix(
        fit,
        0,
        0,
        fit,
        0,
        0,
      );
      scaled.multiply(transform, transform);
      if (object.parentContainer) {
        transform.multiply(object.parentContainer.getWorldTransformMatrix());
      }
      texture.capture(object, { transform });
    }
    texture.render();
  } catch (err) {
    console.warn("ExportForPrint(): could not render part of the page:", err);
    texture?.destroy();
    return null;
  }

  const pixels = readPixels(scene.renderer, texture, width, height);
  texture.destroy();
  // Nothing drawn at all — an empty Graphics, a shape off the page — is not
  // a failure, and there is nothing to send.
  if (pixels === "") return undefined;
  if (!pixels) return null;

  return {
    kind: "raster",
    data: pixels,
    width,
    height,
    matrix: [sheet.width, 0, 0, sheet.height, 0, 0],
    alpha: 1,
    blend: "Normal",
  };
}

/**
 * A dynamic texture's pixels, as a PNG data URL, read synchronously — or an
 * empty string when every pixel is clear, and null when it cannot be read.
 */
function readPixels(renderer, texture, width, height) {
  const gl = renderer.gl;
  const framebuffer = texture.drawingContext?.framebuffer;
  if (!gl || !framebuffer) return null;
  const raw = new Uint8Array(width * height * 4);
  gl.bindFramebuffer(
    gl.FRAMEBUFFER,
    framebuffer.webGLFramebuffer ?? framebuffer,
  );
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // WebGL reads bottom-up, and premultiplied.
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const out = ctx.createImageData(width, height);
  let any = false;
  for (let row = 0; row < height; row++) {
    const from = (height - 1 - row) * width * 4;
    const into = row * width * 4;
    for (let i = 0; i < width * 4; i += 4) {
      const a = raw[from + i + 3];
      if (a === 0) continue;
      any = true;
      out.data[into + i] = Math.min(255, Math.round((raw[from + i] * 255) / a));
      out.data[into + i + 1] = Math.min(
        255,
        Math.round((raw[from + i + 1] * 255) / a),
      );
      out.data[into + i + 2] = Math.min(
        255,
        Math.round((raw[from + i + 2] * 255) / a),
      );
      out.data[into + i + 3] = a;
    }
  }
  if (!any) return "";
  ctx.putImageData(out, 0, 0);
  return canvas.toDataURL("image/png");
}
