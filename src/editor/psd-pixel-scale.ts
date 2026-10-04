/**
 * Pixel art upscale: the row at the foot of the inspector's PSD section.
 *
 * Pixel art is drawn small. Shown big — on a high-resolution web page, or on
 * a 300 DPI sheet — it is either tiny or, scaled up by whoever draws it,
 * soft. So a PSD can be processed bigger than it is: **0** (its own size, the
 * default), **2×**, **3×**, **4×**, or a **Custom** whole number up to 16.
 * Every pixel becomes a hard-edged block in what psd-to-json is given, so the
 * sprites on the canvas and in the game are sharp at that size. The PSD on
 * disk never changes — see `src-tauri/src/psd_pixel_scale.rs` — so editing it
 * is still editing pixel art, and PSD Edit mode lands ink at the file's own
 * pixels (`pixelScaleOf`).
 *
 * Picking a size asks one question: **keep it the same size on the canvas?**
 * Two ways in want different answers. Pixel art pasted from another app
 * arrives small, and growing it 4× is the point — say no. A PSD made from a
 * patch of the canvas is already the size it should be, and only wants to be
 * sharp — say yes, and the placement is shrunk by as much as the sprites
 * grew, about the point it is anchored on.
 */

import { h } from "../lib/dom";
import { chooseSheet, promptSheet } from "../lib/sheet";
import { openProject } from "../lib/print";
import { psd } from "../lib/ipc";
import * as log from "../lib/log";
import type { DocStore } from "../lib/doc-store";
import type { Placement, Point } from "../lib/types";

/** The buttons, in order. 1 is the file at its own size, shown as `0`. */
export const PIXEL_SCALES = [1, 2, 3, 4] as const;
export const MAX_PIXEL_SCALE = 16;

/** A PSD's factor in the open project — 1 for its own size. */
export function pixelScaleOf(key: string): number {
  const factor = openProject()?.pixelScale?.[key];
  return typeof factor === "number" && factor >= 2 && factor <= MAX_PIXEL_SCALE
    ? Math.round(factor)
    : 1;
}

/** Keep the open project's copy of the factors level with what Rust wrote. */
export function rememberPixelScale(key: string, factor: number): void {
  const meta = openProject();
  if (!meta) return;
  const next = { ...(meta.pixelScale ?? {}) };
  if (factor > 1) next[key] = factor;
  else delete next[key];
  meta.pixelScale = next;
}

/** A file renamed or copied took its factor with it — on disk, and here. */
export function carryPixelScale(from: string, to: string, moved: boolean): void {
  const factor = pixelScaleOf(from);
  if (factor <= 1) return;
  rememberPixelScale(to, factor);
  if (moved) rememberPixelScale(from, 1);
}

/** What a typed custom factor means, or null for nothing usable. */
export function readCustomScale(text: string): number | null {
  const n = Number(text.trim().replace(/[x×]$/i, ""));
  if (!Number.isInteger(n) || n < 2 || n > MAX_PIXEL_SCALE) return null;
  return n;
}

/**
 * A placement shrunk (or grown) by `by` about the point its anchor mark
 * stands on, so a re-parse afterwards finds the mark exactly where it was.
 */
export function rescaledAbout(placement: Placement, by: number, fallback: Point): Partial<Placement> {
  const scaleX = placement.width / (placement.naturalWidth || placement.width);
  const scaleY = placement.height / (placement.naturalHeight || placement.height);
  const from = placement.fromAnchor;
  const at = from
    ? { x: placement.x - from.x * scaleX, y: placement.y - from.y * scaleY }
    : fallback;
  return {
    x: at.x + (placement.x - at.x) * by,
    y: at.y + (placement.y - at.y) * by,
    width: placement.width * by,
    height: placement.height * by,
  };
}

export interface PixelScaleDeps {
  projectId: string;
  store: DocStore;
  /** Where a placement with no mark offset is anchored, in the world. */
  anchorWorld: (placement: Placement) => Point;
  /** The new manifest is in: re-place the file's layers against it. */
  applyManifest: (key: string, manifest: string) => Promise<void>;
}

