/**
 * A print project's Output: the pages its own code has captured, and the one
 * button that saves them.
 *
 * A print project has two sections, Draw and **Output**. Output is the code
 * panel and, over the canvas, this pane and nothing else — the game runs
 * underneath it, covered, and what is shown is what it captured. The game
 * starts as Output opens and from then on only when Run or Restart in the
 * code bar says so; a new sheet — Page Setup, the frame dragged on the canvas
 * — restarts it too (see `GameFrame`).
 *
 * **A call captures; Save writes.** Each `ExportForPrint(options)` the game
 * calls arrives here as a page (see `templates/print/js/shared/print.js`) and
 * is drawn straight into the preview from the screen-resolution files the game
 * was already using (`print-preview.ts`). Nothing is written then. **Save** —
 * the one button, labelled with what it will write — writes every captured
 * page from the full-resolution files under `print/`, in the format the bar
 * says: a PDF (`print_pdf.rs`), a layered PSD (`print_psd.rs`), or one picture
 * as a PNG or a JPG (`print_png.rs`). One page is saved as that file; several
 * are saved as one zip. And Save does every step: pressed before the code has
 * captured anything, or while a run of snapshots has not ended, it asks the
 * game for the page — the way a line of code would — and saves once it has it.
 *
 * **Snapshots.** A call with `snapshot: true` adds its page and the code
 * carries on; the run ends at the first call without it, which adds the last
 * page and stops the scenes. While there is more than one page a column of
 * thumbnails runs down the right of the pane, and pressing one puts it in the
 * preview.
 *
 * **Before anything arrives** the pane says what is happening rather than
 * what to expect: a bar while the code runs, and an error if it does not get
 * to `ExportForPrint()` — the game threw before it did, or it has been running
 * a while without calling it.
 */

import { h } from "../lib/dom";
import { optionSegmented } from "../lib/options-controls";
import { printing, type PrintPage, type PrintResult } from "../lib/ipc";
import * as log from "../lib/log";
import {
  describePage,
  dpiOf,
  FORMATS,
  projectOutput,
  writes,
  type PrintFormat,
} from "../lib/print";
import { saveAs } from "../lib/save-as";
import type { ProjectMeta } from "../lib/types";
import { changePage } from "./print-page";
import { drawPage, thumbnailOf } from "./print-preview";

/** What `print.js` posts with a page, what asks it for one, and the answer. */
export const PAGE_MESSAGE = "idlewild-print";
export const REQUEST_MESSAGE = "idlewild-print-request";
export const DONE_MESSAGE = "idlewild-print-done";

/** How long code may run before the pane says it has not printed. */
const NOT_YET_MS = 10_000;

export interface PrintExportHost {
  /** Send a message into the running game, if one is running. */
  post: (message: unknown) => void;
  /** Where the project is served from: `http://127.0.0.1:<port>/<id>`. */
  base: () => string | null;
  /** Whether the game is up. */
  running: () => boolean;
}

/** One captured page, and what it is called when it is saved. */
interface Capture {
  page: PrintPage;
  name: string;
  thumb: HTMLElement;
}

/**
 * Where the pane is.
 *
 * - `stopped`: no game running.
 * - `waiting`: running, nothing captured yet.
 * - `collecting`: running, snapshots arriving, the run not ended.
 * - `ready`: the run ended — or was stopped — with pages to save.
 * - `saving`: Save is writing.
 */
type Phase = "stopped" | "waiting" | "collecting" | "ready" | "saving";

const EXTENSIONS: Record<PrintFormat, string> = {
  pdf: "PDF",
  psd: "Photoshop document",
  png: "PNG image",
  jpg: "JPEG image",
};

export class PrintExport {
  /** The pane: the bar, and under it the preview and its thumbnails. */
  readonly root: HTMLElement;
  private readonly meta: ProjectMeta;
  private readonly host: PrintExportHost;
  private readonly status: HTMLElement;
  private readonly saveButton: HTMLButtonElement;
  private readonly formats: ReturnType<typeof optionSegmented>;
  private readonly main: HTMLElement;
  private readonly thumbs: HTMLElement;
  private captures: Capture[] = [];
  private selected = -1;
  private phase: Phase = "stopped";
  /** Save was pressed before there was anything finished to save. */
  private saveWhenReady = false;
  private notYet = 0;
  /** Bumped by every start and stop, so late work knows it is stale. */
  private run = 0;

