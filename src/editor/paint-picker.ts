/**
 * One control for what a mark is made of: a colour, a pattern, or a shape.
 *
 * Three tools and two panels want this question answered — the Pattern brush,
 * the Shape brush, the Fill tool, a fill already on the grid, and the two
 * library editors' own "which row am I editing" — and answering it in five
 * places would be five palettes that drifted apart. So it is one control,
 * built from the kinds its caller is willing to accept: the Pattern brush
 * passes `["pattern"]` and gets no segmented row, because the tool has
 * already said what kind it is.
 *
 * **The palette is the library, and it is editable in place.** New, Edit,
 * Duplicate, Rename and Remove sit under the swatches, so making a dither
 * that is a little denser than the one in the list is three taps from the
 * brush rather than a trip to another screen. Editing a built-in makes a copy
 * — see `lib/library/store.ts` — so the defaults are always there to go back
 * to, and **Restore defaults** puts back anything taken out.
 */

import { h, ICONS, icon } from "../lib/dom";
import { openSheet, confirmSheet } from "../lib/sheet";
import { createColorPicker } from "../lib/color-picker";
import {
  onLibraryChange,
  patternLibrary,
  shapeLibrary,
  type PatternDef,
  type ShapeDef,
} from "../lib/library";
import {
  PATTERN_SCALE_RANGE,
  patternScaleOf,
  type Paint,
  type PaintKind,
} from "../lib/paint";
import { patternSwatch, shapeSwatch } from "./library-thumbs";
import { openPatternEditor } from "./pattern-editor";
import { openShapeEditor } from "./shape-editor";

export interface PaintPickerOptions {
  value: Paint;
  /** Which kinds are on offer. One kind means no segmented row is drawn. */
  kinds?: readonly PaintKind[];
  /** A grid space in world pixels, so an editor previews at the right size. */
  cell?: number;
  onChange: (paint: Paint) => void;
}

export interface PaintPicker {
  root: HTMLElement;
  destroy: () => void;
}

const KIND_LABELS: Record<PaintKind, string> = {
  color: "Colour",
  pattern: "Pattern",
  shape: "Shape",
};

