/**
 * Every loose stroke in the scene, by the tool that drew it, above the layer
 * list.
 *
 * Ink is not a PSD until it is converted, and only PSDs are in what the
 * project exports and prints — so a pattern swept across a corner, or a fill
 * dropped on a layer nobody has opened in a while, is work that will quietly
 * not be there. The layer list does count strokes, one row per layer, but
 * only under a layer that has been opened, and as one number for everything.
 * This says it at the top of the column, by kind: how much pen, how much
 * pattern, how many fills, and on which layer.
 *
 * A row is one tool's strokes on one layer, and tapping it selects them on
 * the canvas — the selection the two conversions work on, so the next step is
 * one tap away. One row per layer as well as per tool because a selection is
 * one layer's worth (see `Selection`). The section folds, and its heading
 * keeps the count when it is folded, which is what stops anything being lost
 * track of. With no loose strokes in the scene it is not there at all.
 */

import { h, ICONS, icon } from "../lib/dom";
import type { Layer, Selection, Stroke } from "../lib/types";
import { count } from "./layer-items";

const STORAGE_KEY = "idlewild.strokes.open";

/** The tools a stroke can have come from, in the order they are listed. */
export const STROKE_TOOLS = ["pen", "pattern", "shape", "fill", "eraser"] as const;
export type StrokeTool = (typeof STROKE_TOOLS)[number];

const TOOL_NAMES: Record<StrokeTool, string> = {
  pen: "Pen",
  pattern: "Pattern",
  shape: "Shape",
  fill: "Fill",
  eraser: "Eraser",
};

const TOOL_ICONS: Record<StrokeTool, string | readonly string[]> = {
  pen: ICONS.pencil,
  pattern: ICONS.pixels,
  shape: ICONS.shape,
  fill: ICONS.fill,
  eraser: ICONS.slice,
};

/**
 * Which tool a stroke came from, read off what it is. An erasing stroke is an
 * eraser whatever brush made it — it takes away rather than adds, and a list
 * of what will not print should not count it as something that would.
 */
export function strokeTool(stroke: Stroke): StrokeTool {
  if (stroke.erase || stroke.mode === "erase") return "eraser";
  if (stroke.mode === "fill") return "fill";
  if (stroke.mode === "shape" || stroke.paint?.kind === "shape") return "shape";
  if (stroke.paint?.kind === "pattern") return "pattern";
  return "pen";
}

/** One tool's strokes on one layer. */
export interface StrokeGroup {
  tool: StrokeTool;
  layerId: string;
  layerName: string;
  ids: string[];
}

/** The scene's strokes, grouped by tool and then by layer, top layer first. */
export function strokeGroups(layers: readonly Layer[]): StrokeGroup[] {
  const groups: StrokeGroup[] = [];
  for (const tool of STROKE_TOOLS) {
    for (const layer of layers) {
      const ids = layer.strokes.filter((s) => strokeTool(s) === tool).map((s) => s.id);
      if (ids.length > 0) groups.push({ tool, layerId: layer.id, layerName: layer.name, ids });
    }
  }
  return groups;
}

export interface StrokesTrayHost {
  select: (selection: Selection) => void;
}

export class StrokesTray {
  readonly root: HTMLElement;
  private readonly host: StrokesTrayHost;
  private readonly list: HTMLElement;
  private readonly total: HTMLElement;
  private open: boolean;

  constructor(host: StrokesTrayHost) {
    this.host = host;
    this.open = readOpen();
    this.list = h("div", { class: "overlays-body" });
    this.total = h("span", { class: "strokes-total" });
    this.root = h(
      "div",
      { class: "overlays strokes-tray" },
      h(
        "button",
        {
          class: "overlays-head",
          title: "Ink not yet converted to a PSD — it is not in what the project exports",
          onClick: () => this.setOpen(!this.open),
        },
        h("span", { class: "overlays-chevron" }, icon(ICONS.chevronDown, 14)),
        h("span", { class: "panel-title m", text: "Strokes" }),
        this.total,
      ),
      this.list,
    );
    this.root.classList.toggle("closed", !this.open);
  }

  /** Show the scene's strokes as they are now, or nothing when there are none. */
  update(layers: readonly Layer[], selection: Selection): void {
    const groups = strokeGroups(layers);
    this.root.hidden = groups.length === 0;
    const all = groups.reduce((n, g) => n + g.ids.length, 0);
    this.total.textContent = String(all);
    // The layer is only worth naming when strokes are on more than one.
    const several = new Set(groups.map((g) => g.layerId)).size > 1;
    this.list.replaceChildren(...groups.map((g) => this.row(g, several, selection)));
  }

  private row(group: StrokeGroup, several: boolean, selection: Selection): HTMLElement {
    const picked =
      selection.kind === "strokes" &&
      selection.layerId === group.layerId &&
      selection.ids.length === group.ids.length &&
      group.ids.every((id) => selection.ids.includes(id));
    const detail = count(group.ids.length, "stroke") + (several ? ` · ${group.layerName}` : "");
    return h(
      "button",
      {
        class: `overlays-row strokes-row${picked ? " picked" : ""}`,
        title: `Select them on the canvas`,
        onClick: () =>
          this.host.select({ kind: "strokes", layerId: group.layerId, ids: [...group.ids] }),
      },
      h("span", { class: "strokes-icon" }, icon(TOOL_ICONS[group.tool], 14)),
      h(
        "span",
        { class: "artboards-text" },
        h("span", { class: "overlays-name", text: TOOL_NAMES[group.tool] }),
        h("span", { class: "artboards-size", text: detail }),
      ),
    );
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.root.classList.toggle("closed", !open);
    try {
      localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
    } catch {
      // The fold still works for this session.
    }
  }
}

function readOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}
