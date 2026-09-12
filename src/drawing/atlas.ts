/**
 * The brush atlas, ported from Hush's `engine/stroke-atlas.js`.
 *
 * A brush is a 512×128 alpha mask holding four variants of the same tip.
 * The renderer stamps one of them per step with a source rect and a stable
 * rotation, which is what separates a brush from a chain of circles.
 *
 * The masks are Hush's own PNGs, carried across with the engine. They decode
 * asynchronously, so every brush also has a procedural tip — the same soft
 * radial fallback Hush draws with until its PNG lands — and the first
 * strokes of a session are never blocked on a file.
 *
 * Tinting is `source-in` against a solid fill, cached per brush and colour:
 * a canvas used as a `drawImage` source is mutable, so the browser re-uploads
 * it on every stamp, and re-tinting per stroke would do that thousands of
 * times a second.
 */

import brush1 from "./brushes/brush-1.png";
import brush2 from "./brushes/brush-2.png";
import brush3 from "./brushes/brush-3.png";
import brush4 from "./brushes/brush-4.png";
import brush5 from "./brushes/brush-5.png";

export const ATLAS_CELL = 128;
export const ATLAS_VARIANTS = 4;
const ATLAS_WIDTH = ATLAS_CELL * ATLAS_VARIANTS;

export interface BrushDef {
  id: number;
  name: string;
  url: string;
}

/**
 * Hush ships five; the id is what a stroke stores.
 *
 * Two of the names were on the wrong tips: brush 2 is the grainy one and
 * brush 5 the wet, even-edged one, which is Charcoal and Marker the other way
 * round. Only the *names* are swapped here. Swapping the masks instead would
 * repaint every stroke already drawn — a stroke records `brushId` and nothing
 * else about its tip — so the numbers on the buttons stay where they are and
 * the labels move.
 */
export const BRUSHES: readonly BrushDef[] = [
  { id: 1, name: "Ink", url: brush1 },
  { id: 2, name: "Charcoal", url: brush2 },
  { id: 3, name: "Pencil", url: brush3 },
  { id: 4, name: "Dry brush", url: brush4 },
  { id: 5, name: "Marker", url: brush5 },
];

export interface TintedAtlas {
  atlas: CanvasImageSource;
  cell: number;
  variants: number;
}

/** A soft round tip, duplicated across the four variant slots. */
function fallbackMask(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_WIDTH;
  canvas.height = ATLAS_CELL;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const cell = document.createElement("canvas");
  cell.width = cell.height = ATLAS_CELL;
  const cellCtx = cell.getContext("2d");
  if (cellCtx) {
    const r = ATLAS_CELL / 2;
    const grad = cellCtx.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, "rgba(0,0,0,1)");
    grad.addColorStop(0.55, "rgba(0,0,0,1)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    cellCtx.fillStyle = grad;
    cellCtx.fillRect(0, 0, ATLAS_CELL, ATLAS_CELL);
  }
  for (let i = 0; i < ATLAS_VARIANTS; i++) {
    ctx.drawImage(cell, i * ATLAS_CELL, 0);
  }
  return canvas;
}

export interface AtlasCache {
  /** The tinted atlas for a brush and colour, ready to stamp from. */
  get(brushId: number, color: string): TintedAtlas;
  /** Fires when a brush PNG replaces its fallback, so the ink can rebake. */
  onLoad(listener: () => void): () => void;
  destroy(): void;
}

export function createAtlasCache(): AtlasCache {
  const masks = new Map<number, CanvasImageSource>();
  const tinted = new Map<string, TintedAtlas>();
  const listeners = new Set<() => void>();
  let fallback: HTMLCanvasElement | null = null;
  let destroyed = false;

  const maskFor = (brushId: number): CanvasImageSource => {
    const loaded = masks.get(brushId);
    if (loaded) return loaded;
    if (!fallback) fallback = fallbackMask();
    return fallback;
  };

  for (const brush of BRUSHES) {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (destroyed) return;
      masks.set(brush.id, image);
      // Anything tinted from the fallback is now stale.
      for (const key of [...tinted.keys()]) {
        if (key.startsWith(`${brush.id}|`)) tinted.delete(key);
      }
      for (const listener of listeners) listener();
    };
    image.src = brush.url;
  }

  return {
    get(brushId, color) {
      const mask = maskFor(brushId);
      // The fallback is shared, so a tint built from it must not be cached
      // under a key that outlives the PNG's arrival — the load handler
      // drops exactly those entries.
      const key = `${brushId}|${color}`;
      const cached = tinted.get(key);
      if (cached) return cached;

      const canvas = document.createElement("canvas");
      canvas.width = ATLAS_WIDTH;
      canvas.height = ATLAS_CELL;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(mask, 0, 0, ATLAS_WIDTH, ATLAS_CELL);
        ctx.globalCompositeOperation = "source-in";
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, ATLAS_WIDTH, ATLAS_CELL);
      }

      const entry: TintedAtlas = {
        atlas: canvas,
        cell: ATLAS_CELL,
        variants: ATLAS_VARIANTS,
      };
      tinted.set(key, entry);
      return entry;
    },
    onLoad(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      destroyed = true;
      listeners.clear();
      tinted.clear();
      masks.clear();
    },
  };
}
