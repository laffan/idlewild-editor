/**
 * A console argument, flattened into something that can be stored, posted
 * across an origin, and opened up a level at a time.
 *
 * A browser console hands you the live object and lets you unfold it later.
 * Neither half of that works here. The drawer keeps its last 500 lines, so
 * holding live references would pin every sprite ever logged; and the game
 * play mode runs is a different origin, which can only post — and a
 * structured clone of a Phaser scene throws before it gets anywhere. So a
 * logged value is snapshotted at the moment it is logged, depth-capped and
 * circular-safe, and the tree in the drawer is built from the snapshot.
 *
 * The shape is tagged rather than plain JSON because the tags are the things
 * a console is for: `"5"` is not `5`, a class instance is not an `Object`,
 * and `[Circular]` is not a string that happens to read that way.
 *
 * `templates/play/console-bridge.js` builds the same shape in the frame,
 * where it cannot import this. The two are held to one contract by
 * `__tests__/log-value.test.ts`, which runs both over the same fixtures.
 */

export type LogValue =
  | { t: "string"; v: string }
  /** Held as text: `NaN`, `Infinity` and `-0` do not survive as numbers. */
  | { t: "number"; v: string }
  | { t: "boolean"; v: boolean }
  | { t: "empty"; v: "null" | "undefined" }
  /** Already rendered: a function, a symbol, an error's stack, a DOM node,
   *  `[Circular]`, or the depth cap. Shown as it is, never opened. */
  | { t: "other"; v: string }
  | { t: "object"; label?: string; entries: Array<[string, LogValue]>; more?: number }
  | { t: "array"; label?: string; items: LogValue[]; more?: number };

/** How far in a snapshot goes before it stops describing and starts naming. */
export const MAX_DEPTH = 4;
/** How many keys or items are carried from one object or array. */
export const MAX_ENTRIES = 100;

/**
 * Flatten a live value.
 *
 * `seen` is the chain of ancestors rather than everything visited, so a value
 * that appears twice side by side is shown twice — only a genuine cycle is
 * cut. A `Set` of everything visited would report the same sprite in two
 * layers as `[Circular]`, which is a lie about the data.
 */
export function snapshot(value: unknown, depth = 0, seen: unknown[] = []): LogValue {
  if (typeof value === "string") return { t: "string", v: value };
  if (typeof value === "number") return { t: "number", v: numberText(value) };
  if (typeof value === "boolean") return { t: "boolean", v: value };
  if (value === null) return { t: "empty", v: "null" };
  if (value === undefined) return { t: "empty", v: "undefined" };
  if (typeof value === "bigint") return { t: "number", v: `${value}n` };
  if (typeof value === "symbol") return { t: "other", v: value.toString() };
  if (typeof value === "function") {
    return { t: "other", v: `ƒ ${value.name || "anonymous"}()` };
  }
  if (value instanceof Error) {
    return { t: "other", v: value.stack || `${value.name}: ${value.message}` };
  }
  if (typeof Element !== "undefined" && value instanceof Element) {
    return { t: "other", v: `<${value.tagName.toLowerCase()}>` };
  }

  if (seen.includes(value)) return { t: "other", v: "[Circular]" };
  if (depth >= MAX_DEPTH) {
    return { t: "other", v: Array.isArray(value) ? "[Array]" : "[Object]" };
  }

  const chain = [...seen, value];
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ENTRIES)
      .map((item) => snapshot(item, depth + 1, chain));
    const out: LogValue = { t: "array", items };
    if (value.length > MAX_ENTRIES) out.more = value.length - MAX_ENTRIES;
    return out;
  }

  const entries: Array<[string, LogValue]> = [];
  for (const [key, child] of pairs(value).slice(0, MAX_ENTRIES)) {
    try {
      entries.push([key, snapshot(child, depth + 1, chain)]);
    } catch {
      // A getter that throws is a fact about the object, not a failure here.
      entries.push([key, { t: "other", v: "[unreadable]" }]);
    }
  }
  const out: LogValue = { t: "object", entries };
  const label = labelOf(value);
  if (label) out.label = label;
  const total = pairs(value).length;
  if (total > MAX_ENTRIES) out.more = total - MAX_ENTRIES;
  return out;
}

/**
 * The entries of an object-like value.
 *
 * `Map` and `Set` have their contents behind an iterator rather than in own
 * keys, and Phaser is full of both — an object printed as `Map {}` says
 * nothing at all.
 */
function pairs(value: object): Array<[string, unknown]> {
  if (value instanceof Map) {
    return [...value.entries()].map(([k, v]) => [String(k), v]);
  }
  if (value instanceof Set) {
    return [...value.values()].map((v, i) => [String(i), v]);
  }
  return Object.entries(value);
}

/**
 * What to call it. A plain object is not labelled — `Object {…}` on every
 * line is noise — but anything with a class is worth naming, and a `Map` or
 * `Set` has to say how many it holds because its keys were invented here.
 */
function labelOf(value: object): string | undefined {
  if (value instanceof Map) return `Map(${value.size})`;
  if (value instanceof Set) return `Set(${value.size})`;
  const name = value.constructor?.name;
  return name && name !== "Object" ? name : undefined;
}

function numberText(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

/**
 * The one line a collapsed value shows, and the line the drawer searches and
 * copies.
 *
 * `depth` counts *down*: a nested value gets a shorter preview than the thing
 * containing it, so one line stays one line.
 */
export function previewLine(value: LogValue, depth = 2): string {
  switch (value.t) {
    case "string":
      // Quoted, as a console does — inside a structure `1` and `"1"` have to
      // read differently. At the top level `text(…)` unquotes it again.
      return JSON.stringify(value.v);
    case "number":
      return value.v;
    case "boolean":
      return String(value.v);
    case "empty":
      return value.v;
    case "other":
      return value.v;
    case "array": {
      const head = value.label ? `${value.label} ` : "";
      if (value.items.length === 0) return `${head}[]`;
      if (depth <= 0) return `${head}Array(${value.items.length})`;
      const shown = value.items.slice(0, 5).map((v) => previewLine(v, depth - 1));
      if (value.items.length > 5 || value.more) shown.push("…");
      return `${head}[${shown.join(", ")}]`;
    }
    case "object": {
      const head = value.label ? `${value.label} ` : "";
      if (value.entries.length === 0) return `${head}{}`;
      if (depth <= 0) return `${head}{…}`;
      const shown = value.entries
        .slice(0, 5)
        .map(([key, v]) => `${key}: ${previewLine(v, depth - 1)}`);
      if (value.entries.length > 5 || value.more) shown.push("…");
      return `${head}{${shown.join(", ")}}`;
    }
  }
}

/**
 * A value as one line of plain text, the way an argument reads in a log
 * message: a top-level string is itself, not a quoted literal.
 */
export function text(value: LogValue): string {
  return value.t === "string" ? value.v : previewLine(value);
}