/** Ask, write, re-parse, and — if asked to — keep the size on the canvas. */
export async function changePixelScale(
  deps: PixelScaleDeps,
  key: string,
  factor: number,
): Promise<void> {
  const before = pixelScaleOf(key);
  if (factor === before) return;
  const keep = await chooseSheet({
    title: factor > 1 ? `Rescale ${key} ×${factor}` : `${key} at its own size`,
    message:
      "Downscale the preview by the same amount, so it stays the same size on " +
      "the canvas? Choose Let it grow to see the artwork at its new size.",
    choices: [
      { id: "keep", label: "Keep the size", primary: true },
      { id: "grow", label: factor > before ? "Let it grow" : "Let it shrink" },
    ],
    light: false,
  });
  if (!keep) return;
  try {
    const manifest = await psd.setPixelScale(deps.projectId, key, factor);
    rememberPixelScale(key, factor);
    await deps.applyManifest(key, manifest);
  } catch (err) {
    log.error(`Could not rescale ${key}.psd:`, err);
    return;
  }
  log.info(factor > 1 ? `${key}.psd — processed ×${factor}, nearest neighbour` : `${key}.psd — processed at its own size`);
  if (keep !== "keep") return;
  // The re-parse kept each placement's scale against the manifest, so the
  // artwork grew with it; undo exactly that, in one step.
  const by = before / factor;
  const { store } = deps;
  store.history.group(() => {
    for (const layer of store.layers) {
      for (const placement of layer.placements) {
        if (placement.psdKey !== key) continue;
        store.updatePlacement(
          layer.id,
          placement.id,
          rescaledAbout(placement, by, deps.anchorWorld(placement)),
        );
      }
    }
  });
}

/** The row: its name on the left, the five buttons on the right. */
export function pixelScaleRow(
  key: string,
  busy: boolean,
  onPick: (factor: number) => void,
  onDownsample?: () => void,
): HTMLElement {
  const current = pixelScaleOf(key);
  const custom = !(PIXEL_SCALES as readonly number[]).includes(current);
  const button = (label: string, on: boolean, act: () => void, title: string) =>
    h("button", {
      class: `opt-seg-btn${on ? " selected" : ""}`,
      type: "button",
      text: label,
      title,
      "aria-pressed": on ? "true" : "false",
      disabled: busy ? "true" : null,
      onClick: act,
    });
  const row = h(
    "div",
    { class: "psd-pixel-scale" },
    h("span", {
      class: "psd-pixel-scale-name",
      text: "Pixel art upscale",
      title:
        "Process this PSD bigger, nearest neighbour, so pixel art stays sharp. " +
        "The PSD itself is not changed.",
    }),
    h(
      "div",
      { class: "opt-seg psd-pixel-scale-seg" },
      ...PIXEL_SCALES.map((f) =>
        button(
          f === 1 ? "0" : `${f}×`,
          f === current,
          () => onPick(f),
          f === 1 ? "Its own size" : `${f} times bigger`,
        ),
      ),
      button(custom ? `${current}×` : "Custom", custom, () => {
        void promptSheet({
          title: "Pixel art upscale",
          label: `A whole number from 2 to ${MAX_PIXEL_SCALE}`,
          value: custom ? String(current) : "",
          confirmLabel: "Rescale",
          light: false,
        }).then((text) => {
          if (text === null) return;
          const n = readCustomScale(text);
          if (n === null) log.warn(`Pixel art upscale is a whole number from 2 to ${MAX_PIXEL_SCALE}`);
          else onPick(n);
        });
      }, "Another whole number"),
    ),
  );
  // Under it, the other direction — see `psd-downsample.ts`.
  const down = onDownsample
    ? h("button", {
        class: "panel-btn psd-downsample-btn",
        text: "Downsample…",
        title: "Make a PSD of pixel art drawn big into the small file it really is",
        disabled: busy ? "true" : null,
        onClick: onDownsample,
      })
    : null;
  return h("div", { class: "psd-pixel-block" }, row, down);
}
