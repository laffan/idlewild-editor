/**
 * The left sidebar as Code mode draws it: a directory of what the project is
 * made of, rather than a panel you build with.
 *
 * Draw's list is a set of controls — rename a layer, hide it, lock it, carry
 * it up the stack, put a new one on top — and in Code none of that has a
 * canvas to happen on: the game is running over it, nothing there can be
 * picked up, and the inspector that would describe a selection is down. What
 * is left is the half a developer actually wants while writing code beside
 * the game, which is the **names**: the scenes, the Phaser layers in them,
 * the PSDs standing on those, and the layers inside each file. Those are what
 * the project's own code addresses things by, and reading one off the file in
 * Photoshop or out of `game.config.json` is two windows away from where the
 * line is being typed.
 *
 * So this is the same tree with the handles taken off and one level added.
 * Every row is inert except its disclosure — tapping a layer opens it, and
 * tapping a placed PSD opens *that*, which is the level Draw's panel
 * deliberately does not have. (Draw is right not to: a placed PSD is one
 * thing on the canvas however many layers are inside it, and listing its
 * insides there would put a file's stack in the panel that is about the
 * scene. Here nothing is being selected, so the two senses of "layer" cannot
 * be confused by a click.)
 *
 * The names are selectable text, which they are nowhere else in the shell —
 * the whole point of a lookup is copying what you looked up.
 *
 * And in a PSD to Phaser project a row can be **dragged onto the code**: a
 * layer, a placed PSD or a layer inside one, let go over the canvas area or
 * the code panel, writes the `this.P2P.place` lines for it at the caret. See
 * `code-drag.ts`. A placed PSD or a layer in one whose code puts it somewhere
 * other than the canvas does carries a **reset** at the end of its row, which
 * writes the canvas's position into the code — see `code-sync.ts`.
 */

import { h, ICONS, icon } from "../lib/dom";
import type { DocStore } from "../lib/doc-store";
import { layerKind } from "../lib/layer-kinds";
import { layerDepth, type ManifestLayer } from "../lib/manifest";
import { count, describe, emptyText, KIND_ICONS, layerItems } from "./layer-items";
import { layerGlyph } from "./psd-layer-row";
import { psdLayerThumbBox, psdThumbBox, thumbsByPath } from "./psd-thumb-box";
import type { Layer } from "../lib/types";
import type { CodeSource } from "./code-drag";

export interface DirectoryContext {
  store: DocStore;
  /** Which order an object layer's placed files are listed in. */
  isometric: boolean;
  /** The rule an object layer enforces, so a row can still say `No anchor`. */
  isAnchored: (psdKey: string) => boolean;
  /** What is inside a placed file, from the scene's own parsed manifest. */
  psdLayers: (psdKey: string) => readonly ManifestLayer[];
  /** Whether a row is open. The ids are the panel's, and it owns the set. */
  isOpen: (id: string) => boolean;
  /** Open it, or shut it, and redraw. */
  toggle: (id: string) => void;
  /** Make a row draggable onto the code, where the project takes it. */
  dragToCode?: (row: HTMLElement, source: CodeSource, label: string) => void;
  /** Where the code and the canvas disagree about a position, and the fix. */
  codeStatus?: CodeStatus | null;
}

export interface CodeStatus {
  diverged: (placementId: string, path?: string) => boolean;
  reset: (placementId: string, path?: string) => void;
  /** Open the code where it is placed. */
  reveal: (placementId: string, path?: string) => void;
}

/**
 * Draw's mark on a placed PSD's row whose code has gone its own way — the
 * same pieces Code's directory carries a reset for. A broken link, at the
 * row's right-hand end, which opens the code where it is placed. A span
 * rather than a button, because the row may be a button already.
 */
export function unlinkMark(status: CodeStatus | null, placementId: string): HTMLElement | null {
  if (!status?.diverged(placementId)) return null;
  return h(
    "span",
    {
      class: "code-unlink",
      role: "button",
      tabindex: "0",
      title: "Edited by hand in the code — open it where it is placed",
      onPointerDown: (event: Event) => event.stopPropagation(),
      onClick: (event: Event) => {
        event.stopPropagation();
        status.reveal(placementId);
      },
    },
    icon(ICONS.unlink, 12),
  );
}

