/**
 * A broken link beside a selected placed PSD on the canvas whose code no
 * longer follows Draw — one the author edited by hand, which Code's sidebar
 * carries a reset for. Pressing it opens the code at the line that places it.
 * Which units are marked is `code-sync.ts`'s to say.
 *
 * Divs over the canvas rather than paint in it, for the reasons
 * `screen-guide.ts` gives for its boundary: a mark drawn into the scene would
 * be baked into the project's thumbnail, and would have to be redrawn at
 * `1 / zoom` on every zoom. Each is moved with a transform off the same
 * viewport push the guides are driven by. Draw's alone — in Code and Play the
 * canvas is behind the running game (`.code-mode`, `.play-mode`).
 */

import { h, ICONS, icon } from "../lib/dom";
import { worldToScreen, type Viewport } from "../drawing/viewport";

/** One mark: the unit it is for, by one of its placements, and its box in the world. */
export interface CodeMark {
  placementId: string;
  rect: { x: number; y: number; width: number; height: number };
}

export class CodeMarks {
  private readonly root: HTMLElement;
  private marks: CodeMark[] = [];
  private view: Viewport | null = null;

  constructor(
    host: HTMLElement,
    private readonly onReveal: (placementId: string) => void,
  ) {
    this.root = h("div", { class: "code-marks" });
    host.appendChild(this.root);
  }

  set(marks: CodeMark[]): void {
    this.marks = marks;
    this.draw();
  }

  sync(view: Viewport): void {
    this.view = view;
    this.draw();
  }

  destroy(): void {
    this.root.remove();
  }

  private draw(): void {
    const view = this.view;
    this.root.replaceChildren();
    if (!view) return;
    for (const mark of this.marks) {
      // Just off the top right-hand corner, where nothing of the artwork is.
      const at = worldToScreen(view, mark.rect.x + mark.rect.width, mark.rect.y);
      this.root.appendChild(
        h(
          "button",
          {
            class: "code-mark",
            title: "Edited by hand in the code — open it where it is placed",
            "aria-label": "Open the code that places this",
            style: { transform: `translate(${Math.round(at.x) + 2}px, ${Math.round(at.y) - 22}px)` },
            onPointerDown: (event: Event) => event.stopPropagation(),
            onClick: (event: Event) => {
              event.stopPropagation();
              this.onReveal(mark.placementId);
            },
          },
          icon(ICONS.unlink, 12),
        ),
      );
    }
  }
}
