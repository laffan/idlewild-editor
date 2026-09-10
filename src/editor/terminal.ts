/**
 * The console drawer along the bottom. Starts collapsed, as the spec asks.
 *
 * Two sources feed it: the page's own console (wrapped in lib/log.ts) and
 * psd-to-json's progress, which the Rust side emits as `psd-log-line`.
 */

import { listen } from "@tauri-apps/api/event";
import { clear, h, ICONS, icon } from "../lib/dom";
import * as log from "../lib/log";

export class Terminal {
  readonly root: HTMLElement;
  /** The scrolling log region — the console resizer's target. */
  readonly body: HTMLElement;
  private readonly chevron: HTMLElement;
  private open = false;
  private resizeHandle: HTMLElement | null = null;
  private unlistenLog: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    this.chevron = h("span", {}, icon(ICONS.chevronUp, 14, "#9b9797"));
    this.body = h("div", { class: "terminal-body scroll hidden" });

    this.root = h(
      "div",
      { class: "terminal" },
      h(
        "button",
        { class: "terminal-toggle", onClick: () => this.toggle() },
        this.chevron,
        h("span", { class: "m", text: "Console" }),
      ),
      this.body,
    );

    this.unsubscribe = log.subscribe((entries) => {
      if (!this.open) return;
      this.paint(entries);
    });

    void listen<string>("psd-log-line", (event) => {
      // psd-to-json emits multi-line trees; keep them as separate rows.
      for (const line of String(event.payload).split("\n")) {
        if (line.trim()) log.info(line);
      }
    }).then((unlisten) => {
      this.unlistenLog = unlisten;
    });
  }

  /** The drawer's divider sits above the toggle, so it is inserted here. */
  mountResizeHandle(handle: HTMLElement): void {
    this.resizeHandle = handle;
    handle.classList.toggle("collapsed", !this.open);
    this.root.prepend(handle);
  }

  toggle(): void {
    this.open = !this.open;
    this.body.classList.toggle("hidden", !this.open);
    this.resizeHandle?.classList.toggle("collapsed", !this.open);
    clear(this.chevron);
    this.chevron.appendChild(
      icon(this.open ? ICONS.chevronDown : ICONS.chevronUp, 14, "#9b9797"),
    );
    if (this.open) this.paint(log.getEntries());
  }

  private paint(entries: readonly log.LogEntry[]): void {
    clear(this.body);
    for (const entry of entries) {
      const message = h("span", { class: "terminal-message" });
      // Segments carry the styling from any `%c` runs in the original call.
      for (const segment of entry.segments) {
        message.appendChild(
          segment.style
            ? h("span", { style: segment.style, text: segment.text })
            : document.createTextNode(segment.text),
        );
      }

      this.body.appendChild(
        h(
          "div",
          { class: "terminal-line" },
          h("span", { class: "terminal-time", text: entry.t }),
          h("span", { class: `terminal-level ${entry.level}`, text: entry.level }),
          message,
        ),
      );
    }
    this.body.scrollTop = this.body.scrollHeight;
  }

  destroy(): void {
    this.unsubscribe?.();
    this.unlistenLog?.();
  }
}
