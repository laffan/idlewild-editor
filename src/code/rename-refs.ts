/**
 * A PSD or a layer renamed in the editor, renamed in the project's code.
 *
 * The code names a PSD by its key and a layer by its path, as string
 * literals, and nothing about the code's shape is assumed beyond that: a
 * literal is rewritten where what is around it says it is one of those names.
 *
 * **A PSD's key** is rewritten where it is
 * - an argument of a psd-to-phaser call, first or second — `this.P2P.place(this,
 *   "tree", …)`, `this.P2P.getTexture(this, "tree", …)`, `P2P.getData("tree")`,
 *   whatever the receiver is called and however the call is split over lines;
 * - the value of a `key:`, which is how `loadMultiple` is handed a list;
 * - the start of a path into its artwork, `"assets/tree/…"`;
 * - the start of a texture psd-to-phaser made from it, `"tree_trunk"`, where
 *   `trunk` is one of the file's own layer names.
 *
 * **A layer's name** is rewritten, segment by segment, where it is
 * - the path argument of a psd-to-phaser call whose key is that PSD's;
 * - the path handed to `.target(…)` or `.remove(…)` on something placed from
 *   that PSD, read relative to the path it was placed at;
 * - the end of a texture key of that PSD's, `"tree_trunk"`.
 *
 * Either name held in a variable first — `const KEY = "tree";` then
 * `this.P2P.place(this, KEY, PATH)` — is followed back to its declaration, so
 * the literal there is rewritten too.
 *
 * A literal anywhere else is left alone, whatever it says: `"tree"` as a scene
 * key, a label or a log line is not the file. Comments are left alone too,
 * and so is a template literal with `${…}` in it, since what it says is not
 * known until it runs.
 */

/** A string literal in some code: where it is, and what is between its quotes. */
interface Literal {
  start: number;
  end: number;
  quote: string;
  value: string;
}

