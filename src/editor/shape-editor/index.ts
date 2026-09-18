/**
 * The shape editor, as a sheet over the editor.
 *
 * simple-tileset-generator's vector editor, carried over: drag points and
 * handles, click an edge to drop a point in, ⌥-click to curve a corner, add
 * primitives, reflect, align, distribute, cut one path out of another, punch
 * a hole, resize and rotate, crop to the tile, and SVG in and out.
 *
 * What it saves goes into the **app-wide library** rather than the project,
 * and editing a built-in makes a copy — the same bargain the pattern editor
 * strikes, for the same reason.
 */

import { h } from "../../lib/dom";
import { openSheet } from "../../lib/sheet";
import { shapeLibrary } from "../../lib/library";
import { publish } from "../../lib/ipc";
import { saveAs } from "../../lib/save-as";
import * as log from "../../lib/log";
import {
  addPath,
  align,
  booleanCut,
  commitPen,
  crop,
  deletePoints,
  deleteSelected,
  distribute,
  duplicateSelected,
  primitivePath,
  reflect,
  toggleCurve,
  toggleHole,
} from "./ops";
import { bindShapePointer } from "./input";
import { shapeToolbar } from "./panel";
import {
  capture,
  createShapeState,
  redo,
  selectPath,
  squarePath,
  togglePathInSelection,
  toShapeData,
  undo,
  type ShapeEditorState,
} from "./state";
import { pathsToSvg, svgToPaths } from "./svg";
import { drawShapeEditor, drawShapePreview } from "./view";

export interface ShapeEditorOptions {
  /** The row to open. Absent or unknown means a new shape — the whole tile. */
  shapeId?: string | null;
  /** What the preview draws in. */
  color?: string;
  /** How big a grid space is, so the preview tiles at the working size. */
  cell?: number;
}

const PREVIEW_W = 190;
const PREVIEW_H = 300;

