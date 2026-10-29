/**
 * Pictures on the plan: dropped in, turned blue, traced over.
 *
 * A picture dropped on the canvas becomes a PSD, because it is on its way
 * into the game. One dropped while plan mode is up is not going anywhere —
 * a photo of a sketchbook page, a map to work from — so it stays a picture,
 * and the plan's: **desaturated, tinted the pencil's blue and multiplied**
 * over what is under it, so it reads as part of the same sheet of tracing
 * paper as the strokes rather than as artwork laid on top. See `lib/plan.ts`
 * for how it is kept.
 *
 * **Baked once, as it lands.** The grey-to-blue is done to the pixels when
 * the picture arrives rather than by CSS filters on every frame: a filter
 * chain over a large image costs the iPad every time the camera moves, and
 * the picture never needs its own colours back. It is scaled down on the way
 * to `MAX_SIDE`, since it is a guide and the document carries it.
 *
 * **Multiplied by CSS.** The layer is a sibling of the plan's sheet, over it,
 * with `mix-blend-mode: multiply` on the layer as a whole — on the pictures
 * inside it, the blend would only reach the layer's own empty backdrop. So in
 * the mode it darkens the white wash and the scene under it, the plan's ink
 * shows through it, and out of the mode it multiplies straight onto the scene
 * at the Plan row's opacity, like the strokes.
 *
 * **Selected and dragged by the rules the canvas keeps.** A press on a
 * picture under the Lasso picks it up; a selected picture follows a pen, a
 * mouse or a finger under any tool, so one just dropped can be put in place
 * at once. Anywhere else, the press is the tool's as it always was — drawing
 * over a picture is the point of it — and lets go of the picture. The drag
 * writes the document once, on release.
 */

import type { Viewport } from "../drawing";
import { makeId } from "../lib/doc-store";
import type { DocStore } from "../lib/doc-store";
import { h } from "../lib/dom";
import * as log from "../lib/log";
import { PLAN_COLOR, planImagesOf, writePlanImages, type PlanImage } from "../lib/plan";

/** The longest side a picture is kept at, in pixels. */
const MAX_SIDE = 1600;
/** How much of the view a picture may cover as it lands, on either axis. */
const LANDING_SHARE = 0.6;
/** How far a press may stray and still be a tap, in screen px. */
const TAP_SLOP = 6;

export interface PlanImagesDeps {
  store: DocStore;
  /** The plan's drawing surface, whose presses are asked about first. */
  surface: HTMLElement;
  /** Whether plan mode is up — out of it the pictures take no pointer. */
  active: () => boolean;
  /** Whether the Lasso is in hand, borrowed or picked. */
  lassoing: () => boolean;
  /** A picture was picked up or let go of. */
  onSelect: (id: string | null) => void;
}

export class PlanImages {
  /** The layer, which goes just after the plan's sheet in the canvas column. */
  readonly root: HTMLElement;
  private readonly world: HTMLElement;
  private readonly deps: PlanImagesDeps;
  private readonly shown = new Map<string, HTMLImageElement>();
  private view: Viewport = { originX: 0, originY: 0, zoom: 1, width: 0, height: 0 };
  private selectedId: string | null = null;
  /** A press on a picture, and where it has got to. */
  private drag: {
    pointer: number;
    id: string;
    from: { x: number; y: number };
    at: { x: number; y: number };
    moved: boolean;
  } | null = null;

  constructor(deps: PlanImagesDeps) {
    this.deps = deps;
    this.world = h("div", { class: "plan-images-world" });
    this.root = h("div", { class: "plan-images" }, this.world);
    // Capture, so a press on a picture is settled before the drawing layer
    // starts a stroke or a pan with it.
    deps.surface.addEventListener("pointerdown", this.onDown, true);
    deps.surface.addEventListener("pointermove", this.onMove, true);
    deps.surface.addEventListener("pointerup", this.onUp, true);
    deps.surface.addEventListener("pointercancel", this.onUp, true);
    this.render();
  }

  get selected(): string | null {
    return this.selectedId;
  }