  constructor(meta: ProjectMeta, host: PrintExportHost) {
    this.meta = meta;
    this.host = host;
    this.status = h("span", { class: "print-export-status" });
    this.saveButton = h("button", {
      class: "btn btn-primary",
      onClick: () => void this.save(),
    }) as HTMLButtonElement;
    this.formats = optionSegmented(
      FORMATS.map((row) => ({ value: row.value, label: row.label })),
      this.format(),
      (value) => this.setFormat(value as PrintFormat),
    );
    this.formats.root.classList.add("print-export-formats");
    this.formats.root.title = "What Save writes";

    const bar = h(
      "div",
      { class: "print-export-bar" },
      this.status,
      h("div", { class: "print-export-actions" }, this.formats.root, this.saveButton),
    );
    this.main = h("div", { class: "print-export-main" });
    this.thumbs = h("div", { class: "print-export-thumbs hidden" });
    this.root = h(
      "div",
      { class: "print-export-pane" },
      bar,
      h("div", { class: "print-export-body" }, this.main, this.thumbs),
    );
    this.stopped();
  }

  // ── what the game does ────────────────────────────────────────────────────

  /** The game has (re)started: a new run, nothing captured. */
  waiting(): void {
    this.reset();
    this.phase = "waiting";
    this.progress("Running your code — waiting for ExportForPrint()");
    this.status.textContent = `Running · ${this.sheet()}`;
    const run = this.run;
    this.notYet = window.setTimeout(() => {
      if (run !== this.run || this.phase !== "waiting" || this.saveWhenReady) return;
      this.error(
        "ExportForPrint() has not fired",
        `Your code has been running for ${NOT_YET_MS / 1000} seconds without ` +
          "calling it. A new print project calls it in its scene once the " +
          "artwork has loaded — check that line in js/scenes/, or press Save " +
          "to print the page as it stands.",
      );
    }, NOT_YET_MS);
    this.sync();
  }

  /**
   * The game has stopped. What it captured stays, ready to save; a run of
   * snapshots it was in the middle of ends where it got to.
   */
  stopped(): void {
    this.run += 1;
    window.clearTimeout(this.notYet);
    this.saveWhenReady = false;
    if (this.captures.length > 0) {
      this.phase = "ready";
      this.status.textContent = `Stopped · ${this.summary()}`;
    } else {
      const wasWaiting = this.phase === "waiting";
      this.phase = "stopped";
      this.status.textContent = `Stopped · ${this.sheet()}`;
      if (wasWaiting) {
        this.error(
          "Stopped before ExportForPrint() fired",
          "Nothing was captured. Press Run in the code bar to start your code again.",
        );
      } else {
        this.notice("Press Run in the code bar to start your code.");
      }
    }
    this.sync();
  }

  /** The game reported an error. Before anything is captured, that is why. */
  gameError(message: string): void {
    if (this.phase !== "waiting") return;
    window.clearTimeout(this.notYet);
    this.error(
      "Your code stopped before ExportForPrint() fired",
      `${message}\n\nThe console has the whole of it. Fix it and press Restart.`,
    );
  }

  /** A page arrived from the running game. */
  receive(page: PrintPage): void {
    if (this.phase === "stopped" || this.phase === "saving") return;
    window.clearTimeout(this.notYet);
    const snapshot = page.snapshot === true;
    const index = this.captures.length;
    const name = this.unique(page.out ?? (snapshot || index > 0 ? `page-${index + 1}` : "page"));
    const capture: Capture = { page, name, thumb: this.thumb(index, name) };
    this.captures.push(capture);
    this.host.post({ source: DONE_MESSAGE, id: page.id, page: index, pages: index + 1 });

    // The format the code asked for is what Save is set to.
    const asked = page.formats?.[0];
    if (asked && asked !== this.format()) this.setFormat(asked);

    this.phase = snapshot ? "collecting" : "ready";
    this.select(index);
    this.status.textContent = snapshot
      ? `Capturing · ${this.captures.length} page${this.captures.length === 1 ? "" : "s"} so far`
      : this.summary();
    this.sync();
    if (!snapshot && this.saveWhenReady) {
      this.saveWhenReady = false;
      void this.write();
    }
  }

