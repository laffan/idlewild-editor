/**
 * Reading psd-to-json manifests.
 *
 * There is no magic "root" path in psd-to-phaser: `place()` resolves a path
 * by walking the manifest's `layers` by name, so it has to be given a real
 * top-level layer name. Asking for "root" finds nothing and returns an empty
 * group — which is exactly the empty bounding box with no image in it.
 *
 * Points and zones are read, not placed. An import writes two of them —
 * `P | anchor` and `Z | grid` — as orienting marks for whoever opens the PSD
 * to work on it, and psd-to-json exports no pixels for either category. The
 * anchor point is what tells this editor where on the grid the artwork
 * belongs, which is why it survives the artist moving or resizing everything
 * else in the file.
 */

import type { Point } from "./types";

export type LayerCategory = "sprite" | "tileset" | "zone" | "point" | "group";

/**
 * Every spelling of a category this parser will answer to.
 *
 * psd-to-json is a separate program on its own release schedule, and the one
 * field that decides whether a layer is *artwork* or *metadata* is a bare
 * string. Read strictly, an unrecognised spelling falls to the default —
 * "group" — which is placeable, so a marks layer would arrive on the canvas
 * as a placement of its own. That is not hypothetical: capitalised, plural
 * and absent are each enough to put one placed object on the grid per layer
 * in the file, which is what a re-parse then looks like.
 *
 * psd-to-phaser is loose here for the same reason — it reads `category || type`
 * and treats "tile" and "tileset" alike — so this matches it.
 */
const CATEGORIES: Record<string, LayerCategory> = {
  sprite: "sprite",
  sprites: "sprite",
  tileset: "tileset",
  tilesets: "tileset",
  tile: "tileset",
  tiles: "tileset",
  zone: "zone",
  zones: "zone",
  point: "point",
  points: "point",
  group: "group",
  groups: "group",
};

function toCategory(raw: unknown, fallback: unknown): LayerCategory {
  const named = String(raw ?? fallback ?? "").trim().toLowerCase();
  return CATEGORIES[named] ?? "group";
}

export interface ManifestLayer {
  /** The slash-joined path `place()` expects. */
  path: string;
  name: string;
  category: LayerCategory;
  /** Position within the PSD canvas, top-left origin — sprites are placed
   *  with `setOrigin(0, 0)`. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Manifest {
  name: string;
  width: number;
  height: number;
  /** Top-level layers only — what a placement anchors to. */
  top: ManifestLayer[];
  /** Every layer, flattened, for the inspector and completions. */
  all: ManifestLayer[];
  /**
   * Where the grid space this PSD belongs to sits inside its canvas, from
   * the `P | anchor` layer. Null for a PSD that never had one — an import
   * with no grid selection behind it, or somebody else's file.
   */
  anchor: { x: number; y: number } | null;
}

export function parseManifest(json: string): Manifest {
  const raw = JSON.parse(json) as Record<string, unknown>;
  const layers = Array.isArray(raw.layers) ? raw.layers : [];

  const all: ManifestLayer[] = [];
  const top = layers.map((layer) => walk(layer, "", all));

  return {
    name: String(raw.name ?? "untitled"),
    width: Number(raw.width ?? 0),
    height: Number(raw.height ?? 0),
    top,
    all,
    anchor: findAnchor(all),
  };
}

/** The anchor mark's position, which psd-to-json reports as the point's
 *  centre rather than its layer's corner. */
export const ANCHOR_LAYER = "anchor";

/** The other mark: the outline of the grid spaces an import was dropped on. */
export const GRID_LAYER = "grid";

/**
 * Whether a layer is one of the two marks this editor writes.
 *
 * Both come from `psd_marks.rs` and neither is artwork — psd-to-json exports
 * no pixels for a point or a zone, so placing one yields an empty group on
 * the grid. Knowing them by *name* as well as by category is what makes that
 * true whatever the manifest says the category is: the names are the app's,
 * which is also why the inspector will not let them be renamed.
 *
 * The footprint carries its size in its name once it covers more than one
 * space — `grid-4x2` — so the match is a prefix rather than an equality. It
 * was an equality, which meant every multi-space import had a mark this did
 * not recognise.
 */
