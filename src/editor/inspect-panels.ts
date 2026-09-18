/**
 * The inspector's simpler panels.
 *
 * A document layer, a selected region, a lasso of strokes, a boundary, a
 * point and several images caught by a marquee. None of them holds state — they read the document,
 * write some rows, and offer whatever buttons make sense for the thing — so
 * they are functions over a small surface rather than methods on the panel
 * that happens to host them. `placement` and `fill` stay in `inspector.ts`,
 * where the colour picker, the PSD layer list and the name field they own
 * also live.
 */

import { h } from "../lib/dom";
import { strokesBox } from "../drawing";
import { createPaintPicker } from "./paint-picker";
import { fillColliderSection } from "./inspect-collider";
import { describeFill } from "../lib/doc-shape";
import { DEFAULT_PAINT_SPEC, paintLabel, type Paint } from "../lib/paint";
import { count } from "./layer-items";
import { unionRect } from "../game/unit";
import { groupOfUnit, groupPlacements, liveGroups } from "../lib/groups";
import { unitKey } from "../lib/units";
import type { DocStore } from "../lib/doc-store";
import { describeRange, type Grid } from "../lib/grid";
import type { FillPatch, Selection } from "../lib/types";

/**
 * What a panel writes into: the inspector's own body and its row helpers.
 *
 * Narrow on purpose — the panels below need nowhere near the whole class,
 * and saying so is what lets them be read on their own.
 */
export interface PanelSurface {
  body: HTMLElement;
  head(kicker: string, title: string): void;
  /**
   * A head whose title is the thing's own name, and can be retyped.
   *
   * The inspector's, because it is the field its `captureName` puts the caret
   * back into when the panel is rebuilt under someone typing in it.
   */
  editableHead(
    kicker: string,
    value: string,
    suffix: string,
    onCommit: (next: string) => void,
  ): void;
  /**
   * Open a section. `hint` is what its heading says on hover — where this
   * panel's explanations live now, rather than as a line of prose under each
   * one; see `inspect-collapse.ts`.
   */
  section(title?: string, hint?: string): HTMLElement;
  row(key: string, value: string): void;
  /** What to show when the thing selected has gone from the document. */
  empty(): void;
  /**
   * The colour picker, and Fill / Use Image beside it.
   *
   * The inspector's own, because it remembers recent swatches across
   * selections and so cannot be rebuilt per render like everything else here.
   */
  fillSection(fill: FillPatch | undefined): void;
}

/** The buttons these panels offer. */
export interface PanelActions {
  onDeleteSelection: () => void;
  onExportSelection: () => void;
  /** Turn a fill's spaces into ground a character can walk on, or not. */
  onToggleWalkable: (walkable: boolean) => void;
  /** Hand a filled run of grid spaces on as a placed PSD. */
  onFillToPsd: () => void;
  onStrokesToPsd: () => void;
  onStrokesToZone: () => void;
  /**
   * The pattern layer a lassoed sketch would become a shape on, or null.
   *
   * The layer the ink is *on*, which is the only reading that needs nothing
   * remembered: draw the outline on the pattern layer, sweep it up with the
   * lasso, and this button says which layer it is about because there is only
   * one layer involved. Absent on an ordinary layer, where it would be a
   * button with nowhere to put its answer.
   *
   * It is the one route that keeps the *line* — mask mode sweeps rectangles,
   * so a shape adjusted there is spaces and nothing else.
   */
  patternShapeTarget: () => string | null;
  onStrokesToPatternShape: () => void;
  /** Get rid of a whole document layer — the shell asks before it does. */
  onDeleteLayer: (layerId: string) => void;
  onRenamePoint: (layerId: string, pointId: string, name: string) => void;
  /** Say where this scene starts play, or that it starts nowhere. */
  onSetStartPoint: (pointId: string | null) => void;
  /**
   * ⌘G and ⇧⌘G, as buttons.
   *
   * There is no ⌘ on an iPad, so the two shortcuts need somewhere to be — and
   * beside the list of what is selected is the place, because that list is
   * exactly what they act on. See `editor/group-actions.ts`.
   */
  onGroup: () => void;
  onUngroup: () => void;
  onRenameGroup: (layerId: string, groupId: string, name: string) => void;
}

/**
 * A patch of filled grid: what it is made of, what it stops, and the two
 * things that can be done with it.
 *
 * The paint control itself is the inspector's own — it remembers what it last
 * settled on across selections, so filling three patches with one dither is
 * one choice rather than three — and comes in through `fillSection`.
 */
