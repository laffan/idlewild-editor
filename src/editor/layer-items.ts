/**
 * The contents of a layer, listed under it: placed images, fills and
 * boundaries. Selecting one here is the same as selecting it on the canvas —
 * useful when a thing is off-screen, underneath something else, or failed to
 * render.
 */

import { h, ICONS, icon } from "../lib/dom";
import { describeFill, type Layer, type Selection } from "../lib/types";

export interface LayerItem {
  /** What selecting this row means. */
  selection: Selection;
  label: string;
  detail: string;
  path: string | readonly string[];
  /** Drawn as a colour chip instead of an icon, for fills. */
  swatch?: string;
}

/** Everything on a layer that can be selected, in the order it draws. */
export function layerItems(layer: Layer): LayerItem[] {
  const items: LayerItem[] = [];

  for (const placement of layer.placements) {
    // The layer path repeats the key for a converted image; only show it when
    // it says something the key does not.
    const detail =
      placement.layerPath && placement.layerPath !== placement.psdKey
        ? placement.layerPath
        : `${Math.round(placement.width)}×${Math.round(placement.height)}`;
    items.push({
      selection: {
        kind: "placement",
        layerId: layer.id,
        placementId: placement.id,
      },
      label: `${placement.psdKey}.psd`,
      detail,
      path: ICONS.file,
    });
  }

  for (const fill of layer.fills) {
    items.push({
      selection: { kind: "fill", layerId: layer.id, fillId: fill.id },
      label: fill.kind === "pattern" ? "Pattern fill" : "Colour fill",
      detail: describeFill(fill),
      path: ICONS.fill,
      swatch: fill.color ?? "#ec3013",
    });
  }

  for (const zone of layer.zones) {
    items.push({
      selection: { kind: "zone", layerId: layer.id, zoneId: zone.id },
      label: zone.name,
      detail: zone.blocking ? "blocking" : "passable",
      path: ICONS.boundary,
    });
  }

  return items;
}

/**
 * One row.
 *
 * `onGrip` makes it draggable: the panel supplies it for placements, which
 * can be carried to another layer. A grip rather than the row itself, for the
 * reason the layer rows have one — the panel scrolls, and a row that took
 * the pointer outright would take the scroll with it.
 */
export function renderLayerItem(
  item: LayerItem,
  active: boolean,
  onSelect: (selection: Selection) => void,
  onGrip?: (event: PointerEvent) => void,
): HTMLElement {
  const classes = ["layer-item"];
  if (active) classes.push("active");
  if (onGrip) classes.push("has-grip");

  const row = h(
    "button",
    {
      class: classes.join(" "),
      onClick: (event: Event) => {
        event.stopPropagation();
        onSelect(item.selection);
      },
    },
    item.swatch
      ? h("span", { class: "layer-item-swatch", style: { background: item.swatch } })
      : icon(item.path, 13),
    h("span", { class: "layer-item-label", text: item.label }),
    h("span", { class: "layer-item-detail m", text: item.detail }),
  );

  if (onGrip) {
    // A button inside a button is not legal HTML, so the grip is a span with
    // the role spelled out — which is also what keeps a tap on it from
    // selecting the row underneath.
    row.insertBefore(
      h(
        "span",
        {
          class: "layer-item-grip",
          role: "button",
          "aria-label": `Move ${item.label} to another layer`,
          title: "Drag to another layer",
          onPointerDown: onGrip,
          onClick: (event: Event) => event.stopPropagation(),
        },
        icon(ICONS.grip, 13),
      ),
      row.firstChild,
    );
  }
  return row;
}

/** Whether a selection points at this item, so the row can show as current. */
export function isSelected(item: LayerItem, selection: Selection): boolean {
  const a = item.selection;
  // Several images caught by a marquee light up every row they cover, which
  // is the one place the row's kind and the selection's differ.
  if (a.kind === "placement" && selection.kind === "placements") {
    return selection.ids.includes(a.placementId);
  }
  if (a.kind !== selection.kind) return false;
  switch (a.kind) {
    case "placement":
      return (
        selection.kind === "placement" && a.placementId === selection.placementId
      );
    case "fill":
      return selection.kind === "fill" && a.fillId === selection.fillId;
    case "zone":
      return selection.kind === "zone" && a.zoneId === selection.zoneId;
    default:
      return false;
  }
}
