/**
 * What Play runs: the project's own program, over the project's own files.
 *
 * Play used to be a mode of the editor's scene — a character added to the
 * canvas, driven by `game/play-controller.ts`. That made Play something the
 * editor performed *about* the document rather than something the project
 * did, and the code modal's `WorldScene.js` never ran at all: a `console.log`
 * saved into it went nowhere, which is exactly what it looked like. It also
 * meant two implementations of the same game — one in TypeScript for the
 * editor, one in JavaScript for the export — kept in step by hand.
 *
 * So Play loads `game/index.html` from the asset server into a frame over the
 * canvas. The server fills in the two things an export has and a project in
 * the store does not (`lib/` and `assets/`, see `file_server.rs`), so this is
 * the published game, running now, against the document as it stands. What
 * plays and what publishes cannot drift, because they are one program.
 *
 * The frame is a different origin, so its console is forwarded rather than
 * read — `templates/play/console-bridge.js`, injected only for the request
 * this makes. It arrives already flattened: each argument as a value the
 * drawer can open, and the file and line the call was written on.
 */

import { h } from "../lib/dom";
import { assetBase } from "../lib/ipc";
import * as log from "../lib/log";
import type { LogValue } from "../lib/log-value";
import { currentArtboards, isPrint, onPageChange } from "../lib/print";
import type { ProjectMeta } from "../lib/types";
import { isPrintPage, PrintExport } from "./print-export";

/** What the injected bridge posts, and nothing else is listened to. */
const CONSOLE_MESSAGE = "idlewild-game-console";

export class GameFrame {
  readonly root: HTMLElement;
  private readonly projectId: string;
  private frame: HTMLIFrameElement | null = null;
  private base: string | null = null;
  private running = false;
  /**
   * A print project's preview pane — see `print-export.ts`. It lives in this
   * frame's root because it is about the game in it: every page it shows came
   * out of that game.
   */
  private readonly exporter: PrintExport | null;
  /** Stops listening for changes to the sheet. */
  private readonly stopListening: () => void = () => {};
  private restartTimer = 0;
  /**
   * Flushes the document before a Run, so the config the game reads is the
   * canvas as it stands. Set by the mode switch, which holds the store.
   */
  beforeRun: () => Promise<void> = async () => {};
  /** Told whenever the game starts or stops — the code bar's Run button. */
  onRunningChange: ((running: boolean) => void) | null = null;

  constructor(meta: ProjectMeta) {
    this.projectId = meta.id;
    this.root = h("div", { class: "game-frame hidden" });
    this.exporter = isPrint(meta)
      ? new PrintExport(meta, {
          post: (message) => this.frame?.contentWindow?.postMessage(message, "*"),
          base: () => this.base,
          running: () => this.running,
        })
      : null;
    if (this.exporter) {
      // The preview is all a print project's Output shows: the game runs
      // underneath it, full size and covered, because a frame that is hidden
      // or off screen is one the browser stops drawing — and a game that is
      // not drawn never reaches the end of a frame to print.
      this.root.classList.add("printing");
      this.root.append(this.exporter.root);
      // A new sheet is a new game: Page Setup or the frame dragged on the
      // canvas restarts a running Output on it. Coalesced, because a size
      // typed a digit at a time is several changes in a second.
      // Only a change to the artboards — a size, a corner, a name — and not
      // one to what a page is written as, which the game never reads.
      let sheet = JSON.stringify(currentArtboards());
      this.stopListening = onPageChange(() => {
        const now = JSON.stringify(currentArtboards());
        if (now === sheet) return;
        sheet = now;
        if (!this.running) return;
        window.clearTimeout(this.restartTimer);
        this.restartTimer = window.setTimeout(() => void this.restart(), 350);
      });
    }
    window.addEventListener("message", this.onMessage);
  }

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Whether this is a print project's frame: the game beside the preview,
   * started by Run and never restarted on its own.
   */
  get isPrint(): boolean {
    return this.exporter !== null;
  }

  /** A print project's preview as a thumbnail, or empty — see `PrintExport`. */
  thumbnailPng(): Promise<string> {
    return this.exporter?.thumbnailPng() ?? Promise.resolve("");
  }

  /** Put the frame up without starting the game. */
  show(): void {
    this.root.classList.remove("hidden");
  }

  /** Run's half: flush, then start. A print project's way to start. */
  async run(): Promise<void> {
    await this.beforeRun();
    this.show();
    await this.start();
  }

  /**
   * Stop's half: the game comes down and the frame stays up, so the last page
   * printed stays in the preview.
   */
  halt(): void {
    const was = this.running;
    this.running = false;
    window.clearTimeout(this.restartTimer);
    this.frame?.remove();
    this.frame = null;
    this.exporter?.stopped();
    if (was) this.onRunningChange?.(false);
  }

  /** Restart's half: the same game from the top, against what is on disk. */
  async restart(): Promise<void> {
    window.clearTimeout(this.restartTimer);
    await this.beforeRun();
    if (!this.running) return this.run();
    this.frame?.remove();
    this.frame = null;
    this.mount();
  }

  /**
   * Start the project's game.
   *
   * The caller flushes the document first: the config the game reads is
   * rewritten on every save, so a Play that did not wait would run against
   * whatever the last debounce happened to have written.
   */
  async start(): Promise<void> {
    this.running = true;
    this.onRunningChange?.(true);
    this.root.classList.remove("hidden");
    try {
      this.base ??= await assetBase(this.projectId);
    } catch (err) {
      log.error("Could not reach the asset server to play this project:", err);
      return;
    }
    this.mount();
  }

