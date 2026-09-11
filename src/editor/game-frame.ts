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

/** What the injected bridge posts, and nothing else is listened to. */
const CONSOLE_MESSAGE = "idlewild-game-console";

export class GameFrame {
  readonly root: HTMLElement;
  private readonly projectId: string;
  private frame: HTMLIFrameElement | null = null;
  private base: string | null = null;
  private running = false;

  constructor(projectId: string) {
    this.projectId = projectId;
    this.root = h("div", { class: "game-frame hidden" });
    window.addEventListener("message", this.onMessage);
  }

  get isRunning(): boolean {
    return this.running;
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
    this.running = false;
    this.root.classList.add("hidden");
    // Torn down rather than hidden: a hidden game keeps stepping, holds a
    // WebGL context beside the editor's own, and goes on logging into a
    // drawer whose owner has gone back to editing.
    this.frame?.remove();
    this.frame = null;
  }

  /**
   * Run what is on disk now. Saving a file while the game is up calls this,
   * which is what "saving applies it" means for code: the program restarts
   * against the file you just wrote.
   */
  reload(): void {
    if (!this.running) return;
    this.frame?.remove();
    this.frame = null;
    this.mount();
  }

  destroy(): void {
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

    log.logFrom(
      { source: "js", ...(readSite(data.site) ?? {}) },
      readLevel(data.level),
      ...args,
    );
  };
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
