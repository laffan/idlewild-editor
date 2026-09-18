/**
 * Picking a colour off the canvas.
 *
 * Hand-built, like the picker it sits in. The platform has an `EyeDropper`
 * API now and it is no use here: it is Chromium's, WKWebView has never
 * shipped it, and this editor is mostly used on an iPad. It also samples the
 * whole *screen*, which is more than anybody wanted — what a person means by
 * the eyedropper in a drawing app is "that colour, there, in my picture", and
 * a tool that will also hand back the shade of grey behind a toolbar button
 * is a tool that hands back the wrong answer about a third of the time.
 *
 * So it samples **canvases**, and nothing else. In this editor that is the
 * drawing stage's two canvases over Phaser's — see `Docs/drawing.md` — and on
 * the home screen it is the project thumbnails, which is a happy accident.
 *
 * ## It reads a patch, not a pixel
 *
 * What comes back from one sample is a small square of the screen, composited
 * back to front through every canvas under the pointer, and the colour is the
 * middle of it. Two things follow from that and both are the point.
 *
 * The colour is **what you can see**, rather than what the topmost layer
 * holding anything happens to contain: a half-transparent stroke over the
 * grid samples as the blend, the way an eye reads it, instead of as the
 * stroke's own hue at full strength.
 *
 * And the patch is what the **loupe** draws. A preview that is a flat chip of
 * the answer tells you what you have got; a magnified patch tells you what you
 * are *about* to get, which is the question being asked while the pointer is
 * still moving. On a 16px grid the difference between two neighbouring pixels
 * is the difference between the tileset and its outline.
 *
 * ## Why the engine's canvas needs a favour
 *
 * A 2D canvas answers `getImageData` immediately. A WebGL one does not: its
 * drawing buffer is cleared after each frame unless it was asked at creation
 * to keep one, and Phaser's is not. Asking for that would cost every frame of
 * the editor a copy, for a tool used a few times an hour.
 *
 * The renderer will read pixels *during* a frame, though, which is what
 * `snapshot*` is, and that is a frame away rather than immediate. So the
 * sampling is asynchronous throughout and the engine registers itself through
 * `setEngineSampler` — which keeps Phaser out of `lib/`, and keeps this
 * working with nothing registered at all.
 */

import { rgbToHex } from "./color";

/**
 * How a canvas the DOM cannot read answers for a patch of itself.
 *
 * The rectangle is in the canvas's own backing pixels and is already clipped
 * to it. `null` for a canvas the sampler does not know about, so the walk down
 * the stack can carry on past it.
 */
export type EngineSampler = (
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number,
) => Promise<ImageData | null>;

let engineSampler: EngineSampler | null = null;

/**
 * Say how the engine's own canvas is read, and get the way to take it back.
 *
 * Registered by the editor once a game is up, and unregistered when it goes
 * down — a sampler pointed at a destroyed renderer would throw inside a
 * gesture rather than simply decline.
 */
export function setEngineSampler(sampler: EngineSampler | null): () => void {
  engineSampler = sampler;
  return () => {
    if (engineSampler === sampler) engineSampler = null;
  };
}

/** A square of screen, and the colour in the middle of it. */
export interface Sample {
  /** `2 * radius + 1` square, composited back to front. */
  patch: ImageData;
  /** The middle pixel as `#rrggbb`, or null where nothing was drawn. */
  hex: string | null;
}

/**
 * The screen around a viewport point, and the colour at it.
 *
 * `radius` is in **CSS pixels**, because that is what somebody is pointing at.
 * Each canvas is asked for whatever part of its own backing store falls under
 * that square — which is a different number of pixels per canvas, since the
 * drawing stage is several times the size of what is on screen and moved by a
 * CSS transform (see `drawing/surface.ts`) — and each is drawn into the patch
 * scaled to fit. So the patch is a picture of the screen rather than of any
 * one canvas's pixels.
 */
export async function sampleAt(
  clientX: number,
  clientY: number,
  radius: number,
): Promise<Sample> {
  const size = radius * 2 + 1;
  const patch = scratch(size);
  patch.ctx.clearRect(0, 0, size, size);

  // Back to front, so what comes out is the composite rather than whichever
  // layer happened to hold something.
  const stack = document
    .elementsFromPoint(clientX, clientY)
    .filter((el): el is HTMLCanvasElement => el instanceof HTMLCanvasElement)
    .reverse();

  for (const canvas of stack) {
    const region = await readRegion(canvas, clientX, clientY, radius);
    if (region) draw(patch.ctx, region);
  }

  const middle = patch.ctx.getImageData(radius, radius, 1, 1).data;
  return {
    patch: patch.ctx.getImageData(0, 0, size, size),
    hex:
      middle[3] === 0
        ? null
        : rgbToHex({ r: middle[0], g: middle[1], b: middle[2] }),
  };
}

/** Just the colour — what a commit takes. */
export async function sampleColorAt(
  clientX: number,
  clientY: number,
): Promise<string | null> {
  return (await sampleAt(clientX, clientY, 0)).hex;
}

