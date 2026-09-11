/**
 * The console the editor's terminal drawer shows.
 *
 * Two things write to it and the drawer lets you see either on its own.
 * **App** is the editor talking about itself — an import finished, a PSD was
 * renamed, a save failed — every `log.info`/`warn`/`error` call in this
 * codebase. **JS** is the JavaScript console: whatever `console.*` is handed,
 * here and in the frame play mode runs the project's own program in, plus
 * uncaught errors and rejected promises from both. That second source is the
 * one you debug your own code with, and it arrives verbatim, which is why it
 * is worth being able to hide the first.
 *
 * A line is a list of **parts**, not a string. An argument that is an object
 * is snapshotted (`log-value.ts`) and kept as a value the drawer can open a
 * level at a time, the way a browser console does; everything else is text,
 * with the styling a `%c` run asked for. Phaser's boot banner is a `%c`
 * string with two CSS arguments — joined naively it dumps a base64
 * `background-image` across the drawer on every launch, so the directives are
 * interpreted and the style filtered down to colour and weight.
 *
 * A JS line can also carry the **site** it was logged from, which is what
 * makes its level chip a link into the code modal. Only the game frame knows
 * its own, because only it is running files the modal can open.
 */

import { snapshot, text, type LogValue } from "./log-value";

/**
 * `log` and `info` are both `console`'s, and browsers show them differently
 * for a reason: `console.log` is what you write while debugging and
 * `console.info` is what a library announces itself with. The editor's own
 * commentary is `info`.
 */
export type LogLevel = "log" | "info" | "warn" | "error";

/** Who said it — the editor, or the JavaScript console. */
export type LogSource = "app" | "js";

/** Where in the project a line was logged from. */
export interface LogSite {
  /** Relative to `game/`, as the code modal names files. */
  path: string;
  line: number;
  column?: number;
}

/** A run of text with optional inline CSS, as `%c` produces. */
export interface LogSegment {
  text: string;
  style?: string;
}

/** One piece of a line: a run of text, or a value you can open. */
export type LogPart =
  | ({ kind: "text" } & LogSegment)
  | { kind: "value"; value: LogValue };

export interface LogEntry {
  t: string;
  level: LogLevel;
  source: LogSource;
  parts: LogPart[];
  /** The whole line as plain text, for copying and searching. */
  message: string;
  /** The file and line it came from, when that is a file we can open. */
  site?: LogSite;
}

/** What a caller may say about a line beyond its level. */
export interface LogOptions {
  source?: LogSource;
  site?: LogSite;
}

const MAX_ENTRIES = 500;

const entries: LogEntry[] = [];
const listeners = new Set<(entries: LogEntry[]) => void>();

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Record a line, saying where it came from and where it was written. */
export function logFrom(
  options: LogOptions,
  level: LogLevel,
  ...args: unknown[]
): void {
  const parts = formatArgs(args);
  entries.push({
    t: stamp(),
    level,
    source: options.source ?? "app",
    parts,
    message: parts.map(plain).join(""),
    ...(options.site ? { site: options.site } : {}),
  });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  for (const listener of listeners) listener(entries);
}

/** The editor talking about itself. */
export function log(level: LogLevel, ...args: unknown[]): void {
  logFrom({ source: "app" }, level, ...args);
}

export const info = (...args: unknown[]) => log("info", ...args);
export const warn = (...args: unknown[]) => log("warn", ...args);
export const error = (...args: unknown[]) => log("error", ...args);

/**
 * Apply console format directives, the way a browser console would.
 *
 * Only the first argument is a format string, and only when it contains a
 * directive; everything left over is appended space-separated. An object
 * among those leftovers becomes a part of its own rather than being flattened
 * into the sentence, because that is the part you want to open.
 */
