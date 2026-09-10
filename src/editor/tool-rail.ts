/**
 * The tool rail down the left edge of the canvas.
 *
 * Pencil, eraser and boundary belong to the drawing layer, which is the Hush
 * notebook engine port. They are present and wired to the same selection
 * model, but disabled until that port lands rather than pretending to work.
 *
 * There is no Fill tool. Filling is an action on a selection, not a mode you
 * enter — it is the first button on the bar that appears over a selected run
 * of spaces — so a rail slot for it only ever did nothing.
 */

import { h, ICONS, icon } from "../lib/dom";
import type { ToolId } from "../lib/types";

interface ToolSpec {
  id: ToolId;
  name: string;
  path: string;
  /** Set while the drawing engine port is outstanding. */
  pending?: boolean;
}

export const TOOLS: ToolSpec[] = [
  { id: "select", name: "Select", path: ICONS.select },
  { id: "pan", name: "Pan", path: ICONS.hand },
  { id: "pencil", name: "Pencil", path: ICONS.pencil, pending: true },
  { id: "eraser", name: "Eraser", path: ICONS.eraser, pending: true },
  { id: "boundary", name: "Boundary", path: ICONS.boundary, pending: true },
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
          class: "tool-btn",
          title: tool.pending
            ? `${tool.name} — arrives with the drawing layer`
            : tool.name,
          disabled: tool.pending ? "true" : null,
          "aria-pressed": String(tool.id === this.current),
          onClick: () => {
            if (tool.pending) return;
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
