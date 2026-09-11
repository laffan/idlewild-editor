/**
 * A logged value, drawn the way a browser console draws one: a triangle, a
 * one-line preview while it is shut, and its contents a level at a time when
 * it is open.
 *
 * Built from a snapshot (`lib/log-value.ts`), never from a live object, so a
 * line opened an hour after it was written shows what was true when it was
 * written. That is a difference from devtools worth knowing about and, for a
 * game that mutates one sprite sixty times a second, mostly an improvement.
 *
 * Children are built on the first open and kept: a deeply nested value costs
 * nothing until someone asks for it, and a drawer holding five hundred lines
 * cannot afford to have built all of them.
 */

import { h } from "../lib/dom";
import { previewLine, type LogValue } from "../lib/log-value";

/** One logged argument, as a node to put in a console line. */
export function renderValue(value: LogValue): Node {
  return value.t === "object" || value.t === "array"
    ? openable(value)
    : leaf(value);
}

function leaf(value: LogValue): Node {
  switch (value.t) {
    case "string":
      // Quoted here, unlike at the top of a line: inside a structure the
      // difference between `1` and `"1"` is the thing you are looking at.
      return h("span", { class: "lt-string", text: JSON.stringify(value.v) });
    case "number":
      return h("span", { class: "lt-number", text: value.v });
    case "boolean":
      return h("span", { class: "lt-bool", text: String(value.v) });
    case "empty":
      return h("span", { class: "lt-empty", text: value.v });
    default:
      return h("span", { class: "lt-other", text: previewLine(value) });
  }
}

type Openable = Extract<LogValue, { t: "object" } | { t: "array" }>;

function openable(value: Openable): HTMLElement {
  const arrow = h("span", { class: "lt-arrow", text: "▶" });
  const preview = h("span", { class: "lt-preview", text: previewLine(value) });
  const label = value.label
    ? h("span", { class: "lt-label", text: value.label })
    : null;

  const wrapper = h("span", { class: "lt" });
  let children: HTMLElement | null = null;
  let open = false;

  const head = h(
    "button",
    {
      class: "lt-head",
      type: "button",
      "aria-expanded": "false",
      onClick: (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        open = !open;
        arrow.textContent = open ? "▼" : "▶";
        head.setAttribute("aria-expanded", String(open));
        if (open && !children) {
          children = h("div", { class: "lt-children" }, ...rows(value));
          wrapper.appendChild(children);
        }
        if (children) children.hidden = !open;
        preview.hidden = open;
      },
    },
    arrow,
    label,
    preview,
  );

  wrapper.appendChild(head);
  return wrapper;
}

/** The rows an open value shows: one per key or index, plus what was cut. */
function rows(value: Openable): Node[] {
  const entries: Array<[string, LogValue]> =
    value.t === "array"
      ? value.items.map((item, index): [string, LogValue] => [String(index), item])
      : value.entries;

  const out: Node[] = entries.map(([key, child]) =>
    h(
      "div",
      { class: "lt-row" },
      h("span", { class: "lt-key", text: key }),
      document.createTextNode(": "),
      renderValue(child),
    ),
  );

  // A cap that is not mentioned reads as an object with fewer keys than it
  // has, which is the one thing a console must never say.
  if (value.more) {
    out.push(h("div", { class: "lt-row lt-more", text: `… ${value.more} more` }));
  }
  return out;
}
