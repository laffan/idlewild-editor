/**
 * Pixel Art Downsample: the sheet behind the **Downsample…** button, under
 * Pixel art upscale in the PSD section.
 *
 * The upscale goes one way — small pixel art shown big and sharp — and this
 * is the other: a PSD of pixel art that was *drawn* big (a patch of canvas
 * made into a PSD, a screenshot of a game at 4×) made into the small file it
 * really is, so editing it is editing pixels again. Unlike the upscale it
 * rewrites the PSD itself, nearest neighbour, which is why it is a sheet
 * rather than a row: it is a thing done once, and it cannot be undone.
 *
 * **Maintain canvas size** sets the upscale to the matching whole number —
 * ½ → 2×, ⅓ → 3×, ¼ → 4× — so the artwork stays the size it is on the canvas
 * and comes out sharp; whatever a custom size leaves over is taken up by the
 * placement. Unticked, the upscale is left as it was and the artwork shrinks.
 */

import { h } from "../lib/dom";
import { openSheet } from "../lib/sheet";
import { optionCheckbox, optionNumber, optionSegmented } from "../lib/options-controls";
import { optionGroup, optionRow, optionsPage } from "../lib/options-list";
import { psd } from "../lib/ipc";
import * as log from "../lib/log";
import { MAX_PIXEL_SCALE, pixelScaleOf, rememberPixelScale, rescaledAbout, type PixelScaleDeps } from "./psd-pixel-scale";

/** The sizes offered, as fractions — exact, so the upscale they pair with is too. */
export const DOWNSAMPLES: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1 / 2, label: ".5" },
  { value: 1 / 3, label: ".33" },
  { value: 1 / 4, label: ".25" },
];

/** The upscale that puts a downsample back at its size: ½ → 2, ⅓ → 3. */
export function upscaleFor(factor: number): number {
  return Math.max(1, Math.min(MAX_PIXEL_SCALE, Math.round(1 / factor)));
}

/** A typed size, as a fraction under one, or null. `0.3`, `.3` and `30%` all read. */
export function readDownsample(text: string): number | null {
  const trimmed = text.trim();
  const n = trimmed.endsWith("%") ? Number(trimmed.slice(0, -1)) / 100 : Number(trimmed);
  return Number.isFinite(n) && n > 0.01 && n < 1 ? n : null;
}

export function openDownsample(deps: PixelScaleDeps, key: string, onDone: () => void): void {
  let factor = DOWNSAMPLES[0].value;
  let custom = false;
  let maintain = true;
  const before = pixelScaleOf(key);

  const sheet = openSheet({ title: "Downsample PSD", subtitle: `${key}.psd`, width: 560 });
  const result = h("span", { class: "option-value" });
  const sync = () => {
    const up = maintain ? upscaleFor(factor) : before;
    result.textContent = maintain
      ? `Pixel art upscale set to ${up}× — the artwork stays its size, sharp`
      : `The artwork shrinks to ${Math.round(factor * 100)}% on the canvas`;
  };
  const number = optionNumber({
    value: 0.3,
    min: 0.02,
    max: 0.98,
    step: 0.01,
    unit: "×",
    label: "Custom size",
    onChange: (value) => {
      const read = readDownsample(String(value));
      if (read !== null) factor = read;
      sync();
    },
  });
  const customRow = optionRow({ title: "Custom size", control: number.root });
  customRow.hidden = true;
  const sizes = optionSegmented(
    [...DOWNSAMPLES.map((d) => ({ value: String(d.value), label: d.label })), { value: "custom", label: "Custom" }],
    String(factor),
    (value) => {
      custom = value === "custom";
      customRow.hidden = !custom;
      factor = custom ? readDownsample(number.input.value) ?? 0.3 : Number(value);
      sync();
    },
  );
  const keep = optionCheckbox(maintain, (on) => {
    maintain = on;
    sync();
  }, "Maintain canvas size");
  sync();

  sheet.body.appendChild(
    optionsPage([
      optionGroup({
        title: "Downsample",
        note:
          "Rewrites the PSD itself at this size, nearest neighbour — for pixel " +
          "art that was drawn big. It cannot be undone.",
        rows: [
          optionRow({ title: "Size", control: sizes.root }),
          customRow,
          optionRow({
            title: "Maintain canvas size",
            hint: "Set Pixel art upscale to match, so the artwork stays the size it is on the canvas.",
            control: keep.root,
          }),
          optionRow({ title: "Result", control: result }),
        ],
      }),
    ]),
  );

  const go = h("button", {
    class: "btn btn-primary",
    text: "Downsample",
    onClick: () => {
      sheet.close();
      void run(deps, key, factor, maintain ? upscaleFor(factor) : before, maintain, before).then(onDone);
    },
  });
  sheet.actions.append(
    go,
    h("button", { class: "btn btn-ghost", text: "Cancel", onClick: () => sheet.close() }),
  );
}

async function run(
  deps: PixelScaleDeps,
  key: string,
  factor: number,
  upscale: number,
  maintain: boolean,
  before: number,
): Promise<void> {
  try {
    const manifest = await psd.downsamplePixels(deps.projectId, key, factor, upscale);
    rememberPixelScale(key, upscale);
    await deps.applyManifest(key, manifest);
  } catch (err) {
    log.error(`Could not downsample ${key}.psd:`, err);
    return;
  }
  log.info(`${key}.psd downsampled to ${Math.round(factor * 100)}%` + (upscale > 1 ? `, shown at ${upscale}×` : ""));
  // The re-parse kept each placement's scale against the manifest, which is
  // now `factor × upscale / before` of what it was. Maintaining the size takes
  // exactly that back out, about each placement's anchor.
  const changed = (factor * upscale) / before;
  if (!maintain || Math.abs(changed - 1) < 1e-6) return;
  const { store } = deps;
  store.history.group(() => {
    for (const layer of store.layers) {
      for (const placement of layer.placements) {
        if (placement.psdKey !== key) continue;
        store.updatePlacement(layer.id, placement.id, rescaledAbout(placement, 1 / changed, deps.anchorWorld(placement)));
      }
    }
  });
}
