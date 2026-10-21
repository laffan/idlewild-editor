/**
 * What the document's placements are, written out as psd-to-phaser code.
 *
 * A PSD to Phaser scene places its own artwork, in its `create`, the way
 * psd-to-phaser's demos do:
 *
 * ```js
 * const tree = this.P2P.place(this, "tree", "tree");
 * tree.setPosition(120, 80);
 * tree.setScale(0.5);
 * tree.setDepth(3);
 * ```
 *
 * This is where those lines come from: a whole scene's worth when a project
 * is switched onto PSD to Phaser (see `editor/scaffold-switch.ts`), one
 * placement's when it is first placed in Draw (`editor/code-sync.ts`), and one
 * row's worth when a layer, a placed PSD or a layer inside one is dragged out
 * of the sidebar onto the code (`editor/code-drag.ts`). All ask the same
 * function, so a line is the line the whole scene would have had.
 *
 * **One `place` per piece of artwork.** psd-to-phaser's `setPosition` on a
 * group puts every child on the same point, so a placement standing on a
 * group is written as one `place` per layer inside it, each at its own offset
 * — what `applyTransform` in `game/placed-parts.ts` does on the canvas.
 *
 * **`setDepth` is the draw order.** A sprite psd-to-phaser places takes the
 * depth its layer had inside its own file, so two files' layers interleave
 * unless something says otherwise. The number is the piece's rank in the whole
 * scene, back to front, which is what the editor draws — so dragging a single
 * row in gives it the depth it would have had among the rest.
 *
 * **A backdrop is not a PSD**, so psd-to-phaser has nothing to place for one.
 * A colour or gradient on a background layer is a record in the document,
 * drawn by the editor over whatever the camera can see — so it is written as
 * Phaser's own Graphics, held still against the camera with
 * `setScrollFactor(0)` and filled to the size of the screen:
 *
 * ```js
 * const sky = this.add.graphics().setScrollFactor(0).setDepth(1);
 * sky.fillGradientStyle(0x87ceeb, 0x87ceeb, 0xffffff, 0xffffff, 1, 1, 1, 1);
 * sky.fillRect(0, 0, this.scale.width, this.scale.height);
 * ```
 *
 * It takes its rank in the same count as the artwork, under the placements
 * on its own layer, as the canvas draws it. A backdrop painted as an image is
 * a PSD placed on the layer, and is written as one.
 */

import { drawOrder } from "../game/draw-order";
import { gradientAlphas, gradientCorners } from "../game/background-render";
import { alphaOf, hexToNumber } from "../lib/color";
import { unitOf } from "../game/unit";
import { layerKind } from "../lib/layer-kinds";
import type { ManifestLayer } from "../lib/manifest";
import { ordersByHand } from "../lib/units";
import type { Background, Collider, Layer, Placement } from "../lib/types";

/** What the code is written from. */
export interface PlacementSource {
  /** The scene's layers, top-first, as the document stores them. */
  layers: readonly Layer[];
  isometric: boolean;
  /** Every layer in a PSD, flattened — empty when it has not loaded. */
  psdLayers: (psdKey: string) => readonly ManifestLayer[];
  colliders?: Record<string, Collider>;
}

/** One piece of artwork, where it stands, at its rank in the scene. */
export interface PlacedPiece {
  layerId: string;
  placement: Placement;
  /** The layer path `place` is called with. */
  path: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  hidden: boolean;
  depth: number;
}

/** A colour or gradient on a background layer, at its rank in the scene. */
export interface BackdropPiece {
  layerId: string;
  background: Background;
  depth: number;
}

/**
 * Every piece in a scene, back to front.
 *
 * Pattern and tile layers are left out: a pattern layer's placements are the
 * palette it scatters rather than things standing anywhere, and a tile
 * layer's are a tileset. So is a layer that is switched off, as the canvas
 * leaves it out of Play.
 */
export function scenePieces(source: PlacementSource): PlacedPiece[] {
  return walk(source).pieces;
}

/** Every backdrop in a scene, back to front, counted with the pieces. */
export function sceneBackdrops(source: PlacementSource): BackdropPiece[] {
  return walk(source).backdrops;
}

