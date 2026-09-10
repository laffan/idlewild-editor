/**
 * The whole UI is built from this. No framework, same as Phaser Bench and
 * Hush — `h()` plus explicit event wiring is enough for a shell this size,
 * and it keeps the game canvas the only thing doing per-frame work.
 */

type Child = Node | string | number | null | undefined | false;

export interface Attrs {
  class?: string;
  text?: string;
  html?: string;
  style?: Partial<CSSStyleDeclaration> | string;
  dataset?: Record<string, string>;
  [key: string]: unknown;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === "class") {
      el.className = String(value);
    } else if (key === "text") {
      el.textContent = String(value);
    } else if (key === "html") {
      el.innerHTML = String(value);
    } else if (key === "style") {
      if (typeof value === "string") el.setAttribute("style", value);
      else Object.assign(el.style, value);
    } else if (key === "dataset") {
      Object.assign(el.dataset, value as Record<string, string>);
    } else if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(
        key.slice(2).toLowerCase(),
        value as EventListener,
      );
    } else {
      el.setAttribute(key, String(value));
    }
  }

  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(
      typeof child === "string" || typeof child === "number"
        ? document.createTextNode(String(child))
        : child,
    );
  }
}

export function clear(el: Element): void {
  // One call rather than a removeChild loop: removing a focused field fires
  // its blur handler, and a blur handler that touches the DOM used to leave
  // the loop holding a node that was no longer its child.
  el.replaceChildren();
}

/**
 * An inline Lucide-style icon. The design system asks for Lucide throughout;
 * these are the handful of glyphs the shell actually uses.
 *
 * A glyph may be several subpaths — a lock is a body and a shackle, an eye is
 * a lens and a pupil — so `path` accepts an array. Passing one string draws
 * one subpath.
 */
export function icon(
  path: string | readonly string[],
  size = 17,
  stroke = "currentColor",
): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", stroke);
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const d of Array.isArray(path) ? path : [path]) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", "path");
    node.setAttribute("d", d);
    svg.appendChild(node);
  }
  return svg;
}

export const ICONS = {
  plus: ["M12 5v14", "M5 12h14"],
  chevronLeft: "m14 6-6 6 6 6",
  chevronRight: "m10 6 6 6-6 6",
  chevronUp: "m6 15 6-6 6 6",
  chevronDown: "m6 9 6 6 6-6",
  close: ["M18 6 6 18", "M6 6l12 12"],
  eye: [
    "M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z",
    "M12 9.4a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Z",
  ],
  eyeOff: [
    "M3 3l18 18",
    "M10.6 6.2A9.9 9.9 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.3 3.9",
    "M6.5 7.9A17 17 0 0 0 2 12s3.6 6.5 10 6.5c1.4 0 2.6-.2 3.7-.6",
  ],
  lock: ["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4"],
  unlock: ["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 7.6-1.6"],
  select: "M4 4l7 16 2.2-6.4L20 11.6 4 4Z",
  pencil: "M4 20l4-1 10-10-3-3L5 16l-1 4Z",
  eraser: "M8 20h11M6 16l7-7 5 5-4 4H8l-2-2Z",
  fill: "M6 12 12 6l6 6-6 6-6-6Zm13 4c0 1.7 1 2.6 2 2.6",
  boundary: "M3 8V4h4M17 4h4v4M21 16v4h-4M7 20H3v-4",
  /* A freehand loop closing on itself — the lasso's own gesture. */
  lasso: [
    "M4 13a8 5 0 1 0 16 0 8 5 0 1 0-16 0",
    "M6.5 17.2c-.6 1.2-.4 2.4.6 3.1",
  ],
  hand: "M8 13V6a1.6 1.6 0 0 1 3.2 0v6m0-1V5a1.6 1.6 0 0 1 3.2 0v7m0-2a1.6 1.6 0 0 1 3.2 0v6a5 5 0 0 1-5 5h-1a6 6 0 0 1-6-6v-3",
  file: "M6 3h8l4 4v14H6V3Z",
  folder: "M3 6h6l2 3h10v11H3V6Z",
  trash: ["M4 7h16", "M9 7V4h6v3", "M6 7l1 14h10l1-14"],
  rename: "M4 20l4-1 10-10-3-3L5 16l-1 4Z",
  copy: ["M8 8h12v12H8z", "M4 16V4h12"],
  code: ["m9 8-5 4 5 4", "m15 8 5 4-5 4"],
  publish: ["M12 19V5", "M5 12l7-7 7 7"],
  menu: ["M4 7h16", "M4 12h16", "M4 17h16"],
  pin: ["M9 4h6", "M10 4v6l-3 4v2h10v-2l-3-4V4", "M12 16v5"],
  /* Sliders — Project Options, which is settings rather than navigation. */
  sliders: ["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9", "M15 5v4", "M9 15v4"],
  /* A drag handle. Round line caps turn each zero-length segment into a dot,
     which is how a six-dot grip is drawn without leaving the stroked-path
     vocabulary the rest of this set uses. */
  grip: [
    "M9 5h.01",
    "M9 12h.01",
    "M9 19h.01",
    "M15 5h.01",
    "M15 12h.01",
    "M15 19h.01",
  ],
} as const;