export function renderFill(
  panel: PanelSurface,
  store: DocStore,
  actions: PanelActions,
  selection: Extract<Selection, { kind: "fill" }>,
): void {
  const fill = store
    .layer(selection.layerId)
    ?.fills.find((f) => f.id === selection.fillId);
  if (!fill) return panel.empty();

  panel.head("Filled space", describeFill(fill));
  panel.section("Info");
  // What it is *made of*, which is the library's answer when it has one and
  // falls back to the two the document already had: a PSD texture, or a
  // flat colour.
  panel.row(
    "Made of",
    fill.paint && fill.paint.kind !== "color"
      ? paintLabel(fill.paint)
      : fill.kind === "pattern"
        ? "Pattern image"
        : "Colour",
  );
  if (fill.rect) {
    panel.row("Origin", `${Math.round(fill.rect.x)}, ${Math.round(fill.rect.y)}`);
  }
  panel.row("Colour", fill.color ?? "—");
  if (fill.patternKey) panel.row("Pattern image", fill.patternKey);
  panel.fillSection(fill);

  // What it stops, under the same heading a placed PSD's says it under.
  panel.body.appendChild(
    fillColliderSection(fill, (walkable) => actions.onToggleWalkable(walkable)),
  );

  panel.body.appendChild(
    h(
      "div",
      { class: "inspect-section" },
      // A fill is a fast way to block a shape out on the grid; this is
      // what turns the block-out into something an artist can paint.
      h("button", {
        class: "panel-btn",
        text: "Convert to PSD",
        onClick: () => actions.onFillToPsd(),
      }),
      h("button", {
        class: "panel-btn",
        text: "Delete fill",
        onClick: () => actions.onDeleteSelection(),
      }),
    ),
  );
}

/**
 * A named place, and the one thing a scene can say about one.
 *
 * The start point is designated from here rather than from the layer list,
 * because it is a property of the *scene* and this is the only panel that
 * knows which point is being talked about. Only one point per scene can hold
 * it, and that is enforced by the document — `setStartPoint` writes one id on
 * the scene, so naming a second point is the first ceasing to be it — rather
 * than by clearing a flag on everything else and hoping.
 */
export function renderPoint(
  panel: PanelSurface,
  store: DocStore,
  grid: Grid,
  actions: PanelActions,
  selection: Extract<Selection, { kind: "point" }>,
): void {
  const { layerId, pointId } = selection;
  const layer = store.layer(layerId);
  const point = layer?.points.find((p) => p.id === pointId);
  if (!layer || !point) return panel.empty();

  const isStart = store.activeScene.startPointId === point.id;
  panel.editableHead("Point", point.name, "", (next) =>
    actions.onRenamePoint(layerId, pointId, next),
  );
  panel.section("Info");
  panel.row("Layer", layer.name);
  // The space on a lattice, the pixel where there is none: a blank project's
  // cell *is* a pixel, so one row says the true thing either way.
  panel.row(grid.snaps ? "Space" : "Position", `${point.cell.cx}, ${point.cell.cy}`);
  panel.row("Start point", isStart ? `Yes — ${store.activeScene.name}` : "No");

  panel.body.appendChild(
    h(
      "div",
      { class: "inspect-section" },
      h("button", {
        class: isStart ? "panel-btn" : "panel-btn primary",
        text: isStart ? "Clear start point" : "Make start point",
        // What it does is on the button rather than under it, and it says the
        // state it is in: what happens now, asked for rather than read.
        title: isStart
          ? "The game puts the character here when this scene opens."
          : "A scene has one start point. Making this it releases whichever " +
            "point holds it now.",
        onClick: () => actions.onSetStartPoint(isStart ? null : point.id),
      }),
      h("button", {
        class: "panel-btn",
        text: "Delete point",
        onClick: () => actions.onDeleteSelection(),
      }),
    ),
  );
}

/**
 * A document layer: what is on it, and the way to get rid of it.
 *
 * The counts are the same ones the left panel puts in its grey column, said
 * in full — and Delete layer sits under them, beside the tally of everything
 * that would go with it. The left panel can add a layer, reorder, rename,
 * lock and hide one; removing one is the one thing it never offered, and it
 * belongs where the consequences are listed.
 *
 * Refused rather than hidden for the last layer of a scene: a button that
 * vanishes tells nobody why.
 */
export function renderLayer(
  panel: PanelSurface,
  store: DocStore,
  actions: PanelActions,
  selection: Extract<Selection, { kind: "layer" }>,
): void {
  const layer = store.layer(selection.layerId);
  if (!layer) return panel.empty();

  panel.head("Layer", layer.name);
  panel.section("Info");
  panel.row("Locked", layer.locked ? "Yes" : "No");
  panel.row("Visible", layer.visible ? "Yes" : "No");
  panel.row("Images", String(layer.placements.length));
  panel.row("Fills", String(layer.fills.length));
  panel.row("Boundaries", String(layer.zones.length));
  panel.row("Strokes", String(layer.strokes.length));

  const last = store.layers.length <= 1;
  panel.body.appendChild(
    h(
      "div",
      { class: "inspect-section" },
      last
        ? h("div", {
            class: "field-hint",
            text: "A scene keeps at least one layer.",
          })
        : null,
      h("button", {
        class: "panel-btn",
        text: "Delete layer",
        disabled: last ? "true" : null,
        onClick: () => actions.onDeleteLayer(layer.id),
      }),
    ),
  );
}

