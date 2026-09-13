/**
 * The contents of a layer, listed under it: placed images, fills, points and
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
import { unitKey, unitsInDrawOrder } from "../lib/units";
import { backgroundsOf, layerKind } from "../lib/layer-kinds";
import type { LayerKind } from "../lib/types";
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
  /**
   * The placed unit this row is, when it is one. What a drag reorders by —
   * the row carries it so the panel never has to work back from a placement.
   */
  unit?: string;
  /**
   * What is wrong with this thing, in the fewest words that say it.
   *
   * One use so far: a PSD on an object layer with no `P | anchor` at the root
   * of its stack. The row greys out and carries the word rather than being
   * hidden or refused — the file is placed, it draws, and what it cannot do
   * is keep its place when somebody edits it in Photoshop. That is worth
   * saying where the file is listed, and not worth throwing the artwork away
   * over.
   */
  warning?: string;
}

/** What a row needs to know that the layer itself does not say. */
export interface LayerItemContext {
  /** The scene's start point, so a point's row can say it is the one. */
  startPointId?: string;
  /**
   * Whether a PSD carries its anchor mark at the root — the rule an object
   * layer enforces. Absent means "do not ask", which is what the callers that
   * only want the list (a test, a count) mean.
   */
  isAnchored?: (psdKey: string) => boolean;
  /**
   * Whether the project is isometric, which decides what order the placed
   * files on an **object** layer are listed in.
   *
   * The list is in **draw order**, and on an isometric scene an object
   * layer's is screen Y rather than the document's — see `ordersByHand`. A
   * list in document order there would be a list the canvas ignores, and the
   * row you dragged would stay where you put it while nothing moved on
   * screen. A pattern or background layer is the other way round: the
   * document's order is the only one either of them has.
   */
  isometric?: boolean;
}

/**
 * Everything on a layer that can be selected, in the order it draws.
 *
 * `startPointId` is the scene's, not the layer's — a scene has one start
 * point wherever it lives — and it is passed in so a point's row can say it
 * is the one. Optional, because the two callers that only want the list
 * (a test, a count) have no scene to ask.
 */
export function layerItems(
  layer: Layer,
  context: LayerItemContext = {},
): LayerItem[] {
  const items: LayerItem[] = [];
  const kind = layerKind(layer);

  // Backdrops first, because they are the only thing on a background layer
  // that is not also a placed file and the list reads better with its own
  // subject at the top.
  for (const background of backgroundsOf(layer)) {
    items.push({
      selection: {
        kind: "background",
        layerId: layer.id,
        backgroundId: background.id,
      },
      label: background.name,
      detail: background.kind === "gradient" ? "gradient" : "colour",
      path: background.kind === "gradient" ? ICONS.gradient : ICONS.fill,
      swatch: background.color ?? background.gradient?.from,
    });
  }

  for (const unit of unitsInDrawOrder(layer, context.isometric ?? false)) {
    const [first] = unit;
    // Only on an object layer. A pattern layer's placements are its palette
    // and a background layer's are scenery — neither is a thing standing on a
    // grid space, so neither has anywhere to be anchored *to*.
    const unanchored =
      kind === "object" && context.isAnchored?.(first.psdKey) === false;
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
      unit: unitKey(first),
      ...(unanchored ? { warning: "No anchor" } : {}),
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

  for (const point of layer.points) {
    const start = point.id === context.startPointId;
    items.push({
      selection: { kind: "point", layerId: layer.id, pointId: point.id },
      label: point.name,
      // The space it stands on, unless it is the start point — in which case
      // that is the thing worth knowing about it, and the coordinates are two
      // rows away in the inspector.
      detail: start ? "start" : `${point.cell.cx}, ${point.cell.cy}`,
      path: start ? ICONS.flag : ICONS.point,
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
  // Greyed rather than hidden or crossed out: the file is there and it draws,
  // and what the row is saying is that one thing about it is missing.
  if (item.warning) classes.push("warned");

  const row = h(
    "button",
    {
      class: classes.join(" "),
      // What a reorder drags by, read back off the DOM as the finger passes.
      dataset: item.unit ? { unit: item.unit } : undefined,
      onClick: (event: Event) => {
        event.stopPropagation();
        onSelect(item.selection);
      },
    },
    item.swatch
      ? h("span", { class: "layer-item-swatch", style: { background: item.swatch } })
      : icon(item.path, 13),
    h("span", { class: "layer-item-label", text: item.label }),
    item.warning
      ? h(
          "span",
          { class: "layer-item-warning m", title: `${item.label}: ${item.warning}` },
          icon(ICONS.warning, 12),
          h("span", { text: item.warning }),
        )
      : h("span", { class: "layer-item-detail m", text: item.detail }),
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
    case "point":
      return selection.kind === "point" && a.pointId === selection.pointId;
    case "zone":
      return selection.kind === "zone" && a.zoneId === selection.zoneId;
    case "background":
      return (
        selection.kind === "background" &&
        a.backgroundId === selection.backgroundId
      );
    default:
      return false;
  }
}

// ── how a layer's own row reads ─────────────────────────────────────────────
//
// The summary under a layer's name, the glyph beside it and the line an empty
// one shows. They live here rather than in the panel because they are about
// what is *on* a layer, which is this file's subject — and because the panel
// is at its line limit.

/** The glyph each kind of layer carries, in the row and in the menu. */
export const KIND_ICONS: Record<LayerKind, readonly string[]> = {
  object: ICONS.layerObject,
  pattern: ICONS.layerPattern,
  background: ICONS.layerBackground,
};

/**
 * What an expanded layer with nothing on it says.
 *
 * Three kinds, three different next steps — and "Nothing on this layer" on a
 * background layer is true and useless, because the thing to do about it is
 * the button directly underneath.
 */
export function emptyText(layer: Layer): string {
  switch (layerKind(layer)) {
    case "pattern":
      return "Drop a PSD here to scatter it";
    case "background":
      return "Nothing behind this scene yet";
    default:
      return "Nothing on this layer";
  }
}

export function describe(layer: Layer): string {
  const kind = layerKind(layer);
  const parts: string[] = [];
  // A pattern layer's placements are the elements it scatters rather than
  // things standing anywhere, so counting them as PSDs would say the wrong
  // thing about what is on the layer.
  if (kind === "pattern" && layer.placements.length) {
    const spec = layer.pattern;
    parts.push(`${spec?.type ?? "random"} pattern`);
  } else if (layer.placements.length) {
    parts.push(`${layer.placements.length} psd`);
  }
  if (backgroundsOf(layer).length) {
    parts.push(count(backgroundsOf(layer).length, "backdrop"));
  }
  if (layer.fills.length) {
    // Two kinds of fill in one count: a run of spaces contributes its spaces,
    // a rectangle contributes itself. Counting only cells reported a blank
    // project's fills as nothing at all.
    const cells = layer.fills.reduce((n, f) => n + f.cells.length, 0);
    const rects = layer.fills.filter((f) => f.rect).length;
    if (cells) parts.push(count(cells, "cell"));
    if (rects) parts.push(count(rects, "fill"));
  }
  if (layer.points.length) parts.push(count(layer.points.length, "point"));
  if (layer.zones.length) parts.push(count(layer.zones.length, "zone"));
  if (layer.strokes.length) parts.push(count(layer.strokes.length, "stroke"));
  return parts.length ? parts.join(" · ") : "empty";
}

/** These read at a glance, and "1 strokes" stops the glance. */
export function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
