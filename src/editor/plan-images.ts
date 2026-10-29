/**
 * Pictures on the plan: dropped in, turned blue, traced over.
 *
 * A picture dropped on the canvas becomes a PSD, because it is on its way
 * into the game. One dropped while plan mode is up is not going anywhere —
 * a photo of a sketchbook page, a map to work from — so it stays a picture,
 * and the plan's: **desaturated, tinted the pencil's blue and multiplied**
 * over what is under it, so it reads as part of the same sheet of tracing
 * paper as the strokes rather than as artwork laid on top. See `lib/plan.ts`
 * for how it is kept and `plan-image-bake.ts` for the blue.
 *
 * **Multiplied by CSS.** The layer is a sibling of the plan's sheet, over it,
 * with `mix-blend-mode: multiply` on the layer as a whole — on the pictures
 * inside it, the blend would only reach the layer's own empty backdrop. So in
 * the mode it darkens the white wash and the scene under it, the plan's ink
 * shows through it, and out of the mode it multiplies straight onto the scene
 * at the Plan row's opacity, like the strokes.
 *
 * **Selected, it wears the strokes' box** (`drawing/transform-box.ts`): drag
 * inside to move it, a corner to scale it, the knob to turn it, the × off the
 * lower right corner — or Delete — to take it off. The box stands at the
 * picture's own angle, which the picture keeps (`PlanImage.rotation`), and
 * sits in a layer of its own over the pictures, out of the multiply, so the
 * handles keep their colours. Every gesture writes the document once.
 *
 * **Picking one up** is the plan's Select tool, or its Lasso: a press on a
 * picture selects it and carries it in the same movement. Under Select a
 * press anywhere else lets go, and a pen or mouse drag there pans, as it does
 * on the canvas. Under the Pencil and the Eraser a press is the tool's, as it
 * always was — drawing over a picture is the point of it.
 */

import type { Viewport } from "../drawing";
import { TransformBox } from "../drawing/transform-box";
import {
  applyPoint,
  compose,
  IDENTITY,
  rotationAbout,
  type Affine,
} from "../drawing/transform";
import { makeId } from "../lib/doc-store";
import type { DocStore } from "../lib/doc-store";
import { h } from "../lib/dom";
import * as log from "../lib/log";
import { planImagesOf, writePlanImages, type PlanImage } from "../lib/plan";
import { bake } from "./plan-image-bake";

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
  /** Whether a press on a picture picks it up: Select or the Lasso in hand. */
  picks: () => boolean;
  /** Whether Select is in hand, which makes a drag on bare plan a pan. */
  selecting: () => boolean;
  /** Move the camera by this much, in screen pixels. */
  pan: (dx: number, dy: number) => void;
  /** A picture was picked up or let go of. */
  onSelect: (id: string | null) => void;
}

/** A press under way: carrying a picture, or panning under Select. */
type Press =
  | { kind: "carry"; pointer: number; id: string; from: Point; at: Point; moved: boolean }
  | { kind: "pan"; pointer: number; x: number; y: number };

interface Point {
  x: number;
  y: number;
}

export class PlanImages {
  /** The layer, which goes just after the plan's sheet in the canvas column. */
  readonly root: HTMLElement;
  /** The selected picture's box, which goes just after `root`. */
  readonly chrome: HTMLElement;
  private readonly world: HTMLElement;
  private readonly deps: PlanImagesDeps;
  private readonly box: TransformBox;
  private readonly shown = new Map<string, HTMLImageElement>();
  private view: Viewport = { originX: 0, originY: 0, zoom: 1, width: 0, height: 0 };
  private selectedId: string | null = null;
  private press: Press | null = null;

