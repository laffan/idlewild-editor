/**
 * Include context's picture: everything visible on the canvas inside a PSD's
 * own box, except the PSD — which `psd_context.rs` writes into the file as a
 * `context` layer at half opacity each time it is opened or shared.
 *
 * The box is the file's whole canvas where it stands in the world: the
 * placement's corner, less where its layer sits inside the canvas, at the
 * placement's scale. The picture is made at the file's own density — the
 * manifest's pixels times what makes a manifest bigger than its file (a print
 * project's screen copy, Pixel Art Rescale) — so it lines up pixel for pixel.
 *
 * Two halves: the scene's objects (`game/context-capture.ts`), with this
 * file's own placement hidden for the length of the capture, and the ink,
 * which is not in the scene but on the drawing layer's canvas — drawn over
 * them, a layer at a time so an eraser only takes out its own layer's ink.
 */

import type { DocStore } from "../lib/doc-store";
import { psd } from "../lib/ipc";
import { parseManifest } from "../lib/manifest";
import { sourceScale } from "../lib/print";
import type { Placement } from "../lib/types";
import type { WorldScene } from "../game/world-scene";
import { captureBox, type Box } from "../game/context-capture";
import { canvasInWorld } from "../lib/placing";
import { unitOf } from "../game/unit";
import { renderStroke } from "../drawing/render";
import { strokeBox, boxesOverlap } from "../drawing/geometry";
import type { DrawingLayer } from "../drawing";
import { EXPORT_SCALE } from "./import-anchor";
import { pixelScaleOf } from "./psd-pixel-scale";

export interface ContextDeps {
  projectId: string;
  store: DocStore;
  scene: () => WorldScene | null;
  drawing?: () => DrawingLayer | null;
}

export interface ContextPicture {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

/** The placement whose surroundings are wanted: the selected one, or the first. */
function placementOf(store: DocStore, scene: WorldScene, key: string): Placement | null {
  const selection = scene.getSelection();
  let first: Placement | null = null;
  for (const layer of store.layers) {
    for (const placement of layer.placements) {
      if (placement.psdKey !== key) continue;
      if (selection.kind === "placement" && selection.placementId === placement.id) return placement;
      first ??= placement;
    }
  }
  return first;
}

/** The picture, or null when the file is not placed or nothing could be drawn. */
export async function contextPicture(deps: ContextDeps, key: string): Promise<ContextPicture | null> {
  const scene = deps.scene();
  if (!scene) return null;
  const placement = placementOf(deps.store, scene, key);
  if (!placement) return null;
  const manifest = parseManifest(await psd.manifest(deps.projectId, key));
  const entry = manifest.all.find((l) => l.path === placement.layerPath);
  if (!entry) return null;
  const box = canvasInWorld(placement, entry, manifest);
  if (box.width <= 0 || box.height <= 0) return null;

  const per = sourceScale() / EXPORT_SCALE / pixelScaleOf(key);
  const width = Math.max(1, Math.round(manifest.width * per));
  const height = Math.max(1, Math.round(manifest.height * per));

  // The file itself is what is being drawn *on*, so it stays out of its own
  // context. Put back once the picture is read, whatever happened.
  scene.suppressInstance(unitOf(placement));
  let canvas: HTMLCanvasElement | null;
  try {
    canvas = await captureBox(scene, box, width, height);
  } finally {
    scene.suppressInstance(null);
  }
  if (!canvas) return null;
  drawInk(deps, canvas, box);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return { width: canvas.width, height: canvas.height, rgba: data };
}

/** The drawing layer's ink inside the box, over what the scene drew. */
function drawInk(deps: ContextDeps, canvas: HTMLCanvasElement, box: Box): void {
  const atlas = deps.drawing?.()?.atlas;
  const target = canvas.getContext("2d");
  if (!atlas || !target) return;
  const sx = canvas.width / box.width;
  const sy = canvas.height / box.height;
  // Bottom-up: layers are stored top-first.
  for (const layer of [...deps.store.layers].reverse()) {
    if (!layer.visible) continue;
    const strokes = layer.strokes.filter((stroke) => {
      const at = strokeBox(stroke);
      return !!at && boxesOverlap(at, box);
    });
    if (strokes.length === 0) continue;
    const sheet = document.createElement("canvas");
    sheet.width = canvas.width;
    sheet.height = canvas.height;
    const ctx = sheet.getContext("2d");
    if (!ctx) continue;
    ctx.setTransform(sx, 0, 0, sy, -box.x * sx, -box.y * sy);
    for (const stroke of strokes) renderStroke(ctx, stroke, atlas);
    target.drawImage(sheet, 0, 0);
  }
}
