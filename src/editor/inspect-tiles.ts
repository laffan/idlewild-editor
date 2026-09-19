/**
 * A tile layer's own panel: the palettes, and what is standing on the ground.
 *
 * It takes the LAYER zone the way `inspect-pattern.ts` does, and for the same
 * reason read a different way. On a pattern layer the file *is* the rule's
 * palette, so the layer and the file are one subject; on a tile layer the
 * files are palettes you pick *from*, so the subject is the picking — which
 * is why this panel is mostly one control repeated once per tileset rather
 * than a column of numbers.
 *
 * The order is the order somebody reaches for it: what is in hand, what to
 * pick from, and then the two things there are to say about the layer itself.
 *
 * A layer with no palette on it yet says so and says what to do about it,
 * rather than showing an empty box — the same call `emptyText` makes in the
 * left sidebar, where the other half of the answer is the Import Tiled row.
 */

import { h } from "../lib/dom";
import { sectionTitle } from "./inspect-collapse";
import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import {
  describeTiles,
  propertyOf,
  tileLayer,
  tilesetsOf,
} from "../lib/tile-layers";
import { chunksOf, tileCount } from "../lib/tiled/chunks";
import { tileId } from "../lib/tiled/gid";
import { PSD_PROPERTY, type TiledTileset } from "../lib/tiled/types";
import type { Layer, Selection, ToolId } from "../lib/types";
import type { PanelSurface } from "./inspect-panels";
import {
  describeStamp,
  tilePalette,
  zoomControls,
  type TileSelection,
} from "./tile-palette";

/** What the panel needs from the shell that the document cannot answer. */
export interface TileActions {
  /** The asset server's base URL — where a palette's picture is read from. */
  assetBase: () => string;
  /**
   * The camera's zoom, which is where a palette's own starts.
   *
   * Read at the moment the panel is built rather than followed, and that is
   * the trade: "the same size as a tile on the canvas" is answered every time
   * you look at the sidebar, and a palette that resized itself while somebody
   * pinched the canvas would be a column jumping under their other hand.
   */
  canvasZoom: () => number;
  /** What is in hand. Held by the shell, because the panel is rebuilt often. */
  tileSelection: () => TileSelection;
  /** Bring a Tiled map in. The same call the left sidebar's row makes. */
  onImportTiled: (layerId: string) => void;
  /** Take every tile off the layer, leaving its palettes where they are. */
  onClearTiles: (layerId: string) => void;
  /**
   * The two tile tools' own options, which are the rail's rather than the
   * document's — see `tool-routing.ts`. Here because this interface is what
   * the inspector is handed for everything about tiles, and splitting it
   * would be two objects arriving at the same panel.
   */
  tileRandom: (tool: ToolId) => boolean;
  onTileRandom: (tool: ToolId, on: boolean) => void;
  tileDensity: () => number;
  onTileDensity: (density: number) => void;
  /** Put a palette's own file in the panel below — see `selectPsdRow`. */
  onSelectPsd: (selection: Selection) => void;
}

/**
 * The whole panel, written into the LAYER zone.
 *
 * Returns nothing and writes through the surface, unlike `patternSection`,
 * because only one selection shows it: a tile layer has no canvas selection
 * of its own — `picking.ts` makes one inert — so there is no second caller
 * that would have to lay it out differently.
 */
