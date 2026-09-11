/**
 * The contents of a layer, listed under it: placed images, fills and
 * boundaries. Selecting one here is the same as selecting it on the canvas —
 * useful when a thing is off-screen, underneath something else, or failed to
 * render.
 *
 * **A placed PSD is one row, whatever is inside it.** The two things this
 * editor calls a layer are different things and must not be listed as one: a
 * *document* layer is Phaser's idea — draw order and visibility over anything
 * at all — and a *PSD* layer is Photoshop's, which is the inspector's subject
 * and nobody else's. Placing a PSD makes one placement per placeable layer in
 * the file, so listing placements put a file's insides in the panel that is
 * about the canvas: three rows under Foreground for one tower somebody
 * dropped there. So the rows here are **units** — see `game/instance.ts` —
 * which is also what the canvas selects, drags and deletes.
 */

import { h, ICONS, icon } from "../lib/dom";
import { instanceOf } from "../game/instance";
import { describeFill, type Layer, type Placement, type Selection } from "../lib/types";

export interface LayerItem {
  /** What selecting this row means. */
  selection: Selection;
  label: string;
  detail: string;
  path: string | readonly string[];
  /** Drawn as a colour chip instead of an icon, for fills. */
  swatch?: string;
  /**
   * Every placement the row stands for.
   *
   * One for most things and several for a placed PSD, which is why the row
   * carries them rather than the id inside its selection: the canvas selects
   * whichever member the pointer landed on, so a row that matched only its
   * own would go dark when you clicked the thing it is about — and a drag has
   * to carry the whole file rather than the layer of it the row happens to
   * name.
   */
  members?: string[];
}

/** Everything on a layer that can be selected, in the order it draws. */
export function layerItems(layer: Layer): LayerItem[] {
  const items: LayerItem[] = [];

  for (const unit of placedUnits(layer)) {
    const [first] = unit;
    items.push({
      selection: {
        kind: "placement",
        layerId: layer.id,
        placementId: first.id,
      },
      label: `${first.psdKey}.psd`,
      detail: describeUnit(unit),
      path: ICONS.file,
      members: unit.map((p) => p.id),
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
 * A layer's placed PSDs, one entry per unit, in the order they draw.
 *
 * Grouped by `instance` and kept in first-seen order rather than sorted: the
 * list is about where things are in the layer, and the first member of a unit
 * is where that unit starts.
 */
function placedUnits(layer: Layer): Placement[][] {
  const units = new Map<string, Placement[]>();
  for (const placement of layer.placements) {
    const unit = units.get(instanceOf(placement));
    if (unit) unit.push(placement);
    else units.set(instanceOf(placement), [placement]);
  }
  return [...units.values()];
}

/**
 * What the row says beside the filename.
 *
 * How many layers the file put on the canvas, when it put down more than one
 * — which says the thing is a stack without listing the stack, and the
 * inspector is where that is opened up. A single-layer file has nothing to
 * count, so it says the layer path when that adds anything to the key (a file
 * placed by one of its inner layers) and its size when it does not, which is
 * every converted image.
 */
function describeUnit(unit: readonly Placement[]): string {
  if (unit.length > 1) return `${unit.length} layers`;
  const [placement] = unit;
  return placement.layerPath && placement.layerPath !== placement.psdKey
    ? placement.layerPath
    : `${Math.round(placement.width)}×${Math.round(placement.height)}`;
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
  // A placed PSD is one row and several placements, so the row is about any
  // of them: the canvas selects whichever layer of the file the pointer
  // landed on. The same list answers a marquee, which is the one place the
  // row's kind and the selection's differ.
  const members = item.members ?? [];
  if (a.kind === "placement" && selection.kind === "placements") {
    return selection.ids.some((id) => members.includes(id));
  }
  if (a.kind !== selection.kind) return false;
  switch (a.kind) {
    case "placement":
      return (
        selection.kind === "placement" &&
        members.includes(selection.placementId)
      );
    case "fill":
      return selection.kind === "fill" && a.fillId === selection.fillId;
    case "zone":
      return selection.kind === "zone" && a.zoneId === selection.zoneId;
    default:
      return false;
  }
}
