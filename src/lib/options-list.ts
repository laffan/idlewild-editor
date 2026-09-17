/**
 * Building an options page: groups of rows, and the sheets a row opens.
 *
 * The other half of `styles/options.css`. That file is the look; this is the
 * shape, so a page written against it gets the vocabulary rather than
 * re-deriving it out of `div`s — and so a change to what a row *is* happens in
 * one place rather than in every page that has one.
 *
 * **Nothing here knows about any feature.** A row has a title, a quiet second
 * line, something at each end and possibly a press. The Logins sheet is the
 * first page built on it and is meant not to be the last: Project Options and
 * the render settings are the obvious next ones, and they should not have to
 * invent a row again.
 *
 * The deliberate omission is state. Every builder takes what to show and hands
 * back an element; nothing here re-renders, remembers or subscribes. A page
 * that needs to redraw calls its own builder again and replaces the children,
 * which is what every sheet in this app already does — and a list component
 * that owned its own state would be the thing every page then had to work
 * around.
 */

import { h, ICONS, icon } from "./dom";

/** What a row's end can carry: a value it reports, or controls. */
export interface OptionAction {
  label: string;
  onSelect: () => void;
  /** Lit in the accent — the affirmative one, where a row has one. */
  accent?: boolean;
  /** The one that takes something away. */
  danger?: boolean;
  title?: string;
}

/**
 * A quiet line under a row's title.
 *
 * `mono` for something compared character by character rather than read — a
 * fingerprint, a path, a key. A string is the common case and means neither.
 */
export type OptionSub = string | { text: string; mono?: boolean };

export interface OptionRow {
  title: string;
  /**
   * What this row is *for*, or what it is set to. Several, where a row has
   * more than one thing to say quietly — which is why this is not one string:
   * the alternative is the caller reaching into the row it was handed and
   * appending to it, and a builder whose output has to be patched afterwards
   * is a builder that is missing a parameter.
   */
  sub?: OptionSub | OptionSub[];
  /** A glyph at the head of the row — one of `ICONS`, or nothing. */
  glyph?: string | readonly string[];
  /** A short word standing in for a glyph: an initial, a kind. */
  badge?: string;
  /** Reported at the end of the row, before any buttons. */
  value?: string;
  /** Buttons at the end of the row. */
  actions?: OptionAction[];
  /**
   * The whole row is a press. Gets a chevron, unless it also has buttons —
   * a row with both is a row where it is not clear what tapping it does.
   */
  onSelect?: () => void;
}

/** One row of a group. */
export function optionRow(row: OptionRow): HTMLElement {
  const lead = row.glyph
    ? h("span", { class: "option-lead" }, icon(row.glyph, 16))
    : row.badge
      ? h("span", { class: "option-lead", text: row.badge })
      : null;

  const subs = row.sub === undefined ? [] : Array.isArray(row.sub) ? row.sub : [row.sub];
  const body = h(
    "div",
    { class: "option-body" },
    h("span", { class: "option-title", text: row.title }),
    ...subs.map((sub) => {
      const { text, mono } = typeof sub === "string" ? { text: sub, mono: false } : sub;
      return h("span", { class: `option-sub${mono ? " mono" : ""}`, text });
    }),
  );

  const actions = row.actions ?? [];
  const trail =
    row.value || actions.length || (row.onSelect && !actions.length)
      ? h(
          "div",
          { class: "option-trail" },
          row.value ? h("span", { class: "option-value", text: row.value }) : null,
          ...actions.map((action) =>
            h("button", {
              class: `option-btn${action.accent ? " accent" : ""}${action.danger ? " danger" : ""}`,
              type: "button",
              text: action.label,
              title: action.title ?? action.label,
              // A press on a button inside a tappable row is about the button,
              // not the row. Without this the row's own handler runs too, and
              // Delete would also open whatever tapping the row opens.
              onClick: (event: Event) => {
                event.stopPropagation();
                action.onSelect();
              },
            }),
          ),
          row.onSelect && !actions.length
            ? icon(ICONS.chevronRight, 16, "currentColor")
            : null,
        )
      : null;

  const classes = ["option"];
  if (lead) classes.push("has-lead");
  if (row.onSelect) classes.push("tappable");

  return h(
    row.onSelect ? "button" : "div",
    {
      class: classes.join(" "),
      ...(row.onSelect ? { type: "button", onClick: row.onSelect } : {}),
    },
    lead,
    body,
    trail,
  );
}