  stop(): void {
    const was = this.running;
    this.running = false;
    this.root.classList.add("hidden");
    // Torn down rather than hidden: a hidden game keeps stepping, holds a
    // WebGL context beside the editor's own, and goes on logging into a
    // drawer whose owner has gone back to editing.
    window.clearTimeout(this.restartTimer);
    this.frame?.remove();
    this.frame = null;
    this.exporter?.stopped();
    if (was) this.onRunningChange?.(false);
  }

  /**
   * Run what is on disk now. Saving a file while the game is up calls this,
   * which is what "saving applies it" means for code: the program restarts
   * against the file you just wrote.
   */
  reload(): boolean {
    // A print project runs when Run is pressed and not otherwise: a page can
    // be seconds of work at full resolution, or a loop writing a hundred
    // files, and a save that set that off again would be a save nobody
    // could afford to make.
    if (!this.running || this.exporter) return false;
    this.frame?.remove();
    this.frame = null;
    this.mount();
    return true;
  }

  destroy(): void {
    this.stopListening();
    window.removeEventListener("message", this.onMessage);
    this.stop();
    this.root.remove();
  }

  private mount(): void {
    if (!this.base) return;
    // Idempotent: Play is a button that can be pressed twice, and a second
    // frame appended over the first would be a second game running unseen
    // under the one you can see.
    this.frame?.remove();
    // A fresh document each time, and a token the server's `no-store` does
    // not have to be trusted for. `idlewild=console` is what asks for the
    // bridge; without it the page served here is byte-for-byte the published
    // one.
    const url = `${this.base}/game/index.html?idlewild=console&t=${Date.now()}`;
    // A fresh game has printed nothing yet.
    this.exporter?.waiting();
    const frame = h("iframe", {
      class: "game-frame-view",
      src: url,
      title: "Play",
      // The keyboard has to land inside the game the moment it is up: the
      // editor's own shortcuts read `document`, so an unfocused frame means
      // the arrow keys pan the editor's camera under a game that never moves.
      onLoad: () => frame.contentWindow?.focus(),
    });
    this.frame = frame;
    this.root.appendChild(frame);
  }

  /**
   * A line from the running game.
   *
   * Filtered by shape rather than by origin: the frame's origin is the asset
   * server's loopback port, which this window would have to ask Rust for
   * again to compare against, and the only thing accepted is a message whose
   * `source` is the bridge's and whose arguments are values of the shape
   * `log-value.ts` describes.
   */
  private readonly onMessage = (event: MessageEvent): void => {
    // A page from `ExportForPrint()` — only from the game this frame started.
    if (this.exporter && isPrintPage(event.data)) {
      if (event.source !== this.frame?.contentWindow) return;
      this.exporter.receive(event.data);
      return;
    }
    const data = event.data as
      | { source?: string; level?: string; args?: unknown; site?: unknown }
      | null;
    if (!data || data.source !== CONSOLE_MESSAGE) return;
    if (!Array.isArray(data.args)) return;

    const args = (data.args as unknown[])
      .filter(log.isLogValue)
      // A top-level string goes back to being a plain one, because the first
      // argument of a call is a *format string* when it has directives in it
      // — and Phaser's boot banner is exactly that. Wrapped, it would print
      // its own CSS.
      .map((value) => (value.t === "string" ? value.v : (value as LogValue)));

    const level = readLevel(data.level);
    log.logFrom({ source: "js", ...(readSite(data.site) ?? {}) }, level, ...args);
    // On a print project an error before the page is captured is the reason
    // there is no page, and the preview says so rather than waiting.
    if (level === "error" && this.exporter) {
      // The first lines are the message and where it was thrown; the rest of
      // a stack is the console's to show.
      const text = args.map(plainText).join(" ").split("\n").slice(0, 4).join("\n");
      this.exporter.gameError(text);
    }
  };
}

/** A console argument as a line of text, for the preview's error. */
function plainText(value: unknown): string {
  if (typeof value === "string") return value;
  const v = value as { t?: string; v?: unknown; name?: string; message?: string };
  if (v && typeof v === "object") {
    if (typeof v.v === "string") return v.v;
    if (typeof v.message === "string") return v.message;
    if (typeof v.name === "string") return v.name;
  }
  return "";
}

function readLevel(raw: unknown): log.LogLevel {
  return raw === "warn" || raw === "error" || raw === "info" ? raw : "log";
}

/**
 * Where the bridge says the call was written, if it says anything usable.
 *
 * Checked rather than trusted: this arrives over `postMessage`, and the path
 * is about to be handed to the code modal to open. A path that climbs out of
 * `game/` is not a file the modal has any business showing.
 */
function readSite(raw: unknown): { site: log.LogSite } | null {
  if (!raw || typeof raw !== "object") return null;
  const { path, line, column } = raw as Record<string, unknown>;
  if (typeof path !== "string" || !path || path.includes("..")) return null;
  if (typeof line !== "number" || !Number.isFinite(line) || line < 1) return null;
  return {
    site: {
      path,
      line: Math.floor(line),
      ...(typeof column === "number" && Number.isFinite(column)
        ? { column: Math.floor(column) }
        : {}),
    },
  };
}
