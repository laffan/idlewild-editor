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
 * **A zone folds, and it is marked as the thing that is not a section.** The
 * panel under one heading can be several screens, and the sections inside it
 * have folded since `inspect-collapse.ts` existed — which left the three
 * headings that matter most as the only ones that did not. They fold under
 * the same store, keyed `zone:TOOL` so a section that happens to be called
 * Tool is a different thing. And because the panel is now a column of
 * foldable headings from top to bottom, a zone needs to say it is not one
 * more section of whatever is above it: hence the chip, the heavier rule and
 * the tinted ground, which are the only three of them in the panel.
 *
 * A zone with an empty body is never put in the document — `mount` answers
 * whether there was anything to mount — because a labelled box that is always
 * there and usually empty is what the single *Inspector* heading was.
 */

import { h, ICONS, icon } from "../lib/dom";
import { isCollapsed, setCollapsed } from "./inspect-collapse";
import type { Selection } from "../lib/types";

/**
 * The chip each zone carries, by name.
 *
 * Here rather than at the call site because it is a fact about the zone
 * rather than about the panel being written into it, and there are exactly
 * three of them: a name with no chip is a zone this file does not know
 * about, and it simply goes without.
 */
const ZONE_ICONS: Record<string, readonly string[]> = {
  TOOL: ICONS.zoneTool,
  LAYER: ICONS.zoneLayer,
  OBJECT: ICONS.zoneObject,
};

/**
 * What each heading says on hover, when its panel has nothing better.
 *
 * The three answers the panel's order exists to give, in the order it gives
 * them: what is in my hand, where it is going, what it is on top of. The TOOL
 * zone overrides it with the tool's own line — see `TOOL_HINTS` — because by
 * then there is something more specific to say.
 */
export const ZONE_HINTS: Record<string, string> = {
  TOOL: "What the thing in your hand has to set.",
  LAYER: "The layer the next thing you do lands on.",
  OBJECT: "What is selected on the canvas.",
};

/**
 * Which layer a selection belongs to, or "" for one that belongs to none.
 *
 * A region is the case that has none: a run of grid spaces is ground rather
 * than a thing standing on a layer, and it is what the *next* Fill or Add
 * Image will put something on.
 */
export function layerOf(selection: Selection): string {
  switch (selection.kind) {
    case "layer":
    case "placement":
    case "placements":
    case "fill":
    case "point":
    case "zone":
    case "text":
    case "background":
    case "strokes":
      return selection.layerId;
    default:
      return "";
  }
}

/**
 * Whether the LAYER zone has anything to be about.
 *
 * It does when the layer itself is the subject — a layer selected, or nothing
 * selected at all — and it does over a **region**, which is ground rather than
 * a thing standing on a layer: there the zone answers "where would the next
 * Fill land", which is a question the selection raises and does not settle.
 *
 * It does **not** when something standing on a layer is selected. Picking a
 * placed PSD used to draw its layer's whole panel above it, so selecting one
 * thing looked like selecting two and the object you had just tapped started a
 * screen down. The layer is still what the object belongs to, and the left
 * panel still reveals it there; what it is not is a second subject.
 */
export function layerZoneApplies(selection: Selection): boolean {
  if (selection.kind === "layer") return true;
  return layerOf(selection) === "";
}

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

export interface ZoneOptions {
  /** The subject after the colon, when the caller already knows it. */
  subject?: string;
  /**
   * What the heading says on hover: what this zone is for, or what the tool
   * in hand does. The panel's explanations live here and on the section
   * headings rather than as a line of prose under each one — see
   * `inspect-brush.ts`. Omitted, the zone's own line from `ZONE_HINTS`.
   */
  hint?: string;
}

/** The fold store's key for a zone, kept out of the sections' namespace. */
export function zoneKey(name: string): string {
  return `zone:${name}`;
}

export function createZone(name: string, options: ZoneOptions = {}): Zone {
  const subject = options.subject ?? "";
  const subjectEl = h("span", { class: "inspect-zone-subject", text: subject });
  const body = h("div", { class: "inspect-zone-body" });
  const glyph = ZONE_ICONS[name];
  const key = zoneKey(name);

  const head = h(
    "header",
    {
      class: "inspect-zone-head m",
      role: "button",
      tabindex: "0",
      title: options.hint ?? ZONE_HINTS[name] ?? null,
    },
    glyph ? icon(glyph, 14) : null,
    h("span", { class: "inspect-zone-name", text: name }),
    subjectEl,
  );
  if (glyph) head.firstElementChild?.classList.add("inspect-zone-icon");

  const root = h(
    "section",
    { class: `inspect-zone zone-${name.toLowerCase()}` },
    head,
    body,
  );
  let named = subject;

  const apply = (collapse: boolean): void => {
    root.classList.toggle("collapsed", collapse);
    head.setAttribute("aria-expanded", String(!collapse));
  };
  apply(isCollapsed(key));

  head.addEventListener("click", () => {
    const next = !isCollapsed(key);
    setCollapsed(key, next);
    apply(next);
  });
  head.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    // Space scrolls the panel otherwise, which is the opposite of folding.
    event.preventDefault();
    head.click();
  });

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