export function isMarkLayer(name: string): boolean {
  const named = name.trim().toLowerCase();
  return (
    named === ANCHOR_LAYER ||
    named === GRID_LAYER ||
    named.startsWith(`${GRID_LAYER}-`)
  );
}

/**
 * What an extrusion's artwork is made of, top-first as Photoshop lists it.
 *
 * Not one picture. A silhouette, the shading that makes it read as a solid,
 * and the lines between its spaces — three things somebody opening the file
 * wants to take separately: recolour the shape, drop the lines, repaint the
 * shading by hand. They go into the PSD as a group of sprites named after the
 * file, so psd-to-phaser places them together and the layers panel lists them
 * under the one thing they add up to.
 */
export const EXTRUSION_PARTS = ["lines", "shading", "shape"] as const;

export type ExtrusionPart = (typeof EXTRUSION_PARTS)[number];

const EXTRUDE_PREFIX = "extrude-";

/**
 * What one part is called inside a PSD.
 *
 * `extrude-mtx2vyzs` holds `lines-mtx2vyzs`, `shading-mtx2vyzs` and
 * `shape-mtx2vyzs`: the key's own suffix, so a glance at any of them says
 * which file it belongs to. A key that is not one of ours keeps its whole
 * name, which is the only thing that can be said about it.
 */
export function extrusionPartName(key: string, part: ExtrusionPart): string {
  const suffix = key.startsWith(EXTRUDE_PREFIX)
    ? key.slice(EXTRUDE_PREFIX.length)
    : key;
  return `${part}-${suffix}`;
}

/** Whether a layer is one of the parts the editor writes for this key. */
export function isExtrusionPart(key: string, name: string): boolean {
  const named = name.trim().toLowerCase();
  return EXTRUSION_PARTS.some((part) => extrusionPartName(key, part) === named);
}

function findAnchor(all: readonly ManifestLayer[]): { x: number; y: number } | null {
  const point = all.find(
    (l) => l.category === "point" && l.name.toLowerCase() === ANCHOR_LAYER,
  );
  return point ? { x: point.x, y: point.y } : null;
}

/**
 * Where a PSD's anchor sits in its canvas, falling back to the middle.
 *
 * The centre is what the editor used before the mark existed and what any
 * PSD from elsewhere still gets — it is the only defensible guess when
 * nothing in the file says otherwise.
 */
export function anchorOffset(manifest: Manifest): { x: number; y: number } {
  return (
    manifest.anchor ?? { x: manifest.width / 2, y: manifest.height / 2 }
  );
}

function walk(
  raw: unknown,
  prefix: string,
  all: ManifestLayer[],
): ManifestLayer {
  const node = (raw ?? {}) as Record<string, unknown>;
  const name = String(node.name ?? "");
  const path = prefix ? `${prefix}/${name}` : name;

  const layer: ManifestLayer = {
    path,
    name,
    category: toCategory(node.category, node.type),
    x: Number(node.x ?? 0),
    y: Number(node.y ?? 0),
    width: Number(node.width ?? 0),
    height: Number(node.height ?? 0),
  };
  all.push(layer);

  const children = node.children;
  if (Array.isArray(children)) {
    // A group's own box is the union of its children's, which the manifest
    // does not always carry, so derive it.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const child of children) {
      const parsed = walk(child, path, all);
      minX = Math.min(minX, parsed.x);
      minY = Math.min(minY, parsed.y);
      maxX = Math.max(maxX, parsed.x + parsed.width);
      maxY = Math.max(maxY, parsed.y + parsed.height);
    }
    if (Number.isFinite(minX) && layer.width === 0 && layer.height === 0) {
      layer.x = minX;
      layer.y = minY;
      layer.width = maxX - minX;
      layer.height = maxY - minY;
    }
  }

  return layer;
}

/**
 * Where a manifest layer belongs in the world.
 *
 * The one formula both placing and re-importing use: put the PSD's anchor
 * mark on the grid space's world point, then step out to where this layer
 * sits relative to that mark inside the canvas — scaled, because the
 * displayed size is measured against the size the manifest exported.
 */
