// ExportForPrint(), and the page it prints.
//
// A print project is a Phaser game whose screen is a sheet of paper: one
// world pixel is one PostScript point, the page's top-left corner is the
// world's origin, and the game is the size of the sheet. Everything on screen
// is drawn from the screen-resolution copies of the PSDs in `assets/`, which
// is what keeps code that moves five hundred sprites about quick to write and
// quick to run.
//
// `ExportForPrint(options)` is the moment the page is printed. It reads the
// page off the running scenes, at the end of the next frame drawn:
//
// - an image or sprite drawn from a file in `assets/` is sent as *that file*
//   and where it stands — position, rotation, scale, flip, alpha, tint and
//   blend mode — so the export can draw the full-resolution twin of the same
//   file in the same place, from `print/` beside it;
// - anything else that draws — Graphics, shapes, text, particles — has no
//   file behind it, so it is rendered here, at the project's DPI, and sent as
//   pixels.
//
// Every option is optional:
//
//   ExportForPrint({
//     name: "page",          // the file's name, without an extension
//     folder: "",            // a folder inside the project's exports/
//     formats: "pdf",        // "pdf", "psd", "png", or a list — or the bar's
//     stop: true,            // stop every scene once the page is read
//   });
//
// It returns a promise that settles once the files are written, with the
// paths it wrote, so a sequence of pages is a loop with an `await` in it —
// one file per frame of an animation, say:
//
//   for (let i = 0; i < 24; i++) {
//     setFrame(i);
//     await ExportForPrint({ folder: "frames", name: `frame-${i}`, stop: false });
//   }
//
// `stop` pauses the scenes rather than the game: nothing updates, so tweens,
// timers, physics and animations hold still, but the page goes on being drawn,
// so what was printed stays on screen.
//
// Inside the editor the page goes to the editor, which writes the files and
// previews the last. Anywhere else — a published site, a file opened from
// disk — there is no editor to send it to, and the promise settles at once
// with nothing written. This file is the editor's; it is written into every
// print project and read by `js/main.js`.

/** What the editor listens for, what it sends to ask for a page, and what it
 *  answers with once a page's files are written. */
const PAGE_MESSAGE = "idlewild-print";
const REQUEST_MESSAGE = "idlewild-print-request";
const DONE_MESSAGE = "idlewild-print-done";

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
  const inEditor = window.parent && window.parent !== window;
  const waiting = new Map();
  let next = 0;
  rememberSources();

  window.ExportForPrint = (options = {}) =>
    new Promise((resolve, reject) => {
      // At the end of the next frame drawn: whatever the code that called
      // this has just changed has been through a render, and every object
      // the document placed is standing where it will be drawn.
      game.events.once(Phaser.Core.Events.POST_RENDER, async () => {
        if (options.stop !== false) freeze(game);
        let page;
        try {
          page = await readPage(game, sheet, options);
        } catch (err) {
          reject(err);
          return;
        }
        report(page, sheet);
        if (!inEditor) {
          resolve({ files: [] });
          return;
        }
        const id = ++next;
        waiting.set(id, { resolve, reject });
        window.parent.postMessage(
          {
            source: PAGE_MESSAGE,
            id,
            out: outPath(options),
            formats: formatsOf(options.formats),
            ...page,
          },
          "*",
        );
      });
    });

  window.addEventListener("message", (event) => {
    const data = event.data;
    // The editor's own Export button asks for the page the same way a line
    // of code does, so a project that never calls it can still be printed.
    if (data?.source === REQUEST_MESSAGE) {
      void window.ExportForPrint(data.options ?? {});
      return;
    }
    if (data?.source !== DONE_MESSAGE) return;
    const held = waiting.get(data.id);
    if (!held) return;
    waiting.delete(data.id);
    if (data.error) held.reject(new Error(data.error));
    else held.resolve({ files: data.files ?? [] });
  });
}

/** Where the files go, inside exports/, without an extension. */
function outPath(options) {
  const clean = (part) =>
    String(part ?? "")
      .split("/")
      .map((segment) => segment.trim())
      .filter((segment) => segment && segment !== "." && segment !== "..")
      .join("/");
  const folder = clean(options.folder);
  const name = clean(options.name) || "page";
  return folder ? `${folder}/${name}` : name;
}

/**
 * The formats a page is written as, as a list — or undefined, for whatever
 * the editor's bar says. One format or several: `"png"`, `["pdf", "png"]`.
 */
