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
 *
 * Reading only. Turning what is read into a position on the canvas — the
 * anchor, the offsets measured from it, and the arithmetic both placing and
 * re-parsing run — is `lib/placing.ts`.
 */

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
  /**
   * What psd-to-json made of a sprite: `atlas`, `spritesheet`, `animation`,
   * or undefined for a plain one.
   *
   * It is the difference between a layer that is *one picture* and a layer
   * that is a sheet of them, and until now nothing here read it — which is
   * why an atlas was listed as though it were a group, and why a group and
   * an atlas looked alike to everything downstream.
   */
  type?: string;
  /**
   * The frames a composited sprite holds, by name, or undefined.
   *
   * An atlas swallows its children: they are gone from `children` and live
   * on only as keys of the manifest's `frames` map. That map is therefore
   * the only record that `purple` used to be a layer of its own, which is
   * exactly what a re-parse needs in order to work out where a placement
   * standing on `purple` should go now. See `frameOwners`.
   */
  frames?: string[];
  /**
   * Whether this layer is drawn, with its groups taken into account.
   *
   * psd-to-json writes `visible: false` on a layer whose eye is off in
   * Photoshop, and a group carries only its *own* answer — a layer inside a
   * switched-off folder has a lit eye there and says nothing here. Carrying
   * that down is the reader's job, so what this field holds is the effective
   * answer: false if this layer is hidden **or** anything holding it is.
   *
   * Hidden is about drawing rather than about existing. The asset is
   * exported and the layer is placed; it simply starts turned off, here and
   * in the game, so a project's own code can turn it on.
   */
  visible: boolean;
  /**
   * The artwork psd-to-json exported for this layer, relative to the PSD's
   * own `assets/<key>/` directory — `sprites/roof.png`.
   *
   * Only on a sprite; a group and a zone have no picture of their own.
   * Carried because a tile layer's tileset has to name the image a Tiled map
   * draws from, and the path is the one fact about a layer that is about the
   * file on disk rather than about the picture. See `lib/tile-layers.ts`.
   */
  filePath?: string;
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
  const top = layers.map((layer) => walk(layer, "", all, true));

  return {
    name: String(raw.name ?? "untitled"),
    width: Number(raw.width ?? 0),
    height: Number(raw.height ?? 0),
    top,
    all,
    anchor: findAnchor(all),
  };
}

/**
 * Every layer in a raw manifest, flattened and depth-first, paths and all.
 *
 * The same walk `parseManifest` makes, over psd-to-phaser's own copy of the
 * document — the plugin keeps it under `getData(key).original.layers` — rather
 * than over a string. Written against the raw layers for the reason `hasRootAnchor`
 * is: the caller has the object in hand, and re-serialising it so that it can
 * be parsed again would be a JSON round trip per row of a panel.
 *
 * What reads it is the directory Code mode's sidebar becomes, which lists
 * what is inside each placed file. Nothing is filtered out — the editor's own
 * marks included — because a directory of what is in a file that quietly
 * leaves two layers out is a directory that disagrees with Photoshop.
 */
export function manifestLayers(layers: unknown): ManifestLayer[] {
  if (!Array.isArray(layers)) return [];
  const all: ManifestLayer[] = [];
  for (const layer of layers) walk(layer, "", all, true);
  return all;
}

