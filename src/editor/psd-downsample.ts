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
 *
 * **It can be used once per PSD**, and the sheet says so before it is used
 * rather than after. The first pass leaves the file holding the art's real
 * pixels, with an upscale making up the difference. A second would throw away
 * some of those real pixels, and its upscale *replaces* the first rather than
 * multiplying it — so keeping the size would mean stretching the placement by
 * what the upscale no longer covers, and a stretched hard-edged pixel is a
 * soft one. Rust keeps the record (`ProjectMeta::downsample_kept`) and refuses
 * a second; here it is the box greyed out with the reason beside it.
 *
 * Every size says what the file will be in pixels, read off the file itself,
 * so ".33" is a choice between two numbers somebody can check rather than a
 * fraction of a number they cannot see.
 */

import { h } from "../lib/dom";
import { openSheet } from "../lib/sheet";
import { optionCheckbox, optionNumber, optionSegmented } from "../lib/options-controls";
import { optionGroup, optionRow, optionsPage } from "../lib/options-list";
import { psd } from "../lib/ipc";
import * as log from "../lib/log";
import { openProject } from "../lib/print";
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

/**
 * One side of the file after a downsample, in pixels — the arithmetic
 * `psd_downsample::scaled` does, so the number shown is the number written.
 */
export function downsampledLength(length: number, factor: number): number {
  return Math.max(1, Math.round(length / (1 / factor)));
}

/** `512 × 256 px`, after `factor` (1 for as it is now). */
export function describeSize(size: { width: number; height: number }, factor = 1): string {
  return `${downsampledLength(size.width, factor)} \u00d7 ${downsampledLength(size.height, factor)} px`;
}

/** Whether this file has already been downsampled with Maintain canvas size. */
export function downsampleKept(key: string): boolean {
  return openProject()?.downsampleKept?.includes(key) === true;
}

/** Keep the open project's copy level with what Rust recorded. */
export function rememberDownsampleKept(key: string): void {
  const meta = openProject();
  if (!meta || downsampleKept(key)) return;
  meta.downsampleKept = [...(meta.downsampleKept ?? []), key];
}

/** A file renamed or copied is the same pixels — it keeps the record. */
export function carryDownsampleKept(from: string, to: string, moved: boolean): void {
  const meta = openProject();
  if (!meta || !downsampleKept(from)) return;
  const rest = (meta.downsampleKept ?? []).filter((k) => !(moved && k === from) && k !== to);
  meta.downsampleKept = [...rest, to];
}

/** Why Maintain canvas size is once per PSD — said in the sheet, not hidden behind a `?`. */
const ONCE =
  "Maintain canvas size can be used once per PSD. After it, the file holds " +
  "the pixel art's real pixels and the upscale keeps it its size. A second " +
  "downsample would throw some of those real pixels away, and its upscale " +
  "replaces the first instead of multiplying it — so the canvas could only " +
  "keep the size by stretching the artwork by a fraction, and a pixel " +
  "stretched by a fraction is smoothed: the hard edges go fuzzy.";

export function openDownsample(deps: PixelScaleDeps, key: string, onDone: () => void): void {
  let factor = DOWNSAMPLES[0].value;
  let custom = false;
  const kept = downsampleKept(key);
  let maintain = !kept;
  const before = pixelScaleOf(key);
  // The file's own pixel size, read off the file; until it arrives the sizes
  // say nothing rather than a guess.
  let size: { width: number; height: number } | null = null;

  const sheet = openSheet({ title: "Downsample PSD", subtitle: `${key}.psd`, width: 560 });
  const result = h("span", { class: "option-value" });
  const now = h("span", { class: "option-value" });
  const sync = () => {
    const up = maintain ? upscaleFor(factor) : before;
    now.textContent = size ? describeSize(size) : "…";
    result.textContent =
      (size ? `${describeSize(size, factor)} — ` : "") +
      (maintain
        ? `upscale ${up}×, the artwork stays its size, sharp`
        : `the artwork shrinks to ${Math.round(factor * 100)}% on the canvas`);
    // Each preset carries the size it makes, under its fraction.
    DOWNSAMPLES.forEach((d, i) => {
      const dim = presetDims[i];
      if (dim) dim.textContent = size ? describeSize(size, d.value).replace(" px", "") : "";
    });
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
  sizes.root.classList.add("downsample-sizes");
  const presetDims = [...sizes.root.children].slice(0, DOWNSAMPLES.length).map((button) => {
    const dim = h("span", { class: "downsample-dim" });
    button.appendChild(dim);
    return dim;
  });
  const keep = optionCheckbox(maintain, (on) => {
    maintain = on;
    sync();
  }, "Maintain canvas size");
  if (kept) (keep.root as HTMLInputElement).disabled = true;
  sync();
  psd
    .readLayers(deps.projectId, key)
    .then((list) => {
      size = { width: list.width, height: list.height };
      sync();
    })
    .catch((err) => log.warn(`Could not read the size of ${key}.psd:`, err));

  sheet.body.appendChild(
    optionsPage([
      optionGroup({
        title: "Downsample",
        note:
          "Rewrites the PSD itself at this size, nearest neighbour — for pixel " +
          "art that was drawn big. It cannot be undone.",
        rows: [
          optionRow({ title: "Now", control: now }),
          optionRow({ title: "Size", control: sizes.root }),
          customRow,
          optionRow({
            title: "Maintain canvas size",
            sub: kept
              ? "Already used on this PSD, and it can only be used once."
              : "Sets Pixel art upscale to match, so the artwork stays the size it is on the canvas. Once per PSD.",
            control: keep.root,
          }),
          optionRow({ title: "Result", control: result }),
        ],
      }),
      h("div", { class: "options-group-note downsample-once", text: ONCE }),
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
    const manifest = await psd.downsamplePixels(deps.projectId, key, factor, upscale, maintain);
    rememberPixelScale(key, upscale);
    if (maintain) rememberDownsampleKept(key);
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
