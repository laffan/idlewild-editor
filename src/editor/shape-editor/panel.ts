/**
 * The shape editor's toolbar, and the list of the shape's own paths.
 *
 * Upstream's toolbar is five drop-downs across the top — Add, Reflect, Align,
 * Distribute, Cut — and a couple of buttons. The same operations are here,
 * in a column, without the drop-downs: a submenu that opens on hover is a
 * pointer idiom, and half of what this editor is for happens under a finger.
 *
 * **The path list is new**, and it is here for the same reason the pattern
 * editor grew a mode switch. Upstream selects a path by clicking it and adds
 * to the selection with ⇧-click, which is how align, distribute and the
 * boolean cut are aimed. With no shift key those three operations are
 * unreachable, so every path is a row: tapping one picks it, and the ⊕ beside
 * it adds or removes it from the selection.
 */

import { h, ICONS, icon } from "../../lib/dom";
import type { Alignment, Distribution, Primitive } from "./ops";
import { selectedPaths, type ShapeEditorState } from "./state";

export interface ShapePanelActions {
  state: () => ShapeEditorState;
  changed: () => void;
  addPrimitive: (kind: Primitive) => void;
  duplicate: () => void;
  deletePath: () => void;
  toggleHole: () => void;
  cut: () => void;
  reflect: (axis: "horizontal" | "vertical") => void;
  align: (how: Alignment) => void;
  distribute: (how: Distribution) => void;
  toggleCurve: () => void;
  deletePoints: () => void;
  /** Put the pen down, or take it up and throw away what it has. */
  togglePen: () => void;
  /** Lay the tapped-out path down. */
  finishPen: () => void;
  crop: () => void;
  importSvg: () => void;
  exportSvg: () => void;
  /** Make this path the current one — the subject of everything unqualified. */
  pickPath: (index: number) => void;
  /** And the ⊕: in or out of the selection, leaving the subject alone. */
  togglePath: (index: number) => void;
}

export interface ShapePanel {
  root: HTMLElement;
  sync: () => void;
}

const PRIMITIVES: Array<{ id: Primitive; label: string }> = [
  { id: "square", label: "Square" },
  { id: "circle", label: "Circle" },
  { id: "triangle", label: "Triangle" },
  { id: "hexagon", label: "Hexagon" },
];

const ALIGNMENTS: Array<{ id: Alignment; label: string }> = [
  { id: "left", label: "Left" },
  { id: "centre", label: "Centre" },
  { id: "right", label: "Right" },
  { id: "top", label: "Top" },
  { id: "middle", label: "Middle" },
  { id: "bottom", label: "Bottom" },
];

const DISTRIBUTIONS: Array<{ id: Distribution; label: string }> = [
  { id: "horizontal", label: "Across" },
  { id: "vertical", label: "Down" },
  { id: "line", label: "Along a line" },
];