export function createPaintPicker(options: PaintPickerOptions): PaintPicker {
  const kinds = options.kinds ?? (["color", "pattern", "shape"] as const);
  let paint: Paint = { ...options.value };
  const root = h("div", { class: "paint-picker" });

  const emit = (): void => options.onChange({ ...paint });

  const body = h("div", { class: "paint-body" });

  /** Rebuild everything under the segmented row. */
  const render = (): void => {
    body.replaceChildren();
    if (paint.kind === "pattern") body.appendChild(patternSide());
    if (paint.kind === "shape") body.appendChild(shapeSide());
    body.appendChild(colourSide());
  };

  // ── the kind ──────────────────────────────────────────────────────────────
  if (kinds.length > 1) {
    const seg = h("div", { class: "seg" });
    for (const kind of kinds) {
      const button = h("button", {
        class: "seg-opt",
        text: KIND_LABELS[kind],
        "aria-pressed": String(paint.kind === kind),
        onClick: () => {
          paint = { ...paint, kind };
          if (kind === "pattern" && !paint.patternId) {
            paint.patternId = patternLibrary.selectedId ?? undefined;
          }
          if (kind === "shape" && !paint.shapeId) {
            paint.shapeId = shapeLibrary.selectedId ?? undefined;
          }
          for (const other of seg.children) {
            other.setAttribute("aria-pressed", String(other === button));
          }
          render();
          emit();
        },
      });
      seg.appendChild(button);
    }
    root.appendChild(seg);
  }

  root.appendChild(body);

  // ── patterns ──────────────────────────────────────────────────────────────
  function patternSide(): HTMLElement {
    const rows = patternLibrary.list();
    const palette = h("div", { class: "paint-palette" });
    for (const row of rows) {
      palette.appendChild(
        swatch(
          row.name,
          patternSwatch(row, { color: "#201e1d" }),
          row.id === paint.patternId,
          () => {
            paint = { ...paint, patternId: row.id };
            patternLibrary.select(row.id);
            render();
            emit();
          },
        ),
      );
    }

    const scale = h("input", {
      type: "range",
      class: "lib-slider",
      min: String(PATTERN_SCALE_RANGE.min),
      max: String(PATTERN_SCALE_RANGE.max),
      step: "1",
      value: String(patternScaleOf(paint)),
      "aria-label": "Pattern scale",
      onInput: (event: Event) => {
        const next = Number((event.target as HTMLInputElement).value);
        if (!Number.isFinite(next)) return;
        paint = { ...paint, patternScale: next };
        readout.textContent = `${next} px`;
        emit();
      },
    });
    const readout = h("div", { class: "lib-readout", text: `${patternScaleOf(paint)} px` });

    const invert = h("button", {
      class: "lib-toggle",
      text: "Invert",
      "aria-pressed": String(!!paint.patternInvert),
      onClick: () => {
        paint = { ...paint, patternInvert: !paint.patternInvert };
        render();
        emit();
      },
    });

    return h(
      "div",
      { class: "paint-section" },
      palette,
      libraryRow<PatternDef>({
        library: patternLibrary,
        currentId: () => paint.patternId ?? null,
        open: (id) =>
          openPatternEditor({
            patternId: id,
            scale: patternScaleOf(paint),
            color: paint.color,
          }),
        onPicked: (id) => {
          paint = { ...paint, patternId: id };
          render();
          emit();
        },
        noun: "pattern",
      }),
      h(
        "div",
        { class: "lib-field" },
        h("span", { class: "m", text: "Scale" }),
        scale,
        readout,
      ),
      h("div", { class: "lib-hint m", text: "How many world pixels one pattern pixel covers. The lattice is pinned to the world, so strokes line up." }),
      invert,
    );
  }

  // ── shapes ────────────────────────────────────────────────────────────────
  function shapeSide(): HTMLElement {
    const palette = h("div", { class: "paint-palette" });
    for (const row of shapeLibrary.list()) {
      palette.appendChild(
        swatch(row.name, shapeSwatch(row), row.id === paint.shapeId, () => {
          paint = { ...paint, shapeId: row.id };
          shapeLibrary.select(row.id);
          render();
          emit();
        }),
      );
    }

    return h(
      "div",
      { class: "paint-section" },
      palette,
      libraryRow<ShapeDef>({
        library: shapeLibrary,
        currentId: () => paint.shapeId ?? null,
        open: (id) => openShapeEditor({ shapeId: id, color: paint.color, cell: options.cell }),
        onPicked: (id) => {
          paint = { ...paint, shapeId: id };
          render();
          emit();
        },
        noun: "shape",
      }),
    );
  }

  function colourSide(): HTMLElement {
    const picker = createColorPicker({
      value: paint.color,
      onChange: (hex) => {
        paint = { ...paint, color: hex };
        emit();
      },
      onCommit: (hex) => {
        paint = { ...paint, color: hex };
        emit();
      },
    });
    return h(
      "div",
      { class: "paint-section" },
      h("div", { class: "lib-section-title m", text: "Colour" }),
      picker.root,
    );
  }

  render();

  // The palette is app-wide, so an edit made from anywhere — including the
  // other copy of this control in another panel — has to reach this one.
  //
  // It unsubscribes itself once its own element has left the page. The
  // inspector rebuilds its whole panel on every selection change, so a
  // listener that only came off when someone remembered to call `destroy`
  // would be a new listener per rebuild and none of them ever removed.
  const unlisten = onLibraryChange(() => {
    if (!root.isConnected) {
      unlisten();
      return;
    }
    render();
  });

  return { root, destroy: unlisten };
}

