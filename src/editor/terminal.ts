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
 *
 * A line is drawn from its parts: text runs carry whatever styling a `%c`
 * asked for, and an argument that was an object is a tree you can open
 * (`log-tree.ts`). Where the line came from a file the code modal can open,
 * its level chip is a link to that line — which is what the **LOG** beside a
 * `console.log` in your own `WorldScene.js` is for.
 */

import { listen } from "@tauri-apps/api/event";
import { clear, h, ICONS, icon } from "../lib/dom";
import * as log from "../lib/log";
import { renderValue } from "./log-tree";

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
  /** Take me to the line that wrote this, if anything can. */
  private readonly onOpenSource: ((site: log.LogSite) => void) | null;

  constructor(onOpenSource: ((site: log.LogSite) => void) | null = null) {
    this.onOpenSource = onOpenSource;
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
      for (const part of entry.parts) {
        message.appendChild(
          part.kind === "value"
            ? renderValue(part.value)
            : part.style
              ? h("span", { style: part.style, text: part.text })
              : document.createTextNode(part.text),
        );
      }

      this.body.appendChild(
        h(
          "div",
          { class: `terminal-line ${entry.source}` },
          h("span", { class: "terminal-time", text: entry.t }),
          this.levelChip(entry),
          message,
        ),
      );
    }
    this.body.scrollTop = this.body.scrollHeight;
  }

  /**
   * The level, and where the line was written.
   *
   * A `console.log` in the project's own code knows its file and line, so its
   * chip is the way back to it — the fastest thing in a console is the one
   * that answers "where did this come from". Everything else is a plain
   * label: the editor's own lines have no file to open, and neither does a
   * frame inside the vendored Phaser.
   */
  private levelChip(entry: log.LogEntry): HTMLElement {
    const { site } = entry;
    if (!site || !this.onOpenSource) {
      return h("span", { class: `terminal-level ${entry.level}`, text: entry.level });
    }
    return h("button", {
      class: `terminal-level ${entry.level} linked`,
      type: "button",
      text: entry.level,
      title: `${site.path}:${site.line}`,
      onClick: () => this.onOpenSource?.(site),
    });
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
