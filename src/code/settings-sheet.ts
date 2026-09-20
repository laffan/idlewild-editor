/**
 * Code Settings: the three answers the editor keeps about itself.
 *
 * A sheet rather than a menu, because two of the three are not a press — a
 * type size is a number to nudge until the code looks right, and a menu that
 * closes on every press is the wrong shape for that. It is the settings
 * vocabulary (`lib/options-list.ts`), so it reads like Page Setup and the
 * Logins sheet rather than like a third thing.
 *
 * **Every control commits as it is changed.** There is no Save here, which is
 * that vocabulary's own shape, and it is also what makes the type size usable:
 * the editor behind the sheet is redrawn at each step, so the number is
 * chosen by looking at the code rather than by imagining it.
 *
 * The hint sources are **tick boxes** and Tidy on save is a **switch**, which
 * is not an inconsistency: a switch says *this is on*, and a pair of boxes
 * says *these are the ones I want*. See `optionCheckbox`.
 */

import { h } from "../lib/dom";
import { optionGroup, optionRow, optionsPage } from "../lib/options-list";
import {
  optionCheckbox,
  optionNumber,
  optionSwitch,
} from "../lib/options-controls";
import { openSheet } from "../lib/sheet";
import {
  TEXT_SIZE_RANGE,
  type CodeSettings,
} from "./code-settings";

/**
 * Open the sheet.
 *
 * `onChange` fires on every press with the whole of the settings, rather than
 * with what moved: the panel writes them and pushes them into the editor that
 * is open, and both of those want all three anyway.
 */
export function openCodeSettings(
  current: CodeSettings,
  onChange: (next: CodeSettings) => void,
): void {
  let settings = { ...current, hints: { ...current.hints } };

  const commit = (next: Partial<CodeSettings>): void => {
    settings = { ...settings, ...next };
    onChange(settings);
  };

  const sheet = openSheet({
    title: "Code Settings",
    subtitle: "How the editor behaves, on this device",
    width: 560,
  });

  const size = optionNumber({
    value: settings.textSize,
    min: TEXT_SIZE_RANGE.min,
    max: TEXT_SIZE_RANGE.max,
    unit: "px",
    label: "Editor text size",
    onChange: (value) => commit({ textSize: value }),
  });

  const tidy = optionSwitch(
    settings.tidyOnSave,
    (on) => commit({ tidyOnSave: on }),
    "Tidy on save",
  );

  const phaser = optionCheckbox(
    settings.hints.phaser,
    (on) => commit({ hints: { ...settings.hints, phaser: on } }),
    "Phaser hints",
  );

  const js = optionCheckbox(
    settings.hints.js,
    (on) => commit({ hints: { ...settings.hints, js: on } }),
    "JavaScript hints",
  );

  sheet.body.appendChild(
    optionsPage([
      optionGroup({
        title: "Editor",
        rows: [
          optionRow({
            title: "Text size",
            hint:
              "How large the code is drawn, in pixels. The line numbers go " +
              "with it. This is about the screen you are looking at rather " +
              "than about the project, so it is remembered here and travels " +
              "with neither.",
            control: size.root,
          }),
        ],
      }),
      optionGroup({
        title: "Saving",
        rows: [
          optionRow({
            title: "Tidy on save",
            hint:
              "Reprint the file with Prettier on the way to disk — spacing, " +
              "indentation, quotes and semicolons. Lines the editor owns are " +
              "never moved: a tidy that would reprint one is declined and " +
              "says so, and the file is saved as you wrote it. ⇧⌥F tidies " +
              "once without turning this on.",
            control: tidy.root,
          }),
        ],
        note:
          "Tidy reads JavaScript, JSON, CSS, HTML and Markdown. A file with " +
          "a syntax error cannot be reprinted, so a save that cannot parse " +
          "the file writes it unchanged and says where the trouble is.",
      }),
      optionGroup({
        title: "Code hinting",
        rows: [
          optionRow({
            title: "Phaser",
            sub: "Members of the expression you are typing, from the reference",
            control: phaser.root,
          }),
          optionRow({
            title: "JavaScript",
            sub: "Words already in this file, and the browser's own globals",
            control: js.root,
          }),
        ],
        note:
          "Both are offered in JavaScript files only, and only after a dot " +
          "or a few letters. Escape closes the list; nothing is ever written " +
          "into the file without you choosing it.",
      }),
    ]),
  );

  sheet.actions.appendChild(
    h("button", { class: "btn btn-primary", text: "Done", onClick: sheet.close }),
  );
}
