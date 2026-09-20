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
import { optionSegmented } from "../lib/options-controls";
import { sectionTitle } from "./inspect-collapse";
import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import {
  describeTiles,
  isMergedTileset,
  paletteMode,
  propertyOf,
  tileLayer,
  tilesetsOf,
} from "../lib/tile-layers";
import { chunksOf, tileCount } from "../lib/tiled/chunks";
import type { TileShape } from "../lib/tile-tools";
import { tileId } from "../lib/tiled/gid";
import { PSD_PROPERTY, type TiledTileset } from "../lib/tiled/types";
import type { Cell, Layer, PaletteMode, Selection, ToolId } from "../lib/types";
import type { PanelActions, PanelSurface } from "./inspect-panels";
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
  tileShape: () => TileShape;
  onTileShape: (shape: TileShape) => void;
  /** Put a palette's own file in the panel below — see `selectPsdRow`. */
  onSelectPsd: (selection: Selection) => void;
  /**
   * Cut a PSD's palette from the whole file, or from each of its layers —
   * the Layers toggle over each palette. See `layersToggle`.
   */
  onPaletteMode: (psdKey: string, mode: PaletteMode) => void;
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
  // One Layers toggle per file, over a palette that agrees with it — see
  // `toggleRows`.
  const toggles = toggleRows(store, tilesets);

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
          paletteName(tileset, layer, actions),
          zoomControls(tileset.firstgid, selection, actions.canvasZoom, resize),
        ),
        toggles.has(tileset.firstgid)
          ? layersToggle(store, tileset, actions)
          : null,
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
 * OBJECT, for a run of tiles caught with the Select tool.
 *
 * Short on purpose. A run of tiles has no name, no size to type and nothing
 * to be made of — it is some ground with things standing on it — so the panel
 * says how much was caught, where it is, and offers the one thing there is to
 * do to it from here. The other thing, moving it, is a gesture rather than a
 * control: drag the run.
 */
export function renderTileSelection(
  panel: PanelSurface,
  store: DocStore,
  actions: PanelActions,
  selection: Extract<Selection, { kind: "tiles" }>,
): void {
  const layer = store.layer(selection.layerId);
  if (!layer) return panel.empty();
  const n = selection.cells.length;

  panel.head("Tiles", `${n} ${n === 1 ? "tile" : "tiles"}`);
  panel.section("Info");
  panel.row("Layer", layer.name);
  panel.row("Spread", describeSpread(selection.cells));
  panel.row("Move", "drag them");

  panel.body.appendChild(
    h(
      "div",
      { class: "inspect-section" },
      h("button", {
        class: "panel-btn",
        text: n === 1 ? "Delete tile" : "Delete tiles",
        onClick: () => actions.onDeleteSelection(),
      }),
    ),
  );
}

/** The box a run of tiles sits in, in spaces. */
function describeSpread(cells: readonly Cell[]): string {
  const xs = cells.map((c) => c.cx);
  const ys = cells.map((c) => c.cy);
  const cols = Math.max(...xs) - Math.min(...xs) + 1;
  const rows = Math.max(...ys) - Math.min(...ys) + 1;
  return `${cols} × ${rows} spaces`;
}

/**
 * Which palettes in the list carry the Layers toggle, by `firstgid`.
 *
 * **One per file**, because the choice is the file's: a file cut Separate
 * shows three palettes, and three copies of the same control over them would
 * read as three answers to give rather than one.
 *
 * And it goes on a palette that **agrees with the answer it is showing**.
 * Both cuts of a file can be in the list at once — a palette with tiles
 * standing on it is always shown, whichever way the file is cut now, because
 * the panel has to be able to explain what is on the ground. A control
 * reading *Merged* directly above one of three layer palettes would be a
 * control contradicting the picture under it, so the toggle takes the palette
 * that matches, and the first one of that file otherwise.
 */
export function toggleRows(
  store: DocStore,
  tilesets: readonly TiledTileset[],
): Set<number> {
  const chosen = new Map<string, TiledTileset>();
  /** Files that have already found a palette agreeing with their mode. */
  const settled = new Set<string>();
  for (const tileset of tilesets) {
    const key = propertyOf(tileset, PSD_PROPERTY);
    if (key === undefined || settled.has(key)) continue;
    if (isMergedTileset(tileset) === (paletteMode(store, key) === "merged")) {
      chosen.set(key, tileset);
      settled.add(key);
    } else if (!chosen.has(key)) {
      // Stands in until one that agrees turns up, and stays if none does.
      chosen.set(key, tileset);
    }
  }
  return new Set([...chosen.values()].map((set) => set.firstgid));
}