export function renderTileLayer(
  panel: PanelSurface,
  store: DocStore,
  grid: Grid,
  actions: TileActions,
  layer: Layer,
): void {
  const tilesets = palettesOn(store, layer);
  const selection = actions.tileSelection();

  panel.section("Tiles");
  panel.row("On the ground", describeTiles(layer));
  panel.row(
    "Spaces",
    `${Math.round(grid.tileWidth)} × ${Math.round(grid.tileHeight)} px`,
  );
  panel.row("Palettes", `${tilesets.length}`);

  if (tilesets.length === 0) {
    panel.body.appendChild(emptyNotice(layer.id, actions));
    return;
  }

  const summary = h("div", {
    class: "field-hint",
    text: `In hand: ${describeStamp(selection.stamp)}`,
  });

  /**
   * Re-measure one palette after its zoom moved.
   *
   * The buttons over a palette are outside it, so they cannot reach into it —
   * and re-rendering the whole panel would throw away the scroll position,
   * which is exactly what somebody zooming a picture larger than its box is
   * about to want. So the announcement the palettes already listen for is
   * reused: each re-reads the zoom it is holding and resizes itself.
   */
  const resize = (): void => {
    for (const el of palettes.querySelectorAll(".tile-palette")) {
      el.dispatchEvent(new CustomEvent("tiles-picked"));
    }
  };

  const palettes = h(
    "div",
    { class: "inspect-section tile-palettes" },
    sectionTitle("Palette", {
      hint:
        "Drag across a palette to take a run of tiles; Stamp and Sweep fill " +
        "put down whatever is in hand. The lines are where the picture is " +
        "cut, which is the size of a space on this project's grid.",
    }),
    summary,
    ...tilesets.map((tileset) =>
      h(
        "div",
        { class: "tile-palette-row" },
        h(
          "div",
          { class: "tile-palette-head" },
          h("div", { class: "tile-palette-name m", text: tileset.name }),
          zoomControls(tileset.firstgid, selection, actions.canvasZoom, resize),
        ),
        tilePalette({
          tileset,
          assetBase: actions.assetBase(),
          selection,
          cell: grid.tileWidth,
          canvasZoom: actions.canvasZoom(),
          onPick: (stamp) => {
            summary.textContent = `In hand: ${describeStamp(stamp)}`;
          },
        }),
        // What was a tally — "20 tiles, 5 across" — and is now the way to
        // the file itself. The count was true and no use: nobody looking at a
        // palette needs to be told how many tiles are in the picture in front
        // of them, and what they do want from a palette often enough is to go
        // and change the artwork. Selecting the PSD is the first step of
        // that: it puts the file in the OBJECT zone, where its layer list and
        // Open PSD are.
        selectPsdRow(tileset, layer, actions),
      ),
    ),
  );
  panel.body.appendChild(palettes);

  panel.body.appendChild(
    h(
      "div",
      { class: "inspect-section" },
      sectionTitle("The map", {
        hint:
          "The tiles standing on this layer are a Tiled tile layer, saved in " +
          "Tiled's own format — what is in the document is what a .tmj holds.",
      }),
      h("button", {
        class: "panel-btn",
        text: "Import Tiled…",
        onClick: () => actions.onImportTiled(layer.id),
      }),
      h("button", {
        class: "panel-btn",
        text: "Clear tiles",
        disabled: tileCount(layer.tiles) === 0 ? "true" : null,
        onClick: () => actions.onClearTiles(layer.id),
      }),
    ),
  );
}

/**
 * The way from a palette to the file it was cut from.
 *
 * A link rather than a button, because what it does is *navigate* — it
 * changes what the panel below is describing and nothing about the document.
 * A palette whose PSD is not placed on this layer has none to select: that
 * happens when the file has been carried elsewhere and the tiles made of it
 * are still standing here, which the row says rather than offering a link
 * that would select nothing.
 */
function selectPsdRow(
  tileset: TiledTileset,
  layer: Layer,
  actions: TileActions,
): HTMLElement {
  const key = propertyOf(tileset, PSD_PROPERTY);
  const placement = layer.placements.find((p) => p.psdKey === key);
  if (!placement) {
    return h("div", { class: "field-hint", text: "Its PSD is not on this layer." });
  }
  return h("button", {
    class: "tile-palette-open",
    text: "Select PSD",
    title: `Show ${key}.psd in the panel below, where Open PSD is`,
    onClick: () =>
      actions.onSelectPsd({
        kind: "placement",
        layerId: layer.id,
        placementId: placement.id,
      }),
  });
}

/**
 * The palettes this layer can draw from.
 *
 * The tilesets are the **document's** — a gid means the nth tile across every
 * tileset in the map, so they have to be, and two layers of one map draw from
 * one list. What makes a set *this layer's* is that its file is placed here,
 * which is how it got cut in the first place. A set whose file has since been
 * carried to another layer is still listed, because the tiles standing on
 * this one are still made of it and a palette that vanished from under them
 * would be a panel that could not explain what is on the ground.
 */
function palettesOn(store: DocStore, layer: Layer): TiledTileset[] {
  const here = new Set(layer.placements.map((p) => p.psdKey));
  const standing = gidsOn(layer);
  return tilesetsOf(store).filter((tileset) => {
    const key = propertyOf(tileset, PSD_PROPERTY);
    if (key !== undefined && here.has(key)) return true;
    return standing.some(
      (gid) =>
        gid >= tileset.firstgid && gid < tileset.firstgid + tileset.tilecount,
    );
  });
}

/** Every distinct tile id standing on a layer, flags taken off. */
function gidsOn(layer: Layer): number[] {
  const held = new Set<number>();
  for (const chunk of chunksOf(tileLayer(layer))) {
    for (const gid of chunk.data) if (gid !== 0) held.add(tileId(gid));
  }
  return [...held];
}

/** What a tile layer with nothing to pick from says, and what to do about it. */
function emptyNotice(layerId: string, actions: TileActions): HTMLElement {
  return h(
    "div",
    { class: "inspect-section" },
    sectionTitle("Palette"),
    h("div", {
      class: "inspect-empty",
      text:
        "Nothing to pick from yet. Drop a PSD on this layer and it is cut " +
        "into a palette on the project's own grid, or bring a map in.",
    }),
    h("button", {
      class: "panel-btn",
      text: "Import Tiled…",
      onClick: () => actions.onImportTiled(layerId),
    }),
  );
}