/**
 * The reset at the end of a row whose code stands it somewhere else. A span
 * rather than a button, because a placed PSD's row is a button already.
 */
function resetMark(ctx: DirectoryContext, placementId: string, path?: string): HTMLElement | null {
  const status = ctx.codeStatus;
  if (!status?.diverged(placementId, path)) return null;
  const mark = h(
    "span",
    {
      class: "code-reset",
      role: "button",
      tabindex: "0",
      title: "The code puts this somewhere else — reset it to where it is in Draw",
      onClick: (event: Event) => {
        event.stopPropagation();
        status.reset(placementId, path);
      },
    },
    icon(ICONS.restart, 12),
  );
  return mark;
}

/**
 * The id a placed PSD's row is remembered by.
 *
 * Keyed on the placement rather than on the file, because the same PSD placed
 * on two layers is two rows and opening one is not opening the other. Prefixed
 * so it can share the panel's one set of open rows with the layer ids.
 */
function psdRowId(layerId: string, placementId: string): string {
  return `psd:${layerId}:${placementId}`;
}

/** Draw the whole directory into an empty body. */
export function renderDirectory(body: HTMLElement, ctx: DirectoryContext): void {
  for (const layer of ctx.store.layers) {
    const group = h("div", { class: "layer-group", dataset: { layerId: layer.id } });
    group.appendChild(layerRow(layer, ctx));
    body.appendChild(group);
    if (ctx.isOpen(layer.id)) fillLayer(group, layer, ctx);
  }
}

/**
 * A layer's own row: what it is, what it is called, and what is on it.
 *
 * The whole row is the disclosure. In Draw it is a 22px arrow because the rest
 * of the row is five other controls; with those gone, the row has one meaning
 * and a finger should be able to land anywhere on it.
 */
function layerRow(layer: Layer, ctx: DirectoryContext): HTMLElement {
  const kind = layerKind(layer);
  const open = ctx.isOpen(layer.id);
  const row = h(
    "button",
    {
      class: `layer-row browse kind-${kind}`,
      "aria-expanded": String(open),
      onClick: () => ctx.toggle(layer.id),
    },
    h(
      "span",
      { class: open ? "layer-disclose open" : "layer-disclose" },
      icon(ICONS.chevronRight, 13),
    ),
    h("span", { class: "layer-kind" }, icon(KIND_ICONS[kind], 14)),
    h(
      "span",
      { class: "layer-main" },
      h("span", { class: "layer-name static", text: layer.name }),
      h("span", { class: "layer-meta m", text: describe(layer) }),
    ),
  );
  ctx.dragToCode?.(row, { kind: "layer", layerId: layer.id }, layer.name);
  return row;
}

/** Everything on a layer, listed under it. */
function fillLayer(
  group: HTMLElement,
  layer: Layer,
  ctx: DirectoryContext,
): void {
  const items = layerItems(layer, {
    startPointId: ctx.store.activeScene.startPointId,
    isAnchored: ctx.isAnchored,
    isometric: ctx.isometric,
  });

  if (items.length === 0 && layer.strokes.length === 0) {
    group.appendChild(h("div", { class: "layer-item empty m", text: emptyText(layer) }));
    return;
  }

  for (const item of items) {
    // A placed file is the one row with something under it. Everything else —
    // a fill, a point, a boundary, a backdrop — is a fact about the document
    // and has no stack inside it to open.
    if (item.selection.kind !== "placement" || !item.psdKey) {
      const row = group.appendChild(staticItem(item.path, item.label, item.detail, item.swatch));
      // A backdrop is no PSD, and is written as Graphics — see `placement-code.ts`.
      if (item.selection.kind === "background") {
        const at = { kind: "backdrop" as const, layerId: layer.id, backgroundId: item.selection.backgroundId };
        ctx.dragToCode?.(row, at, item.label);
      }
      continue;
    }
    group.appendChild(psdRow(layer.id, item.selection.placementId, item, ctx));
    const id = psdRowId(layer.id, item.selection.placementId);
    if (ctx.isOpen(id)) {
      const at = { layerId: layer.id, placementId: item.selection.placementId };
      fillPsd(group, item.psdKey, ctx.psdLayers(item.psdKey), ctx, at);
    }
  }

  if (layer.strokes.length > 0) {
    group.appendChild(
      staticItem(ICONS.pencil, count(layer.strokes.length, "stroke"), ""),
    );
  }
}

