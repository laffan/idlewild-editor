/**
 * The tool rail down the left edge of the canvas.
 *
 * Two groups, split by who owns the pointer. Select and Pan are the game
 * canvas's — grid spaces, placed images, the camera. Pencil, Eraser and
 * Lasso belong to the drawing layer, which takes raw input while one of
 * them is up and hands it back when it is not.
 *
 * There is no Fill tool and no Boundary tool. Both are actions on something
 * already selected — a run of grid spaces, a group of strokes — rather than
 * modes you enter, so a rail slot for either only ever did nothing.
 *
 * Point is here for the opposite reason: nothing on the canvas can be
 * promoted into one, so putting a point down has to be a thing you do to
 * empty space. It sits with Select and Pan because the game canvas keeps the
 * pointer under it — a drag still moves the camera, and only the tap means
 * anything new.
 */

import { h, ICONS, icon } from "../lib/dom";
import type { ToolId } from "../lib/types";

interface ToolSpec {
  id: ToolId;
  name: string;
  path: string | readonly string[];
  /** Starts the group that hands the pointer to the drawing layer. */
  divide?: boolean;
}

export const TOOLS: ToolSpec[] = [
  { id: "select", name: "Select", path: ICONS.select },
  { id: "pan", name: "Pan", path: ICONS.hand },
  { id: "point", name: "Point", path: ICONS.point },
  { id: "pencil", name: "Pencil", path: ICONS.pencil, divide: true },
  { id: "eraser", name: "Eraser", path: ICONS.eraser },
  { id: "lasso", name: "Lasso", path: ICONS.lasso },
];

export class ToolRail {
  readonly root: HTMLElement;
  readonly label: HTMLElement;
  private readonly buttons = new Map<ToolId, HTMLButtonElement>();
  private current: ToolId = "select";

  constructor(onPick: (tool: ToolId) => void) {
    this.root = h("div", { class: "tool-rail" });
    this.label = h("div", { class: "tool-name m", text: "Select" });

    for (const tool of TOOLS) {
      const button = h(
        "button",
        {
          class: tool.divide ? "tool-btn divide" : "tool-btn",
          title: tool.name,
          "aria-pressed": String(tool.id === this.current),
          onClick: () => {
            this.setTool(tool.id);
            onPick(tool.id);
          },
        },
        icon(tool.path, 21),
      );
      this.buttons.set(tool.id, button);
      this.root.appendChild(button);
    }
  }

  setTool(tool: ToolId): void {
    this.current = tool;
    for (const [id, button] of this.buttons) {
      button.setAttribute("aria-pressed", String(id === tool));
    }
    this.label.textContent = TOOLS.find((t) => t.id === tool)?.name ?? "";
  }

  get tool(): ToolId {
    return this.current;
  }
}
