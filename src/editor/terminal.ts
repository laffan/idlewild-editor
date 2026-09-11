/**
 * The console drawer along the bottom. Starts collapsed, as the spec asks.
 *
 * Three things feed it: the editor's own commentary, psd-to-json's progress
 * from the Rust side, and the JavaScript console — this page's and that of the
 * frame play mode runs the project's program in. The last of those is what
 * makes a `console.log` in your own `WorldScene.js` show up here, and it is
 * also what fills the drawer with Phaser's boot banner every time Play is
 * pressed. So the header carries two toggles: **App** is the editor talking,
 * **JS** is the console. Either can be turned off, and the choice is
 * remembered; they only appear while the drawer is open, because a filter on
 * something you cannot see is chrome for nothing.
 */

import { listen } from "@tauri-apps/api/event";
import { clear, h, ICONS, icon } from "../lib/dom";
import * as log from "../lib/log";

const STORAGE_KEY = "consoleSources";

export class Terminal {
  readonly root: HTMLElement;
  /** The scrolling log region — the console resizer's target. */
  readonly body: HTMLElement;
  private readonly chevron: HTMLElement;
  private readonly filters: HTMLElement;
  private readonly toggles = new Map<log.LogSource, HTMLButtonElement>();
  private shown = new Set<log.LogSource>(readShown());
  private open = false;
  private resizeHandle: HTMLElement | null = null;
  private unlistenLog: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    this.chevron = h("span", {}, icon(ICONS.chevronUp, 14, "#9b9797"));
    this.body = h("div", { class: "terminal-body scroll hidden" });
    this.filters = h(
      "div",
      { class: "terminal-filters hidden" },
      this.filter("app", "App", "Lines the editor wrote"),
      this.filter("js", "JS", "The JavaScript console, here and in play mode"),
    );

    this.root = h(
      "div",
      { class: "terminal" },
      h(
        "div",
        { class: "terminal-head" },
        h(
          "button",
          { class: "terminal-toggle", onClick: () => this.toggle() },
          this.chevron,
          h("span", { class: "m", text: "Console" }),
        ),
        this.filters,
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

  /** The drawer's divider sits above the header, so it is inserted here. */
  mountResizeHandle(handle: HTMLElement): void {
    this.resizeHandle = handle;
    handle.classList.toggle("collapsed", !this.open);
    this.root.prepend(handle);
  }

  toggle(): void {
    this.open = !this.open;
    this.body.classList.toggle("hidden", !this.open);
    this.filters.classList.toggle("hidden", !this.open);
    this.resizeHandle?.classList.toggle("collapsed", !this.open);
    clear(this.chevron);
    this.chevron.appendChild(
      icon(this.open ? ICONS.chevronDown : ICONS.chevronUp, 14, "#9b9797"),
    );
    if (this.open) this.paint(log.getEntries());
  }

  /** Open it, if it is not already — what an error worth reading asks for. */
  reveal(): void {
    if (!this.open) this.toggle();
  }

  private filter(
    source: log.LogSource,
    label: string,
    title: string,
  ): HTMLButtonElement {
    const button = h("button", {
      class: "terminal-filter",
      type: "button",
      text: label,
      title,
      "aria-pressed": String(this.shown.has(source)),
      onClick: () => this.setShown(source, !this.shown.has(source)),
    });
    this.toggles.set(source, button);
    return button;
  }

  private setShown(source: log.LogSource, shown: boolean): void {
    if (shown) this.shown.add(source);
    else this.shown.delete(source);
    this.toggles.get(source)?.setAttribute("aria-pressed", String(shown));
    writeShown(this.shown);
    this.paint(log.getEntries());
  }

  private paint(entries: readonly log.LogEntry[]): void {
    clear(this.body);
    for (const entry of entries) {
      if (!this.shown.has(entry.source)) continue;
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
          { class: `terminal-line ${entry.source}` },
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

/**
 * Which sources were last left on. Both, for anyone who has never touched
 * the toggles — hiding half the console by default would be a trap.
 */
function readShown(): log.LogSource[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return ["app", "js"];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return ["app", "js"];
    return parsed.filter(
      (value): value is log.LogSource => value === "app" || value === "js",
    );
  } catch {
    return ["app", "js"];
  }
}

function writeShown(shown: Set<log.LogSource>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...shown]));
  } catch {
    // Private browsing, or a quota. The filter still works for this session.
  }
}