  /** Pick one up, or let go with null. */
  select(id: string | null): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    this.render();
    this.deps.onSelect(id);
  }

  /** Take the selected picture off the plan. False when none is selected. */
  removeSelected(): boolean {
    const id = this.selectedId;
    if (!id) return false;
    const { store } = this.deps;
    writePlanImages(store, store.activeSceneId, this.images().filter((i) => i.id !== id));
    this.select(null);
    return true;
  }

  /** Follow the camera: one transform for the whole layer. */
  sync(view: Viewport): void {
    this.view = view;
    const { originX, originY, zoom } = view;
    this.world.style.transform = `scale(${zoom}) translate(${-originX}px, ${-originY}px)`;
    // The outline's weight, in world units, so it stays a hairline on screen.
    this.root.style.setProperty("--plan-image-line", `${2 / zoom}px`);
  }

  /** Draw what the open scene has. Cheap: pictures are made once and kept. */
  render(): void {
    const images = this.images();
    if (this.selectedId && !images.some((i) => i.id === this.selectedId)) {
      this.selectedId = null;
      this.deps.onSelect(null);
    }
    const seen = new Set<string>();
    for (const image of images) {
      seen.add(image.id);
      let el = this.shown.get(image.id);
      if (!el) {
        el = h("img", { class: "plan-image", alt: "", draggable: "false" }) as HTMLImageElement;
        el.src = image.src;
        this.shown.set(image.id, el);
      }
      // Back to front, in the document's order.
      this.world.appendChild(el);
      this.place(el, image);
      el.classList.toggle("selected", image.id === this.selectedId);
    }
    for (const [id, el] of this.shown) {
      if (seen.has(id)) continue;
      el.remove();
      this.shown.delete(id);
    }
  }

  /** A file dropped on the plan at this point on the page. */
  async add(file: File, clientX: number, clientY: number): Promise<void> {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      log.info(`Plan mode takes PNG, JPEG or GIF pictures — ${file.name} is not one it can read`);
      return;
    }
    const src = bake(bitmap);
    // Centred where it was let go, and no bigger than most of the view.
    const span = {
      width: this.view.width / this.view.zoom,
      height: this.view.height / this.view.zoom,
    };
    const fit = Math.min(
      1,
      (span.width * LANDING_SHARE) / bitmap.width,
      (span.height * LANDING_SHARE) / bitmap.height,
    );
    const width = Math.round(bitmap.width * fit);
    const height = Math.round(bitmap.height * fit);
    bitmap.close();
    const at = this.worldAt(clientX, clientY);
    const image: PlanImage = {
      id: makeId("plan-image"),
      src,
      x: Math.round(at.x - width / 2),
      y: Math.round(at.y - height / 2),
      width,
      height,
    };
    const { store } = this.deps;
    writePlanImages(store, store.activeSceneId, [...this.images(), image]);
    this.select(image.id);
    log.info(`${file.name} is on the plan — drag it into place; Delete takes it off`);
  }

  destroy(): void {
    const { surface } = this.deps;
    surface.removeEventListener("pointerdown", this.onDown, true);
    surface.removeEventListener("pointermove", this.onMove, true);
    surface.removeEventListener("pointerup", this.onUp, true);
    surface.removeEventListener("pointercancel", this.onUp, true);
    this.root.remove();
  }

  // ── input ─────────────────────────────────────────────────────────────────

  private onDown = (event: PointerEvent): void => {
    if (!this.deps.active() || this.drag) return;
    const at = this.worldAt(event.clientX, event.clientY);
    const hit = this.hitAt(at);
    const takes = hit && (hit.id === this.selectedId || this.deps.lassoing());
    if (!hit || !takes) {
      // The tool's press, as ever — and it lets go of a picture, the way a
      // press away from a selection does on the canvas. A finger pans, which
      // is not a reason to drop anything.
      if (event.pointerType !== "touch") this.select(null);
      return;
    }
    event.stopImmediatePropagation();
    event.preventDefault();
    this.deps.surface.setPointerCapture(event.pointerId);
    this.select(hit.id);
    this.drag = { pointer: event.pointerId, id: hit.id, from: at, at, moved: false };
  };

  private onMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer) return;
    event.stopImmediatePropagation();
    drag.at = this.worldAt(event.clientX, event.clientY);
    const dx = (drag.at.x - drag.from.x) * this.view.zoom;
    const dy = (drag.at.y - drag.from.y) * this.view.zoom;
    if (!drag.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
    drag.moved = true;
    const image = this.images().find((i) => i.id === drag.id);
    const el = this.shown.get(drag.id);
    if (image && el) this.place(el, moved(image, drag.from, drag.at));
  };

  private onUp = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointer) return;
    event.stopImmediatePropagation();
    this.drag = null;
    if (this.deps.surface.hasPointerCapture(event.pointerId)) {
      this.deps.surface.releasePointerCapture(event.pointerId);
    }
    if (!drag.moved) return;
    const { store } = this.deps;
    writePlanImages(
      store,
      store.activeSceneId,
      this.images().map((i) => (i.id === drag.id ? moved(i, drag.from, drag.at) : i)),
    );
  };

  private images(): readonly PlanImage[] {
    return planImagesOf(this.deps.store.activeScene);
  }

  /** The front-most picture under a world point. */
  private hitAt(at: { x: number; y: number }): PlanImage | null {
    const images = this.images();
    for (let i = images.length - 1; i >= 0; i--) {
      const { x, y, width, height } = images[i];
      if (at.x >= x && at.x <= x + width && at.y >= y && at.y <= y + height) return images[i];
    }
    return null;
  }

  private worldAt(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.deps.surface.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / this.view.zoom + this.view.originX,
      y: (clientY - rect.top) / this.view.zoom + this.view.originY,
    };
  }

  private place(el: HTMLImageElement, image: PlanImage): void {
    el.style.left = `${image.x}px`;
    el.style.top = `${image.y}px`;
    el.style.width = `${image.width}px`;
    el.style.height = `${image.height}px`;
  }
}

/** A picture carried from one world point to another. */
function moved(
  image: PlanImage,
  from: { x: number; y: number },
  to: { x: number; y: number },
): PlanImage {
  return {
    ...image,
    x: Math.round(image.x + to.x - from.x),
    y: Math.round(image.y + to.y - from.y),
  };
}

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