  constructor(deps: PlanImagesDeps) {
    this.deps = deps;
    this.world = h("div", { class: "plan-images-world" });
    this.root = h("div", { class: "plan-images" }, this.world);
    this.box = new TransformBox({
      bounds: () => {
        const image = this.selectedImage();
        return image ? { x: image.x, y: image.y, width: image.width, height: image.height } : null;
      },
      offered: () => this.deps.active(),
      toScreen: (x, y) => ({
        x: (x - this.view.originX) * this.view.zoom,
        y: (y - this.view.originY) * this.view.zoom,
      }),
      toWorld: (event) => this.worldAt(event.clientX, event.clientY),
      frame: () => {
        const image = this.selectedImage();
        return image ? frameOf(image) : IDENTITY;
      },
      preview: (m) => {
        const image = this.selectedImage();
        const el = image && this.shown.get(image.id);
        if (image && el) place(el, m ? transformed(image, m) : image);
      },
      commit: (m) => this.write((image) => (image.id === this.selectedId ? transformed(image, m) : image)),
      remove: () => this.removeSelected(),
    });
    this.chrome = h("div", { class: "plan-image-box plan-surface" }, this.box.root);
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

  /** Follow the camera: one transform for the whole layer, and the box. */
  sync(view: Viewport): void {
    this.view = view;
    const { originX, originY, zoom } = view;
    this.world.style.transform = `scale(${zoom}) translate(${-originX}px, ${-originY}px)`;
    this.box.refresh();
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
      place(el, image);
    }
    for (const [id, el] of this.shown) {
      if (seen.has(id)) continue;
      el.remove();
      this.shown.delete(id);
    }
    this.box.refresh();
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
    const fit = Math.min(
      1,
      (this.view.width / this.view.zoom) * LANDING_SHARE / bitmap.width,
      (this.view.height / this.view.zoom) * LANDING_SHARE / bitmap.height,
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
    log.info(`${file.name} is on the plan — drag it into place; × or Delete takes it off`);
  }

  destroy(): void {
    const { surface } = this.deps;
    surface.removeEventListener("pointerdown", this.onDown, true);
    surface.removeEventListener("pointermove", this.onMove, true);
    surface.removeEventListener("pointerup", this.onUp, true);
    surface.removeEventListener("pointercancel", this.onUp, true);
    this.root.remove();
    this.chrome.remove();
  }

  // ── input ─────────────────────────────────────────────────────────────────

  private onDown = (event: PointerEvent): void => {
    if (!this.deps.active() || this.press) return;
    const at = this.worldAt(event.clientX, event.clientY);
    const hit = this.deps.picks() ? this.hitAt(at) : null;
    const touch = event.pointerType === "touch";
    if (hit) {
      this.claim(event);
      this.select(hit.id);
      this.press = { kind: "carry", pointer: event.pointerId, id: hit.id, from: at, at, moved: false };
      return;
    }
    // A finger pans and pinches on the drawing layer whatever is in hand, and
    // panning is not a reason to let go of anything.
    if (touch) return;
    this.select(null);
    if (!this.deps.selecting()) return;
    this.claim(event);
    this.press = { kind: "pan", pointer: event.pointerId, x: event.clientX, y: event.clientY };
  };

  private onMove = (event: PointerEvent): void => {
    const press = this.press;
    if (!press || event.pointerId !== press.pointer) return;
    event.stopImmediatePropagation();
    if (press.kind === "pan") {
      this.deps.pan(event.clientX - press.x, event.clientY - press.y);
      press.x = event.clientX;
      press.y = event.clientY;
      return;
    }
    press.at = this.worldAt(event.clientX, event.clientY);
    const dx = (press.at.x - press.from.x) * this.view.zoom;
    const dy = (press.at.y - press.from.y) * this.view.zoom;
    if (!press.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
    press.moved = true;
    this.box.showThrough(this.carried(press));
  };

  private onUp = (event: PointerEvent): void => {
    const press = this.press;
    if (!press || event.pointerId !== press.pointer) return;
    event.stopImmediatePropagation();
    this.press = null;
    if (this.deps.surface.hasPointerCapture(event.pointerId)) {
      this.deps.surface.releasePointerCapture(event.pointerId);
    }
    if (press.kind !== "carry" || !press.moved) return;
    const m = this.carried(press);
    this.box.showThrough(null);
    this.write((image) => (image.id === press.id ? transformed(image, m) : image));
  };

  /** This press is the pictures', and nothing under them hears it. */
  private claim(event: PointerEvent): void {
    event.stopImmediatePropagation();
    event.preventDefault();
    this.deps.surface.setPointerCapture(event.pointerId);
  }

  /** The move a carry has made so far, previewed on the picture as it goes. */
  private carried(press: Extract<Press, { kind: "carry" }>): Affine {
    const m: Affine = [1, 0, 0, 1, press.at.x - press.from.x, press.at.y - press.from.y];
    const image = this.images().find((i) => i.id === press.id);
    const el = this.shown.get(press.id);
    if (image && el) place(el, transformed(image, m));
    return m;
  }

  private write(update: (image: PlanImage) => PlanImage): void {
    const { store } = this.deps;
    writePlanImages(store, store.activeSceneId, this.images().map(update));
  }

  private images(): readonly PlanImage[] {
    return planImagesOf(this.deps.store.activeScene);
  }

  private selectedImage(): PlanImage | null {
    return this.images().find((i) => i.id === this.selectedId) ?? null;
  }

  /** The front-most picture under a world point, its angle and all. */
  private hitAt(at: Point): PlanImage | null {
    const images = this.images();
    for (let i = images.length - 1; i >= 0; i--) {
      const image = images[i];
      const cx = image.x + image.width / 2;
      const cy = image.y + image.height / 2;
      const local = applyPoint(rotationAbout(cx, cy, -(image.rotation ?? 0)), at.x, at.y);
      if (
        local.x >= image.x &&
        local.x <= image.x + image.width &&
        local.y >= image.y &&
        local.y <= image.y + image.height
      ) {
        return image;
      }
    }
    return null;
  }

  private worldAt(clientX: number, clientY: number): Point {
    const rect = this.deps.surface.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / this.view.zoom + this.view.originX,
      y: (clientY - rect.top) / this.view.zoom + this.view.originY,
    };
  }
}

/** Where a picture's own rectangle stands in the world: turned about its middle. */
export function frameOf(image: PlanImage): Affine {
  return rotationAbout(
    image.x + image.width / 2,
    image.y + image.height / 2,
    image.rotation ?? 0,
  );
}

/**
 * A picture after `m`, a move, scale or turn in the world, read back into
 * the four numbers and the angle it is kept as.
 *
 * Its own rectangle goes through where it stands and then through `m`; the
 * angle is where its top edge now points, each side's length how far that
 * side was stretched, and the middle where the middle went.
 */
export function transformed(image: PlanImage, m: Affine): PlanImage {
  const whole = compose(frameOf(image), m);
  const width = image.width * Math.hypot(whole[0], whole[1]);
  const height = image.height * Math.hypot(whole[2], whole[3]);
  const middle = applyPoint(whole, image.x + image.width / 2, image.y + image.height / 2);
  const rotation = Math.atan2(whole[1], whole[0]);
  const round = (v: number) => Math.round(v * 100) / 100;
  const { rotation: _old, ...rest } = image;
  return {
    ...rest,
    x: round(middle.x - width / 2),
    y: round(middle.y - height / 2),
    width: round(width),
    height: round(height),
    ...(Math.abs(rotation) > 1e-6 ? { rotation } : {}),
  };
}

function place(el: HTMLImageElement, image: PlanImage): void {
  el.style.left = `${image.x}px`;
  el.style.top = `${image.y}px`;
  el.style.width = `${image.width}px`;
  el.style.height = `${image.height}px`;
  el.style.transform = image.rotation ? `rotate(${image.rotation}rad)` : "";
}