/**
 * Where the PSD's whole canvas sits in the world, given one placement of it.
 *
 * The frame pen mode draws, and the thing a placement's own outline is *not*:
 * that box is one layer's artwork, cropped to its pixels, which on a file
 * with a margin or several layers is a good deal smaller than the document
 * somebody opens in Photoshop. Drawing inside the artwork's box and calling
 * it "inside the PSD" is the mismatch this exists to close.
 *
 * The arithmetic is `placedPosition` run over the canvas corner: the anchor
 * mark lands on the placement's grid space, and the top-left of the canvas is
 * however far the mark sits from it, scaled by how big the artwork is being
 * shown against its own pixels.
 */
export function canvasBox(
  anchorWorld: Point,
  manifest: Manifest,
  scale: number,
): { x: number; y: number; width: number; height: number } {
  const anchor = anchorOffset(manifest);
  return {
    x: anchorWorld.x - anchor.x * scale,
    y: anchorWorld.y - anchor.y * scale,
    width: manifest.width * scale,
    height: manifest.height * scale,
  };
}

export function placedPosition(
  world: Point,
  manifest: Manifest,
  entry: Point,
  scaleX: number,
  scaleY: number,
): Point {
  return positionFrom(world, anchorOffset(manifest), entry, scaleX, scaleY);
}

/**
 * The same, against an anchor named outright rather than read from the file.
 *
 * A re-import is the one caller that has a better answer than the manifest
 * does. `anchorOffset` falls back to the canvas centre for a file with no
 * mark, which is the only defensible guess about a file nobody has placed —
 * and quite wrong about one that is already standing on the grid. See
 * `game/reconcile.ts`.
 */
export function positionFrom(
  world: Point,
  anchor: Point,
  entry: Point,
  scaleX: number,
  scaleY: number,
): Point {
  return {
    x: world.x + (entry.x - anchor.x) * scaleX,
    y: world.y + (entry.y - anchor.y) * scaleY,
  };
}

/**
 * The anchor a file *would* need for a layer to land on a given spot.
 *
 * The placement formula run backwards. What it is for: a file that has come
 * back from another program without its `P | anchor` — flattened, or saved
 * as a PNG — still has to go back where it was, and where it was is a fact
 * the document holds even though the file has stopped saying it.
 */
export function anchorImpliedBy(
  world: Point,
  at: Point,
  entry: Point,
  scaleX: number,
  scaleY: number,
): Point {
  return {
    x: entry.x - (at.x - world.x) / (scaleX || 1),
    y: entry.y - (at.y - world.y) / (scaleY || 1),
  };
}

/**
 * The layers a single import should place. Groups are placed whole rather
 * than descended into, so an imported PSD arrives as the composition its
 * author built.
 *
 * Points and zones are not among them. Both are metadata — psd-to-json
 * exports no image for either — so placing one yields an empty group at a
 * position nobody asked for, and the anchor mark this editor writes would
 * turn every import into two placements.
 *
 * Nor are the editor's own marks, by name, whatever category the manifest
 * gives them. That is belt and braces on purpose: the category is one string
 * from another program, and getting it wrong here does not fail loudly — it
 * puts an object on the grid for every layer in the file.
 */
export function placeableLayers(manifest: Manifest): ManifestLayer[] {
  const placeable = manifest.top.filter(
    (l) =>
      l.category !== "zone" &&
      l.category !== "point" &&
      !isMarkLayer(l.name),
  );
  return placeable.length > 0 ? placeable : manifest.top;
}

/**
 * How high each placeable layer sits in the PSD's stack, by path.
 *
 * Zero is the back. It is the one thing a placement cannot work out for
 * itself later: the manifest's own order is the artwork's order, and once a
 * placement is in the document there is nothing in it that says which of two
 * layers was on top.
 */
export function stackOrder(manifest: Manifest): Map<string, number> {
  const placeable = placeableLayers(manifest);
  // The manifest lists layers top-first, as Photoshop's own panel does, so
  // the last one is the back of the stack and gets height zero.
  return new Map(
    placeable.map((layer, index) => [layer.path, placeable.length - 1 - index]),
  );
}
