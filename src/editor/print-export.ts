/**
 * The Export section of a print project: the project's own code running on
 * the left, and what it printed on the right.
 *
 * On a game the third section is Play. On a print project it is the same
 * game — the project's `game/` tree, from the asset server, in the same frame
 * — run until it calls `ExportForPrint()`. That call stops everything where
 * it is and sends the page here (see `templates/print/js/shared/print.js`),
 * and Rust writes it from the full-resolution files under `print/`: as a PDF
 * (`print_pdf.rs`), as a layered PSD at the project's DPI (`print_psd.rs`),
 * or both — the **output** chosen on the New Project sheet, in Page Setup, or
 * in this bar. The result is shown beside the frozen game it came from, so
 * the two can be compared at a glance, and Save hands each file over.
 *
 * **Export now** asks the game for the page the way a line of code would, so a
 * project that never calls `ExportForPrint()` — the scaffold leaves the line
 * commented out — still prints. **Run again** restarts the game for another
 * go, which is what a generative piece wants: every run a different page.
 *
 * The preview is the real file wherever a webview can show one: the PDF, in a
 * frame, from the same asset server the game comes from. A PSD cannot be shown
 * that way, so a PSD-only export previews the flattened page Rust composited
 * into it. Changing the output after a page has arrived writes the other
 * format from the same page rather than asking for a new one — the game is
 * frozen on it, and a generative piece would not draw it again.
 */

import { h } from "../lib/dom";
import { optionSegmented } from "../lib/options-controls";
import {
  printing,
  projects,
  type PrintPage,
  type PrintResult,
} from "../lib/ipc";
import * as log from "../lib/log";
import {
  dpiOf,
  FORMATS,
  projectOutput,
  writes,
  type PrintFormats,
} from "../lib/print";
import { saveAs } from "../lib/save-as";
import type { ProjectMeta } from "../lib/types";

/** What `print.js` posts with the page, and what asks it for one. */
export const PAGE_MESSAGE = "idlewild-print";
export const REQUEST_MESSAGE = "idlewild-print-request";

export interface PrintExportHost {
  /** Send a message into the running game, if one is running. */
  post: (message: unknown) => void;
  /** Restart the game. */
  reload: () => void;
  /** Where the project is served from: `http://127.0.0.1:<port>/<id>`. */
  base: () => string | null;
}

type Format = "pdf" | "psd";

