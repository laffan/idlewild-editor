/**
 * The canvas, greyed out while the project's PSDs are still arriving.
 *
 * A project opens with its grid, fills and ink up at once and its placed PSDs
 * coming in one file at a time behind them — seconds of it on a large
 * project, and up to twenty on an iPad. Without this the canvas looked done
 * and was not: what was still loading read as missing, and a fill or a drag
 * started in the meantime landed on half a picture.
 *
 * So the canvas wrapper is covered — the rail and the bars in it too — with
 * a bar that fills as files land and the name of the one on its way. It takes
 * the pointer, which is the point. The sidebars stay usable: nothing in them
 * is about what is still loading.
 *
 * It waits a beat before it shows, so a project that loads in a blink never
 * flashes it. The numbers come from the scene through
 * `lib/psd-load-progress.ts`.
 */

import { h } from "../lib/dom";
import { loading, onPsdLoad, type PsdLoadProgress } from "../lib/psd-load-progress";

/** How long a pass runs before it is worth covering the canvas for. */
const SHOW_AFTER_MS = 250;

export interface PsdVeil {
  readonly root: HTMLElement;
  destroy: () => void;
}

/** The line under the bar: how many, and which one. */
export function describeLoad(progress: PsdLoadProgress): string {
  const count = `${progress.done} of ${progress.total}`;
  return progress.key ? `${count} · ${progress.key}` : count;
}

export function createPsdVeil(): PsdVeil {
  const fill = h("div", { class: "psd-veil-fill" });
  const line = h("div", { class: "psd-veil-line" });
  const root = h(
    "div",
    { class: "psd-veil hidden", role: "status", "aria-live": "polite" },
    h(
      "div",
      { class: "psd-veil-card" },
      h("div", { class: "panel-title m", text: "Loading PSDs" }),
      h("div", { class: "psd-veil-bar" }, fill),
      line,
    ),
  );
  let timer: number | undefined;

  const stop = onPsdLoad((progress) => {
    fill.style.width = `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`;
    line.textContent = describeLoad(progress);
    if (!loading(progress)) {
      window.clearTimeout(timer);
      timer = undefined;
      root.classList.add("hidden");
      return;
    }
    if (timer === undefined && root.classList.contains("hidden")) {
      timer = window.setTimeout(() => root.classList.remove("hidden"), SHOW_AFTER_MS);
    }
  });

  return {
    root,
    destroy: () => {
      window.clearTimeout(timer);
      stop();
      root.remove();
    },
  };
}
