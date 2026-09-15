/**
 * The pattern editor, as a sheet over the editor.
 *
 * simple-tileset-generator's pixel editor, carried over whole: the tile
 * surrounded by its own repeats, four brushes, an erase toggle, a straight
 * line on shift, a selection you can fill, clear or turn into a brush, a
 * pattern you can push around to change its phase, invert, import and export,
 * and undo.
 *
 * What it saves goes into the **app-wide library**, not into the project —
 * see `lib/library/store.ts`. Editing a built-in makes a copy, which is
 * upstream's behaviour and the one that keeps the defaults a floor rather
 * than something you can lose.
 */

import { h } from "../../lib/dom";
import { openSheet } from "../../lib/sheet";
import { patternLibrary, type PatternData } from "../../lib/library";
import { publish } from "../../lib/ipc";
import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import * as log from "../../lib/log";
import { imageToBits } from "./brushes";
import {
  applyBrush,
  commitOffset,
  moveRegion,
  regionBits,
  invert,
  lineInto,
  nudge,
  patternPngUrl,
  resize,
  setSelection,
  selectionBits,
} from "./draw";
import { patternToolbar } from "./panel";
import {
  CANVAS_PX,
  MAX_SIZE,
  blankPattern,
  capture,
  createPatternState,
  redo,
  selectionBounds,
  undo,
  type PatternEditorState,
} from "./state";
import {
  cellAt,
  drawEditor,
  drawPreview,
  insideSelection,
  layoutOf,
  onSelectionHandle,
  rawCellAt,
} from "./view";

export interface PatternEditorOptions {
  /** The row to open. Absent or unknown means a new, blank pattern. */
  patternId?: string | null;
  /** World pixels per pattern pixel, so the preview is at the working size. */
  scale?: number;
  /** What the preview draws the pattern in. */
  color?: string;
}

const PREVIEW_W = 190;
const PREVIEW_H = 300;

/**
 * Open it, and resolve with the id of what was saved — which is a *new* id
 * when a built-in was edited — or null if it was cancelled.
 */
export function openPatternEditor(
  options: PatternEditorOptions = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    const existing = patternLibrary.get(options.patternId);
    const state = createPatternState(
      existing ? { size: existing.size, pixels: existing.pixels } : blankPattern(),
      existing?.id ?? null,
      existing?.name ?? "New pattern",
    );

    const sheet = openSheet({
      title: existing ? "Edit pattern" : "New pattern",
      subtitle: "Saved to the library, and available in every project",
      width: 980,
      dismissable: false,
    });

    const canvas = h("canvas", { class: "lib-canvas" });
    const preview = h("canvas", { class: "lib-preview-canvas" });
    const nameField = h("input", {
      class: "lib-name",
      type: "text",
      value: state.name,
      "aria-label": "Pattern name",
      onInput: (event: Event) => {
        state.name = (event.target as HTMLInputElement).value;
      },
    });

    const scale = Math.max(1, Math.round(options.scale ?? 4));
    const color = options.color ?? "#201e1d";

    const redraw = (): void => {
      drawEditor(canvas, state);
      drawPreview(preview, state, scale, color, PREVIEW_W, PREVIEW_H);
      toolbar.sync();
      history.sync();
    };

    // ── the toolbar ───────────────────────────────────────────────────────
    const toolbar = patternToolbar({
      state: () => state,
      changed: redraw,
      setSize: (size) => {
        resize(state, size);
        redraw();
      },
      setMode: (mode) => {
        state.mode = mode;
        if (mode !== "select") state.selection = null;
        redraw();
      },
      invert: () => {
        invert(state);
        redraw();
      },
      nudge: (dx, dy) => {
        nudge(state, dx, dy);
        redraw();
      },
      importImage: () => pickImage((image) => {
        capture(state);
        const bits = imageToBits(image, MAX_SIZE);
        state.pattern = { size: bits.length, pixels: bits };
        state.selection = null;
        redraw();
      }),
      exportPng: () => void savePng(state.pattern, state.name),
      uploadBrush: () => pickImage((image) => {
        state.customBrush = imageToBits(image, 32);
        state.brush = "custom";
        redraw();
      }),
      forgetBrush: () => {
        state.customBrush = null;
        if (state.brush === "custom") state.brush = "square";
        redraw();
      },
      brushFromSelection: () => {
        const bits = selectionBits(state);
        if (!bits) {
          log.warn("Nothing inside the box to make a brush from");
          return;
        }
        state.customBrush = bits;
        state.brush = "custom";
        state.mode = "draw";
        state.selection = null;
        redraw();
      },
      fillSelection: (value) => {
        setSelection(state, value);
        redraw();
      },
      clearSelection: () => {
        state.selection = null;
        redraw();
      },
    });

    // ── undo, and the two ways out ────────────────────────────────────────
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
    const history = {
      sync: () => {
        undoButton.disabled = state.past.length === 0;
        redoButton.disabled = state.future.length === 0;
      },
    };

    const finish = (id: string | null): void => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keyup", onKeyUp, true);
      sheet.close();
      resolve(id);
    };

    const saveIt = (asCopy: boolean): void => {
      const row = { name: state.name.trim() || "Pattern", ...state.pattern };
      const id =
        state.sourceId && !asCopy
          ? patternLibrary.save(state.sourceId, row)
          : patternLibrary.add(row);
      patternLibrary.select(id);
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
    // Only where there is something to be a copy *of*. A new pattern saved as
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

    // ── the pointer ───────────────────────────────────────────────────────
    bindPointer(canvas, state, redraw);

    /** Space and ⌘ borrow a mode for as long as they are held. */
    let borrowed: PatternEditorState["mode"] | null = null;

    const onKey = (event: KeyboardEvent): void => {
      // Capture phase, and stopped here: the shell's own ⌘Z and space bar are
      // listening on the same document, and while this sheet is up they are
      // about the wrong history and the wrong camera.
      const typing = event.target instanceof HTMLInputElement;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey ? redo(state) : undo(state)) redraw();
        return;
      }
      if (typing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finish(null);
        return;
      }
      if (event.key.toLowerCase() === "x" && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        event.stopPropagation();
        state.erasing = !state.erasing;
        redraw();
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        event.stopPropagation();
        if (borrowed || state.mode === "pan") return;
        borrowed = state.mode;
        state.mode = "pan";
        redraw();
      }
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code !== "Space" || !borrowed) return;
      event.stopPropagation();
      state.mode = borrowed;
      borrowed = null;
      redraw();
    };

    document.addEventListener("keydown", onKey, true);
    document.addEventListener("keyup", onKeyUp, true);

    sheet.body.appendChild(
      h(
        "div",
        { class: "lib-work" },
        toolbar.root,
        h("div", { class: "lib-stage" }, canvas, zoomRow(state, redraw)),
        h(
          "div",
          { class: "lib-side" },
          h("div", { class: "lib-section-title m", text: "Name" }),
          nameField,
          h("div", { class: "lib-section-title m", text: "At this project's scale" }),
          h("div", { class: "lib-preview" }, preview),
        ),
      ),
    );

    redraw();
  });
}

