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
    category: (node.category as LayerCategory) ?? "group",
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
export function placedPosition(
  world: Point,
  manifest: Manifest,
  entry: Point,
  scaleX: number,
  scaleY: number,
): Point {
  const anchor = anchorOffset(manifest);
  return {
    x: world.x + (entry.x - anchor.x) * scaleX,
    y: world.y + (entry.y - anchor.y) * scaleY,
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
 */
export function placeableLayers(manifest: Manifest): ManifestLayer[] {
  const placeable = manifest.top.filter(
    (l) => l.category !== "zone" && l.category !== "point",
  );
  return placeable.length > 0 ? placeable : manifest.top;
}
