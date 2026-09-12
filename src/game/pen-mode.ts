/**
 * Pen mode: the state the canvas is in while one layer of a PSD is being
 * drawn into.
 *
 * The third of the canvas modes, and modelled on extrude: the rest of the
 * canvas dims, a bar along the bottom offers Apply and Cancel, and while it
 * is up nothing underneath answers a gesture. What it holds is one target —
 * a layer of a file — and one rectangle, the PSD's own canvas, standing where
 * that file stands on the grid.
 *
 * **The frame is the document, not the artwork.** A placement's outline is
 * one layer's pixels, cropped to what is in them; the PSD is bigger than
 * that, often by a whole grid space, because a converted fill or an extrusion
 * is written with room around it to paint the eaves that hang past the wall.
 * Drawing inside the artwork's box and calling it "inside the PSD" would put
 * the boundary in the wrong place, and it is a boundary somebody is going to
 * draw right up against. `canvasBox` in `lib/manifest.ts` is the arithmetic;
 * see the note there.
 *
 * **It owns no pointer of its own.** This is where it parts company with
 * extrude and collider, and it is not an oversight: the thing that draws here
 * is the drawing layer, which is a stack of 2D canvases over Phaser's rather
 * than anything in the scene, and it has had a pencil, five brushes, an
 * eraser and pressure since long before this mode existed. So entering picks
 * the Pencil and the ink goes where ink always goes. What the gestures below
 * are for is the case where the user takes a different tool from the rail
 * while the mode is up: the canvas underneath stays inert, so a stray drag
 * cannot pick up and move the very artwork being drawn on — which would slide
 * the file out from under a frame that was worked out when the mode opened.
 *
 * Nothing here touches the document either. The strokes are the document's,
 * drawn on the layer being worked on like any others; which of them belong to
 * this session, and what happens to them at the end, is `editor/pen.ts` —
 * this object could not write a PSD if it wanted to, because it has no idea
 * what a project is.
 */

import type Phaser from "phaser";
import type { Bounds } from "../drawing/types";
import * as log from "../lib/log";
import { PenRender } from "./pen-render";

/**
 * The layer a session is drawing into.
 *
 * `index` and `name` together are how Rust finds the row — both, because a
 * paint against a stale index would put the drawing in the wrong layer and
 * nothing about the result would say so.
 */
export interface PenTarget {
  key: string;
  /** Its row in the list `readLayers` returned. */
  index: number;
  /** And what that row was called then, as the file spells it. */
  name: string;
}

/** What the mode needs from the scene around it. */
export interface PenHost {
  readonly scene: Phaser.Scene;
  /** The dim is cut out of what this can see — see `pen-render.ts`. */
  camera(): Phaser.Cameras.Scene2D.Camera;
  /**
   * Pen mode owns the canvas while it is up, so nothing stays chosen
   * underneath it — including the placement it was entered from, whose resize
   * handles would otherwise float over a dimmed canvas.
   */
  clearSelection(): void;
  /** Anything the bottom bar would want to hear about. */
  onChange(): void;
}

export class PenMode {
  private readonly host: PenHost;
  private readonly render: PenRender;

  private session: { target: PenTarget; frame: Bounds; scale: number } | null =
    null;

  constructor(host: PenHost) {
    this.host = host;
    this.render = new PenRender(host.scene);
  }

  get active(): boolean {
    return this.session !== null;
  }

  /** The layer being drawn into, or null when the mode is not up. */
  get target(): PenTarget | null {
    return this.session?.target ?? null;
  }

  /** The PSD's canvas in world pixels — where the ink is allowed to land. */
  get frame(): Bounds | null {
    return this.session?.frame ?? null;
  }

  /** World pixels per PSD pixel, which is how big the ink is written. */
  get scale(): number {
    return this.session?.scale ?? 1;
  }

  /**
   * Enter the mode over one layer of a placed PSD.
   *
   * `frame` is the file's whole canvas in world pixels and `scale` is how big
   * it is being shown against its own — both worked out by the caller, which
   * is the side that has the manifest and the placement.
   */
  start(target: PenTarget, frame: Bounds, scale: number): boolean {
    if (frame.width <= 0 || frame.height <= 0 || scale <= 0) {
      log.warn(`${target.key}.psd has no canvas to draw in`);
      return false;
    }
    this.session = { target, frame, scale };
    this.host.clearSelection();
    this.refresh();
    this.host.onChange();
    log.info(
      `Pen mode — drawing into "${target.name}" in ${target.key}.psd; ` +
        "ink inside the frame goes into the file when you Apply",
    );
    return true;
  }

  /** Leave. What happens to the ink is the caller's business, not this. */
  stop(): void {
    if (!this.session) return;
    this.session = null;
    this.render.clear();
    this.host.onChange();
  }

  /**
   * Redraw against the camera as it is now.
   *
   * Called every frame while the mode is up rather than only on a zoom: the
   * dim is cut out of what the camera can see, so a pan moves it as surely as
   * a zoom does. Four rectangles and an outline — cheaper than working out
   * when it was needed.
   */
  refresh(): void {
    if (this.session) {
      this.render.render(this.session.frame, this.host.camera());
    }
  }

  // ── gestures ──────────────────────────────────────────────────────────────
  //
  // All of them swallowed and none of them used. See the note at the top: the
  // pen draws through the drawing layer, and what these stop is a gesture
  // made with some *other* tool reaching the document under the dim.

  claims(): boolean {
    return this.active;
  }

  destroy(): void {
    this.render.destroy();
  }
}
