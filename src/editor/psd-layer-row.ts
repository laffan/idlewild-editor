/**
 * One row of a PSD's layer list: the grip, the name, the second line, and
 * whatever the row leads to.
 *
 * Apart from the list for the 700-line rule, and it splits cleanly because a
 * row is a function of what it is showing. Everything stateful — which groups
 * are folded, where a drag is up to, what the file is — reaches it through
 * `RowContext` rather than through `this`, so the list keeps the state and
 * this keeps the markup.
 *
 * The indent is the only thing saying what is inside what, so it is set from
 * the row's depth rather than by a rule per level.
 */

import { h, ICONS, icon } from "../lib/dom";
import { blockLength } from "./psd-layer-tree";
import type { OwnedLayer } from "./psd-layer-owner";
import type { PsdLayerInfo, PsdLayerList } from "../lib/ipc";

/**
 * A layer as it is in the file, beside the name it is being given.
 *
 * `depth` is the row's own, carried here rather than read off `source` every
 * time because it is what the tree arithmetic works on — and because a move
 * is free to change it the day the inspector offers a way to re-parent.
 */
export interface Row {
  source: PsdLayerInfo;
  name: string;
  depth: number;
  /**
   * Whether its eye is on, as this list is showing it.
   *
   * Photoshop's own eye, and the same one psd-to-json reads: a hidden layer
   * is exported and placed and simply starts turned off, in the editor and in
   * the game. Held here beside the name because it is staged the same way —
   * the canvas shows it at once, the file hears about it on Apply.
   */
  visible: boolean;
}

/** A row as it comes off a read: where it is, at the depth the file has it. */
export function asRow(source: PsdLayerInfo): Row {
  return {
    source,
    name: source.name,
    depth: source.depth,
    visible: source.visible,
  };
}

/** Everything a row needs from the list it is part of. */
export interface RowContext {
  /** The file, which decides whether anything here can be typed in at all. */
  stack: PsdLayerList;
  /** The order as it stands, for measuring how much a group is holding. */
  rows: readonly Row[];
  /** Whether the app owns this layer's name, and what it offers instead. */
  owner: (layer: PsdLayerInfo) => OwnedLayer | null;
  folded: (row: Row) => boolean;
  onFold: (row: Row) => void;
  /** A keystroke in the name field; the list decides what is dirty. */
  onRename: (row: Row, name: string) => void;
  /** The eye, clicked. */
  onVisible: (row: Row, visible: boolean) => void;
  onGripDown: (event: PointerEvent) => void;
  onGripKey: (event: KeyboardEvent, row: Row) => void;
  /** Draw into this layer. Only reached where `penable` says so. */
  onPen: (layer: PsdLayerInfo) => void;
}

/** How far one level of nesting indents a row, in pixels. */
const INDENT = 14;

export function psdLayerRow(row: Row, ctx: RowContext): HTMLElement {
  const owner = ctx.owner(row.source);
  const group = row.source.isGroup;
  const writable = ctx.stack.writable;
  return h(
    "div",
    {
      class:
        `psd-layer-row ${row.source.category}` +
        `${owner ? " owned" : ""}${group ? " group" : ""}`,
      dataset: { index: String(row.source.index) },
      style: { paddingLeft: `${row.depth * INDENT}px` },
    },
    writable
      ? h(
          "button",
          {
            class: "psd-layer-grip",
            title: "Drag to reorder",
            "aria-label": `Reorder ${row.source.name}`,
            onPointerDown: (event: PointerEvent) => ctx.onGripDown(event),
            onKeyDown: (event: KeyboardEvent) => ctx.onGripKey(event, row),
          },
          icon(ICONS.grip, 14),
        )
      : h("div", { class: "psd-layer-grip" }),
    h(
      "div",
      { class: "psd-layer-main" },
      h("input", {
        class: "psd-layer-name",
        value: row.name,
        readonly: writable && !owner ? null : "true",
        title: owner?.reason ?? null,
        onInput: (event: Event) => {
          ctx.onRename(row, (event.target as HTMLInputElement).value);
        },
        onKeyDown: (event: KeyboardEvent) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        },
      }),
      group
        ? foldEl(row, ctx)
        : h("div", {
            class: "psd-layer-meta m",
            text:
              `${row.source.category} · ` +
              `${row.source.width} × ${row.source.height}`,
          }),
    ),
    owner?.action
      ? actionEl(owner.action.icon, owner.action.label, owner.action.run)
      : null,
    // The way into pen mode, on every row there is anything to draw in.
    // Beside the extrusion's cube rather than instead of it, and for the same
    // reason: a row that leads somewhere says so on the row.
    penable(row.source, owner)
      ? actionEl(ICONS.pen, `Draw in "${row.source.name}"`, () =>
          ctx.onPen(row.source),
        )
      : null,
    // The eye, last on the row, in a column of its own — it is on every row
    // rather than on the ones that lead somewhere, so it lines up down the
    // list the way Photoshop's does. A file that cannot be rewritten cannot
    // be told anything, so it shows the state without offering to change it.
    eyeEl(row, ctx),
  );
}