/** The zoom slider under the canvas: 0.25 to 1, where 1 fills the red box. */
function zoomRow(state: PatternEditorState, redraw: () => void): HTMLElement {
  const readout = h("div", { class: "lib-readout", text: "1:1" });
  const input = h("input", {
    type: "range",
    class: "lib-slider",
    min: "25",
    max: "100",
    step: "1",
    value: "100",
    "aria-label": "Zoom",
    onInput: (event: Event) => {
      const next = Number((event.target as HTMLInputElement).value);
      state.zoom = next / 100;
      readout.textContent = next === 100 ? "1:1" : `${(next / 100).toFixed(2)}×`;
      redraw();
    },
  });
  return h("div", { class: "lib-field lib-zoom" }, h("span", { class: "m", text: "Zoom" }), input, readout);
}

/**
 * Everything the pointer does, in one place.
 *
 * Pointer events rather than mouse and touch separately — upstream has both,
 * and this shell runs on a device where the same gesture arrives as a pen, a
 * finger or a trackpad. One listener set means the Pencil draws, a finger
 * draws, and neither is a translation of the other.
 */
function bindPointer(
  canvas: HTMLCanvasElement,
  state: PatternEditorState,
  redraw: () => void,
): void {
  /** What the gesture in flight is doing, or null between gestures. */
  let doing: "draw" | "line" | "select" | "move" | "resize" | "pan" | null = null;
  let value = 1;
  let from: { row: number; col: number } | null = null;
  let panFrom: { x: number; y: number } | null = null;
  /** What a settled selection is carrying, once a drag has picked it up. */
  let held: number[][] | null = null;
  let heldFrom: { r0: number; c0: number; r1: number; c1: number } | null = null;
  let heldAt: { row: number; col: number } | null = null;

  const local = (event: PointerEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    const at = local(event);
    const cell = cellAt(state, at.x, at.y);
    const wantsSelect = state.mode === "select" || event.metaKey || event.ctrlKey;
    const wantsPan = state.mode === "pan";

    if (wantsPan) {
      capture(state);
      doing = "pan";
      panFrom = at;
      return;
    }
    if (wantsSelect) {
      const box = selectionBounds(state);
      // A settled box answers to two more gestures before it answers to being
      // replaced: its corner repeats what it holds, and its middle moves it.
      if (box && (onSelectionHandle(state, at.x, at.y) || insideSelection(state, cell.row, cell.col))) {
        capture(state);
        held = regionBits(state.pattern, box);
        heldFrom = box;
        // Unwrapped, so a drag that leaves the tile carries on instead of
        // leaping to the other side — see `rawCellAt`.
        heldAt = rawCellAt(state, at.x, at.y);
        doing = onSelectionHandle(state, at.x, at.y) ? "resize" : "move";
        state.preview = moveRegion(state.pattern, box, held, box.r0, box.c0);
        redraw();
        return;
      }

      doing = "select";
      state.sweeping = true;
      state.selection = { r0: cell.row, c0: cell.col, r1: cell.row, c1: cell.col };
      redraw();
      return;
    }

    capture(state);
    value = state.erasing ? 0 : 1;
    from = cell;
    if (event.shiftKey) {
      doing = "line";
      state.preview = lineInto(state, state.pattern, cell, cell, value);
    } else {
      doing = "draw";
      applyBrush(state, state.pattern, cell.row, cell.col, value);
    }
    redraw();
  });

  canvas.addEventListener("pointermove", (event) => {
    const at = local(event);
    const cell = cellAt(state, at.x, at.y);
    state.hover = cell;

    if (doing === "pan" && panFrom) {
      // Whole cells only, measured from where the drag started — so the
      // pattern jumps a cell at a time rather than sliding between them, and
      // what you let go of is what gets written.
      const layout = layoutOf(state);
      state.offset = {
        x: Math.round((at.x - panFrom.x) / layout.cell),
        y: Math.round((at.y - panFrom.y) / layout.cell),
      };
      redraw();
      return;
    }

    if (doing === "select" && state.selection) {
      state.selection = { ...state.selection, r1: cell.row, c1: cell.col };
      redraw();
      return;
    }

    if ((doing === "move" || doing === "resize") && held && heldFrom && heldAt) {
      const raw = rawCellAt(state, at.x, at.y);
      if (doing === "move") {
        const dr = raw.row - heldAt.row;
        const dc = raw.col - heldAt.col;
        state.preview = moveRegion(state.pattern, heldFrom, held, heldFrom.r0 + dr, heldFrom.c0 + dc);
        state.selection = {
          r0: heldFrom.r0 + dr,
          c0: heldFrom.c0 + dc,
          r1: heldFrom.r1 + dr,
          c1: heldFrom.c1 + dc,
        };
      } else {
        const width = Math.max(1, Math.min(state.pattern.size, raw.col - heldFrom.c0 + 1));
        const height = Math.max(1, Math.min(state.pattern.size, raw.row - heldFrom.r0 + 1));
        state.preview = moveRegion(state.pattern, heldFrom, held, heldFrom.r0, heldFrom.c0, {
          width,
          height,
        });
        state.selection = {
          r0: heldFrom.r0,
          c0: heldFrom.c0,
          r1: heldFrom.r0 + height - 1,
          c1: heldFrom.c0 + width - 1,
        };
      }
      redraw();
      return;
    }

    if (doing === "line" && from) {
      state.preview = lineInto(state, state.pattern, from, cell, value);
      redraw();
      return;
    }

    if (doing === "draw") {
      applyBrush(state, state.pattern, cell.row, cell.col, value);
    }
    redraw();
  });

  const end = (): void => {
    if (state.preview && (doing === "line" || doing === "move" || doing === "resize")) {
      state.pattern = state.preview;
      // The cells wrapped as they landed; the box has to follow them back
      // into the tile, or the next drag on it is a drag on empty canvas.
      if (state.selection) {
        const size = state.pattern.size;
        const wrap = (n: number) => ((n % size) + size) % size;
        const { r0, c0, r1, c1 } = state.selection;
        state.selection = {
          r0: wrap(r0),
          c0: wrap(c0),
          r1: wrap(r0) + (r1 - r0),
          c1: wrap(c0) + (c1 - c0),
        };
      }
    }
    if (doing === "pan") commitOffset(state);
    state.preview = null;
    state.sweeping = false;
    doing = null;
    from = null;
    panFrom = null;
    held = null;
    heldFrom = null;
    heldAt = null;
    redraw();
  };

  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("pointerleave", () => {
    state.hover = null;
    if (doing) end();
    else redraw();
  });

  canvas.width = CANVAS_PX;
  canvas.height = CANVAS_PX;
  // A brush wants a crosshair; the other two say what they do by dragging.
  canvas.style.cursor = "crosshair";
}

/** Read an image file the ordinary way: a file input and a data URL. */
function pickImage(onImage: (image: HTMLImageElement) => void): void {
  const input = h("input", { type: "file", accept: "image/*", style: { display: "none" } });
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => onImage(image);
      image.onerror = () => log.warn("That file could not be read as an image");
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
  document.body.appendChild(input);
  input.click();
}

/** The pattern as a PNG on disk, one pixel per pixel. */
async function savePng(pattern: PatternData, name: string): Promise<void> {
  try {
    const url = patternPngUrl(pattern);
    if (!url) return;
    const path = await saveFileDialog({
      defaultPath: `${name.replace(/[^\w-]+/g, "-").toLowerCase() || "pattern"}.png`,
      filters: [{ name: "PNG", extensions: ["png"] }],
    });
    if (!path) return;
    await publish.saveBytes(path, url);
    log.info(`Saved ${path}`);
  } catch (err) {
    log.error("Could not save the pattern:", err);
  }
}
