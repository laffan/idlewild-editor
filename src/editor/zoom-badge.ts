/**
 * What the camera is doing, in one number, at the head of the tool rail.
 *
 * The canvas is effectively infinite and its zoom is reached by pinching,
 * wheeling with a modifier, or palming a trackpad — three gestures that are
 * easy to trip and none of which says what they left behind. So there was no
 * answer anywhere on screen to *how far in am I*, and no way back to 1:1
 * short of pinching until the lattice looked about right. The palette in the
 * properties sidebar has carried exactly this control for as long as it has
 * had a zoom of its own — a readout that is also the way back — and this is
 * that control for the camera.
 *
 * **At the head of the rail rather than beside it.** The rail hangs from the
 * top-left corner and Select is its first button, so a badge above Select is
 * a badge at the top of the screen's left edge, which is where a readout
 * about the *view* belongs: it is a fact about the canvas, like the tools
 * under it are things you do to the canvas. Mounted into the rail's own head
 * slot rather than positioned over it, so it moves with the column and is
 * taken down with it in Code and Play — where the canvas is behind a running
 * game and the number would be describing something nobody can see.
 *
 * **A tap is 100%, not the zoom the project opens at.** Those are two
 * different questions and the second one already has an answer in Project
 * Options. What this is for is getting back to *one screen pixel per world
 * pixel* — the scale artwork is measured at, and the only zoom whose number
 * means anything on its own.
 */

import { h } from "../lib/dom";

/** What the badge shows for a camera at this zoom. */
export function zoomLabel(zoom: number): string {
  if (!Number.isFinite(zoom) || zoom <= 0) return "100%";
  // A whole per cent from 1× up, and a tenth below it. The two halves of the
  // range are not the same readout: zoomed in, a per cent is already finer
  // than anybody is aiming for and the extra digit only shuffles under the
  // finger doing the pinching; zoomed out, the camera spends most of its
  // range between 10% and 100%, where whole per cents round four separate
  // zooms to the same number. Trailing zeroes are dropped, so 50% is still
  // three characters.
  const percent = zoom * 100;
  const places = percent < 100 ? 1 : 0;
  return `${Number(percent.toFixed(places))}%`;
}

export class ZoomBadge {
  readonly root: HTMLButtonElement;
  private zoom = 1;

  /**
   * @param onReset a tap on the badge — back to one screen pixel per world
   *        pixel, about the middle of the viewport.
   */
  constructor(onReset: () => void) {
    this.root = h(
      "button",
      {
        class: "zoom-badge m",
        title: "The canvas's zoom — tap for 100%",
        "aria-label": "Canvas zoom, 100%",
        onClick: () => onReset(),
      },
      // Two lines: the number, and what it is the number of. Without the
      // second one a lone percentage at the top of the canvas is as likely to
      // be read as an opacity or a progress bar.
      h("span", { class: "zoom-badge-value", text: "100%" }),
      h("span", { class: "zoom-badge-label", text: "zoom" }),
    ) as HTMLButtonElement;
  }

  /**
   * Follow the camera.
   *
   * Called from the viewport push, which fires on every frame the camera has
   * moved in — a pan included, where the number has not changed — so the
   * write is guarded. Text nodes are cheap and this is not about the write:
   * it is about not resetting the button's own `aria-label` under a screen
   * reader that is reading it.
   */
  setZoom(zoom: number): void {
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    const label = zoomLabel(zoom);
    const value = this.root.firstElementChild;
    if (value) value.textContent = label;
    this.root.setAttribute("aria-label", `Canvas zoom, ${label}`);
    // At 1:1 there is nowhere for the tap to go, and a control that does
    // nothing should say so rather than being pressed twice to find out.
    this.root.classList.toggle("at-one", label === "100%");
  }
}