/**
 * Whether pen mode can draw into a row.
 *
 * A sprite, and one whose name is the author's. Groups are out because ink
 * goes into a layer rather than into a folder of them; the two marks are out
 * because they carry no pixels the game ever sees; and an extrusion's own
 * layers are out because Apply regenerates them under the file's key, so
 * anything painted over one would disappear the next time the solid behind it
 * was pulled. That last case is the one worth being firm about — it would
 * look like it worked, right up until it quietly did not.
 */
export function penable(
  layer: PsdLayerInfo,
  owner: OwnedLayer | null,
): boolean {
  return !owner && !layer.isGroup && layer.category === "sprite";
}

/**
 * The eye: whether the game draws this layer.
 *
 * Hiding is not a rename, so it is offered on rows whose *name* the app owns
 * as well — the two marks, an extrusion's parts. Nothing downstream reads a
 * mark's pixels, so turning one off changes only what Photoshop shows; an
 * extrusion's parts are artwork like any other, and being able to drop the
 * lines from a block-out is the reason to want this at all.
 */
function eyeEl(row: Row, ctx: RowContext): HTMLElement {
  const shown = row.visible;
  const label = shown ? `Hide "${row.source.name}"` : `Show "${row.source.name}"`;
  return h(
    "button",
    {
      class: shown ? "psd-layer-eye" : "psd-layer-eye off",
      title: ctx.stack.writable ? label : "This file is read-only",
      "aria-label": label,
      "aria-pressed": String(!shown),
      disabled: ctx.stack.writable ? null : "true",
      onClick: () => ctx.onVisible(row, !shown),
    },
    icon(shown ? ICONS.eye : ICONS.eyeOff, 14),
  );
}

/** One icon button on the right of a row. */
function actionEl(
  glyph: string | readonly string[],
  label: string,
  run: () => void,
): HTMLElement {
  return h(
    "button",
    {
      class: "psd-layer-action",
      title: label,
      "aria-label": label,
      onClick: run,
    },
    icon(glyph, 14),
  );
}

/**
 * A group's second line, which is also the handle that folds it away.
 *
 * On the meta line rather than beside the grip, where it would push the name
 * over too — and a name sitting further right than every other name reads as
 * the group itself being inside something.
 *
 * The count is of layers, so a group holding a group counts what is in
 * neither of them; the fold takes the whole block regardless, which is what
 * the indent under it already shows.
 */
function foldEl(row: Row, ctx: RowContext): HTMLElement {
  const at = ctx.rows.indexOf(row);
  const block = at < 0 ? 1 : blockLength(ctx.rows, at);
  const layers = ctx.rows
    .slice(at + 1, at + block)
    .filter((held) => !held.source.isGroup).length;
  const label = `group · ${layers} ${layers === 1 ? "layer" : "layers"}`;
  if (block < 2) return h("div", { class: "psd-layer-meta m", text: label });

  const shut = ctx.folded(row);
  return h(
    "button",
    {
      class: "psd-layer-meta m psd-layer-fold",
      "aria-expanded": shut ? "false" : "true",
      title: shut ? "Show what is inside" : "Hide what is inside",
      onClick: () => ctx.onFold(row),
    },
    icon(shut ? ICONS.chevronRight : ICONS.chevronDown, 12),
    h("span", { text: label }),
  );
}