export function formatArgs(args: unknown[]): LogPart[] {
  const [first, ...rest] = args;
  if (typeof first !== "string" || !/%[scdifoOj%]/.test(first)) {
    return spaced(args);
  }

  const parts: LogPart[] = [];
  let style: string | undefined;
  let buffer = "";
  let argIndex = 0;

  const flush = () => {
    if (buffer) parts.push({ kind: "text", text: buffer, ...(style ? { style } : {}) });
    buffer = "";
  };

  for (let i = 0; i < first.length; i++) {
    if (first[i] !== "%" || i === first.length - 1) {
      buffer += first[i];
      continue;
    }

    const directive = first[i + 1];
    if (directive === "%") {
      buffer += "%";
      i++;
      continue;
    }
    if (!"scdifoOj".includes(directive)) {
      buffer += first[i];
      continue;
    }

    i++;
    const value = rest[argIndex];
    // A directive with no argument left is printed verbatim, as browsers do.
    if (argIndex >= rest.length) {
      buffer += `%${directive}`;
      continue;
    }
    argIndex++;

    switch (directive) {
      case "c":
        flush();
        style = sanitiseStyle(String(value ?? ""));
        break;
      case "d":
      case "i":
        buffer += String(Math.trunc(Number(value)));
        break;
      case "f":
        buffer += String(Number(value));
        break;
      case "s":
        buffer += typeof value === "string" ? value : text(take(value));
        break;
      default:
        // `%o`, `%O` and `%j` are the directives that mean "show me the
        // object", so they are the ones that keep it openable.
        flush();
        parts.push({ kind: "value", value: take(value) });
        break;
    }
  }

  flush();
  // Arguments the format string did not consume, appended the way a browser
  // appends them — after a space, and still openable if they are objects.
  const leftovers = rest.slice(argIndex);
  if (leftovers.length > 0) {
    if (parts.length > 0) parts.push({ kind: "text", text: " " });
    parts.push(...spaced(leftovers));
  }
  return parts;
}

/** Arguments as parts, one space between them. */
function spaced(args: unknown[]): LogPart[] {
  const parts: LogPart[] = [];
  args.forEach((arg, index) => {
    if (index > 0) parts.push({ kind: "text", text: " " });
    const value = take(arg);
    parts.push(
      value.t === "string"
        ? { kind: "text", text: value.v }
        : { kind: "value", value },
    );
  });
  return parts;
}

/**
 * Snapshot an argument, unless it has already been snapshotted somewhere
 * else — the game frame flattens its own before posting them, because it
 * cannot send the objects themselves.
 */
function take(arg: unknown): LogValue {
  return isLogValue(arg) ? arg : snapshot(arg);
}

/** Whether this is already one of ours, rather than something to flatten. */
export function isLogValue(arg: unknown): arg is LogValue {
  if (!arg || typeof arg !== "object") return false;
  const tag = (arg as { t?: unknown }).t;
  return (
    tag === "string" ||
    tag === "number" ||
    tag === "boolean" ||
    tag === "empty" ||
    tag === "other" ||
    tag === "object" ||
    tag === "array"
  );
}

function plain(part: LogPart): string {
  return part.kind === "text" ? part.text : text(part.value);
}

/**
 * Keep the colour and weight of a `%c` run, drop everything else.
 *
 * These strings come from any library that logs a banner. Background images,
 * padding and font sizes wreck the drawer's rhythm, and `url(...)` values are
 * the base64 payloads that made the log unreadable in the first place.
 */
function sanitiseStyle(css: string): string | undefined {
  const allowed = ["color", "font-weight", "font-style", "text-decoration"];
  const kept: string[] = [];
  for (const rule of css.split(";")) {
    const [rawName, ...valueParts] = rule.split(":");
    const name = rawName.trim().toLowerCase();
    const value = valueParts.join(":").trim();
    if (!allowed.includes(name) || !value) continue;
    if (/url\s*\(|expression|javascript:/i.test(value)) continue;
    kept.push(`${name}:${value}`);
  }
  return kept.length > 0 ? kept.join(";") : undefined;
}

export function subscribe(listener: (entries: LogEntry[]) => void): () => void {
  listeners.add(listener);
  listener(entries);
  return () => listeners.delete(listener);
}

export function getEntries(): readonly LogEntry[] {
  return entries;
}

export function clearLog(): void {
  entries.length = 0;
  for (const listener of listeners) listener(entries);
}

/**
 * Mirror the page's console into the drawer, keeping the originals so
 * devtools still work. Called once at boot.
 *
 * Everything this captures is tagged **JS**, because that is literally what
 * it is: the browser console, as the browser would have shown it. The
 * editor's own commentary goes through `info`/`warn`/`error` and never
 * touches `console`, so the two never have to be told apart after the fact.
 *
 * No site travels with these. The frames behind them are this bundle's, and
 * the code modal opens the project's files — a link into a minified chunk
 * would be a link to nowhere.
 */
export function captureConsole(): void {
  const levels: Array<[LogLevel, "log" | "info" | "warn" | "error" | "debug"]> = [
    ["log", "log"],
    ["log", "debug"],
    ["info", "info"],
    ["warn", "warn"],
    ["error", "error"],
  ];
  for (const [level, method] of levels) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      logFrom({ source: "js" }, level, ...args);
    };
  }

  window.addEventListener("error", (event) => {
    logFrom({ source: "js" }, "error", event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    logFrom({ source: "js" }, "error", "Unhandled rejection:", event.reason);
  });
}
