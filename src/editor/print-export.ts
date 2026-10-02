/**
 * A print project's Output: the pages its own code has printed.
 *
 * A print project has two sections, Draw and **Output**. Output is the code
 * panel and, over the canvas, this pane and nothing else beside it — the game
 * runs underneath it, covered, and what is shown is what it printed. The game
 * starts as Output opens, and from then on only when Run or Restart in the
 * code bar says so: it does not restart on a save, because a print can be
 * seconds of work at full resolution, or a loop writing a hundred files. A new
 * sheet — a size picked in Page Setup, the frame dragged on the canvas — does
 * restart it, because the page it was printing is not the page any more.
 *
 * Each `ExportForPrint(options)` the game calls arrives here as a page (see
 * `templates/print/js/shared/print.js`), and Rust writes it from the
 * full-resolution files under `print/` as a PDF (`print_pdf.rs`), a layered
 * PSD at the project's DPI (`print_psd.rs`) or a PNG at that DPI
 * (`print_png.rs`) — whichever the call names, or the bar's — into
 * `exports/<folder>/<name>`. Pages are written one at a time in the order
 * they came, and the game is told when each is done, which is what settles
 * the promise the call returned.
 *
 * The bar across the top of the pane:
 *
 * - **PDF · PSD · PNG**: what a page is written as when the call does not
 *   say. Stored on the project. Changed after a page has arrived, that page is
 *   written in the new format too, because the game is holding it and a
 *   generative piece would not draw it again.
 * - **Export now**: asks the game for the page, the way a line of code does,
 *   so a project that never calls it still prints.
 * - **Save**: the last page's file, through the platform's save dialog — one
 *   button per format it was written in. **Save all** is every file this run
 *   wrote, as one zip.
 *
 * The preview is the real file wherever a webview can show one: the PDF in a
 * frame, the PNG as itself. A PSD cannot be shown that way, so a PSD page
 * previews the flattened image Rust composited into it.
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
import { changePage } from "./print-page";
import { saveAs } from "../lib/save-as";
import type { ProjectMeta } from "../lib/types";

/** What `print.js` posts with a page, what asks it for one, and the answer. */
export const PAGE_MESSAGE = "idlewild-print";
export const REQUEST_MESSAGE = "idlewild-print-request";
export const DONE_MESSAGE = "idlewild-print-done";

export interface PrintExportHost {
  /** Send a message into the running game, if one is running. */
  post: (message: unknown) => void;
  /** Where the project is served from: `http://127.0.0.1:<port>/<id>`. */
  base: () => string | null;
}

type Format = PrintFormat;
const ORDER: Format[] = ["pdf", "psd", "png"];

/** A page and what has been written from it. */
interface Printed {
  page: PrintPage;
  files: Partial<Record<Format, PrintResult>>;
}

export class PrintExport {
  /** The pane: the bar, and the preview under it. */
  readonly root: HTMLElement;
  private readonly meta: ProjectMeta;
  private readonly host: PrintExportHost;
  private readonly status: HTMLElement;
  private readonly saveButtons: Record<Format, HTMLButtonElement>;
  private readonly saveAll: HTMLButtonElement;
  private readonly nowButton: HTMLButtonElement;
  private readonly body: HTMLElement;
  private readonly empty: HTMLElement;
  private view: HTMLElement | null = null;
  /** The last page, kept so a change of format can write it again. */
  private last: Printed | null = null;
  /** Every file this run wrote, for Save all. */
  private runFiles: string[] = [];
  /** Pages are written one after another, in the order they arrived. */
  private queue: Promise<void> = Promise.resolve();
  /** Bumped by every start and stop, so a write in flight knows it is stale. */
  private run = 0;

