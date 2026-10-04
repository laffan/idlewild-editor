/**
 * Page Setup, on a print project: the sheet of paper, rather than the page a
 * game sits on.
 *
 * A game's Page Setup describes an HTML document — how big the game is in a
 * browser window, where it sits, what is around it. A print project's page is
 * not a layout choice: it is a sheet, one point to the CSS pixel, and the game
 * is exactly that size. So the size, the placement, the margin and the corner
 * radius have nothing left to say, and what takes their place is what a print
 * dialog asks — the **Dimensions**: a standard sheet and which way round, or
 * Custom, a width and a height in inches or centimetres. These are the same
 * rows the New Project sheet shows (`lib/print-dimensions.ts`). What a page is
 * written as — PDF, PSD or PNG — is asked where pages are made, in the Output
 * preview's bar.
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
 * Commits as it changes, like every settings sheet here, through
 * `changePage` — which writes it, moves the frame on the canvas and restarts a
 * running Output on the new sheet once the config has been rewritten around
 * it. Output is never more than one change behind the sheet in front of you.
 */

import { openSheet } from "../lib/sheet";
import { optionGroup, optionRow, optionsPage } from "../lib/options-list";
import { artboardsOf, describePage, dpiOf, projectOutput } from "../lib/print";
import { optionText } from "../lib/options-controls";
import { dimensionRows } from "../lib/print-dimensions";
import type { ProjectMeta } from "../lib/types";
import { h } from "../lib/dom";
import { changePage } from "./print-page";

export function openPrintSetup(meta: ProjectMeta, artboardId?: string): void {
  const output = projectOutput(meta);
  const boards = artboardsOf(output);
  let board = boards.find((b) => b.id === artboardId) ?? boards[0];
  const artboard = board.id;

  const sheet = openSheet({
    title: "Page Setup",
    subtitle: boards.length > 1 ? `${meta.name} · ${board.name}` : meta.name,
    width: 620,
  });

  const size = h("span", { class: "option-value", text: describePage(board) });
  const dimensions = dimensionRows({ ...output, ...board }, (patch) => {
    board = { ...board, ...patch };
    size.textContent = describePage(board);
    void changePage({ ...patch, artboard });
  });
  // Written as it is typed, like every other row here; the name that lands is
  // the one the project keeps, which may have a number on it if another
  // artboard is already called that.
  let renaming = 0;
  const name = optionText(
    board.name,
    (value) => {
      window.clearTimeout(renaming);
      renaming = window.setTimeout(() => {
        if (value.trim()) void changePage({ artboard, name: value });
      }, 300);
    },
    { label: "Artboard name", placeholder: "Artboard 1" },
  );

  sheet.body.appendChild(
    optionsPage([
      optionGroup({
        title: "Artboard",
        note:
          "The sheet the page is printed on. One point is one world pixel, and " +
          "the frame on the canvas in Draw is this sheet, edge for edge — drag " +
          "its label to move it over what you have drawn.",
        rows: [
          optionRow({
            title: "Name",
            hint:
              "What ExportForPrint() calls this artboard's page: with more than " +
              "one artboard, each is saved as the page's name, a dash, and this.",
            control: name,
          }),
          ...dimensions.rows,
          optionRow({ title: "Size", control: size }),
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