/** Every plain string literal, skipping comments and interpolated templates. */
function literals(text: string): Literal[] {
  const out: Literal[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "/" && next === "/") {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      let interpolated = false;
      while (j < text.length && text[j] !== c) {
        if (text[j] === "\\") j++;
        else if (c === "`" && text[j] === "$" && text[j + 1] === "{") interpolated = true;
        else if (c !== "`" && text[j] === "\n") break;
        j++;
      }
      if (!interpolated && text[j] === c) {
        out.push({ start: i, end: j + 1, quote: c, value: unescape(text.slice(i + 1, j)) });
      }
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

/**
 * What comes before a literal in its statement — back to the last `;`, `{`
 * or `}` — with every other literal in it reduced to `""`, so a comma or a
 * bracket inside one is not read as the call's.
 */
function before(text: string, all: readonly Literal[], at: Literal): string {
  let from = at.start;
  while (from > 0 && !";{}".includes(text[from - 1])) from--;
  let out = "";
  let cursor = from;
  for (const other of all) {
    if (other.end <= from || other.start >= at.start) continue;
    out += text.slice(cursor, other.start) + JSON.stringify(other.value);
    cursor = other.end;
  }
  return out + text.slice(cursor, at.start);
}

/** A literal's first or second argument of a psd-to-phaser call. */
const P2P_ARGUMENT = /P2P(?:\s*\.\s*\w+)+\s*\(\s*(?:[^,()]+,\s*)?$/;
/** The path after a call's key: `P2P.place(this, "key", ` → key, as a literal or a name. */
const P2P_PATH = /P2P(?:\s*\.\s*\w+)+\s*\(\s*[^,()]+,\s*("(?:[^"\\]|\\.)*"|[A-Za-z_$][\w$]*)\s*,\s*$/;
/** `const NAME = ` directly before a literal: a name held for later. */
const HELD = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/;
/** `name.target(` or `name.remove(`, for the name. */
const PLACED_CALL = /\b([A-Za-z_$][\w$]*)\s*\.\s*(?:target|remove)\s*\(\s*$/;
/** `const name = …P2P.place(…, "key", "path"`. */
const PLACED = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[\w$.]*P2P\s*\.\s*place\s*\(\s*[^,()]+,\s*/g;

/** The code with a PSD's key renamed `from` → `to` wherever it means the file. */
export function renameKeyInCode(
  text: string,
  from: string,
  to: string,
  layerNames: readonly string[] = [],
): string {
  if (!from || from === to) return text;
  const all = literals(text);
  const names = new Set(layerNames);
  // Names a psd-to-phaser call is handed as its key.
  const keyNames = new Set<string>();
  for (const match of text.matchAll(/P2P(?:\s*\.\s*\w+)+\s*\(\s*(?:[^,()]+,\s*)?([A-Za-z_$][\w$]*)\s*[,)]/g)) {
    keyNames.add(match[1]);
  }
  return rewrite(text, all, (lit) => {
    const value = lit.value;
    if (value === from) {
      const lead = before(text, all, lit);
      if (P2P_ARGUMENT.test(lead) || /\bkey\s*:\s*$/.test(lead)) return to;
      const held = HELD.exec(lead);
      if (held && keyNames.has(held[1])) return to;
    }
    if (value === `assets/${from}` || value.startsWith(`assets/${from}/`)) {
      return `assets/${to}${value.slice(`assets/${from}`.length)}`;
    }
    if (value.startsWith(`${from}_`) && names.has(value.slice(from.length + 1))) {
      return `${to}_${value.slice(from.length + 1)}`;
    }
    return null;
  });
}

/**
 * The code with layers of PSD `key` renamed, by name, `names` mapping old to
 * new — what the inspector's layer list hands back when it writes the file.
 */
export function renameLayersInCode(
  text: string,
  key: string,
  names: ReadonlyMap<string, string>,
): string {
  if (names.size === 0) return text;
  const all = literals(text);
  const segments = (path: string) =>
    path
      .split("/")
      .map((part) => names.get(part) ?? part)
      .join("/");
  const placedAt = placedPaths(text, all, key);
  // What each `const NAME = "…"` holds, so a key or a path in a name is known.
  const held = new Map<string, Literal>();
  for (const lit of all) {
    const name = HELD.exec(before(text, all, lit))?.[1];
    if (name) held.set(name, lit);
  }
  const keyOf = (arg: string) => (arg.startsWith('"') ? (JSON.parse(arg) as string) : held.get(arg)?.value);
  // Names a psd-to-phaser call of this file is handed as its path.
  const pathNames = new Set<string>();
  for (const match of text.matchAll(
    /P2P(?:\s*\.\s*\w+)+\s*\(\s*[^,()]+,\s*([^,()]+?)\s*,\s*([A-Za-z_$][\w$]*)\s*[,)]/g,
  )) {
    const arg = match[1].trim();
    const literal = all.find((l) => text.slice(l.start, l.end) === arg);
    if ((literal ? literal.value : held.get(arg)?.value) === key) pathNames.add(match[2]);
  }
  return rewrite(text, all, (lit) => {
    const value = lit.value;
    const lead = before(text, all, lit);
    const call = P2P_PATH.exec(lead);
    if (call && keyOf(call[1]) === key) return segments(value);
    const name = HELD.exec(lead)?.[1];
    if (name && pathNames.has(name)) return segments(value);
    const target = PLACED_CALL.exec(lead);
    if (target && placedAt.has(target[1])) {
      const base = placedAt.get(target[1]) ?? "";
      const full = segments(base ? `${base}/${value}` : value);
      const rebased = segments(base);
      return base && full.startsWith(`${rebased}/`) ? full.slice(rebased.length + 1) : full;
    }
    if (value.startsWith(`${key}_`)) {
      const name = value.slice(key.length + 1);
      const renamed = names.get(name);
      if (renamed) return `${key}_${renamed}`;
    }
    return null;
  });
}

/** Every variable placed from `key`, and the path it was placed at. */
function placedPaths(text: string, all: readonly Literal[], key: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of text.matchAll(PLACED)) {
    const at = (match.index ?? 0) + match[0].length;
    const index = all.findIndex((l) => l.start === at);
    const keyLit = all[index];
    const pathLit = all[index + 1];
    if (!keyLit || keyLit.value !== key) continue;
    const between = text.slice(keyLit.end, pathLit?.start ?? keyLit.end);
    out.set(match[1], pathLit && /^\s*,\s*$/.test(between) ? pathLit.value : "");
  }
  return out;
}

/** Each literal `change` answers for, rewritten in its own quotes. */
function rewrite(text: string, all: readonly Literal[], change: (lit: Literal) => string | null): string {
  let out = "";
  let cursor = 0;
  for (const lit of all) {
    const next = change(lit);
    if (next === null || next === lit.value) continue;
    out += text.slice(cursor, lit.start) + lit.quote + escapeFor(next, lit.quote) + lit.quote;
    cursor = lit.end;
  }
  return cursor === 0 ? text : out + text.slice(cursor);
}

function unescape(raw: string): string {
  return raw.replace(/\\(.)/g, (_, c: string) => (c === "n" ? "\n" : c === "t" ? "\t" : c));
}

function escapeFor(value: string, quote: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(new RegExp(quote === "`" ? "`|\\$\\{" : quote, "g"), (m) => `\\${m}`)
    .replace(/\n/g, "\\n");
}