  // ── saving ────────────────────────────────────────────────────────────────

  /**
   * Save: every step. With a finished run it writes; otherwise it asks the
   * game for the page first — the last of a run of snapshots, or the only one
   * — and writes once it arrives.
   */
  private async save(): Promise<void> {
    if (this.phase === "saving") return;
    if (this.phase === "ready") {
      await this.write();
      return;
    }
    if (!this.host.running()) return;
    this.saveWhenReady = true;
    this.status.textContent = "Asking your code for the page…";
    if (this.captures.length === 0) this.progress("Capturing the page…");
    this.sync();
    this.host.post({ source: REQUEST_MESSAGE });
  }

  /** Write every captured page in the bar's format, and hand it over. */
  private async write(): Promise<void> {
    const captures = [...this.captures];
    if (captures.length === 0) return;
    const format = this.format();
    const ext = format.toUpperCase();
    const before = this.phase;
    this.phase = "saving";
    this.sync();
    const shown = this.selected;

    const writeAll = async (): Promise<PrintResult[]> => {
      const results: PrintResult[] = [];
      for (const [i, capture] of captures.entries()) {
        this.progress(
          `Writing ${capture.name}.${format} at ${dpiOf(projectOutput(this.meta))} DPI`,
          captures.length > 1 ? i / captures.length : undefined,
        );
        this.status.textContent = `Saving · ${i + 1} of ${captures.length}`;
        const page = { ...capture.page, out: capture.name };
        results.push(await exporter(format)(this.meta.id, page));
      }
      return results;
    };

    try {
      if (captures.length === 1) {
        const capture = captures[0];
        await saveAs({
          fileName: `${capture.name.split("/").pop()}.${format}`,
          filter: { name: EXTENSIONS[format], extensions: [format] },
          what: `Saved the ${ext}`,
          write: async (path) => {
            const [result] = await writeAll();
            report(result);
            await printing.saveFile(this.meta.id, result.path, path);
          },
        });
      } else {
        await saveAs({
          fileName: `${this.meta.name || "pages"} ${ext}.zip`,
          filter: { name: "Zip archive", extensions: ["zip"] },
          what: `Saved ${captures.length} ${ext}s`,
          write: async (path) => {
            const results = await writeAll();
            results.forEach(report);
            await printing.saveFiles(
              this.meta.id,
              results.map((r) => r.path),
              path,
            );
          },
        });
      }
    } catch (err) {
      log.error("Could not save the page:", err);
    }
    this.phase = before === "saving" ? "ready" : before;
    if (this.phase === "stopped") this.phase = "ready";
    this.select(shown);
    this.status.textContent = this.summary();
    this.sync();
  }

  /**
   * The page in the preview, as the home screen's thumbnail — the one
   * selected, framed the way the pane frames it. Empty when nothing has been
   * captured since the project opened.
   */
  async thumbnailPng(): Promise<string> {
    const capture = this.captures[this.selected];
    const base = this.host.base();
    if (!capture || !base) return "";
    const ground = getComputedStyle(this.root).backgroundColor || "#404040";
    return thumbnailOf(capture.page, base, ground);
  }

  // ── what the pane shows ───────────────────────────────────────────────────

  private select(index: number): void {
    const capture = this.captures[index];
    if (!capture) return;
    this.selected = index;
    for (const [i, c] of this.captures.entries()) {
      c.thumb.classList.toggle("selected", i === index);
    }
    const base = this.host.base();
    if (!base) return;
    const run = this.run;
    void drawPage(capture.page, base, 1600).then((canvas) => {
      if (run !== this.run || this.selected !== index || this.phase === "saving") return;
      canvas.classList.add("print-export-page");
      this.main.replaceChildren(canvas);
    });
  }

  /** One page's thumbnail, drawn small, in the column on the right. */
  private thumb(index: number, name: string): HTMLElement {
    const item = h(
      "button",
      {
        class: "print-export-thumb",
        type: "button",
        title: name,
        onClick: () => this.select(index),
      },
      h("span", { class: "print-export-thumb-name", text: name.split("/").pop() ?? name }),
    );
    this.thumbs.appendChild(item);
    const base = this.host.base();
    const page = () => this.captures[index]?.page;
    if (base) {
      queueMicrotask(() => {
        const p = page();
        if (!p) return;
        void drawPage(p, base, 180).then((canvas) => item.prepend(canvas));
      });
    }
    return item;
  }

