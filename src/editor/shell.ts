/**
 * The editor's layout: the rows and columns, the dividers between them, and
 * the two tabs that fold a sidebar away.
 *
 * Split out of `editor.ts` because it is the one part of the shell that is
 * about *where things are* rather than about what they do. What it hands back
 * is the two elements everything else positions itself against — the whole
 * shell, for a panel that covers it, and the main row, for one that docks
 * beside the canvas.
 *
 * The sizes are a per-viewer convenience rather than project state, so every
 * divider persists its own in localStorage — see `resizer.ts`.
 */

import { h, ICONS, icon } from "../lib/dom";
import { createResizer, type Resizer } from "./resizer";

/** A sidebar, as the layout needs to see one. */
interface SidePanel {
  root: HTMLElement;
  setCollapsed: (collapsed: boolean) => void;
}

/** The console drawer, which is a row with a divider of its own inside it. */
interface Drawer {
  root: HTMLElement;
  body: HTMLElement;
  mountResizeHandle: (handle: HTMLElement) => void;
}

export interface ShellParts {
  header: HTMLElement;
  layers: SidePanel;
  /** The canvas wrapper. The edge toggles are mounted inside it. */
  canvas: HTMLElement;
  inspector: SidePanel;
  terminal: Drawer;
}

export interface Shell {
  /** The whole editor: what a full-screen code panel covers. */
  root: HTMLElement;
  /** The row holding the sidebars and the canvas: what a column docks into. */
  main: HTMLElement;
  /** Fold a sidebar away, or bring it back. */
  toggleSide: (side: "left" | "right") => void;
  /** Apply every stored divider size. Call once the shell is in the document. */
  restore: () => void;
  destroy: () => void;
}

export function createShell(parts: ShellParts): Shell {
  const { header, layers, canvas, inspector, terminal } = parts;

  const leftToggle = h(
    "button",
    {
      class: "edge-toggle left",
      title: "Toggle layers",
      onClick: () => toggleSide("left"),
    },
    icon(ICONS.chevronLeft, 14),
  );
  const rightToggle = h(
    "button",
    {
      class: "edge-toggle right",
      title: "Toggle inspector",
      onClick: () => toggleSide("right"),
    },
    icon(ICONS.chevronRight, 14),
  );
  canvas.append(leftToggle, rightToggle);

  const leftResizer = createResizer({
    target: layers.root,
    axis: "width",
    edge: "end",
    min: 200,
    max: 560,
    storageKey: "leftWidth",
  });
  const rightResizer = createResizer({
    target: inspector.root,
    axis: "width",
    edge: "start",
    min: 240,
    max: 620,
    storageKey: "rightWidth",
  });
  const consoleResizer = createResizer({
    target: terminal.body,
    axis: "height",
    edge: "start",
    min: 80,
    max: 620,
    storageKey: "consoleHeight",
  });
  terminal.mountResizeHandle(consoleResizer.handle);

  const main = h(
    "div",
    { class: "editor-main" },
    layers.root,
    leftResizer.handle,
    canvas,
    rightResizer.handle,
    inspector.root,
  );

  const root = h("div", { class: "editor" }, header, main, terminal.root);

  function toggleSide(side: "left" | "right"): void {
    const panel = side === "left" ? layers : inspector;
    const resizer = side === "left" ? leftResizer : rightResizer;
    const collapsed = panel.root.classList.contains("collapsed");
    panel.setCollapsed(!collapsed);
    resizer.handle.classList.toggle("collapsed", !collapsed);
  }

  const dividers: Resizer[] = [leftResizer, rightResizer, consoleResizer];

  return {
    root,
    main,
    toggleSide,
    restore: () => {
      for (const divider of dividers) divider.restore();
    },
    destroy: () => {
      for (const divider of dividers) divider.destroy();
    },
  };
}
