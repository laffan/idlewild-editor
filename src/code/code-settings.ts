/**
 * How the code editor behaves, remembered per install.
 *
 * Three answers, and they have one thing in common that decides where they
 * live: none of them is a fact about the *project*. How large the type is,
 * whether a save tidies the file, and whether names are offered as you type
 * are facts about the person and the screen they are looking at — so they are
 * in `localStorage` beside the folded folders rather than in the document,
 * which travels with the project and is read by the exported game.
 *
 * **Read once and handed round**, not read at every use. The panel reads
 * them when it opens the settings sheet and when it builds an editor, and a
 * change is pushed to whatever is already on screen — see
 * `CodeModal.applySettings`. A module that re-read the store on every
 * keystroke would be the same three values parsed a hundred times a minute.
 *
 * Everything here is tolerant of what it finds. A stored value that is
 * missing, the wrong type, or out of range answers the default rather than
 * throwing: this is a preference, and a browser that has been cleared, a
 * private window and a quota error all look the same from here.
 */

const SETTINGS_KEY = "idlewild.code.settings";

/** What the editor's type can be set to, in CSS pixels. */
export const TEXT_SIZE_RANGE = { min: 10, max: 24 } as const;

export interface CodeHints {
  /** The Phaser API, from the same reference the docs panel reads. */
  phaser: boolean;
  /** JavaScript itself: the words in this file, and the browser's globals. */
  js: boolean;
}

export interface CodeSettings {
  /** The editor's type size, in CSS pixels. */
  textSize: number;
  /** Run the file through Prettier on the way to disk. */
  tidyOnSave: boolean;
  hints: CodeHints;
}

/**
 * What the editor does before anybody has said otherwise.
 *
 * **Tidy is off.** It rewrites the whole file, and a setting that silently
 * reformats somebody's code the first time they press ⌘S is a setting that
 * has to be *asked for*. Hints are on, both of them: an empty completion list
 * costs nothing and the whole point of the reference panel beside the editor
 * is that this is somebody learning Phaser.
 */
export const CODE_SETTINGS_DEFAULTS: CodeSettings = {
  textSize: 13,
  tidyOnSave: false,
  hints: { phaser: true, js: true },
};

/**
 * A type size the editor can actually draw, whatever it was handed.
 *
 * A number, or a string of one — the box in the settings sheet reports what
 * has been typed into it. Everything else is *not a size* and answers the
 * default rather than the minimum: `Number(null)` is 0 and `Number("")` is 0,
 * so a store that has lost the value would otherwise come back as the
 * smallest type the editor draws, which looks like a setting somebody changed.
 */
export function clampTextSize(size: unknown): number {
  const text = typeof size === "string" ? size.trim() : "";
  const n =
    typeof size === "number" ? size : text === "" ? Number.NaN : Number(text);
  if (!Number.isFinite(n)) return CODE_SETTINGS_DEFAULTS.textSize;
  return Math.min(TEXT_SIZE_RANGE.max, Math.max(TEXT_SIZE_RANGE.min, Math.round(n)));
}

/** Whatever is stored, read as settings — see the note at the top. */
export function readCodeSettings(): CodeSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    return codeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...CODE_SETTINGS_DEFAULTS, hints: { ...CODE_SETTINGS_DEFAULTS.hints } };
  }
}

/**
 * The same reading, of a value that has already been parsed.
 *
 * Its own function because it is the half worth testing: what comes back from
 * a store nobody can predict the contents of.
 */
export function codeSettings(stored: unknown): CodeSettings {
  const held = (stored ?? {}) as Partial<CodeSettings>;
  const hints = (held.hints ?? {}) as Partial<CodeHints>;
  return {
    textSize: clampTextSize(held.textSize ?? CODE_SETTINGS_DEFAULTS.textSize),
    tidyOnSave:
      typeof held.tidyOnSave === "boolean"
        ? held.tidyOnSave
        : CODE_SETTINGS_DEFAULTS.tidyOnSave,
    hints: {
      phaser:
        typeof hints.phaser === "boolean"
          ? hints.phaser
          : CODE_SETTINGS_DEFAULTS.hints.phaser,
      js: typeof hints.js === "boolean" ? hints.js : CODE_SETTINGS_DEFAULTS.hints.js,
    },
  };
}

export function writeCodeSettings(settings: CodeSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing, or a quota. It still holds for this session.
  }
}