  constructor(meta: ProjectMeta, host: PrintExportHost) {
    this.meta = meta;
    this.host = host;
    this.status = h("span", { class: "print-export-status" });
    this.nowButton = h("button", {
      class: "btn btn-ghost",
      text: "Export now",
      title: "Print the page as it stands, as ExportForPrint() would",
      onClick: () => this.host.post({ source: REQUEST_MESSAGE }),
    }) as HTMLButtonElement;
    const save = (format: Format) =>
      h("button", {
        class: "btn btn-primary",
        text: `Save ${format.toUpperCase()}`,
        hidden: "",
        onClick: () => void this.saveOne(format),
      }) as HTMLButtonElement;
    this.saveButtons = { pdf: save("pdf"), psd: save("psd"), png: save("png") };
    this.saveAll = h("button", {
      class: "btn btn-ghost",
      hidden: "",
      title: "Every file this run wrote, as one zip",
      onClick: () => void this.saveEverything(),
    }) as HTMLButtonElement;

    const formats = optionSegmented(
      FORMATS.map((row) => ({ value: row.value, label: row.label })),
      projectOutput(meta).formats,
      (value) => void this.setFormats(value as PrintFormat),
    );
    formats.root.classList.add("print-export-formats");
    formats.root.title = "What a page is written as, when the code does not say";

    const bar = h(
      "div",
      { class: "print-export-bar" },
      this.status,
      h(
        "div",
        { class: "print-export-actions" },
        formats.root,
        this.nowButton,
        this.saveAll,
        this.saveButtons.pdf,
        this.saveButtons.psd,
        this.saveButtons.png,
      ),
    );
    this.empty = h("div", { class: "print-export-empty" });
    this.body = h("div", { class: "print-export-body" }, this.empty);
    this.root = h("div", { class: "print-export-pane" }, bar, this.body);
    this.stopped();
  }

  /** What the sheet is, the way the status line says it. */
  private sheet(): string {
    const output = projectOutput(this.meta);
    return `${describePage(output)} · ${dpiOf(output)} DPI`;
  }

  /**
   * The game has stopped. The last page stays in the preview — it is the
   * thing just made — and only the status says the code is no longer running.
   */
  stopped(): void {
    this.run += 1;
    this.nowButton.disabled = true;
    if (this.last) {
      this.show();
      this.status.textContent = `Stopped · ${this.status.textContent}`;
      return;
    }
    this.reset();
    this.status.textContent = `Stopped · ${this.sheet()}`;
    this.empty.textContent =
      "Press Run in the code bar to start your code. Each page it prints " +
      "with ExportForPrint() appears here.";
  }

  /** The game has (re)started: nothing printed yet. */
  waiting(): void {
    this.reset();
    this.nowButton.disabled = false;
    this.status.textContent = `Running · waiting for ExportForPrint() · ${this.sheet()}`;
    this.empty.textContent =
      "The page appears here when the code calls ExportForPrint(), or when " +
      "you press Export now.";
  }

  private reset(): void {
    this.run += 1;
    this.last = null;
    this.runFiles = [];
    this.view?.remove();
    this.view = null;
    this.empty.hidden = false;
    this.syncSaves();
  }

  /**
   * A page arrived from the running game. Written after any still being
   * written, and answered — `reply` posts back into the game — once its
   * files are on disk, or once they could not be.
   */
  receive(page: PrintPage): void {
    const run = this.run;
    this.queue = this.queue.then(async () => {
      if (run !== this.run) return;
      const wanted = writes(projectOutput(this.meta), page.formats);
      const printed: Printed = { page, files: {} };
      let error: string | null = null;
      try {
        for (const format of wanted) await this.write(printed, format, run);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        log.error("Could not write the page:", err);
        this.status.textContent = "Could not write the page";
      }
      if (run !== this.run) return;
      this.host.post({
        source: DONE_MESSAGE,
        id: page.id,
        files: Object.values(printed.files).map((file) => file!.path),
        ...(error ? { error } : {}),
      });
      if (!error) {
        this.last = printed;
        this.show();
      }
    });
  }

