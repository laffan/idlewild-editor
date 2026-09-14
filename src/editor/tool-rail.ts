/**
 * The tools, on two columns down the left edge of the canvas.
 *
 * They were one column, split by a gap into "the game canvas's" and "the
 * drawing layer's". The gap was doing too much work: it was the only thing
 * saying that Pencil and Select answer to different owners, and the column
 * grew a *second* column under it whenever PSD Edit mode was up — a rail
 * whose buttons moved under your hand.
 *
 * Two columns now, and which end of the screen a column hangs from is the
 * distinction the gap was carrying:
 *
 * **The rail**, from the top, is what you do *to* the canvas: Select, Pan,
 * Point and Boundary. The first two are the camera and the pointer, which is
 * what the canvas does when nothing else is chosen. The other two make
 * something out of bare ground — nothing already on the canvas can be
 * promoted into either, so putting one down has to be a thing you do to a
 * patch of empty grid.
 *
 * **The drawing toolbar**, from the bottom, is the ink: Pencil, Pattern,
 * Shape, Eraser, Lasso and Fill. Fill and Pattern used to be reachable only
 * inside PSD Edit mode, from that second rail. They are the same tools
 * everywhere, so they are on the toolbar with the rest of the ink, and PSD
 * Edit mode borrows them rather than owning them.
 *
 * Three of the six paint with the **library** rather than with a colour —
 * Pattern always, Shape always, Fill when it is aimed at one — and all three
 * are set from the same control in the inspector's TOOL zone. See
 * `editor/paint-picker.ts`.
 *
 * Both are columns, and both are 56px buttons, so the two read as one
 * vocabulary held apart rather than as two kinds of chrome. A hand resting on
 * an iPad's glass is nearer the bottom corner than the top one, which is the
 * right way round: the ink is what a hand is doing most of the time.
 *
 * There is still no Fill *region* tool and no Boundary-from-strokes tool.
 * Both of those are actions on something already selected — a run of grid
 * spaces, a group of strokes — rather than modes you enter.
 */

import { h, ICONS, icon } from "../lib/dom";
import type { ToolId } from "../lib/types";

/** Which column a tool sits in. */
export type Bar = "rail" | "draw";

export interface ToolSpec {
  id: ToolId;
  name: string;
  /** What the button's tooltip says after the name, when there is more. */
  hint?: string;
  path: string | readonly string[];
  bar: Bar;
}

export const TOOLS: ToolSpec[] = [
  { id: "select", name: "Select", bar: "rail", path: ICONS.select },
  { id: "pan", name: "Pan", bar: "rail", path: ICONS.hand },
  {
    id: "point",
    name: "Point",
    hint: "Tap to put a named place down; a drag still pans",
    bar: "rail",
    path: ICONS.point,
  },
  {
    id: "zone",
    name: "Boundary",
    hint: "Sweep an outline and it becomes a blocking zone",
    bar: "rail",
    path: ICONS.boundary,
  },
  { id: "pencil", name: "Pencil", bar: "draw", path: ICONS.pencil },
  {
    id: "pattern",
    name: "Pattern",
    hint: "Reveal a pixel pattern, pinned to the world",
    bar: "draw",
    path: ICONS.pixels,
  },
  {
    id: "shape",
    name: "Shape",
    hint: "Stamp a shape into every grid space you cross",
    bar: "draw",
    path: ICONS.shape,
  },
  { id: "eraser", name: "Eraser", bar: "draw", path: ICONS.eraser },
  {
    id: "lasso",
    name: "Lasso",
    hint: "Sweep around strokes to select them",
    bar: "draw",
    path: ICONS.lasso,
  },
  {
    id: "fill",
    name: "Fill",
    hint: "Sweep a closed shape, or tap its corners out",
    bar: "draw",
    path: ICONS.fill,
  },
];

/**
 * What the label beside the rail says, for tools with no button on either
 * column.
 *
 * Rub is PSD Edit mode's alone — it is the pencil with the paint taken out,
 * and it rubs out ink from that session — so its button is a toggle on that
 * mode's own bar. The name beside the canvas still has to follow it, or
 * picking it up looks like picking nothing up.
 */
export const OFF_BAR: Partial<Record<ToolId, string>> = { rub: "Rub" };

/**
 * What the label beside the canvas calls a tool.
 *
 * Empty for a tool nothing names, which is what the test guards against: a
 * tool added to `ToolId` and forgotten here is a tool whose name goes blank
 * the moment it is picked up, and nothing else would say so.
 */
export function toolName(tool: ToolId): string {
  return TOOLS.find((t) => t.id === tool)?.name ?? OFF_BAR[tool] ?? "";
}

export class ToolRail {
  /** What you do to the canvas, hanging from the top-left corner. */
  readonly root: HTMLElement;
  /** The ink, standing on the bottom-left corner. */
  readonly drawBar: HTMLElement;
  readonly label: HTMLElement;
  private readonly buttons = new Map<ToolId, HTMLButtonElement>();
  private current: ToolId = "select";

  constructor(onPick: (tool: ToolId) => void) {
    this.root = h("div", { class: "tool-rail" });
    this.label = h("div", { class: "tool-name m", text: "Select" });
    this.drawBar = h("div", { class: "tool-rail draw-bar" });

    const hosts: Record<Bar, HTMLElement> = {
      rail: this.root,
      draw: this.drawBar,
    };

    for (const tool of TOOLS) {
      const button = h(
        "button",
        {
          class: "tool-btn",
          title: tool.hint ? `${tool.name} — ${tool.hint}` : tool.name,
          "aria-label": tool.name,
          "aria-pressed": String(tool.id === this.current),
          onClick: () => {
            this.setTool(tool.id);
            onPick(tool.id);
          },
        },
        icon(tool.path, 21),
      );
      this.buttons.set(tool.id, button);
      hosts[tool.bar].appendChild(button);
    }
  }

  setTool(tool: ToolId): void {
    this.current = tool;
    for (const [id, button] of this.buttons) {
      button.setAttribute("aria-pressed", String(id === tool));
    }
    this.label.textContent = toolName(tool);
  }

  get tool(): ToolId {
    return this.current;
  }
}
