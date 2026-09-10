/**
 * The console the editor's terminal drawer shows.
 *
 * Phaser Bench forwards `console.*` across a postMessage bridge because its
 * game runs in an iframe. Idlewild's game runs in this same webview, so the
 * bridge collapses into a plain wrap of the console plus a subscribable log.
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  t: string;
  level: LogLevel;
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
  const message = args.map(format).join(" ");
  entries.push({ t: stamp(), level, message });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  for (const listener of listeners) listener(entries);
}

export const info = (...args: unknown[]) => log("info", ...args);
export const warn = (...args: unknown[]) => log("warn", ...args);
export const error = (...args: unknown[]) => log("error", ...args);

function format(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
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
