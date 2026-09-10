/**
 * Reading psd-to-json manifests.
 *
 * There is no magic "root" path in psd-to-phaser: `place()` resolves a path
 * by walking the manifest's `layers` by name, so it has to be given a real
 * top-level layer name. Asking for "root" finds nothing and returns an empty
 * group — which is exactly the empty bounding box with no image in it.
 */

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
  };
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
 * The layers a single import should place. Groups are placed whole rather
 * than descended into, so an imported PSD arrives as the composition its
 * author built.
 */
export function placeableLayers(manifest: Manifest): ManifestLayer[] {
  const placeable = manifest.top.filter((l) => l.category !== "zone");
  return placeable.length > 0 ? placeable : manifest.top;
}