export function shapeToolbar(actions: ShapePanelActions): ShapePanel {
  const root = h("div", { class: "lib-tools" });
  const syncs: Array<() => void> = [];

  root.append(
    section(
      "Add",
      row(
        ...PRIMITIVES.map((p) =>
          h("button", { class: "btn btn-ghost", text: p.label, onClick: () => actions.addPrimitive(p.id) }),
        ),
      ),
    ),
  );

  // ── the paths, and what can be done to them ───────────────────────────────
  const list = h("div", { class: "lib-paths" });
  syncs.push(() => {
    const state = actions.state();
    const picked = new Set(selectedPaths(state));
    list.replaceChildren(
      ...state.paths.map((path, index) =>
        h(
          "div",
          {
            class: "lib-path-row",
            "aria-current": String(index === state.current),
            "aria-selected": String(picked.has(index)),
          },
          h("button", {
            class: "lib-path-name",
            text: `${path.hole ? "Hole" : "Path"} ${index + 1}`,
            onClick: () => actions.pickPath(index),
          }),
          h("span", { class: "lib-path-count m", text: `${path.vertices.length}` }),
          h(
            "button",
            {
              class: "lib-path-add",
              title: picked.has(index) ? "Take out of the selection" : "Add to the selection",
              "aria-pressed": String(picked.has(index)),
              onClick: () => actions.togglePath(index),
            },
            icon(picked.has(index) ? ICONS.check : ICONS.plus, 14),
          ),
        ),
      ),
    );
  });

  const holeButton = h("button", { class: "btn btn-ghost", text: "Make a hole", onClick: () => actions.toggleHole() });
  syncs.push(() => {
    const state = actions.state();
    const anyHole = selectedPaths(state).some((i) => state.paths[i]?.hole);
    holeButton.textContent = anyHole ? "Fill the hole in" : "Make a hole";
  });

  root.append(
    section(
      "Paths",
      list,
      row(
        h("button", { class: "btn btn-ghost", text: "Duplicate", onClick: () => actions.duplicate() }),
        h("button", { class: "btn btn-ghost", text: "Delete", onClick: () => actions.deletePath() }),
      ),
      row(
        holeButton,
        h("button", {
          class: "btn btn-ghost",
          text: "Cut out",
          title: "Take every other selected path out of the current one",
          onClick: () => actions.cut(),
        }),
      ),
    ),
  );

  root.append(
    section(
      "Arrange",
      row(
        h("button", { class: "btn btn-ghost", text: "Flip across", onClick: () => actions.reflect("horizontal") }),
        h("button", { class: "btn btn-ghost", text: "Flip down", onClick: () => actions.reflect("vertical") }),
      ),
      h("div", {
        class: "lib-hint m",
        text:
          "Two or more points selected and it is the points that line up. " +
          "Otherwise one path lines up with the tile, and several with each other.",
      }),
      h(
        "div",
        { class: "lib-grid-3" },
        ...ALIGNMENTS.map((a) =>
          h("button", { class: "btn btn-ghost", text: a.label, onClick: () => actions.align(a.id) }),
        ),
      ),
      h("div", {
        class: "lib-hint m",
        text: "Three or more — points if that many are selected, else paths.",
      }),
      row(
        ...DISTRIBUTIONS.map((d) =>
          h("button", { class: "btn btn-ghost", text: d.label, onClick: () => actions.distribute(d.id) }),
        ),
      ),
    ),
  );

  const transform = h("button", {
    class: "lib-toggle",
    text: "Resize and rotate",
    title: "Show the transform box. Holding ⌘ does the same.",
    onClick: () => {
      const state = actions.state();
      state.transforming = !state.transforming;
      actions.changed();
    },
  });
  syncs.push(() => transform.setAttribute("aria-pressed", String(actions.state().transforming)));

  // The pen, and the two things that only make sense while it is down.
  const pen = h("button", {
    class: "lib-toggle",
    text: "Draw a path",
    title: "Tap corners on the canvas; tap the first one again to close",
    onClick: () => actions.togglePen(),
  });
  const penRow = h(
    "div",
    { class: "lib-row-buttons" },
    h("button", { class: "btn btn-ghost", text: "Finish", onClick: () => actions.finishPen() }),
    h("button", { class: "btn btn-ghost", text: "Cancel", onClick: () => actions.togglePen() }),
  );
  const penCount = h("div", { class: "lib-hint m" });
  syncs.push(() => {
    const corners = actions.state().pen;
    pen.setAttribute("aria-pressed", String(corners !== null));
    penRow.hidden = corners === null;
    penCount.hidden = corners === null;
    const count = corners?.length ?? 0;
    penCount.textContent =
      count === 0
        ? "Tap the canvas to drop a corner."
        : `${count} ${count === 1 ? "corner" : "corners"} — tap the first one again to close.`;
  });

  root.append(
    section(
      "Points",
      row(
        h("button", { class: "btn btn-ghost", text: "Curve or corner", onClick: () => actions.toggleCurve() }),
        h("button", { class: "btn btn-ghost", text: "Delete point", onClick: () => actions.deletePoints() }),
      ),
      transform,
      pen,
      penCount,
      penRow,
      h("div", {
        class: "lib-hint m",
        text: "Click an edge to drop a point into it. ⌥-click a point to curve it.",
      }),
    ),
  );

  root.append(
    section(
      "Shape",
      row(
        h("button", {
          class: "btn btn-ghost",
          text: "Crop to fill",
          title: "Scale the shape so it fills the tile exactly",
          onClick: () => actions.crop(),
        }),
      ),
      row(
        h("button", { class: "btn btn-ghost", text: "Import SVG…", onClick: () => actions.importSvg() }),
        h("button", { class: "btn btn-ghost", text: "Save SVG…", onClick: () => actions.exportSvg() }),
      ),
    ),
  );

  return {
    root,
    sync: () => {
      for (const run of syncs) run();
    },
  };
}

function section(title: string, ...children: (Node | null)[]): HTMLElement {
  return h(
    "div",
    { class: "lib-section" },
    h("div", { class: "lib-section-title m", text: title }),
    ...children,
  );
}

function row(...children: (Node | null)[]): HTMLElement {
  return h("div", { class: "lib-row-buttons" }, ...children);
}