/**
 * **Layers: Merged or Separate**, over the palette it decides the shape of.
 *
 * A PSD on a tile layer is cut into a palette, and it used to be cut one
 * palette per layer whether or not that was what the file was. For a
 * tileset drawn as *ground*, *walls* and *props* that is exactly right. For
 * a building drawn as walls, roof and shadow it is three sparse pictures,
 * each missing the other two's tiles, and the way to paint the building is to
 * stamp from all three onto the same space — which is not a thing anybody
 * would design. So the file as it looks is the default and the layer-by-layer
 * cut is the thing you ask for.
 *
 * **Above the palette rather than in a menu**, because it is the first thing
 * to ask about a picture you are looking at — *is this one sheet or several*
 * — and because the answer changes what is underneath it. A segmented pair
 * rather than a switch, because neither answer is the absence of the other:
 * "Merged / off" says nothing about what happens instead.
 *
 * **Per file, and kept in the document.** `psd/` is one directory for the
 * project, so a file is cut one way everywhere; a second answer per layer
 * would be two palettes of the same picture with different gids, and a tile
 * put down from one would be a tile the other cannot explain.
 *
 * Switching **adds** the other palette rather than replacing this one. A gid
 * means the nth tile across every tileset in the map, so a palette anything
 * has ever been painted from has to stay exactly where it is — the same rule
 * that is why there is no way to take a palette out at all. What the toggle
 * changes is which palettes this panel offers and how the next file to arrive
 * is cut; nothing already on the ground moves.
 */
function layersToggle(
  store: DocStore,
  tileset: TiledTileset,
  actions: TileActions,
): HTMLElement | null {
  const key = propertyOf(tileset, PSD_PROPERTY);
  // A palette that came in from a Tiled map somebody else made has no PSD
  // behind it and therefore nothing to cut differently — see `Import Tiled`.
  if (!key) return null;

  const control = optionSegmented(
    [
      { value: "merged", label: "Merged" },
      { value: "separate", label: "Separate" },
    ],
    paletteMode(store, key),
    (value) => actions.onPaletteMode(key, value as PaletteMode),
  );
  return h(
    "div",
    {
      class: "tile-palette-layers",
      title:
        "Merged cuts the whole file into one palette. Separate cuts one " +
        "palette per layer, for a file whose layers are different sets of " +
        "tiles. Tiles already put down never move.",
    },
    h("span", { class: "tile-palette-layers-label m", text: "Layers" }),
    control.root,
  );
}

/**
 * A palette's name, which is the way to the file it was cut from.
 *
 * The name itself rather than a link beside it. It was a *Select PSD* row
 * under each palette for a moment, and that was a second thing to read for
 * something the first thing already identified: the name of a palette **is**
 * the name of the PSD, so making it the control is one fewer word on screen
 * and puts the affordance where the eye already is. The same reading the
 * layer panel takes of a layer's name.
 *
 * What it does is *navigate* — it changes what the panel below is describing
 * and nothing about the document — so it is drawn as a link rather than as a
 * button. A palette whose PSD is not on this layer has none to select, which
 * happens when the file has been carried elsewhere and the tiles made of it
 * are still standing here; there the name is a name and nothing more.
 */
function paletteName(
  tileset: TiledTileset,
  layer: Layer,
  actions: TileActions,
): HTMLElement {
  const key = propertyOf(tileset, PSD_PROPERTY);
  const placement = layer.placements.find((p) => p.psdKey === key);
  if (!placement) {
    return h("div", {
      class: "tile-palette-name m",
      title: "Its PSD is on another layer",
      text: tileset.name,
    });
  }
  return h("button", {
    class: "tile-palette-name tile-palette-open m",
    text: tileset.name,
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
    const used = standing.some(
      (gid) =>
        gid >= tileset.firstgid && gid < tileset.firstgid + tileset.tilecount,
    );
    // Something standing on it is the strongest reason there is: the panel
    // has to be able to explain what is on the ground, whichever way the
    // file happens to be cut *now*. This is also what keeps the palettes a
    // switch left behind from vanishing out from under their own tiles.
    if (used) return true;
    if (key === undefined || !here.has(key)) return false;
    // Otherwise it is the cut this file is currently set to. Both sets can
    // exist once somebody has switched — no palette is ever taken away,
    // because a gid means the nth tile across every tileset in the map — and
    // showing both would be the same picture twice with different gids.
    return isMergedTileset(tileset) === (paletteMode(store, key) === "merged");
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