  /** A bar — determinate when `fraction` is given — and what it is doing. */
  private progress(text: string, fraction?: number): void {
    const fill = h("div", { class: "print-progress-fill" });
    const track = h(
      "div",
      { class: `print-progress-track${fraction === undefined ? " indeterminate" : ""}` },
      fill,
    );
    if (fraction !== undefined) fill.style.width = `${Math.round(fraction * 100)}%`;
    this.main.replaceChildren(
      h("div", { class: "print-progress" }, track, h("p", { text })),
    );
  }

  private error(title: string, text: string): void {
    this.main.replaceChildren(
      h(
        "div",
        { class: "print-export-error", role: "alert" },
        h("strong", { text: title }),
        h("p", { text }),
      ),
    );
  }

  private notice(text: string): void {
    this.main.replaceChildren(h("div", { class: "print-export-empty", text }));
  }

  /** The Save button's label and state, and whether the column shows. */
  private sync(): void {
    const ext = this.format().toUpperCase();
    const n = this.captures.length;
    const button = this.saveButton;
    button.textContent =
      this.phase === "saving"
        ? "Saving…"
        : n > 1
          ? `Save ${n} ${ext}s`
          : `Save ${ext}`;
    const canAsk = this.host.running() && this.phase !== "stopped";
    button.disabled =
      this.phase === "saving" || this.saveWhenReady || !(this.phase === "ready" || canAsk);
    this.thumbs.classList.toggle("hidden", n < 2);
  }

  private reset(): void {
    this.run += 1;
    window.clearTimeout(this.notYet);
    this.captures = [];
    this.selected = -1;
    this.saveWhenReady = false;
    this.thumbs.replaceChildren();
  }

  // ── small things ──────────────────────────────────────────────────────────

  private format(): PrintFormat {
    return writes(projectOutput(this.meta))[0];
  }

  /** Change what Save writes. Stored on the project; the game is not told. */
  private setFormat(format: PrintFormat): void {
    this.meta.output = { ...projectOutput(this.meta), formats: format };
    this.formats.select(format);
    this.sync();
    void changePage({ formats: format });
  }

  /** A name no other captured page has: `frame`, `frame-2`, `frame-3`. */
  private unique(name: string): string {
    const taken = new Set(this.captures.map((c) => c.name));
    if (!taken.has(name)) return name;
    for (let n = 2; ; n++) if (!taken.has(`${name}-${n}`)) return `${name}-${n}`;
  }

  private sheet(): string {
    const output = projectOutput(this.meta);
    return `${describePage(output)} · ${dpiOf(output)} DPI`;
  }

  private summary(): string {
    const n = this.captures.length;
    return `${n} page${n === 1 ? "" : "s"} ready · ${this.sheet()}`;
  }
}

/** The command that writes a page in a format. */
function exporter(format: PrintFormat): (id: string, page: PrintPage) => Promise<PrintResult> {
  return {
    pdf: printing.exportPdf,
    psd: printing.exportPsd,
    png: printing.exportPng,
    jpg: printing.exportJpg,
  }[format];
}

function report(result: PrintResult): void {
  log.info(`Saved ${result.path} (${megabytes(result.bytes)})`);
  if (result.screenOnly.length > 0) {
    log.warn(
      `Printed at screen resolution, with no full-resolution file behind them: ` +
        result.screenOnly.join(", "),
    );
  }
  if (result.skipped > 0) {
    log.warn(`${result.skipped} thing(s) on the page could not be printed.`);
  }
}

function megabytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Whether a message is a page from `print.js`, by shape. The frame is checked
 * by the caller — only the game it started may print.
 */
export function isPrintPage(data: unknown): data is PrintPage & { source: string } {
  if (!data || typeof data !== "object") return false;
  const value = data as Record<string, unknown>;
  return (
    value.source === PAGE_MESSAGE &&
    Array.isArray(value.items) &&
    !!value.page &&
    typeof value.page === "object"
  );
}