/** A row that adds something, at the foot of the group it adds to. */
export function optionAddRow(title: string, onSelect: () => void): HTMLElement {
  return h(
    "button",
    { class: "option tappable add has-lead", type: "button", onClick: onSelect },
    h("span", { class: "option-lead" }, icon(ICONS.plus, 16)),
    h("div", { class: "option-body" }, h("span", { class: "option-title", text: title })),
  );
}

/** What a group says when it has nothing in it, so the card is never a void. */
export function optionEmptyRow(text: string): HTMLElement {
  return h("div", { class: "option empty" }, h("span", { class: "option-body", text }));
}

export interface OptionGroup {
  /** The quiet label above the card. */
  title?: string;
  /** The sentence under it — the thing that would otherwise be a tooltip. */
  note?: string;
  rows: Array<HTMLElement | null>;
  /** Shown as a row of its own when `rows` is empty. */
  empty?: string;
}

/** A titled card of rows. */
export function optionGroup(group: OptionGroup): HTMLElement {
  const rows = group.rows.filter((row): row is HTMLElement => row !== null);
  return h(
    "section",
    { class: "options-group" },
    group.title ? h("div", { class: "options-group-title", text: group.title }) : null,
    h(
      "div",
      { class: "options-rows" },
      ...(rows.length ? rows : [optionEmptyRow(group.empty ?? "Nothing here yet.")]),
    ),
    group.note ? h("div", { class: "options-group-note", text: group.note }) : null,
  );
}

/**
 * The page itself: the element a sheet's body is filled with.
 *
 * `light` for the home screen's sheets, which are drawn on paper; the editor's
 * are dark and are the default.
 */
export function optionsPage(
  groups: Array<HTMLElement | null>,
  light = false,
): HTMLElement {
  return h(
    "div",
    { class: `options${light ? " light" : ""}` },
    ...groups.filter((group): group is HTMLElement => group !== null),
  );
}

// ── the sheets a row opens ──────────────────────────────────────────────────

export interface OptionField {
  label: string;
  placeholder?: string;
  value?: string;
  hint?: string;
  /** A password box: what it holds is never read back out of the app. */
  secret?: boolean;
  /** A button beside the box — "Choose…", "Test". */
  button?: { label: string; onSelect: () => void };
  /** Enter in the box means the sheet's affirmative button. */
  onSubmit?: () => void;
}

/**
 * A labelled field, label above the box.
 *
 * Above rather than beside, which is the design system's shape: a settings
 * form is read down, and a column of right-aligned keys is a table. The
 * element is handed back with its input, because every caller needs the value
 * and none of them should have to query for it.
 */
export function optionField(field: OptionField): {
  root: HTMLElement;
  input: HTMLInputElement;
} {
  const input = h("input", {
    class: "input",
    type: field.secret ? "password" : "text",
    value: field.value ?? "",
    placeholder: field.placeholder ?? "",
    spellcheck: "false",
    autocapitalize: "off",
    // Off for everything, not only secrets: these are hostnames and paths, and
    // a browser offering to remember them is a browser guessing wrong.
    autocomplete: "off",
    "aria-label": field.label,
  }) as HTMLInputElement;

  if (field.onSubmit) {
    input.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key === "Enter") field.onSubmit?.();
    });
  }

  const box = field.button
    ? h(
        "div",
        { class: "options-field-row" },
        input,
        h("button", {
          class: "option-btn",
          type: "button",
          text: field.button.label,
          onClick: field.button.onSelect,
        }),
      )
    : input;

  return {
    root: h(
      "div",
      { class: "options-field" },
      h("label", { class: "options-field-label", text: field.label }),
      box,
      field.hint ? h("div", { class: "options-field-hint", text: field.hint }) : null,
    ),
    input,
  };
}

/** A line the form says back: what it is doing, or why it did not. */
export function optionNotice(): HTMLElement {
  return h("div", { class: "options-notice" });
}

/** The body of a sheet a row opens: fields, stacked, on the options grid. */
export function optionsForm(...parts: Array<HTMLElement | null>): HTMLElement {
  return h(
    "div",
    { class: "options" },
    h(
      "section",
      { class: "options-group" },
      ...parts.filter((part): part is HTMLElement => part !== null),
    ),
  );
}