/** A placed PSD, which opens onto its own layer stack. */
function psdRow(
  layerId: string,
  placementId: string,
  item: { label: string; detail: string; warning?: string; psdKey?: string; path: string | readonly string[] },
  ctx: DirectoryContext,
): HTMLElement {
  const id = psdRowId(layerId, placementId);
  const open = ctx.isOpen(id);
  const row = h(
    "button",
    {
      class: "layer-item browse",
      "aria-expanded": String(open),
      onClick: () => ctx.toggle(id),
    },
    h(
      "span",
      { class: open ? "layer-disclose open" : "layer-disclose" },
      icon(ICONS.chevronRight, 12),
    ),
    item.psdKey ? psdThumbBox(item.psdKey, item.path) : null,
    h("span", { class: "layer-item-label", text: item.label }),
    h("span", {
      class: "layer-item-detail m",
      text: item.warning ?? item.detail,
    }),
    resetMark(ctx, placementId),
  );
  ctx.dragToCode?.(row, { kind: "placed", layerId, placementId }, item.label);
  return row;
}

/**
 * The layers inside one file, in the file's own order and nesting.
 *
 * Every one of them, the editor's two marks included: this says what is in
 * the document, and a list that quietly dropped two rows would disagree with
 * what Photoshop shows. What it does say about them is that they are not
 * artwork — the category is beside each name, which is also the thing that
 * tells a developer whether a row has a texture behind it or is a point the
 * config carries.
 */
function fillPsd(
  group: HTMLElement,
  key: string,
  layers: readonly ManifestLayer[],
  ctx: DirectoryContext,
  at: { layerId: string; placementId: string },
): void {
  if (layers.length === 0) {
    group.appendChild(
      h("div", {
        class: "psd-layer-row empty m",
        style: { paddingLeft: "68px" },
        // Not an error: the file is placed and it draws. The manifest simply
        // has not arrived yet, or this is a key the scene never loaded.
        text: "Not loaded yet",
      }),
    );
    return;
  }

  for (const layer of layers) {
    const row = group.appendChild(
      h(
        "div",
        {
          class: layer.visible ? "psd-layer-row" : "psd-layer-row hidden-layer",
          // The stack's own shape, so a group reads as holding what is under
          // it rather than as a sibling of it.
          style: { paddingLeft: `${68 + layerDepth(layer.path) * 14}px` },
          title: layer.path,
        },
        psdLayerThumbBox(key, (thumbs) => thumbsByPath(thumbs).get(layer.path), layerGlyph(layer)),
        h("span", { class: "psd-layer-name", text: layer.name }),
        h("span", { class: "psd-layer-kind m", text: layer.category }),
        resetMark(ctx, at.placementId, layer.path),
      ),
    );
    ctx.dragToCode?.(row, { kind: "psd-layer", ...at, psdKey: key, path: layer.path }, layer.name);
  }
}

/** A row that is only a row: an icon or a swatch, a name and a note. */
function staticItem(
  path: string | readonly string[],
  label: string,
  detail: string,
  swatch?: string,
): HTMLElement {
  return h(
    "div",
    { class: "layer-item static" },
    swatch
      ? h("span", {
          class: "layer-item-swatch",
          style: { backgroundColor: swatch },
        })
      : icon(path, 13),
    h("span", { class: "layer-item-label", text: label }),
    h("span", { class: "layer-item-detail m", text: detail }),
  );
}
