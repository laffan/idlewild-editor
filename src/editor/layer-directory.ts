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
 */

import { h, ICONS, icon } from "../lib/dom";
import type { DocStore } from "../lib/doc-store";
import { layerKind } from "../lib/layer-kinds";
import { layerDepth, type ManifestLayer } from "../lib/manifest";
import { count, describe, emptyText, KIND_ICONS, layerItems } from "./layer-items";
import type { Layer } from "../lib/types";

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
  return h(
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
      group.appendChild(staticItem(item.path, item.label, item.detail, item.swatch));
      continue;
    }
    group.appendChild(psdRow(layer.id, item.selection.placementId, item, ctx));
    const id = psdRowId(layer.id, item.selection.placementId);
    if (ctx.isOpen(id)) fillPsd(group, ctx.psdLayers(item.psdKey));
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
  item: { label: string; detail: string; warning?: string },
  ctx: DirectoryContext,
): HTMLElement {
  const id = psdRowId(layerId, placementId);
  const open = ctx.isOpen(id);
  return h(
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
    h("span", { class: "layer-item-label", text: item.label }),
    h("span", {
      class: "layer-item-detail m",
      text: item.warning ?? item.detail,
    }),
  );
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
function fillPsd(group: HTMLElement, layers: readonly ManifestLayer[]): void {
  if (layers.length === 0) {
    group.appendChild(
      h("div", {
        class: "psd-layer-row empty m",
        // Not an error: the file is placed and it draws. The manifest simply
        // has not arrived yet, or this is a key the scene never loaded.
        text: "Not loaded yet",
      }),
    );
    return;
  }

  for (const layer of layers) {
    group.appendChild(
      h(
        "div",
        {
          class: layer.visible ? "psd-layer-row" : "psd-layer-row hidden-layer",
          // The stack's own shape, so a group reads as holding what is under
          // it rather than as a sibling of it.
          style: { paddingLeft: `${68 + layerDepth(layer.path) * 14}px` },
          title: layer.path,
        },
        h("span", { class: "psd-layer-name", text: layer.name }),
        h("span", { class: "psd-layer-kind m", text: layer.category }),
      ),
    );
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
