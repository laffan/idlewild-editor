/**
 * A panel's title, when the title is the thing itself.
 *
 * Most of what the properties sidebar shows is read-only — a size, a layer's
 * name, how many spaces a fill covers — and the two or three places where the
 * heading *is* the record's own name want a field rather than a label. This
 * is that field.
 *
 * **Borderless until it is focused**, like the layer names in the left panel.
 * The sidebar is a column of facts and one of them happens to be editable,
 * which a box drawn round it all the time would overstate.
 *
 * Its own file because `inspector.ts` reached the seven hundred lines, and it
 * lifts cleanly: it needs nothing from the panel but the two strings it is
 * given, and it hands back an element the zone puts where it likes.
 */

import { h } from "../lib/dom";

/**
 * The head row for a named thing.
 *
 * `suffix` is shown beside the field rather than in it — a file's extension
 * is not part of its name, and retyping it would only be a way to get it
 * wrong. Escape puts the name back and Enter commits, which is the pair every
 * other field in this app keeps.
 *
 * A name cleared or retyped to what it already was commits **nothing**: there
 * is no rename to make, and writing one would put a step on the undo stack
 * that undoes to itself.
 */
export function nameRow(
  kicker: string,
  value: string,
  suffix: string,
  onCommit: (next: string) => void,
): HTMLElement {
  const input = h("input", {
    class: "inspect-name",
    value,
    spellcheck: "false",
    "aria-label": `${kicker} name`,
    onChange: (event: Event) => {
      const field = event.target as HTMLInputElement;
      const next = field.value.trim();
      if (!next || next === value) {
        field.value = value;
        return;
      }
      onCommit(next);
    },
    onKeyDown: (event: KeyboardEvent) => {
      const field = event.target as HTMLInputElement;
      if (event.key === "Enter") field.blur();
      if (event.key === "Escape") {
        field.value = value;
        field.blur();
      }
    },
  });

  return h(
    "div",
    { class: "inspect-head" },
    h(
      "div",
      { class: "inspect-title inspect-name-row" },
      input,
      h("span", { class: "inspect-ext", text: suffix }),
    ),
  );
}
