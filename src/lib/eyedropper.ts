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
 * So it samples **canvases**, and nothing else. Whatever is under the pointer
 * is asked for its pixel from the front of the stack backwards, and the first
 * one that is not see-through wins. In this editor that is the drawing
 * stage's two canvases over Phaser's — see `Docs/drawing.md` — and over on the
 * home screen it is the project thumbnails, which is a happy accident nobody
 * has to be told about.
 *
 * ## Why the engine's canvas needs a favour
 *
 * A 2D canvas answers `getImageData` immediately. A WebGL one does not: its
 * drawing buffer is cleared after each frame unless it was asked at creation
 * to keep one, and Phaser's is not. Asking for that would cost every frame of
 * the editor a copy, for a tool used a few times an hour.
 *
 * The renderer will read a pixel *during* a frame, though, which is what
 * `snapshotPixel` is, and that is a frame away rather than immediate. So the
 * sampling is asynchronous throughout and the engine registers itself through
 * `setEngineSampler` — which keeps Phaser out of `lib/`, and keeps this
 * working with nothing registered at all.
 */

import { rgbToHex } from "./color";

/**
 * How a WebGL canvas answers "what colour is this pixel".
 *
 * `x` and `y` are in the canvas's own backing pixels. `null` for a canvas the
 * sampler does not know about, so the caller can fall back.
 */
export type EngineSampler = (
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
) => Promise<string | null>;

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

/**
 * The colour on screen at a viewport point, or null where nothing answers.
 *
 * Front to back, first opaque pixel wins. *Opaque* rather than *present*
 * because the ink stage is a sheet of transparency with marks on it: a
 * sample beside a stroke has to fall through to the artwork under it, which
 * is what the eye is doing anyway.
 */
export async function sampleColorAt(
  clientX: number,
  clientY: number,
): Promise<string | null> {
  const stack = document
    .elementsFromPoint(clientX, clientY)
    .filter((el): el is HTMLCanvasElement => el instanceof HTMLCanvasElement);

  for (const canvas of stack) {
    const point = backingPoint(canvas, clientX, clientY);
    if (!point) continue;
    const hex = await readPixel(canvas, point.x, point.y);
    if (hex) return hex;
  }
  return null;
}

/**
 * A viewport point in one canvas's backing pixels, or null if it is outside.
 *
 * Through the bounding rect rather than through the element's own geometry,
 * because the drawing stage is moved and scaled by a single CSS transform and
 * its canvases are several times the size of what is on screen — see
 * `drawing/surface.ts`. The rect is what that transform actually produced, so
 * the ratio between it and the backing store is the mapping, whatever the
 * camera is doing.
 */
function backingPoint(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = Math.floor(((clientX - rect.left) / rect.width) * canvas.width);
  const y = Math.floor(((clientY - rect.top) / rect.height) * canvas.height);
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
  return { x, y };
}

/** One pixel of one canvas, by whichever route that canvas has. */
async function readPixel(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
): Promise<string | null> {
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
      const { data } = ctx.getImageData(x, y, 1, 1);
      if (data[3] === 0) return null;
      return rgbToHex({ r: data[0], g: data[1], b: data[2] });
    } catch {
      // A canvas holding cross-origin pixels is tainted and refuses to be
      // read. Nothing in this app draws one, but a thumbnail is an image and
      // an image is the sort of thing that acquires an origin later.
      return null;
    }
  }

  if (!engineSampler) return null;
  try {
    return await engineSampler(canvas, x, y);
  } catch {
    return null;
  }
}

/**
 * Take over the screen until somebody points at a colour, and hand it back.
 *
 * Null if they changed their mind — Escape, a second finger, a right-click,
 * or a tap that landed on nothing sampleable.
 *
 * **A press and a drag are the same gesture.** A tap picks what is under it;
 * a press that then moves keeps picking as it goes and settles on wherever it
 * is let go. That is one gesture on a Mac and it is the only usable one on an
 * iPad, where the thing being pointed at is under a finger: the loupe rides
 * above the touch so the colour can be read while the finger is still on it,
 * and the pick is made on lift rather than on land.
 */
export function pickColor(): Promise<string | null> {
  return new Promise((resolve) => {
    const veil = document.createElement("div");
    veil.className = "eyedrop-veil";

    const loupe = document.createElement("div");
    loupe.className = "eyedrop-loupe";
    const chip = document.createElement("span");
    chip.className = "eyedrop-chip";
    const label = document.createElement("span");
    label.className = "eyedrop-hex";
    label.textContent = "—";
    loupe.append(chip, label);
    veil.appendChild(loupe);
    document.body.appendChild(veil);

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

    const show = (hex: string | null): void => {
      seen = hex;
      chip.style.background = hex ?? "transparent";
      label.textContent = hex ? hex.toUpperCase() : "—";
    };

    const place = (event: PointerEvent): void => {
      // Above and to the left of the pointer, and flipped at either edge so
      // the readout is never the thing off screen.
      const flipX = event.clientX < 140;
      const flipY = event.clientY < 90;
      loupe.style.left = `${event.clientX + (flipX ? 18 : -18)}px`;
      loupe.style.top = `${event.clientY + (flipY ? 56 : -18)}px`;
      loupe.style.transform = `translate(${flipX ? "0" : "-100%"}, -100%)`;
    };

    // The veil is not in the way: `elementsFromPoint` hands back the whole
    // stack under a point rather than the topmost of it, so the veil is simply
    // the first thing in a list that then gets filtered to canvases.
    const look = (event: PointerEvent): void => {
      place(event);
      if (busy) return;
      busy = true;
      const at = { x: event.clientX, y: event.clientY };
      void sampleColorAt(at.x, at.y)
        .then((hex) => {
          if (!settled) show(hex);
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
      look(event);
      event.preventDefault();
    });
    veil.addEventListener("pointermove", (event) => {
      if (veil.hasPointerCapture(event.pointerId)) look(event);
    });
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
