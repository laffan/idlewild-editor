/**
 * Names offered as you type: the Phaser API, and JavaScript itself.
 *
 * Two sources, because they answer two different questions and somebody
 * learning this has different appetites for them. **Phaser** is a reference
 * nobody memorises: `this.add.` has sixty members and the difference between
 * `sprite` and `image` is the sort of thing you look up every time. **JS** is
 * the words already in this file and the browser's own globals, which is the
 * completion every editor has and the one most likely to get in the way of
 * somebody typing a word it has never seen. So they are two switches in the
 * settings sheet rather than one — see `code-settings.ts`.
 *
 * Both are *offered*, not forced: `activateOnTyping` is CodeMirror's default
 * and the list closes on Escape. Nothing here ever writes into the document
 * on its own.
 *
 * The Phaser source reads the same `phaser-docs.json` the reference panel
 * does and matches the same prefixes, so what is offered as you type and what
 * the panel shows when the caret lands are the same answer — see
 * `docs/phaser-api.ts`. It is asked for inside a keystroke and has nothing to
 * wait with, so a reference that has not been read yet offers nothing this
 * time, starts the read, and is there by the next.
 */

import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { localCompletionSource, scopeCompletionSource } from "@codemirror/lang-javascript";
import type { Extension } from "@codemirror/state";
import { signature } from "./docs/api-render";
import { loadedApi, phaserApi, PREFIXES } from "./docs/phaser-api";
import type { ApiMember } from "./docs/api-render";
import type { CodeHints } from "./code-settings";

/** The generator's key for the members every game object has. */
const GAME_OBJECT = "gameobject";

/**
 * What one file gets, given what is switched on.
 *
 * JavaScript only, and deliberately: `scopeCompletionSource` offers the
 * browser's globals, which are not what is being written in a stylesheet, and
 * the Phaser reference in `index.html` would be answering a question nobody
 * asked. CodeMirror's HTML and CSS languages bring their own completions with
 * them, and those stay whatever these switches say.
 */
export function hintExtensions(path: string, hints: CodeHints): Extension[] {
  if (!path.endsWith(".js")) return [];
  const sources = [
    hints.phaser ? phaserCompletions : null,
    hints.js ? localCompletionSource : null,
    hints.js ? scopeCompletionSource(globalThis) : null,
  ].filter((source): source is NonNullable<typeof source> => source !== null);
  if (sources.length === 0) return [];
  return [autocompletion({ override: sources })];
}

/**
 * The Phaser reference, as a completion source.
 *
 * What is on the left of the caret decides the section: the longest prefix
 * the text ends with, or the game-object members for a plain `something.`,
 * which is the same fallback `lookupAt` makes when the panel is following the
 * caret. No dot, no answer — a source that offered sixty Phaser methods for
 * the letter `s` at the start of a line would be a source somebody turns off.
 */
export function phaserCompletions(
  context: CompletionContext,
): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const typed = /([\w$.]*\.)([\w$]*)$/.exec(before);
  if (!typed) return null;

  const docs = loadedApi();
  if (!docs) {
    // Nothing this time, everything the next. `load` is idempotent and holds
    // what it read, so a source that is asked on every keystroke reads once.
    void phaserApi.load();
    return null;
  }

  const prefix = hintSection(typed[1], (name) => name in docs);
  const section = docs[prefix];
  if (!section) return null;
  const options = Object.entries(section.members).map(([name, entry]) =>
    completion(prefix, name, entry),
  );
  if (options.length === 0) return null;
  return { from: context.pos - typed[2].length, options, validFor: /^[\w$]*$/ };
}

/**
 * Which section of the reference answers for the text before the caret.
 *
 * The longest prefix the text ends with, since the list is in that order and
 * `this.input.` would otherwise answer for `this.input.keyboard.`. Anything
 * else ending in a dot is some object of the user's, and the members every
 * game object has are the best guess there — the same fallback `lookupAt`
 * makes when the panel is following the caret.
 *
 * `has` rather than the reference itself, so the rule can be read and tested
 * without a megabyte of JSDoc behind it.
 */
export function hintSection(
  before: string,
  has: (prefix: string) => boolean,
): string {
  for (const prefix of PREFIXES) {
    if (before.endsWith(prefix) && has(prefix)) return prefix;
  }
  return GAME_OBJECT;
}

/**
 * One member, as the list shows it.
 *
 * The signature is the `detail` rather than the label, so what is inserted is
 * the name and what is read beside it is what the name takes. The description
 * is JSDoc, which is markdown with fenced code in it — the first sentence of
 * it as plain text is what fits on one line of a completion list, and the
 * panel beside the editor is where the whole of it already is.
 */
function completion(prefix: string, name: string, entry: ApiMember): Completion {
  const shown = prefix === GAME_OBJECT ? "." : prefix;
  return {
    label: name,
    type: entry.params ? "method" : "property",
    // What it takes, with the expression that got here left off: the list is
    // already under the dot that was typed.
    detail: signature(prefix, name, entry).slice(shown.length + name.length),
    info: firstSentence(entry.desc ?? ""),
  };
}

/** The first sentence of a member's JSDoc, as one line of plain text. */
export function firstSentence(desc: string): string {
  const plain = desc.replace(/\s+/g, " ").trim();
  const stop = plain.indexOf(". ");
  const one = stop > 0 ? plain.slice(0, stop + 1) : plain;
  return one.length > 160 ? `${one.slice(0, 157)}…` : one;
}