function walk(source: PlacementSource): { pieces: PlacedPiece[]; backdrops: BackdropPiece[] } {
  const pieces: PlacedPiece[] = [];
  const backdrops: BackdropPiece[] = [];
  let depth = 0;
  for (const layer of [...source.layers].reverse()) {
    const kind = layerKind(layer);
    if (!layer.visible || kind === "pattern" || kind === "tile") continue;
    // Stored top-first, like the layers; under the layer's own placements.
    for (const background of [...(layer.backgrounds ?? [])].reverse()) {
      backdrops.push({ layerId: layer.id, background, depth: ++depth });
    }
    const order = drawOrder(
      layer.placements,
      !ordersByHand(layer, source.isometric),
      (p) => source.colliders?.[p.psdKey],
    );
    for (const placement of order) {
      for (const piece of piecesOf(placement, source.psdLayers(placement.psdKey))) {
        pieces.push({ ...piece, layerId: layer.id, depth: ++depth });
      }
    }
  }
  return { pieces, backdrops };
}

/** A placement's artwork: itself, or every drawn layer inside its group. */
function piecesOf(
  placement: Placement,
  manifest: readonly ManifestLayer[],
): Omit<PlacedPiece, "layerId" | "depth">[] {
  const naturalWidth = placement.naturalWidth || placement.width;
  const naturalHeight = placement.naturalHeight || placement.height;
  const scaleX = naturalWidth ? placement.width / naturalWidth : 1;
  const scaleY = naturalHeight ? placement.height / naturalHeight : 1;
  const self = manifest.find((l) => l.path === placement.layerPath);
  const inside =
    self?.category === "group"
      ? manifest.filter(
          (l) =>
            l.path.startsWith(`${placement.layerPath}/`) &&
            (l.category === "sprite" || l.category === "tileset"),
        )
      : [];
  if (inside.length === 0) {
    return [
      {
        placement,
        path: placement.layerPath,
        x: placement.x,
        y: placement.y,
        scaleX,
        scaleY,
        hidden: placement.hidden === true,
      },
    ];
  }
  const left = Math.min(...inside.map((l) => l.x));
  const top = Math.min(...inside.map((l) => l.y));
  const off = new Set(placement.hiddenParts ?? []);
  return inside.map((l) => ({
    placement,
    path: l.path,
    x: placement.x + (l.x - left) * scaleX,
    y: placement.y + (l.y - top) * scaleY,
    scaleX,
    scaleY,
    hidden: placement.hidden === true || !l.visible || off.has(l.name),
  }));
}

/** The pieces a dragged row stands for. */
export type CodeSource =
  | { kind: "layer"; layerId: string }
  | { kind: "placed"; layerId: string; placementId: string }
  | { kind: "psd-layer"; layerId: string; placementId: string; psdKey: string; path: string }
  | { kind: "backdrop"; layerId: string; backgroundId: string };

export function piecesFor(pieces: readonly PlacedPiece[], source: CodeSource): PlacedPiece[] {
  if (source.kind === "layer") return pieces.filter((p) => p.layerId === source.layerId);
  if (source.kind === "backdrop") return [];
  const held = pieces.find((p) => p.placement.id === source.placementId);
  if (!held) return [];
  const unit = pieces.filter(
    (p) => p.layerId === source.layerId && unitOf(p.placement) === unitOf(held.placement),
  );
  if (source.kind === "placed") return unit;
  return unit.filter((p) => p.path === source.path || p.path.startsWith(`${source.path}/`));
}

/**
 * The lines for some pieces, unindented, one statement to a line.
 *
 * `taken` is every name already declared where the lines will go, and is
 * added to, so two drags into one file never declare the same `const`.
 */
export function placementCode(pieces: readonly PlacedPiece[], taken: Set<string>): string[] {
  const lines: string[] = [];
  for (const piece of pieces) {
    const name = freeName(piece.path, piece.placement.psdKey, taken);
    const key = JSON.stringify(piece.placement.psdKey);
    lines.push(`const ${name} = this.P2P.place(this, ${key}, ${JSON.stringify(piece.path)});`);
    lines.push(`${name}.setPosition(${num(piece.x)}, ${num(piece.y)});`);
    if (piece.scaleX !== 1 || piece.scaleY !== 1) {
      lines.push(
        piece.scaleX === piece.scaleY
          ? `${name}.setScale(${num(piece.scaleX)});`
          : `${name}.setScale(${num(piece.scaleX)}, ${num(piece.scaleY)});`,
      );
    }
    lines.push(`${name}.setDepth(${piece.depth});`);
    if (piece.hidden) lines.push(`${name}.setVisible(false);`);
  }
  return lines;
}