export class PrintExport {
  /** The strip across the top, spanning both halves. */
  readonly bar: HTMLElement;
  /** The file, or what is happening instead. */
  readonly preview: HTMLElement;
  private readonly meta: ProjectMeta;
  private readonly host: PrintExportHost;
  private readonly status: HTMLElement;
  private readonly saveButtons: Record<Format, HTMLButtonElement>;
  private readonly nowButton: HTMLButtonElement;
  private readonly empty: HTMLElement;
  private view: HTMLElement | null = null;
  /** The last page the game sent, kept so a change of output can rewrite it. */
  private page: PrintPage | null = null;
  /** What has been written from that page. */
  private written: Partial<Record<Format, PrintResult>> = {};
  private busy = false;

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
        disabled: "",
        onClick: () => void this.save(format),
      }) as HTMLButtonElement;
    this.saveButtons = { pdf: save("pdf"), psd: save("psd") };

    const formats = optionSegmented(
      FORMATS.map((row) => ({ value: row.value, label: row.label })),
      projectOutput(meta).formats,
      (value) => void this.setFormats(value as PrintFormats),
    );
    formats.root.classList.add("print-export-formats");
    formats.root.title = "What Export writes from the page";

    this.bar = h(
      "div",
      { class: "print-export-bar" },
      h("span", { class: "print-export-title", text: "Export" }),
      this.status,
      formats.root,
      h(
        "div",
        { class: "print-export-actions" },
        this.nowButton,
        h("button", {
          class: "btn btn-ghost",
          text: "Run again",
          title: "Restart the project's code for another page",
          onClick: () => this.host.reload(),
        }),
        this.saveButtons.pdf,
        this.saveButtons.psd,
      ),
    );
    this.empty = h("div", { class: "print-export-empty" });
    this.preview = h("div", { class: "print-export-preview" }, this.empty);
    this.waiting();
  }

  /** The game has (re)started: nothing printed yet. */
  waiting(): void {
    this.busy = false;
    this.page = null;
    this.written = {};
    this.view?.remove();
    this.view = null;
    this.nowButton.disabled = false;
    this.syncSaves();
    const output = projectOutput(this.meta);
    this.status.textContent =
      `Running — waiting for ExportForPrint() · ${dpiOf(output)} DPI`;
    this.empty.textContent =
      "The page appears here when the code calls ExportForPrint(), or when " +
      "you press Export now.";
    this.empty.hidden = false;
  }

  /** A page arrived from the running game. */
  async receive(page: PrintPage): Promise<void> {
    if (this.busy || this.page) return;
    this.page = page;
    this.nowButton.disabled = true;
    await this.write();
  }

  /** Write whatever the output asks for that this page has not had yet. */
  private async write(): Promise<void> {
    const page = this.page;
    if (!page || this.busy) return;
    const wanted = writes(projectOutput(this.meta));
    const todo = (["pdf", "psd"] as const).filter(
      (format) => wanted[format] && !this.written[format],
    );
    if (todo.length === 0) {
      this.show();
      return;
    }
    this.busy = true;
    try {
      for (const format of todo) {
        this.status.textContent =
          format === "pdf"
            ? "Drawing the PDF from the full-resolution files…"
            : "Layering the PSD at full resolution…";
        const result =
          format === "pdf"
            ? await printing.exportPdf(this.meta.id, page)
            : await printing.exportPsd(this.meta.id, page);
        // A restart while that was in flight: the page is not this game's.
        if (this.page !== page) return;
        this.written[format] = result;
        this.report(format, result);
      }
    } catch (err) {
      this.status.textContent = "Could not write the page";
      log.error("Could not write the page:", err);
    } finally {
      this.busy = false;
    }
    this.show();
  }

  /** Put the best preview there is up, and say what was written. */
  private show(): void {
    const base = this.host.base();
    const wanted = writes(projectOutput(this.meta));
    const pdf = wanted.pdf ? this.written.pdf : undefined;
    const psd = wanted.psd ? this.written.psd : undefined;
    this.syncSaves();
    const shown = pdf ?? psd;
    if (!base || !shown) return;

    this.view?.remove();
    const src = `${base}/${pdf ? pdf.path : (psd?.preview ?? "")}?t=${Date.now()}`;
    this.view = pdf
      ? h("iframe", { class: "print-export-view", title: "PDF preview", src })
      : h("img", { class: "print-export-image", alt: "The page, as the PSD flattens", src });
    this.empty.hidden = true;
    this.preview.appendChild(this.view);

    const inches = (pt: number) => Math.round((pt / 72) * 100) / 100;
    const files = [
      pdf ? `PDF ${megabytes(pdf.bytes)}` : "",
      psd ? `PSD ${megabytes(psd.bytes)}, ${psd.drawn} layers` : "",
    ].filter(Boolean);
    this.status.textContent =
      `${inches(shown.width)} × ${inches(shown.height)} in at ${shown.dpi} DPI · ` +
      `${shown.drawn} item${shown.drawn === 1 ? "" : "s"} · ${files.join(" · ")}`;
  }

  private report(format: Format, result: PrintResult): void {
    log.info(
      `ExportForPrint() → ${result.path} (${result.drawn} ` +
        `${format === "psd" ? "layers" : "items"}, ${megabytes(result.bytes)})`,
    );
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

  /** Show a Save for each format the output asks for, live once written. */
  private syncSaves(): void {
    const wanted = writes(projectOutput(this.meta));
    for (const format of ["pdf", "psd"] as const) {
      const button = this.saveButtons[format];
      button.hidden = !wanted[format];
      button.disabled = !this.written[format];
    }
  }

  /**
   * Change what Export writes. Stored on the project — it is the same setting
   * Page Setup and the New Project sheet show — and, when a page is already in
   * hand, the format it has not had yet is written from it straight away.
   */
  private async setFormats(formats: PrintFormats): Promise<void> {
    const output = projectOutput(this.meta);
    this.meta.output = { ...output, formats };
    this.syncSaves();
    void this.write();
    try {
      const written = await projects.setPaper(
        this.meta.id,
        output.paper,
        output.landscape,
        formats,
      );
      this.meta.output = written.output;
    } catch (err) {
      log.error("Could not save the output:", err);
    }
  }

  private async save(format: Format): Promise<void> {
    await saveAs({
      fileName: `${this.meta.name || "page"}.${format}`,
      filter: {
        name: format === "pdf" ? "PDF" : "Photoshop document",
        extensions: [format],
      },
      what: `Saved the ${format.toUpperCase()}`,
      write: (path) => printing.saveFile(this.meta.id, format, path),
    });
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
