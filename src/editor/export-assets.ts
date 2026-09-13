/**
 * **Export Assets**: some of a project's PSDs, on their own.
 *
 * The third exit from the menu, and the only one that hands back *artwork*
 * rather than a program. Export site is a game you can serve and Export project
 * is the whole project as a `.idlewild`; both are all-or-nothing and both are
 * only useful to something that can read them. What was missing is the pictures:
 * the sprite sheets a tileset was sliced into, so they can go into another
 * engine or a document, and the source PSDs, so a file drawn on an iPad can be
 * opened on a desktop.
 *
 * So the sheet asks two questions and nothing else. **Which files** — a list
 * with a checkbox each, everything ticked to begin with, because "all of them"
 * is the common answer and un-ticking three is less work than ticking twelve.
 * And **what of them** — the generated assets, the PSDs themselves, or both.
 *
 * It lists what is on disk rather than what the document places. A file whose
 * placement has been deleted is still a file somebody drew, and the one thing
 * this export exists to rescue is artwork — refusing to hand back the only copy
 * of it would be the wrong kind of tidiness. A file the pipeline has never run
 * over says so on its row and cannot contribute generated assets, since it has
 * none.
 */

import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { h } from "../lib/dom";
import { openSheet } from "../lib/sheet";
import { publish, type PsdSummary } from "../lib/ipc";
import * as log from "../lib/log";

/** What the archive should carry, as the segmented control offers it. */
type Wanted = "assets" | "psds" | "both";

const WANTED: Array<{ value: Wanted; label: string; hint: string }> = [
  {
    value: "assets",
    label: "Assets",
    hint:
      "What the pipeline made: each file's data.json and the sprites and " +
      "tiles beside it. This is what another engine can read.",
  },
  {
    value: "psds",
    label: "PSDs",
    hint:
      "The source files, as Photoshop would open them — layers, the anchor " +
      "mark and the grid the artwork was drawn over.",
  },
  {
    value: "both",
    label: "Both",
    hint: "The source files and what the pipeline made from them, side by side.",
  },
];

export function openExportAssets(projectId: string, projectName: string): void {
  const sheet = openSheet({
    title: "Export Assets",
    subtitle: "Pick the PSDs, and what of them",
    width: 620,
  });

  const stem = projectName.replace(/[^\w-]+/g, "-").toLowerCase() || "idlewild";
  const chosen = new Set<string>();
  let wanted: Wanted = "both";

  const list = h("div", { class: "sheet-list scroll psd-picker" });
  const tally = h("div", { class: "sheet-row-key m" });
  const exportButton = h("button", {
    class: "btn btn-primary",
    text: "Export",
    onClick: () => void run(),
  }) as HTMLButtonElement;

  const refresh = () => {
    const n = chosen.size;
    tally.textContent = `${n} of ${files.length} selected`;
    exportButton.disabled = n === 0;
  };

  let files: PsdSummary[] = [];

  const run = async () => {
    // Read before the sheet closes: closing it drops the checkboxes, and the
    // dialog that follows is a round trip through the OS.
    const keys = [...chosen];
    const want = wanted;
    sheet.close();
    try {
      const path = await saveFileDialog({
        defaultPath: `${stem}-assets.zip`,
        filters: [{ name: "Zip archive", extensions: ["zip"] }],
      });
      if (!path) return;
      await publish.assets(
        projectId,
        path,
        keys,
        want !== "psds",
        want !== "assets",
      );
      log.info(
        `Exported ${keys.length} ${keys.length === 1 ? "PSD" : "PSDs"} ` +
          `(${want === "both" ? "assets and sources" : want}) → ${path}`,
      );
    } catch (err) {
      log.error("Export Assets failed:", err);
    }
  };

  // Which files. Built before the segmented control below it, because it is
  // the answer somebody came here to give.
  sheet.body.append(
    h(
      "div",
      { class: "sheet-row" },
      h("div", { class: "sheet-row-key m", text: "Files" }),
      h(
        "div",
        { class: "sheet-row-value picker-actions" },
        h("button", {
          class: "panel-btn",
          text: "All",
          onClick: () => setAll(true),
        }),
        h("button", {
          class: "panel-btn",
          text: "None",
          onClick: () => setAll(false),
        }),
        tally,
      ),
    ),
    list,
    h(
      "div",
      { class: "sheet-row control" },
      h("div", { class: "sheet-row-key m", text: "Export" }),
      h("div", { class: "sheet-row-value" }, segmented()),
    ),
  );

  sheet.actions.append(
    exportButton,
    h("button", { class: "btn btn-ghost", text: "Cancel", onClick: sheet.close }),
  );

  const boxes = new Map<string, HTMLInputElement>();

  function setAll(on: boolean): void {
    for (const [key, box] of boxes) {
      box.checked = on;
      if (on) chosen.add(key);
      else chosen.delete(key);
    }
    refresh();
  }

  /**
   * The three answers to "what of them", as one control.
   *
   * A segmented row rather than two checkboxes: the three states are the ones
   * anybody wants, and two boxes would let somebody tick neither — an export
   * with nothing in it, refused at the far end of a save dialog.
   */
  function segmented(): HTMLElement {
    const hint = h("div", { class: "check-hint" });
    const seg = h("div", { class: "seg" });
    const buttons = WANTED.map((option) =>
      h("button", {
        class: "seg-opt",
        "aria-pressed": String(option.value === wanted),
        text: option.label,
        onClick: () => {
          wanted = option.value;
          for (const [i, button] of buttons.entries()) {
            button.setAttribute(
              "aria-pressed",
              String(WANTED[i].value === wanted),
            );
          }
          hint.textContent = option.hint;
        },
      }),
    );
    seg.append(...buttons);
    hint.textContent = WANTED.find((o) => o.value === wanted)?.hint ?? "";
    return h("div", { class: "seg-stack" }, seg, hint);
  }

  void load();

  async function load(): Promise<void> {
    try {
      files = await publish.listPsds(projectId);
    } catch (err) {
      log.error("Could not read this project's PSDs:", err);
    }

    if (files.length === 0) {
      list.appendChild(
        h("div", {
          class: "sheet-list-hint",
          text: "This project has no PSDs yet. Add an image, or draw one.",
        }),
      );
      refresh();
      return;
    }

    for (const file of files) {
      const box = h("input", {
        type: "checkbox",
        class: "check-box",
      }) as HTMLInputElement;
      box.checked = true;
      chosen.add(file.key);
      box.addEventListener("change", () => {
        if (box.checked) chosen.add(file.key);
        else chosen.delete(file.key);
        refresh();
      });
      boxes.set(file.key, box);

      list.appendChild(
        h(
          "label",
          { class: "psd-pick" },
          box,
          h("span", { class: "psd-pick-name", text: `${file.key}.psd` }),
          h("span", {
            class: "sheet-list-hint m",
            // Size, and the one thing that changes what an export of this row
            // can contain.
            text: file.hasAssets ? size(file.bytes) : `${size(file.bytes)} · not processed`,
          }),
        ),
      );
    }
    refresh();
  }
}

/** A file size a person reads, rather than a number of bytes. */
function size(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}
