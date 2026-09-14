/**
 * One of the properties sidebar's three zones: TOOL, LAYER, OBJECT.
 *
 * A zone is a heading and a body, and the heading is the panel's whole
 * navigation: it says which of the three subjects the rows under it are
 * about. Reading down the sidebar is then reading the same sentence every
 * time — what is in my hand, which layer it is going on, what is under it —
 * rather than working out which of three unrelated panels happens to be up.
 *
 * **The heading is the head.** The panels in `inspect-panels.ts` and its
 * neighbours open with a kicker and a title — *Boundary* over *Boundary 1* —
 * and the zone's heading is where that kicker now goes: `OBJECT : Boundary`.
 * A panel whose title says the same thing the heading already does draws no
 * title at all, which is why a layer reads `LAYER : Foreground` and not
 * `LAYER : Layer` over the word *Foreground*.
 *
 * A zone with an empty body is never put in the document — `mount` answers
 * whether there was anything to mount — because a labelled box that is always
 * there and usually empty is what the single *Inspector* heading was.
 */

import { h } from "../lib/dom";

export interface Zone {
  /** The whole zone, heading included. Only in the document once mounted. */
  readonly root: HTMLElement;
  /** What the panels write into. */
  readonly body: HTMLElement;
  /**
   * Name the zone's subject, if it has not been named already.
   *
   * Returns whatever the heading now says after the colon, so a caller can
   * tell whether its own title would be a second copy of it.
   */
  name(subject: string): string;
  /** Put it in `into`, unless nothing was written into it. */
  mount(into: HTMLElement): boolean;
}

export function createZone(name: string, subject = ""): Zone {
  const subjectEl = h("span", { class: "inspect-zone-subject", text: subject });
  const body = h("div", { class: "inspect-zone-body" });
  const root = h(
    "section",
    { class: `inspect-zone zone-${name.toLowerCase()}` },
    h(
      "header",
      { class: "inspect-zone-head m" },
      h("span", { class: "inspect-zone-name", text: name }),
      subjectEl,
    ),
    body,
  );
  let named = subject;

  return {
    root,
    body,
    name(next: string): string {
      // First namer wins. The zone's own caller knows the subject best — a
      // layer is named by its name, not by the word "Layer" its panel's
      // kicker carries — and a panel that happens to open with a kicker is
      // only filling in for a zone nobody has named yet.
      if (!named && next) {
        named = next;
        subjectEl.textContent = next;
      }
      return named;
    },
    mount(into: HTMLElement): boolean {
      if (body.childElementCount === 0) return false;
      into.appendChild(root);
      return true;
    },
  };
}
