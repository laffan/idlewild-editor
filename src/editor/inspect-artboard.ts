/**
 * A print project's artboard, in the OBJECT zone.
 *
 * An artboard is picked by tapping its label on the canvas or its row in the
 * Artboards list, and from then on the sidebar treats it like any other
 * selected thing: its name to retype, its size and where it is, and what can
 * be done to it. Two things are only offered here:
 *
 * - **Show ruler** puts a ruler along the top and left edge of every
 *   artboard, and the guides pulled from them — see `artboard-chrome.ts`.
 *   One switch for the project rather than one per artboard, because a ruler
 *   is a way of looking at the page rather than a fact about it.
 * - **Resize** puts handles on this artboard's edges and corners until it is
 *   pressed again or the artboard is put down. A sheet dragged to a size is a
 *   custom sheet, the way a size typed into Page Setup is.
 *
 * It is not a canvas `Selection`. The scene has no artboards, and teaching
 * every switch over selections about one would be a great deal of code for a
 * thing only a print project has; so the inspector holds it beside the canvas
 * selection instead, and puts it down the moment the canvas selects anything.
 */

import { h } from "../lib/dom";
import { optionSwitchRow } from "../lib/options-controls";
import { describePage, type PlacedArtboard } from "../lib/print";
import type { PanelSurface } from "./inspect-panels";

/** An artboard the inspector is showing. */
export interface ArtboardSubject {
  id: string;
  /** Write the panel. */
  render: (panel: PanelSurface) => void;
  /** The canvas selected something else, or another artboard was picked. */
  onDismiss: () => void;
}

/** What the panel's controls do. */
export interface ArtboardPanelActions {
  rename: (name: string) => void;
  rulers: boolean;
  setRulers: (on: boolean) => void;
  resizing: boolean;
  setResizing: (on: boolean) => void;
  pageSetup: () => void;
  remove: () => void;
}

/** `board` is undefined when the artboard has gone from under the panel. */
export function renderArtboard(
  panel: PanelSurface,
  board: PlacedArtboard | undefined,
  count: number,
  actions: ArtboardPanelActions,
): void {
  if (!board) return panel.empty();
  panel.editableHead("Artboard", board.name, "", actions.rename);

  panel.section("Info");
  panel.row("Size", describePage(board));
  panel.row("Corner", `${board.x}, ${board.y} pt`);
  const guides = (board.guidesX?.length ?? 0) + (board.guidesY?.length ?? 0);
  panel.row("Guides", String(guides));

  const view = panel.section(
    "View",
    "Rulers along the top and left of every artboard. Tap a ruler for a " +
      "guide; drag its handle to move it, ⌘-click it or drag it off the end " +
      "to remove it.",
  );
  view.append(
    optionSwitchRow({
      label: "Show ruler",
      value: actions.rulers,
      onChange: actions.setRulers,
    }).root,
  );

  panel.body.appendChild(
    h(
      "div",
      { class: "inspect-section" },
      h("button", {
        class: actions.resizing ? "panel-btn primary" : "panel-btn",
        text: actions.resizing ? "Done resizing" : "Resize",
        title: actions.resizing
          ? "Put the handles away"
          : "Handles on the edges and corners, to drag the sheet to a size",
        "aria-pressed": String(actions.resizing),
        onClick: () => actions.setResizing(!actions.resizing),
      }),
      h("button", {
        class: "panel-btn",
        text: "Page Setup…",
        title: "Its paper, and which way round",
        onClick: actions.pageSetup,
      }),
      h("button", {
        class: "panel-btn",
        text: "Remove artboard",
        title: count > 1 ? "Nothing drawn on the canvas goes with it" : "A print project needs one artboard",
        disabled: count <= 1,
        onClick: actions.remove,
      }),
    ),
  );
}
