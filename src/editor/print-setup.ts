/**
 * Page Setup, on a print project: the sheet of paper, rather than the page a
 * game sits on.
 *
 * A game's Page Setup describes an HTML document — how big the game is in a
 * browser window, where it sits, what is around it. A print project's page is
 * not a layout choice: it is a sheet, one point to the CSS pixel, and the game
 * is exactly that size. So the size, the placement, the margin and the corner
 * radius have nothing left to say, and what takes their place is what a print
 * dialog asks — **which paper**, and **which way round**. What a page is
 * written as — PDF, PSD or both — is asked where pages are made, in the
 * preview pane's bar.
 *
 * The sheet decides where the page falls on the canvas (the solid frame from
 * the origin, see `screen-guide.ts`), how big the game's screen is, and the
 * size of the PDF. It changes nothing that has already been drawn: the world
 * stays where it is, and a smaller sheet simply shows less of it.
 *
 * The **resolution** is reported rather than offered. Every PSD in the project
 * was written at it, and a file made at 300 DPI does not have 600's worth of
 * pixels to give — see `src-tauri/src/print.rs`.
 *
 * Commits as it changes, like every settings sheet here, and restarts a game
 * that is up once the config has been rewritten around the new sheet — the
 * same `onChanged` the game's Page Setup uses.
 */

import { openSheet } from "../lib/sheet";
import { optionGroup, optionRow, optionsPage } from "../lib/options-list";
import { optionSegmented } from "../lib/options-controls";
import { projects } from "../lib/ipc";
import * as log from "../lib/log";
import {
  describePage,
  dpiOf,
  PAPERS,
  projectOutput,
  setOpenProject,
} from "../lib/print";
import type { ProjectMeta } from "../lib/types";
import { h } from "../lib/dom";

export function openPrintSetup(
  meta: ProjectMeta,
  onChanged: () => void = () => {},
): void {
  let output = projectOutput(meta);

  const sheet = openSheet({
    title: "Page Setup",
    subtitle: meta.name,
    width: 620,
  });

  const size = h("span", { class: "option-value", text: describePage(output) });

  const commit = (paper: string, landscape: boolean): void => {
    output = { ...output, paper, landscape };
    size.textContent = describePage(output);
    void projects
      .setPaper(meta.id, paper, landscape)
      .then((written) => {
        meta.output = written.output;
        // The screen guide draws the sheet; it reads this.
        setOpenProject(meta);
        onChanged();
      })
      .catch((err) => log.error("Could not save the paper:", err));
  };

  const paper = optionSegmented(
    PAPERS.map((row) => ({ value: row.id, label: row.label })),
    output.paper,
    (value) => commit(value, output.landscape),
  );
  const orientation = optionSegmented(
    [
      { value: "portrait", label: "Portrait" },
      { value: "landscape", label: "Landscape" },
    ],
    output.landscape ? "landscape" : "portrait",
    (value) => commit(output.paper, value === "landscape"),
  );

  sheet.body.appendChild(
    optionsPage([
      optionGroup({
        title: "Paper",
        note:
          "The sheet the page is printed on. Its top-left corner is the world's " +
          "origin and one point is one world pixel, so the frame on the canvas " +
          "in Draw is this sheet, edge for edge.",
        rows: [
          optionRow({ title: "Size", control: paper.root }),
          optionRow({ title: "Orientation", control: orientation.root }),
          optionRow({ title: "Page", control: size }),
        ],
      }),
      optionGroup({
        title: "Resolution",
        rows: [
          optionRow({
            title: "Print resolution",
            hint:
              "Every PSD in this project is written at this, and the PDF is " +
              "drawn from those files. The canvas and your code use a copy at " +
              "screen resolution. It was chosen when the project was made and " +
              "cannot change: a file made at 300 DPI has no 600's worth of " +
              "pixels to give.",
            value: `${dpiOf(output)} DPI`,
          }),
        ],
      }),
    ]),
  );

  sheet.actions.append(
    h("button", { class: "btn btn-primary", text: "Done", onClick: sheet.close }),
  );
}
