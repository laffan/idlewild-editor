/**
 * The second rail, under the first, up only while pen mode is.
 *
 * The rail above it is the editor's: what the pointer does to the *document*
 * — pick something up, move the camera, put a point down, draw. These three
 * are about the ink going into one PSD layer, and they are worth their own
 * column rather than three more slots on that one, because they mean nothing
 * anywhere else and a rail that grew and shrank with the mode would be a rail
 * whose buttons moved under your hand.
 *
 * All three are the pencil with something changed about it, which is why they
 * are here rather than in the drawing engine as three more tools: Rub is the
 * same brush stamping `destination-out`, Pixels is the same stamping with a
 * hard checker for a tip, and Fill is the lasso's gesture ending in a shape
 * instead of a selection. Only Fill needs the engine to know anything new.
 *
 * Nothing is pressed to begin with: pen mode opens on the plain pencil, and
 * these are departures from it. Pressing the pressed one puts it back.
 */

import { PIXEL_BRUSH, type StrokeStyle } from "../drawing";
import { h, ICONS, icon } from "../lib/dom";
import type { ToolId } from "../lib/types";

/** What the pen rail can be doing. Null is the plain pencil. */
export type PenTool = "rub" | "fill" | "pixels" | null;

interface PenToolSpec {
  id: NonNullable<PenTool>;
  name: string;
  hint: string;
  path: string | readonly string[];
}

export const PEN_TOOLS: PenToolSpec[] = [
  {
    id: "rub",
    name: "Rub",
    hint: "Rub out ink drawn in this session",
    path: ICONS.eraser,
  },
  {
    id: "fill",
    name: "Fill",
    hint: "Sweep a closed shape and it fills",
    path: ICONS.fill,
  },
  {
    id: "pixels",
    name: "Pixels",
    hint: "Draw with a hard pixel pattern",
    path: ICONS.pixels,
  },
];

export class PenRail {
  readonly root: HTMLElement;
  private readonly buttons = new Map<NonNullable<PenTool>, HTMLButtonElement>();
  private current: PenTool = null;

  constructor(onPick: (tool: PenTool) => void) {
    this.root = h("div", { class: "pen-rail hidden" });
    for (const tool of PEN_TOOLS) {
      const button = h(
        "button",
        {
          class: "tool-btn",
          title: `${tool.name} — ${tool.hint}`,
          "aria-label": tool.name,
          "aria-pressed": "false",
          onClick: () => {
            // Pressing the one that is down goes back to the pencil, which is
            // the way out of every one of these and saves a fourth button
            // saying "the pencil again".
            const next = this.current === tool.id ? null : tool.id;
            this.setTool(next);
            onPick(next);
          },
        },
        icon(tool.path, 21),
      );
      this.buttons.set(tool.id, button);
      this.root.appendChild(button);
    }
  }

  /** Show or hide the whole column. Leaving pen mode puts the pencil back. */
  setShown(shown: boolean): void {
    this.root.classList.toggle("hidden", !shown);
    if (!shown) this.setTool(null);
  }

  setTool(tool: PenTool): void {
    this.current = tool;
    for (const [id, button] of this.buttons) {
      button.setAttribute("aria-pressed", String(id === tool));
    }
  }

  get tool(): PenTool {
    return this.current;
  }
}

/**
 * What picking one of these actually changes about the pencil.
 *
 * All three are the pencil with something different about it, and saying so
 * once here keeps the shell's job to applying it: `brush` is what the pencil
 * had before Pixels borrowed the slot, so putting the tool back puts the tip
 * back too.
 */
export function penToolEffect(
  tool: PenTool,
  brush: number,
): { tool: ToolId; style: Partial<StrokeStyle> } {
  return {
    // Fill is the only one whose *gesture* differs; the other two are the
    // pencil, drawn differently.
    tool: tool === "fill" ? "fill" : "pencil",
    style: {
      mode: tool === "rub" ? "erase" : "ink",
      brushId: tool === "pixels" ? PIXEL_BRUSH : brush,
    },
  };
}