export function renderRegion(
  panel: PanelSurface,
  grid: Grid,
  actions: PanelActions,
  selection: Extract<Selection, { kind: "region" }>,
): void {
  const { from, to } = selection;
  const bounds = grid.rangeBounds(from, to);
  panel.head("Selection", describeRange(grid, from, to));
  panel.section("Info");
  panel.row("Origin", `${Math.min(from.cx, to.cx)}, ${Math.min(from.cy, to.cy)}`);
  panel.row("Pixels", `${Math.round(bounds.width)} × ${Math.round(bounds.height)}`);
  panel.row("Template", grid.projection);
  // A blank project has a nominal unit but does not round to it, and a row
  // that said "Grid: 64 px" over a selection that ignored it would lie.
  panel.row("Grid", grid.snaps ? `${grid.size} px` : "no snapping");
  // The colour picker, which belongs to the inspector rather than to this
  // panel: it holds recent swatches across selections, so it outlives every
  // render and is reached through the surface.
  panel.fillSection(undefined);

  // Exporting a selection as a PNG used to be a button on the floating
  // action bar, beside Fill and Add Image. It was the odd one out there —
  // those two turn space into content and this sends content out — so it
  // sits here with the rest of what is true about a selection.
  panel.body.appendChild(
    h(
      "div",
      { class: "inspect-section" },
      h("button", {
        class: "panel-btn",
        text: "Export as PNG",
        onClick: actions.onExportSelection,
      }),
    ),
  );
}
/**
 * Several images: caught by a marquee, picked in the sidebar, or tied together
 * as a group.
 *
 * Deliberately thin about the images themselves. There is nothing to say about
 * a set of them that is true of all of them — they have different files, sizes
 * and anchors — so this says what was caught and lists it, and everything
 * about one file is reached by picking that one.
 *
 * What it does offer is the two things that are about the **set**: tying it
 * together and letting it go. Those are ⌘G and ⇧⌘G, which do not exist on an
 * iPad, and beside the list of what is selected is where they belong — that
 * list is exactly what they act on. When the selection *is* a group, the
 * heading is the group's own name and it can be retyped there.
 */
export function renderPlacements(
  panel: PanelSurface,
  store: DocStore,
  actions: PanelActions,
  selection: Extract<Selection, { kind: "placements" }>,
): void {
  const layer = store.layer(selection.layerId);
  if (!layer) return panel.empty();
  const chosen = new Set(selection.ids);
  const placements = layer.placements.filter((p) => chosen.has(p.id));
  if (placements.length === 0) return panel.empty();

  // The group this selection *is*, rather than one it merely overlaps: a
  // heading naming a group that only half of what is selected belongs to would
  // be a heading saying something untrue.
  const group = liveGroups(layer).find(
    (g) =>
      groupPlacements(layer, g).length === placements.length &&
      groupPlacements(layer, g).every((p) => chosen.has(p.id)),
  );
  const units = new Set(placements.map(unitKey));
  const grouped = [...units].some((unit) => !!groupOfUnit(layer, unit));

  if (group) {
    panel.editableHead("Group", group.name, "", (name) =>
      actions.onRenameGroup(layer.id, group.id, name),
    );
  } else {
    panel.head("Selection", count(units.size, "placed PSD"));
  }
  panel.section("Info");
  panel.row("Layer", layer.name);
  const box = unionRect(placements);
  if (box) {
    panel.row("Size", `${Math.round(box.width)} \u00d7 ${Math.round(box.height)}`);
    panel.row("Origin", `${Math.round(box.x)}, ${Math.round(box.y)}`);
  }

  panel.section(
    "Images",
    group
      ? "They move and delete together. Reach one from the layer panel."
      : "Drag to move them together. Tap one to work on it.",
  );
  for (const placement of placements) {
    panel.row(`${placement.psdKey}.psd`, placement.layerPath);
  }

  panel.section(
    "Group",
    "A group is the editor's own: it is saved with the project and travels " +
      "in an export, and the game is never told about it.",
  );
  panel.body.appendChild(
    h(
      "div",
      { class: "inspect-section" },
      units.size > 1 && !group
        ? h("button", {
            class: "panel-btn",
            text: "Group",
            title: "⌘G — tap any of them to select the lot",
            onClick: actions.onGroup,
          })
        : null,
      grouped
        ? h("button", {
            class: "panel-btn",
            text: "Ungroup",
            title: "⇧⌘G",
            onClick: actions.onUngroup,
          })
        : null,
      h("button", {
        class: "panel-btn",
        text: "Delete images",
        onClick: actions.onDeleteSelection,
      }),
    ),
  );
}

