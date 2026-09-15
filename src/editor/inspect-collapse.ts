/**
 * Folding the inspector's sections away.
 *
 * The panel describes one thing at a time, but the thing it describes can be
 * several screens of it: a placed PSD carries Info, Transform, its collider,
 * its own layer stack and — on a pattern layer — the rule and its shapes. Most
 * of the time only one of those is being worked on, and scrolling past four
 * headings to reach the fifth is the whole of the complaint.
 *
 * **It is applied to the panel after it is built, not written into each
 * section.** Sections are made in seven files — `inspector.ts`,
 * `inspect-panels.ts`, `inspect-collider.ts`, `inspect-pattern.ts`,
 * `inspect-background.ts`, `inspect-brush.ts`, `psd-layers.ts` — and threading
 * a fold through all of them would be seven copies of the same three lines,
 * with an eighth forgetting. What makes one pass over the DOM honest here is
 * that the markup already says which sections have a heading: a section whose
 * **first** child is an `.inspect-section-title` is a named section, and a
 * named section is one a reader can fold. A section with no heading — the row
 * of buttons at the foot of a panel, say — is not something to hide behind a
 * name it has not got.
 *
 * What is folded is *state of the panel*, not of the document: which sections
 * somebody has closed is a per-install convenience, like a sidebar's width, so
 * it lives in localStorage under the section's own name and is shared by every
 * panel that has a section of that name. That is deliberate — close Collider
 * once and it stays closed for the next PSD you select, which is the point of
 * closing it.
 */

import { h } from "../lib/dom";

const STORAGE_KEY = "idlewild.inspector.collapsed";

/**
 * The names that are folded away, read once and written on every change.
 *
 * Held in memory as well because the panel rebuilds on every document change —
 * a drag rebuilds it per pointer move — and a `localStorage` read per section
 * per frame is the kind of cost this editor keeps off the main thread.
 */
let closed: Set<string> | null = null;

function state(): Set<string> {
  if (closed) return closed;
  closed = new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const name of parsed) if (typeof name === "string") closed.add(name);
      }
    }
  } catch {
    // Private browsing, blocked site data, and something else's JSON under the
    // same key all land here. Everything open is a fine place to start from.
  }
  return closed;
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...state()]));
  } catch {
    // As above: the fold still works for this session.
  }
}

/**
 * The name a heading folds under, which is not always the heading.
 *
 * A section that counts in its own title — `Shapes · 2`, because the list is
 * the subject of that section rather than a footnote under it — is the same
 * section as `Shapes`. Keying on the whole string would reopen it every time
 * somebody added a shape.
 */
export function sectionName(heading: string): string {
  return heading.split(" · ")[0].trim();
}

export interface SectionTitleOptions {
  /**
   * The part after the colon — `Brush : Ink`.
   *
   * The same device the zone headings use, and for the same reason: the
   * pencil's panel had a *Brush* heading and, above it, a title saying which
   * brush, which is two headings for one fact. The subject is not part of
   * the name the fold is keyed on, so picking a different brush does not
   * reopen a section somebody closed.
   */
  subject?: string;
  /**
   * What the heading says on hover.
   *
   * Where the panel's explanations live. They were a line of prose under
   * each heading, which is a paragraph you read once and then scroll past
   * for ever — and four of them in a narrow column is most of the column.
   */
  hint?: string;
}

/**
 * A section's heading, as `makeSectionsCollapsible` expects to find it: the
 * **first** child of an `.inspect-section`.
 *
 * Built here rather than at each of the seven call sites because the fold
 * reads the name off it, and a heading that carries a subject or a tooltip
 * has to say which part of itself is the name.
 */
export function sectionTitle(
  name: string,
  options: SectionTitleOptions = {},
): HTMLElement {
  const el = h("div", {
    class: "inspect-section-title m",
    title: options.hint ?? null,
  });
  el.dataset.foldName = sectionName(name);
  el.appendChild(h("span", { class: "inspect-section-name", text: name }));
  if (options.subject) {
    el.appendChild(
      h("span", { class: "inspect-section-subject", text: options.subject }),
    );
  }
  return el;
}

/** Whether a section with this name is currently folded away. */
export function isCollapsed(name: string): boolean {
  return state().has(name);
}