/** Open it, resolving with the saved row's id, or null if it was cancelled. */
export function openShapeEditor(
  options: ShapeEditorOptions = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    const existing = shapeLibrary.get(options.shapeId);
    const state = createShapeState(
      existing ?? { paths: [{ vertices: squarePath().vertices, closed: true }] },
      existing?.id ?? null,
      existing?.name ?? "New shape",
    );

    const sheet = openSheet({
      title: existing ? "Edit shape" : "New shape",
      subtitle: "Saved to the library, and available in every project",
      width: 1000,
      dismissable: false,
    });

    const canvas = h("canvas", { class: "lib-canvas" });
    const preview = h("canvas", { class: "lib-preview-canvas" });
    const nameField = h("input", {
      class: "lib-name",
      type: "text",
      value: state.name,
      "aria-label": "Shape name",
      onInput: (event: Event) => {
        state.name = (event.target as HTMLInputElement).value;
      },
    });

    const color = options.color ?? "#201e1d";
    const cell = Math.max(16, Math.round(options.cell ?? 48));

    const redraw = (): void => {
      drawShapeEditor(canvas, state, pointer.ghost());
      drawShapePreview(preview, state, color, cell, PREVIEW_W, PREVIEW_H);
      toolbar.sync();
      undoButton.disabled = state.past.length === 0;
      redoButton.disabled = state.future.length === 0;
    };

    const toolbar = shapeToolbar({
      state: () => state,
      changed: redraw,
      addPrimitive: (kind) => {
        addPath(state, primitivePath(kind));
        redraw();
      },
      duplicate: () => {
        duplicateSelected(state);
        redraw();
      },
      deletePath: () => {
        deleteSelected(state);
        redraw();
      },
      toggleHole: () => {
        toggleHole(state);
        redraw();
      },
      cut: () => {
        if (!booleanCut(state)) {
          log.warn(
            "Nothing to cut: pick a second path with ⊕, and make sure it does " +
              "not swallow the one being cut",
          );
        }
        redraw();
      },
      reflect: (axis) => {
        reflect(state, axis);
        redraw();
      },
      align: (how) => {
        align(state, how);
        redraw();
      },
      distribute: (how) => {
        distribute(state, how);
        redraw();
      },
      toggleCurve: () => {
        toggleCurve(state);
        redraw();
      },
      togglePen: () => {
        state.pen = state.pen ? null : [];
        state.selectedPoints.clear();
        redraw();
      },
      finishPen: () => {
        if (!commitPen(state)) log.warn("Three corners is the least that encloses anything");
        redraw();
      },
      deletePoints: () => {
        if (!deletePoints(state)) log.warn("A path needs three points — pick another to delete");
        redraw();
      },
      crop: () => {
        crop(state);
        redraw();
      },
      importSvg: () => pickSvg((text) => {
        const paths = svgToPaths(text);
        if (!paths || paths.length === 0) {
          log.warn("Nothing in that SVG this could read — paths, polygons, rects and circles");
          return;
        }
        capture(state);
        state.paths = paths;
        state.current = 0;
        state.selectedPaths = new Set([0]);
        state.selectedPoints.clear();
        redraw();
      }),
      exportSvg: () => void saveSvg(state),
      pickPath: (index) => {
        selectPath(state, index, false);
        redraw();
      },
      togglePath: (index) => {
        togglePathInSelection(state, index);
        redraw();
      },
    });

    const undoButton = h("button", {
      class: "btn btn-ghost",
      text: "Undo",
      onClick: () => {
        if (undo(state)) redraw();
      },
    });
    const redoButton = h("button", {
      class: "btn btn-ghost",
      text: "Redo",
      onClick: () => {
        if (redo(state)) redraw();
      },
    });

    const finish = (id: string | null): void => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keyup", onKeyUp, true);
      pointer.destroy();
      sheet.close();
      resolve(id);
    };

    const saveIt = (asCopy: boolean): void => {
      if (state.crop) crop(state);
      const row = { name: state.name.trim() || "Shape", ...toShapeData(state.paths) };
      const id =
        state.sourceId && !asCopy
          ? shapeLibrary.save(state.sourceId, row)
          : shapeLibrary.add(row);
      shapeLibrary.select(id);
      finish(id);
    };

    // Undo and Redo stay on the left, where they are about the work. The two
    // ways out are grouped and pushed to the right-hand end, in the order the
    // sheets in this app end on: Cancel, then the qualified save, then the
    // one Enter would take — so the button under the thumb is the ordinary
    // answer and Cancel is the furthest thing from it.
    sheet.actions.append(undoButton, redoButton);
    const ways = h("div", { class: "sheet-actions-end" });
    ways.append(
      h("button", { class: "btn btn-ghost", text: "Cancel", onClick: () => finish(null) }),
    );
    // Only where there is something to be a copy *of*. A new shape saved as
    // a copy would be the same button twice.
    if (state.sourceId) {
      ways.append(
        h("button", { class: "btn btn-ghost", text: "Save as a copy", onClick: () => saveIt(true) }),
      );
    }
    ways.append(
      h("button", { class: "btn btn-primary", text: "Save", onClick: () => saveIt(false) }),
    );
    sheet.actions.append(ways);

    const pointer = bindShapePointer(canvas, state, () => redraw());

    const onKey = (event: KeyboardEvent): void => {
      // Capture phase, and stopped: the shell's own ⌘Z is about the document.
      if (event.target instanceof HTMLInputElement) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey ? redo(state) : undo(state)) redraw();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && !state.transforming) {
        state.transforming = true;
        redraw();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        // The pen first: a mode you are in is the thing Escape is about, and
        // losing a half-tapped path *and* the sheet on one key is two
        // surprises for the price of one.
        if (state.pen) {
          state.pen = null;
          redraw();
          return;
        }
        finish(null);
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        event.stopPropagation();
        if (state.selectedPoints.size > 0) deletePoints(state);
        else deleteSelected(state);
        redraw();
        return;
      }
      if (event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        event.stopPropagation();
        duplicateSelected(state, 0, 0);
        redraw();
      }
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key !== "Meta" && event.key !== "Control") return;
      if (!state.transforming) return;
      state.transforming = false;
      redraw();
    };

    document.addEventListener("keydown", onKey, true);
    document.addEventListener("keyup", onKeyUp, true);

    const cropBox = h("input", {
      type: "checkbox",
      onChange: (event: Event) => {
        state.crop = (event.target as HTMLInputElement).checked;
      },
    });

    sheet.body.appendChild(
      h(
        "div",
        { class: "lib-work" },
        toolbar.root,
        h("div", { class: "lib-stage" }, canvas),
        h(
          "div",
          { class: "lib-side" },
          h("div", { class: "lib-section-title m", text: "Name" }),
          nameField,
          h(
            "label",
            { class: "lib-check" },
            cropBox,
            h("span", { text: "Crop to the tile when saving" }),
          ),
          h("div", { class: "lib-section-title m", text: "Tiled" }),
          h("div", { class: "lib-preview" }, preview),
        ),
      ),
    );

    redraw();
  });
}

/** Read an SVG file the ordinary way. */
function pickSvg(onText: (text: string) => void): void {
  const input = h("input", {
    type: "file",
    accept: ".svg,image/svg+xml",
    style: { display: "none" },
  });
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onText(String(reader.result));
    reader.readAsText(file);
  });
  document.body.appendChild(input);
  input.click();
}

async function saveSvg(state: ShapeEditorState): Promise<void> {
  const svg = pathsToSvg(state.paths);
  await saveAs({
    fileName: `${state.name.replace(/[^\w-]+/g, "-").toLowerCase() || "shape"}.svg`,
    filter: { name: "SVG", extensions: ["svg"] },
    what: "Saved the shape",
    // The same route every other export takes: base64 over IPC, written by
    // Rust. A webview cannot be trusted with a download on either platform.
    write: (path) =>
      publish.saveBytes(path, btoa(unescape(encodeURIComponent(svg)))),
  });
}