/**
 * A lasso selection. The two buttons are the drawing layer's only exits:
 * the sketch becomes a game object, or it becomes a region play mode can
 * walk around. Both consume the strokes — see editor/stroke-actions.
 */
export function renderStrokes(
  panel: PanelSurface,
  store: DocStore,
  actions: PanelActions,
  selection: Extract<Selection, { kind: "strokes" }>,
): void {
  const { layerId, ids } = selection;
  const layer = store.layer(layerId);
  if (!layer) return panel.empty();
  const strokes = layer.strokes.filter((s) => ids.includes(s.id));
  if (strokes.length === 0) return panel.empty();

  panel.head("Sketch", count(strokes.length, "stroke"));
  panel.section("Info");
  panel.row("Layer", layer.name);
  const box = strokesBox(strokes);
  if (box) {
    panel.row("Size", `${Math.round(box.width)} × ${Math.round(box.height)}`);
    panel.row("Origin", `${Math.round(box.x)}, ${Math.round(box.y)}`);
  }

  panel.body.appendChild(
    h(
      "div",
      { class: "inspect-section" },
      h("button", {
        class: "panel-btn primary",
        text: "Convert to PSD",
        onClick: () => actions.onStrokesToPsd(),
      }),
      h("button", {
        class: "panel-btn",
        text: "Convert to boundary",
        onClick: () => actions.onStrokesToZone(),
      }),
      actions.patternShapeTarget()
        ? h("button", {
            class: "panel-btn",
            text: `Convert to pattern shape — ${
              store.layer(actions.patternShapeTarget() ?? "")?.name ?? "pattern"
            }`,
            onClick: () => actions.onStrokesToPatternShape(),
          })
        : null,
      h("button", {
        class: "panel-btn",
        text: "Delete strokes",
        onClick: () => actions.onDeleteSelection(),
      }),
    ),
  );
}
export function renderZone(
  panel: PanelSurface,
  store: DocStore,
  actions: PanelActions,
  selection: Extract<Selection, { kind: "zone" }>,
): void {
  const { layerId, zoneId } = selection;
  const zone = store.layer(layerId)?.zones.find((z) => z.id === zoneId);
  if (!zone) return panel.empty();
  panel.head("Boundary", zone.name);
  panel.section("Info");
  panel.row("Points", String(zone.points.length));
  panel.row("Blocking", zone.blocking ? "Yes" : "No");
  panel.body.appendChild(
    h(
      "div",
      { class: "inspect-section" },
      h("button", {
        class: "panel-btn",
        text: "Delete boundary",
        onClick: () => actions.onDeleteSelection(),
      }),
    ),
  );
}


/**
 * What a run of grid spaces — or a patch already on one — is filled with.
 *
 * All three kinds, because a grid fill is where a **shape** fill makes the
 * most sense it ever makes: the spaces are already there, so "a shape in
 * every space" is a tileset laid down in one gesture rather than a field
 * approximated on a lattice.
 *
 * **Use pattern image** stays where it was and means something else — a PSD
 * in *this project* whose texture tiles the patch, rather than a row in the
 * app-wide library. The two are kept apart on `FillPatch`; see the note there.
 *
 * Here rather than in `inspector.ts`, where it lived until that file reached
 * its seven hundred lines. What stayed behind is the *memory* of what the
 * control last said, which is panel state rather than a panel.
 */
export function renderFillPaint(
  body: HTMLElement,
  options: {
    grid: Grid;
    fill: FillPatch | undefined;
    /** What the control opens on when there is no fill to read. */
    held: Paint;
    onPaint: (paint: Paint) => void;
    onUsePatternImage: () => void;
  },
): void {
  const { fill, held } = options;
  const value: Paint = fill
    ? { ...(fill.paint ?? DEFAULT_PAINT_SPEC), color: fill.color ?? held.color }
    : { ...held };

  const picker = createPaintPicker({
    value,
    cell: options.grid.tileWidth,
    onChange: options.onPaint,
  });

  body.appendChild(
    h(
      "div",
      { class: "inspect-section" },
      h("div", { class: "inspect-section-title m", text: "Fill" }),
      picker.root,
      h("button", {
        class: "panel-btn",
        text: "Use pattern image…",
        onClick: () => options.onUsePatternImage(),
      }),
    ),
  );
}