/** Fold a section away, or open it, and remember which. */
export function setCollapsed(name: string, collapse: boolean): void {
  if (collapse) state().add(name);
  else state().delete(name);
  persist();
}

/**
 * Give every named section in a panel a heading that folds it.
 *
 * Idempotent, because the panel is rebuilt rather than patched: a section that
 * has already been through this carries `data-collapsible`, and a second pass
 * over the same DOM leaves it alone.
 */
export function makeSectionsCollapsible(body: HTMLElement): void {
  for (const section of body.querySelectorAll<HTMLElement>(".inspect-section")) {
    const title = section.firstElementChild;
    if (
      !(title instanceof HTMLElement) ||
      !title.classList.contains("inspect-section-title") ||
      section.dataset.collapsible === "true"
    ) {
      continue;
    }

    // `data-fold-name` when the heading carries more than its name — a
    // subject after the colon, which is not part of what it is keyed on.
    const name = title.dataset.foldName || sectionName(title.textContent ?? "");
    if (!name) continue;

    section.dataset.collapsible = "true";
    title.classList.add("inspect-section-fold");
    // A div with a button's semantics rather than a real `<button>`: the
    // heading is styled as one of the panel's 10px labels, and a button would
    // arrive with a border, a background and a font of its own to undo.
    title.setAttribute("role", "button");
    title.setAttribute("tabindex", "0");
    apply(section, title, name, isCollapsed(name));

    title.addEventListener("click", () => {
      const next = !isCollapsed(name);
      setCollapsed(name, next);
      apply(section, title, name, next);
    });
    title.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      // Space scrolls the panel otherwise, which is the opposite of folding.
      event.preventDefault();
      title.click();
    });
  }
}

/**
 * The named sections inside `within`, paired with the name each folds under.
 *
 * The same reading `makeSectionsCollapsible` does — first child, and
 * `data-fold-name` in preference to the heading's text, because a heading can
 * carry a subject after a colon — so the two cannot disagree about what a
 * section is called.
 */
export function namedSections(
  within: HTMLElement,
): Array<{ section: HTMLElement; title: HTMLElement; name: string }> {
  const out: Array<{ section: HTMLElement; title: HTMLElement; name: string }> = [];
  for (const section of within.querySelectorAll<HTMLElement>(".inspect-section")) {
    const title = section.firstElementChild;
    if (!(title instanceof HTMLElement)) continue;
    if (!title.classList.contains("inspect-section-title")) continue;
    const name = title.dataset.foldName || sectionName(title.textContent ?? "");
    if (name) out.push({ section, title, name });
  }
  return out;
}

/**
 * Open one section and fold every other named section in `within` away.
 *
 * For the moment after a PSD is made, when the one thing anybody wants is the
 * file's own layer list and everything above it is in the way — see
 * `Inspector.revealPsdLayers`.
 *
 * It writes the fold store rather than only the DOM, on purpose and for the
 * reason the fold is per-install in the first place: what you were shown the
 * last time is what you get the next time. A panel that sprang back open on
 * the next selection would have said something about this PSD rather than
 * about how you are working.
 */
export function isolateSection(within: HTMLElement, keep: string): void {
  for (const { section, title, name } of namedSections(within)) {
    const collapse = name !== keep;
    setCollapsed(name, collapse);
    apply(section, title, name, collapse);
  }
}

/**
 * Open one section, fold the rest of `within` away, and scroll `scroller` to
 * it.
 *
 * The scroll is measured rather than delegated to `scrollIntoView`, which
 * walks every scrollable ancestor — in this panel that would take the shell's
 * own column with it.
 */
export function revealSection(
  within: HTMLElement,
  name: string,
  scroller: HTMLElement,
): void {
  isolateSection(within, name);
  const row = namedSections(within).find((s) => s.name === name);
  if (!row) return;
  scroller.scrollTop +=
    row.section.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top;
}

function apply(
  section: HTMLElement,
  title: HTMLElement,
  name: string,
  collapse: boolean,
): void {
  section.classList.toggle("collapsed", collapse);
  title.setAttribute("aria-expanded", String(!collapse));
  title.setAttribute(
    "aria-label",
    collapse ? `${name} — closed, open it` : `${name} — open, close it`,
  );
}

/** For the tests: read the store again from scratch. */
export function resetCollapsedForTests(): void {
  closed = null;
}