/** One canvas's share of the square under the pointer, and where it lands. */
interface Region {
  pixels: ImageData;
  /** Where it goes in the patch, in patch pixels — fractional at the edges. */
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Read the square under the pointer out of one canvas.
 *
 * Through the bounding rect rather than through the element's own geometry,
 * because the drawing stage is moved and scaled by a single CSS transform and
 * its canvases are several times the size of what is on screen. The rect is
 * what that transform actually produced, so the ratio between it and the
 * backing store is the mapping, whatever the camera is doing.
 *
 * The square is clipped to the canvas, and what was clipped is why `Region`
 * carries a destination: a pointer at the very edge of the artwork reads a
 * half square, and that half has to land on its own half of the patch rather
 * than being stretched across the whole of it.
 */
async function readRegion(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  radius: number,
): Promise<Region | null> {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  if (canvas.width <= 0 || canvas.height <= 0) return null;

  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  // The square in this canvas's backing pixels, before clipping.
  const wanted = {
    left: (clientX - radius - rect.left) * scaleX,
    top: (clientY - radius - rect.top) * scaleY,
    width: (radius * 2 + 1) * scaleX,
    height: (radius * 2 + 1) * scaleY,
  };

  const left = Math.floor(Math.max(0, wanted.left));
  const top = Math.floor(Math.max(0, wanted.top));
  const right = Math.ceil(Math.min(canvas.width, wanted.left + wanted.width));
  const bottom = Math.ceil(Math.min(canvas.height, wanted.top + wanted.height));
  if (right <= left || bottom <= top) return null;

  const pixels = await readPixels(canvas, left, top, right - left, bottom - top);
  if (!pixels) return null;

  // Back into patch pixels: what fraction of the wanted square this is.
  return {
    pixels,
    left: ((left - wanted.left) / wanted.width) * (radius * 2 + 1),
    top: ((top - wanted.top) / wanted.height) * (radius * 2 + 1),
    width: ((right - left) / wanted.width) * (radius * 2 + 1),
    height: ((bottom - top) / wanted.height) * (radius * 2 + 1),
  };
}

/** Pixels out of one canvas, by whichever route that canvas has. */
async function readPixels(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<ImageData | null> {
  // `getContext("2d")` on a canvas already holding a WebGL context returns
  // null rather than throwing, which is exactly the question being asked.
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    ctx = null;
  }

  if (ctx) {
    try {
      return ctx.getImageData(x, y, width, height);
    } catch {
      // A canvas holding cross-origin pixels is tainted and refuses to be
      // read. Nothing in this app draws one, but a thumbnail is an image and
      // an image is the sort of thing that acquires an origin later.
      return null;
    }
  }

  if (!engineSampler) return null;
  try {
    return await engineSampler(canvas, x, y, width, height);
  } catch {
    return null;
  }
}

/** Composite one canvas's region onto the patch, at the size it covers. */
function draw(ctx: CanvasRenderingContext2D, region: Region): void {
  const source = scratch(0, "source");
  source.canvas.width = region.pixels.width;
  source.canvas.height = region.pixels.height;
  source.ctx.putImageData(region.pixels, 0, 0);

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    source.canvas,
    0,
    0,
    region.pixels.width,
    region.pixels.height,
    region.left,
    region.top,
    region.width,
    region.height,
  );
}

/**
 * Two canvases kept between samples, by name.
 *
 * A drag takes one of these a frame; allocating a pair each time is a pair of
 * backing stores a frame for the garbage collector to find. `size` of 0 means
 * the caller sets the dimensions itself.
 */
const scratches = new Map<
  string,
  { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }
>();

function scratch(
  size: number,
  name = "patch",
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  let held = scratches.get(name);
  if (!held) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("no 2d context for the eyedropper");
    held = { canvas, ctx };
    scratches.set(name, held);
  }
  if (size > 0 && (held.canvas.width !== size || held.canvas.height !== size)) {
    held.canvas.width = size;
    held.canvas.height = size;
  }
  return held;
}

/**
 * How many screen pixels either side of the pointer the loupe magnifies.
 *
 * Eleven across. Enough to see which side of an edge the pointer is on, few
 * enough that each one is a square you could aim at — at 6× that is a 132px
 * disc, which is about as much as should sit over somebody's artwork.
 */
const LOUPE_RADIUS = 5;

/** How much each of those pixels is blown up by. */
const LOUPE_ZOOM = 12;

/**
 * Take over the screen until somebody points at a colour, and hand it back.
 *
 * Null if they changed their mind — Escape, a right-click, a cancelled
 * gesture, or a lift over something with nothing to sample.
 *
 * **A press and a drag are the same gesture.** A tap picks what is under it;
 * a press that then moves keeps picking as it goes and settles on wherever it
 * is let go. That is one gesture on a Mac and it is the only usable one on an
 * iPad, where the thing being pointed at is under a finger.
 *
 * **The loupe is the preview.** It rides with the pointer showing the screen
 * magnified, with the pixel that would be taken boxed in the middle of it and
 * the hex under that — so what is being chosen is legible before it is
 * chosen, which is the whole difficulty with a one-pixel target. It is
 * centred on the pointer for a mouse or a pen, because a magnified view of
 * what is underneath is not in the way of anything; on a **touch** it sits
 * above the finger, because a finger is.
 */