  private async write(printed: Printed, format: Format, run: number): Promise<void> {
    const name = printed.page.out ?? "page";
    this.status.textContent = {
      pdf: `Drawing ${name}.pdf from the full-resolution files…`,
      psd: `Layering ${name}.psd at full resolution…`,
      png: `Rendering ${name}.png at full resolution…`,
    }[format];
    const result =
      format === "pdf"
        ? await printing.exportPdf(this.meta.id, printed.page)
        : format === "psd"
          ? await printing.exportPsd(this.meta.id, printed.page)
          : await printing.exportPng(this.meta.id, printed.page);
    if (run !== this.run) return;
    printed.files[format] = result;
    if (!this.runFiles.includes(result.path)) this.runFiles.push(result.path);
    report(result);
  }

  /** Put the best preview of the last page up, and say what was written. */
  private show(): void {
    this.syncSaves();
    const base = this.host.base();
    const last = this.last;
    // The format the bar says, if the page has it; otherwise whatever it has.
    const preferred = projectOutput(this.meta).formats;
    const format = last?.files[preferred]
      ? preferred
      : ORDER.find((f) => last?.files[f]);
    const shown = format ? last?.files[format] : undefined;
    if (!base || !last || !shown || !format) return;

    this.view?.remove();
    const file = format === "pdf" ? shown.path : (shown.preview ?? shown.path);
    const src = `${base}/${file}?t=${Date.now()}`;
    this.view =
      format === "pdf"
        ? h("iframe", { class: "print-export-view", title: "PDF preview", src })
        : h("img", { class: "print-export-image", alt: "The printed page", src });
    this.empty.hidden = true;
    this.body.appendChild(this.view);

    const inches = (pt: number) => Math.round((pt / 72) * 100) / 100;
    const names = Object.values(last.files).map((file) => {
      const at = file!.path.lastIndexOf("/");
      return `${file!.path.slice(at + 1)} ${megabytes(file!.bytes)}`;
    });
    const count = this.runFiles.length;
    this.status.textContent =
      `${names.join(" · ")} · ${inches(shown.width)} × ${inches(shown.height)} in ` +
      `at ${shown.dpi} DPI` +
      (count > names.length ? ` · ${count} files this run` : "");
  }

  /** A Save for each file the last page has, and Save all past one page. */
  private syncSaves(): void {
    for (const format of ORDER) {
      this.saveButtons[format].hidden = !this.last?.files[format];
    }
    const lastCount = Object.keys(this.last?.files ?? {}).length;
    this.saveAll.hidden = this.runFiles.length <= lastCount;
    this.saveAll.textContent = `Save all (${this.runFiles.length})`;
  }

  /**
   * Change what a page is written as when the code does not say. Stored on
   * the project, and the last page — if there is one — is written in the new
   * format too, from the page the game is holding.
   */
  private async setFormats(formats: PrintFormat): Promise<void> {
    this.meta.output = { ...projectOutput(this.meta), formats };
    const last = this.last;
    if (last && !last.files[formats]) {
      const run = this.run;
      this.queue = this.queue.then(async () => {
        try {
          await this.write(last, formats, run);
        } catch (err) {
          log.error("Could not write the page:", err);
        }
        if (run === this.run && this.last === last) this.show();
      });
    } else if (last) {
      this.show();
    }
    await changePage({ formats });
  }

  private async saveOne(format: Format): Promise<void> {
    const file = this.last?.files[format];
    if (!file) return;
    await saveAs({
      fileName: file.path.slice(file.path.lastIndexOf("/") + 1),
      filter: {
        name: { pdf: "PDF", psd: "Photoshop document", png: "PNG image" }[format],
        extensions: [format],
      },
      what: `Saved the ${format.toUpperCase()}`,
      write: (path) => printing.saveFile(this.meta.id, file.path, path),
    });
  }

  private async saveEverything(): Promise<void> {
    const files = [...this.runFiles];
    if (files.length === 0) return;
    await saveAs({
      fileName: `${this.meta.name || "pages"} exports.zip`,
      filter: { name: "Zip archive", extensions: ["zip"] },
      what: `Saved ${files.length} files`,
      write: (path) => printing.saveFiles(this.meta.id, files, path),
    });
  }
}

function report(result: PrintResult): void {
  log.info(`ExportForPrint() → ${result.path} (${megabytes(result.bytes)})`);
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