function formatsOf(formats) {
  const known = ["pdf", "psd", "png"];
  const list = (Array.isArray(formats) ? formats : [formats]).filter((f) =>
    known.includes(f),
  );
  return list.length > 0 ? [...new Set(list)] : undefined;
}

/** What the console says about a page. */
function report(page, sheet) {
  console.info(
    `ExportForPrint(): ${page.items.length} ` +
      `item${page.items.length === 1 ? "" : "s"} on a ` +
      `${sheet.width} × ${sheet.height} pt sheet at ${sheet.dpi} DPI.`,
  );
  if (page.skipped > 0) {
    console.warn(
      `ExportForPrint(): ${page.skipped} object${page.skipped === 1 ? "" : "s"} ` +
        "could not be read and were left off the page.",
    );
  }
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

/**
 * Stop everything that moves, so the page on screen is the page printed.
 *
 * The scenes are paused rather than the game. A paused scene does not update
 * — its tweens, timers, physics and animations hold still — but it is still
 * drawn, so the page stays on screen. Stopping the game's loop instead stops
 * the drawing too, and a page printed before its first frame is a blank
 * canvas from then on.
 */
function freeze(game) {
  for (const scene of game.scene.getScenes(true)) scene.scene.pause();
  game.sound?.pauseAll?.();
}

/** Every visible thing on the page, back to front, as the editor wants it. */
async function readPage(game, sheet) {
  const scale = Math.max(1, sheet.dpi / 72);
  const items = [];
  let skipped = 0;
  // Consecutive things with no file behind them are rendered together, in
  // order, so a fill under a sprite under a line of text stays in that order.
  let run = [];

  // A run is rendered now, in its place, and read back later: the readback
  // is asynchronous, and the order of `items` is the order on the page.
  const flush = (scene, camera) => {
    if (run.length === 0) return;
    const count = run.length;
    items.push(
      rasterise(scene, camera, run, sheet, scale).then((raster) => {
        if (raster === null) skipped += count;
        return raster;
      }),
    );
    run = [];
  };

  let background = null;
  // Running and paused alike: a page printed after another that stopped
  // everything is still a page of the scenes on screen.
  const onScreen = game.scene
    .getScenes(false)
    .filter((scene) => scene.sys.isActive() || scene.sys.isPaused());
  for (const scene of onScreen) {
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

  const settled = (await Promise.all(items)).filter(Boolean);
  return {
    page: { width: sheet.width, height: sheet.height, dpi: sheet.dpi },
    background,
    items: settled,
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
 * Resolves to the raster, or to null when it could not be done. A raster
 * with nothing drawn on it — an empty Graphics, a shape off the page — is
 * trimmed away on the far side.
 *
 * One page-sized texture per run, drawn at `scale` pixels to the point — less
 * when the device cannot hold a texture that big — and read back with
 * Phaser's own snapshot, which keeps the renderer's state its own: reaching
 * past it to the WebGL context is what left the game's canvas blank. Text is
 * re-rendered at the same resolution for the capture and put back after,
 * because a line of text drawn at screen resolution and scaled up is a
 * blurred line of text.
 */
async function rasterise(scene, camera, objects, sheet, scale) {
  const max = scene.renderer.getMaxTextureSize?.() ?? 4096;
  const fit = Math.min(scale, max / sheet.width, max / sheet.height);
  const width = Math.max(1, Math.floor(sheet.width * fit));
  const height = Math.max(1, Math.floor(sheet.height * fit));

  let texture;
  const texts = [];
  try {
    texture = scene.textures.addDynamicTexture(
      `__print-${Date.now()}-${Math.random()}`,
      width,
      height,
    );
    for (const object of objects) {
      if (typeof object.setResolution === "function" && object.style) {
        texts.push([object, object.style.resolution ?? 1]);
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
  } finally {
    for (const [text, resolution] of texts) text.setResolution(resolution);
  }

  const data = await new Promise((resolve) => {
    try {
      texture.snapshot((image) => resolve(image?.src ?? null));
    } catch {
      resolve(null);
    }
  });
  texture.destroy();
  if (typeof data !== "string" || !data.startsWith("data:image")) return null;

  return {
    kind: "raster",
    data,
    width,
    height,
    matrix: [sheet.width, 0, 0, sheet.height, 0, 0],
    alpha: 1,
    blend: "Normal",
  };
}
