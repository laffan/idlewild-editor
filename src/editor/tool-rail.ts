/**
 * The tools, on three bars around the canvas.
 *
 * They were one column down the left edge, split by a gap into "the game
 * canvas's" and "the drawing layer's". The gap was doing too much work: it
 * was the only thing saying that Pencil and Select answer to different
 * owners, and the column grew a second column under it whenever PSD Edit mode
 * was up. So the three groups are three bars, each where the thing it is
 * about happens.
 *
 * **The rail**, top left, is the camera and the pointer: Select and Pan.
 * They are what the canvas does when nothing else is chosen, and they belong
 * at the corner the eye starts from.
 *
 * **The place bar**, bottom left, puts something new on empty ground: a
 * Point and a Boundary. Both are here for the same reason — nothing already
 * on the canvas can be promoted into either, so making one has to be a thing
 * you do to a bare patch of grid. The Point tool leaves the game canvas
 * holding the pointer (a drag still pans, and only the tap means anything
 * new); the boundary hands it to the drawing layer, because its gesture is a
 * swept outline.
 *
 * **The drawing toolbar**, under it, is the ink: Pencil, Pixels, Eraser,
 * Lasso and Fill. Fill and Pixels used to be reachable only inside PSD Edit
 * mode, from a second rail that appeared and disappeared under your hand.
 * They are the same tools everywhere — a swept shape, and the pencil with a
 * hard checker for a tip — so they are on the toolbar with the rest of the
 * ink and PSD Edit mode borrows them rather than owning them.
 *
 * There is still no Fill *region* tool and no Boundary-from-strokes tool.
 * Both of those are actions on something already selected — a run of grid
 * spaces, a group of strokes — rather than modes you enter.
 */

import { h, ICONS, icon } from "../lib/dom";
import type { ToolId } from "../lib/types";

/** Which bar a tool sits on. */
export type Bar = "rail" | "place" | "draw";

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
    bar: "place",
    path: ICONS.point,
  },
  {
    id: "zone",
    name: "Boundary",
    hint: "Sweep an outline and it becomes a blocking zone",
    bar: "place",
    path: ICONS.boundary,
  },
  { id: "pencil", name: "Pencil", bar: "draw", path: ICONS.pencil },
  {
    id: "pixels",
    name: "Pixels",
    hint: "The pencil with a hard pixel pattern for a tip",
    bar: "draw",
    path: ICONS.pixels,
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
 * What the label beside the rail says, for tools with no button on any bar.
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
  /** The camera's two, top left. */
  readonly root: HTMLElement;
  /** The two bottom-left bars, in one column: place over draw. */
  readonly dock: HTMLElement;
  readonly label: HTMLElement;
  private readonly buttons = new Map<ToolId, HTMLButtonElement>();
  private current: ToolId = "select";

  constructor(onPick: (tool: ToolId) => void) {
    this.root = h("div", { class: "tool-rail" });
    this.label = h("div", { class: "tool-name m", text: "Select" });

    const place = h("div", { class: "tool-bar place-bar" });
    const draw = h("div", { class: "tool-bar draw-bar" });
    this.dock = h("div", { class: "canvas-docks" }, place, draw);

    const hosts: Record<Bar, HTMLElement> = {
      rail: this.root,
      place,
      draw,
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