/** The lines for some backdrops, unindented — see the note at the top. */
export function backdropCode(backdrops: readonly BackdropPiece[], taken: Set<string>): string[] {
  const lines: string[] = [];
  for (const { background, depth } of backdrops) {
    const name = freeName(background.name || "backdrop", "backdrop", taken);
    lines.push(`const ${name} = this.add.graphics().setScrollFactor(0).setDepth(${depth});`);
    if (background.kind === "gradient" && background.gradient) {
      const { from, to, angle } = background.gradient;
      const colors = gradientCorners(from, to, angle ?? 0).map(hex);
      const alphas = gradientAlphas(from, to, angle ?? 0).map(num);
      lines.push(`${name}.fillGradientStyle(${[...colors, ...alphas].join(", ")});`);
    } else {
      const color = background.color ?? "#2b3b4a";
      lines.push(`${name}.fillStyle(${hex(hexToNumber(color))}, ${num(alphaOf(color))});`);
    }
    lines.push(`${name}.fillRect(0, 0, this.scale.width, this.scale.height);`);
  }
  return lines;
}

/**
 * The lines for some pieces and backdrops of a scene together, back to
 * front — a backdrop under the artwork on its layer.
 */
export function partsCode(
  pieces: readonly PlacedPiece[],
  backdrops: readonly BackdropPiece[],
  taken: Set<string>,
): string[] {
  const parts = [
    ...backdrops.map((b) => ({ depth: b.depth, lines: () => backdropCode([b], taken) })),
    ...pieces.map((p) => ({ depth: p.depth, lines: () => placementCode([p], taken) })),
  ].sort((a, b) => a.depth - b.depth);
  return parts.flatMap((part) => part.lines());
}

/** What a dragged row writes, or nothing when nothing on it draws. */
export function codeFor(source: PlacementSource, row: CodeSource, taken: Set<string>): string[] {
  const { pieces, backdrops } = walk(source);
  const held = piecesFor(pieces, row);
  const behind =
    row.kind === "layer"
      ? backdrops.filter((b) => b.layerId === row.layerId)
      : row.kind === "backdrop"
        ? backdrops.filter((b) => b.background.id === row.backgroundId)
        : [];
  if (held.length > 0 || behind.length > 0) return partsCode(held, behind, taken);
  return row.kind === "psd-layer" ? barePlacement(row.psdKey, row.path, taken) : [];
}

/** A layer that is in a PSD but placed nowhere: where the file puts it. */
export function barePlacement(psdKey: string, path: string, taken: Set<string>): string[] {
  const name = freeName(path, psdKey, taken);
  return [`const ${name} = this.P2P.place(this, ${JSON.stringify(psdKey)}, ${JSON.stringify(path)});`];
}

/**
 * A whole scene's placement lines, indented for a method body, grouped under
 * a comment naming each layer — what a scene file is written with.
 */
export function sceneCode(source: PlacementSource): string {
  const lines = sceneLines(source, new Set());
  return lines.map((line) => (line ? `    ${line}\n` : "\n")).join("");
}

/** The same lines, unindented, over `taken`. */
export function sceneLines(source: PlacementSource, taken: Set<string>): string[] {
  const { pieces, backdrops } = walk(source);
  const out: string[] = [];
  for (const layer of [...source.layers].reverse()) {
    const lines = partsCode(
      pieces.filter((p) => p.layerId === layer.id),
      backdrops.filter((b) => b.layerId === layer.id),
      taken,
    );
    if (lines.length === 0) continue;
    if (out.length > 0) out.push("");
    out.push(`// ${layer.name}`, ...lines);
  }
  return out;
}

/** Every `const`, `let`, `var`, `function` or `class` name in some code. */
export function declaredNames(code: string): Set<string> {
  const names = new Set<string>();
  for (const match of code.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1]);
  }
  return names;
}

const RESERVED = new Set(
  ("break case catch class const continue debugger default delete do else export extends " +
    "false finally for function if import in instanceof let new null return super switch " +
    "this throw true try typeof var void while with yield await enum static")
    .split(" "),
);

/** A camelCase name for a layer, free in `taken`, which it is added to. */
function freeName(path: string, psdKey: string, taken: Set<string>): string {
  const leaf = path.split("/").pop() ?? path;
  let base = camel(leaf);
  if (!base || /^\d/.test(base) || RESERVED.has(base)) base = camel(`${psdKey} ${leaf}`);
  if (!base || /^\d/.test(base) || RESERVED.has(base)) base = `layer${base}`;
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}${n}`;
  taken.add(name);
  return name;
}

function camel(text: string): string {
  const words = text.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words
    .map((w, i) => (i === 0 ? w[0].toLowerCase() + w.slice(1) : w[0].toUpperCase() + w.slice(1)))
    .join("");
}

/** A packed colour as code: `0x87ceeb`. */
function hex(value: number): string {
  return `0x${(value & 0xffffff).toString(16).padStart(6, "0")}`;
}

/** A coordinate as code: two decimals at most, and no trailing zeros. */
function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}