/** How deep in the stack a layer sits, from its slash-joined path. */
export function layerDepth(path: string): number {
  return path.split("/").length - 1;
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

/**
 * The layer a path names, which is what a texture is keyed *on*.
 *
 * A path is slash-joined, so a layer inside a group is `G | town/S | roof`
 * and the name is the last segment. Here rather than beside the loader
 * because it is a fact about a manifest path, and because everything in this
 * file is readable without a Phaser to import.
 */
export function layerName(layerPath: string): string {
  const at = layerPath.lastIndexOf("/");
  return at < 0 ? layerPath : layerPath.slice(at + 1);
}

/**
 * What psd-to-phaser keys a texture on: the **PSD's** key, then the layer's
 * name.
 *
 * The plugin has two namings and the one it uses is a fact about how the file
 * was loaded. `load` keys a sprite on `layer.name` alone, so two PSDs with a
 * same-named layer share one texture — a `S | layer-1` added to a pattern
 * layer's file showed up as the artwork of the `S | layer-1` in an object
 * layer's, because the second load was silently dropped and the first
 * texture answered for both. `loadMultiple` keys it `<psdKey>_<name>` and
 * `place` reads the same `isMultiplePsd` flag back, so the two halves agree.
 * Every load this editor makes goes through that path — see
 * `game/psd-loader.ts` — so this is *the* key, not one of two.
 *
 * Masks are the one exception and they stay unscoped: the plugin applies one
 * by looking for `<name>_mask` whichever way the file was loaded. See
 * `maskKey`.
 */
export function textureKey(psdKey: string, layerPath: string): string {
  return `${psdKey}_${layerName(layerPath)}`;
}

/** The same, over a list of names a `TextureNeed` already worked out. */
export function scopeKeys(psdKey: string, keys: readonly string[]): string[] {
  return keys.map((key) => `${psdKey}_${key}`);
}

/**
 * A layer's mask texture, which is **not** scoped to the PSD.
 *
 * `place` looks for `<name>_mask` on both of the plugin's loading paths, so
 * scoping it here would be a texture nothing asks for. Two files with a
 * same-named masked layer therefore still share a mask — the collision the
 * scoping above closes for artwork, left open for masks because the plugin
 * gives no way to close it. Masks are rare, and a shared mask is a wrong
 * shape rather than a missing picture.
 */
export function maskKey(name: string): string {
  return `${name}_mask`;
}

/**
 * Whether a PSD carries the anchor mark at the **root** of its layer stack.
 *
 * Not the same question `manifest.anchor` answers. That one finds the mark
 * wherever it is, because a file whose author tucked it inside a folder
 * should still land where they put it. This one is the *rule* an object layer
 * enforces: the mark has to be a top-level layer, where anybody opening the
 * file sees it and nothing else in the stack can hide it, turn it off or take
 * it away by being deleted.
 *
 * Written against the raw manifest layers rather than a parsed `Manifest`
 * because the caller has psd-to-phaser's copy of the document in hand — the
 * plugin keeps it under `getData(key).original` — and re-serialising it to
 * re-parse it would be a JSON round trip per row of the layer panel.
 */
export function hasRootAnchor(layers: unknown): boolean {
  if (!Array.isArray(layers)) return false;
  return layers.some((raw) => {
    const node = (raw ?? {}) as Record<string, unknown>;
    return (
      toCategory(node.category, node.type) === "point" &&
      String(node.name ?? "").trim().toLowerCase() === ANCHOR_LAYER
    );
  });
}

/**
 * The mark's position, or null when the file has none this can be read from.
 *
 * **A point with no area is not a position.** psd-to-json reports a point as
 * the centre of its layer's rectangle, and a layer whose pixels have gone has
 * no rectangle: it comes back as 0 × 0 at the origin, which reads as an anchor
 * on the canvas's top-left corner rather than as the absence of one. That is
 * not hypothetical — cropping a PSD in Photoshop deletes what falls outside
 * the new canvas, and `psd_marks::layout` can leave the dot on the very edge
 * or, when the anchor space is not one the artwork covers, past it. The row is
 * still in the layer list afterwards, so it looks to everybody like the mark
 * is right where they left it, and the artwork lands a canvas away.
 *
 * Null is the honest answer, and it is also the useful one: `reconcile.ts`
 * reads it as "hold this where it is" and says so in the console, rather than
 * moving artwork to a corner on the strength of an empty layer.
 */
function findAnchor(all: readonly ManifestLayer[]): { x: number; y: number } | null {
  const point = all.find(
    (l) =>
      l.category === "point" &&
      l.name.toLowerCase() === ANCHOR_LAYER &&
      l.width > 0 &&
      l.height > 0,
  );
  return point ? { x: point.x, y: point.y } : null;
}

function walk(
  raw: unknown,
  prefix: string,
  all: ManifestLayer[],
  shown = true,
): ManifestLayer {
  const node = (raw ?? {}) as Record<string, unknown>;
  const name = String(node.name ?? "");
  const path = prefix ? `${prefix}/${name}` : name;

  const frames = node.frames;
  const layer: ManifestLayer = {
    path,
    name,
    category: toCategory(node.category, node.type),
    type: typeof node.type === "string" ? node.type : undefined,
    frames:
      frames && typeof frames === "object" && !Array.isArray(frames)
        ? Object.keys(frames as Record<string, unknown>)
        : undefined,
    // Absent means visible, which is what every manifest written before
    // psd-to-json read the flag says about every layer in it.
    visible: shown && node.visible !== false,
    filePath: typeof node.filePath === "string" ? node.filePath : undefined,
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
      const parsed = walk(child, path, all, layer.visible);
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
 * Which composited layer swallowed a given name, by name.
 *
 * Grouping a handful of loose sprites into `S | confetti | atlas |` is one
 * edit in Photoshop and a considerable one here: `purple` and `green` stop
 * being layers and become *frames*, so a manifest that had three entries now
 * has one. A placement still standing on `purple` points at a layer the file
 * no longer has, and the honest reading of that — the layer is gone, drop the
 * placement — takes the artwork off the canvas for what the author experienced
 * as tidying up.
 *
 * The frames map is what makes a better answer possible. It is the only thing
 * left in the file that remembers `purple` was once a layer, and it says which
 * image it is part of now, so a placement can follow its artwork into the
 * atlas instead of being deleted. See `reconcile.ts`.
 *
 * Only composited sprites contribute, and a name claimed by two of them
 * belongs to the first — the manifest addresses layers by name too, so that
 * ambiguity is the file's rather than this reader's.
 */
export function frameOwners(manifest: Manifest): Map<string, string> {
  const owners = new Map<string, string>();
  for (const layer of manifest.all) {
    if (!layer.frames) continue;
    for (const frame of layer.frames) {
      if (!owners.has(frame)) owners.set(frame, layer.path);
    }
  }
  return owners;
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
 * The layers inside a placed one that are hidden on their own.
 *
 * A group is placed **whole** — one placement, one call to `place()` — so a
 * hidden child inside it cannot be expressed by leaving a placement out. What
 * comes back is the names of the pieces to turn off once the plugin has made
 * them, which is how the canvas and the game both do it.
 *
 * Names rather than paths because a placed object carries the name
 * psd-to-phaser gave it and nothing else. Two layers with the same name
 * inside one file are therefore one answer; the manifest addresses layers by
 * name too, so that ambiguity is the file's rather than this reader's.
 *
 * Empty for a layer with nothing hidden under it, which is almost every
 * layer — so a placement usually carries no list at all.
 */
export function hiddenPartNames(
  manifest: Manifest,
  path: string,
): string[] {
  const inside = `${path}/`;
  const names = manifest.all
    .filter((layer) => layer.path.startsWith(inside) && !layer.visible)
    .map((layer) => layer.name);
  return [...new Set(names)];
}

/**
 * What a placement of one layer should record about what is turned off.
 *
 * Both fields come back **undefined** rather than absent when there is
 * nothing hidden, because this is spread over a placement that may already
 * carry the answer from last time: a layer turned back on has to clear the
 * flag, and a key left out of the patch would leave the old one standing.
 */
export function placedVisibility(
  manifest: Manifest,
  path: string,
): { hidden: boolean | undefined; hiddenParts: string[] | undefined } {
  const entry = manifest.all.find((layer) => layer.path === path);
  const parts = hiddenPartNames(manifest, path);
  return {
    hidden: entry && !entry.visible ? true : undefined,
    hiddenParts: parts.length > 0 ? parts : undefined,
  };
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

/**
 * One layer's textures: what the layer is called, and the keys it needs.
 *
 * A layer does not always want *one* texture, and that is the whole reason
 * this exists. A sprite wants a texture under its own name. A tileset wants
 * one per slice — `Background_tile_0_0` and along — and nothing under its own
 * name at all. Asking the sprite question about a tileset is how a thirty-
 * tile backdrop came back from Photoshop and was never drawn: the gate that
 * decides whether an object may be made looked for a texture that does not
 * exist for that category and quietly answered no, every frame, for ever.
 */
export interface TextureNeed {
  /** The layer's own name, which is what a warning has to say out loud. */
  name: string;
  /** Every texture key psd-to-phaser will have loaded for it. */
  keys: string[];
}

/**
 * The textures a manifest — or one layer of it — is waiting on.
 *
 * Written against the **raw** layers rather than a parsed `Manifest` because
 * both callers hold psd-to-phaser's own copy of the document, under
 * `getData(key).original`, and re-serialising it to re-parse it would be a
 * JSON round trip per placement.
 *
 * The walk mirrors the plugin's own categoriser, which is the only thing that
 * makes the answer true: it descends into a **group** and stops at a
 * **tileset**, so a sprite nested inside one is never loaded as a sprite and
 * is never waited for. Points and zones carry no pixels and want nothing.
 *
 * `path` scopes the answer to one layer and everything under it, addressed
 * the way `place()` addresses them — names joined by slashes. A path that
 * names nothing in this manifest comes back empty, which the caller has to
 * read as *no answer* rather than as *nothing to wait for*.
 */
export function textureNeeds(layers: unknown, path?: string): TextureNeed[] {
  const root = path === undefined ? layers : findLayer(layers, path.split("/"));
  const out: TextureNeed[] = [];
  if (path === undefined) collectNeeds(root, out);
  else if (root) collectNeeds([root], out);
  return out;
}

function findLayer(layers: unknown, names: string[]): unknown {
  if (!Array.isArray(layers) || names.length === 0) return null;
  const [head, ...rest] = names;
  for (const raw of layers) {
    const node = (raw ?? {}) as Record<string, unknown>;
    if (String(node.name ?? "") !== head) continue;
    return rest.length === 0 ? node : findLayer(node.children, rest);
  }
  return null;
}

function collectNeeds(layers: unknown, out: TextureNeed[]): void {
  if (!Array.isArray(layers)) return;
  for (const raw of layers) {
    const node = (raw ?? {}) as Record<string, unknown>;
    const name = String(node.name ?? "");
    switch (toCategory(node.category, node.type)) {
      case "sprite":
        if (name) out.push({ name, keys: [name] });
        break;
      case "tileset":
        if (name) out.push({ name, keys: tileKeys(node, name) });
        break;
      case "group":
        collectNeeds(node.children, out);
        break;
      default:
        break;
    }
  }
}

/**
 * Every slice of a tileset, by the key the plugin loads and places it under.
 *
 * `<name>_tile_<col>_<row>`, read off the plugin's `loadTile` and its
 * `placeTileset` — which build the same string from the same two counts the
 * manifest carries. A tileset with no counts is one slice, which is what the
 * plugin's own loop comes to.
 */
function tileKeys(node: Record<string, unknown>, name: string): string[] {
  const columns = Math.max(1, Math.round(Number(node.columns ?? 1)) || 1);
  const rows = Math.max(1, Math.round(Number(node.rows ?? 1)) || 1);
  const keys: string[] = [];
  for (let col = 0; col < columns; col++) {
    for (let row = 0; row < rows; row++) keys.push(`${name}_tile_${col}_${row}`);
  }
  return keys;
}
