/**
 * The console the editor's terminal drawer shows.
 *
 * Phaser Bench forwards `console.*` across a postMessage bridge because its
 * game runs in an iframe. Idlewild's game runs in this same webview, so the
 * bridge collapses into a plain wrap of the console plus a subscribable log.
 *
 * Format directives are interpreted rather than printed. Phaser's own boot
 * banner is a `%c`-styled string with two CSS arguments; joining the raw
 * arguments dumped a wall of `background-image: url("data:image/png;base64…`
 * into the drawer on every launch.
 */

export type LogLevel = "info" | "warn" | "error";

/** A run of text with optional inline CSS, as `%c` produces. */
export interface LogSegment {
  text: string;
  style?: string;
}

export interface LogEntry {
  t: string;
  level: LogLevel;
  segments: LogSegment[];
  /** The whole line as plain text, for copying and searching. */
  message: string;
}

const MAX_ENTRIES = 500;

const entries: LogEntry[] = [];
const listeners = new Set<(entries: LogEntry[]) => void>();

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function log(level: LogLevel, ...args: unknown[]): void {
  const segments = formatArgs(args);
  entries.push({
    t: stamp(),
    level,
    segments,
    message: segments.map((s) => s.text).join(""),
  });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  for (const listener of listeners) listener(entries);
}

export const info = (...args: unknown[]) => log("info", ...args);
export const warn = (...args: unknown[]) => log("warn", ...args);
export const error = (...args: unknown[]) => log("error", ...args);

/**
 * Apply console format directives, the way a browser console would.
 *
 * Only the first argument is a format string, and only when it contains a
 * directive; everything left over is appended space-separated.
 */
export function formatArgs(args: unknown[]): LogSegment[] {
  const [first, ...rest] = args;
  if (typeof first !== "string" || !/%[scdifoOj%]/.test(first)) {
    return [{ text: args.map(stringify).join(" ") }];
  }

  const segments: LogSegment[] = [];
  let style: string | undefined;
  let buffer = "";
  let argIndex = 0;

  const flush = () => {
    if (buffer) segments.push(style ? { text: buffer, style } : { text: buffer });
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
        buffer += typeof value === "string" ? value : stringify(value);
        break;
      default:
        buffer += stringify(value);
        break;
    }
  }

  flush();
  for (const extra of rest.slice(argIndex)) {
    segments.push({ text: ` ${stringify(extra)}` });
  }
  return segments;
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

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
 */
export function captureConsole(): void {
  const levels: Array<[LogLevel, "log" | "info" | "warn" | "error"]> = [
    ["info", "log"],
    ["info", "info"],
    ["warn", "warn"],
    ["error", "error"],
  ];
  for (const [level, method] of levels) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args);
      log(level, ...args);
    };
  }

  window.addEventListener("error", (event) => {
    log("error", event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    log("error", String(event.reason));
  });
}