/** One palette cell: the swatch, its name underneath, and whether it is current. */
function swatch(
  name: string,
  canvas: HTMLCanvasElement,
  current: boolean,
  onPick: () => void,
): HTMLElement {
  return h(
    "button",
    {
      class: "paint-swatch",
      title: name,
      "aria-label": name,
      "aria-pressed": String(current),
      onClick: onPick,
    },
    canvas,
  );
}

/**
 * The row of things you can do to the palette itself.
 *
 * Deliberately under the swatches rather than on them. A per-swatch menu is
 * what upstream has, and on a touch screen it means a long-press on a 38-pixel
 * target to reach a delete — so the actions apply to whichever row is current,
 * which is the one the brush is already pointed at.
 */
interface LibraryRowOptions<T extends { id: string; name: string }> {
  library: {
    get(id: string | null): T | null;
    duplicate(id: string): string | null;
    rename(id: string, name: string): void;
    remove(id: string): void;
    restoreDefaults(): void;
    isDefault(id: string): boolean;
  };
  currentId: () => string | null;
  open: (id: string | null) => Promise<string | null>;
  onPicked: (id: string) => void;
  noun: string;
}

function libraryRow<T extends { id: string; name: string }>(
  options: LibraryRowOptions<T>,
): HTMLElement {
  const run = async (task: Promise<string | null>): Promise<void> => {
    const id = await task;
    if (id) options.onPicked(id);
  };

  const current = () => options.currentId();

  return h(
    "div",
    { class: "lib-row-buttons paint-actions" },
    h(
      "button",
      { class: "btn btn-ghost", title: `A new ${options.noun}`, onClick: () => void run(options.open(null)) },
      icon(ICONS.plus, 14),
      h("span", { text: "New" }),
    ),
    h("button", {
      class: "btn btn-ghost",
      text: "Edit",
      onClick: () => {
        const id = current();
        if (id) void run(options.open(id));
      },
    }),
    h("button", {
      class: "btn btn-ghost",
      text: "Duplicate",
      onClick: () => {
        const id = current();
        if (!id) return;
        const made = options.library.duplicate(id);
        if (made) options.onPicked(made);
      },
    }),
    h("button", {
      class: "btn btn-ghost",
      text: "Rename",
      onClick: () => {
        const id = current();
        const row = id ? options.library.get(id) : null;
        if (!id || !row) return;
        promptName(`Rename ${options.noun}`, row.name, (name) => options.library.rename(id, name));
      },
    }),
    h("button", {
      class: "btn btn-ghost",
      text: "Remove",
      onClick: () => {
        const id = current();
        const row = id ? options.library.get(id) : null;
        if (!id || !row) return;
        void (async () => {
          const isDefault = options.library.isDefault(id);
          const ok = await confirmSheet(
            `Remove ${row.name}?`,
            isDefault
              ? "It is one of the built-in rows, so it only leaves this palette — Restore defaults brings it back. Anything already drawn with it keeps drawing."
              : "It goes for good. Anything already drawn with it keeps its colour but loses the pattern.",
            "Remove",
            false,
          );
          if (ok) options.library.remove(id);
        })();
      },
    }),
    h("button", {
      class: "btn btn-ghost",
      text: "Restore defaults",
      title: "Put back every built-in row that has been taken out",
      onClick: () => options.library.restoreDefaults(),
    }),
  );
}

/** A one-field sheet, for the two things in here that need a name typed. */
function promptName(title: string, value: string, onName: (name: string) => void): void {
  const sheet = openSheet({ title, width: 420 });
  const field = h("input", { class: "lib-name", type: "text", value });
  sheet.body.appendChild(field);
  const commit = () => {
    const next = field.value.trim();
    sheet.close();
    if (next) onName(next);
  };
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") commit();
  });
  sheet.actions.append(
    h("button", { class: "btn btn-primary", text: "Rename", onClick: commit }),
    h("button", { class: "btn btn-ghost", text: "Cancel", onClick: () => sheet.close() }),
  );
  field.focus();
  field.select();
}