export function pickColor(): Promise<string | null> {
  return new Promise((resolve) => {
    const veil = document.createElement("div");
    veil.className = "eyedrop-veil";

    const loupe = document.createElement("div");
    loupe.className = "eyedrop-loupe";
    const glass = document.createElement("canvas");
    glass.className = "eyedrop-glass";
    const side = LOUPE_RADIUS * 2 + 1;
    glass.width = side * LOUPE_ZOOM;
    glass.height = side * LOUPE_ZOOM;
    const label = document.createElement("span");
    label.className = "eyedrop-hex";
    label.textContent = "—";
    loupe.append(glass, label);
    veil.appendChild(loupe);
    document.body.appendChild(veil);

    const glassCtx = glass.getContext("2d");
    let seen: string | null = null;
    /** One sample in flight at a time: a drag outruns the renderer otherwise. */
    let busy = false;
    let settled = false;

    const finish = (hex: string | null): void => {
      if (settled) return;
      settled = true;
      document.removeEventListener("keydown", onKey, true);
      veil.remove();
      resolve(hex);
    };

    /** Paint the magnified patch, and box the pixel that would be taken. */
    const show = (sample: Sample): void => {
      seen = sample.hex;
      label.textContent = sample.hex ? sample.hex.toUpperCase() : "—";
      loupe.style.setProperty("--eyedrop-ink", sample.hex ?? "transparent");
      if (!glassCtx) return;

      glassCtx.clearRect(0, 0, glass.width, glass.height);
      // Nearest neighbour: this is a magnifier, and a smoothed one would
      // invent colours between the pixels somebody is choosing between.
      glassCtx.imageSmoothingEnabled = false;
      const source = scratch(0, "loupe");
      source.canvas.width = sample.patch.width;
      source.canvas.height = sample.patch.height;
      source.ctx.putImageData(sample.patch, 0, 0);
      glassCtx.drawImage(source.canvas, 0, 0, glass.width, glass.height);

      // The middle cell, boxed in both inks so it reads against either.
      const at = LOUPE_RADIUS * LOUPE_ZOOM;
      glassCtx.lineWidth = 2;
      glassCtx.strokeStyle = "rgba(32, 30, 29, 0.85)";
      glassCtx.strokeRect(at - 1, at - 1, LOUPE_ZOOM + 2, LOUPE_ZOOM + 2);
      glassCtx.strokeStyle = "rgba(255, 255, 255, 0.95)";
      glassCtx.strokeRect(at + 1, at + 1, LOUPE_ZOOM - 2, LOUPE_ZOOM - 2);
    };

    const place = (event: PointerEvent): void => {
      loupe.style.left = `${event.clientX}px`;
      loupe.style.top = `${event.clientY}px`;
      // On the pointer, except under a finger — which covers exactly the
      // thing the loupe exists to show.
      loupe.classList.toggle("above", event.pointerType === "touch");
    };

    // The veil is not in the way: `elementsFromPoint` hands back the whole
    // stack under a point rather than the topmost of it, so the veil is simply
    // the first thing in a list that then gets filtered to canvases.
    const look = (event: PointerEvent): void => {
      place(event);
      if (busy) return;
      busy = true;
      const at = { x: event.clientX, y: event.clientY };
      void sampleAt(at.x, at.y, LOUPE_RADIUS)
        .then((sample) => {
          if (!settled) show(sample);
        })
        .finally(() => {
          busy = false;
        });
    };

    veil.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 && event.pointerType === "mouse") {
        finish(null);
        return;
      }
      veil.setPointerCapture(event.pointerId);
      loupe.classList.add("live");
      look(event);
      event.preventDefault();
    });
    // Hovering with a mouse or a pen previews before anything is pressed.
    // A touch has no hover, which is why the press is the same gesture.
    veil.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch" && !veil.hasPointerCapture(event.pointerId)) {
        return;
      }
      loupe.classList.add("live");
      look(event);
    });
    veil.addEventListener("pointerleave", () => loupe.classList.remove("live"));
    veil.addEventListener("pointerup", (event) => {
      veil.releasePointerCapture(event.pointerId);
      // One last read at the point it was let go of, rather than whatever the
      // loupe happens to be showing: a drag that outran the renderer left the
      // loupe a sample or two behind, and the colour somebody committed to is
      // the one under the finger when it came off. What the loupe had is the
      // fallback, for a lift the read cannot answer.
      void sampleColorAt(event.clientX, event.clientY).then((hex) =>
        finish(hex ?? seen),
      );
    });
    veil.addEventListener("pointercancel", () => finish(null));
    veil.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      finish(null);
    });

    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      finish(null);
    };
    // Captured, so Escape reaches this before the sheet or panel behind it.
    document.addEventListener("keydown", onKey, true);
  });
}
