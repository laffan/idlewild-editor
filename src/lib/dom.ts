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
  /* A tick, for the card a Select has picked. */
  check: "m5 13 4 4 10-10",
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
  /* A craft knife, for the tool that *cuts* a stroke rather than rubbing
     pixels out. It was a rubber block, and that became a lie the moment every
     brush grew an eraser of its own: this one slices a line in two and leaves
     both halves, which is a different thing that happened to share a name. */
  /* It points the *other* way from the pencil on purpose. Both are a blade on
     a diagonal at 21px, and drawn the same way round they read as the same
     glyph four buttons apart. */
  slice: ["M21 20 10 8l-4 4 11 9Z", "M8 10l-5-5"],
  /* A nib: the barrel, the slit down the middle, and the point it writes
     from. Its own glyph rather than the rail's pencil, because the two mean
     different things — that one picks up a tool, this one opens a mode. */
  pen: [
    "M14 3.5 20.5 10 10 20.5l-6.5.5.5-6.5L14 3.5Z",
    "M12.5 5 19 11.5",
    "m4 20 4.2-4.2",
  ],
  fill: "M6 12 12 6l6 6-6 6-6-6Zm13 4c0 1.7 1 2.6 2 2.6",
  /* A checkerboard, for the brush that reveals a pattern rather than laying
     ink down. Four filled squares of a 4×4 grid, which is the smallest
     arrangement that reads as a pattern at 21px rather than as four dots. */
  pixels: [
    "M4 4h5v5H4z",
    "M14 4h5v5h-5z",
    "M9 9h5v5H9z",
    "M4 14h5v5H4z",
    "M14 14h5v5h-5z",
  ],
  boundary: "M3 8V4h4M17 4h4v4M21 16v4h-4M7 20H3v-4",
  /* A tile with a corner rounded off — the Shape brush. It is deliberately
     one of the shapes in the palette rather than a generic polygon: what the
     tool stamps is a tile, and a quarter circle is the tile that says so. */
  shape: ["M4 4h16v16H4z", "M20 4A16 16 0 0 0 4 20"],
  /* A freehand loop closing on itself — the lasso's own gesture. */
  lasso: [
    "M4 13a8 5 0 1 0 16 0 8 5 0 1 0-16 0",
    "M6.5 17.2c-.6 1.2-.4 2.4.6 3.1",
  ],
  hand: "M8 13V6a1.6 1.6 0 0 1 3.2 0v6m0-1V5a1.6 1.6 0 0 1 3.2 0v7m0-2a1.6 1.6 0 0 1 3.2 0v6a5 5 0 0 1-5 5h-1a6 6 0 0 1-6-6v-3",
  /** A solid, for what extrude mode builds: the cube seen from its corner. */
  box: [
    "M12 2.5 21 7.5v9l-9 5-9-5v-9l9-5Z",
    "m3 7.5 9 5 9-5",
    "M12 12.5V21.5",
  ],
  /* A map pin: a dot standing on a place, which is what a point is. */
  point: ["M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z", "M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"],
  /* A flag, for the point a scene starts play on. */
  flag: ["M6 21V4", "M6 4h11l-2.5 4L17 12H6"],
  file: "M6 3h8l4 4v14H6V3Z",
  /* A picture: a frame with a horizon and a sun in it. Export Assets, which is
     the one exit that hands back artwork rather than a program. */
  image: ["M4 5h16v14H4z", "m4 16 5-5 4 4 3-3 4 4", "M9 9.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"],
  folder: "M3 6h6l2 3h10v11H3V6Z",
  /* Two objects inside a selection box — a group, drawn the way every editor
     draws one. The corner brackets rather than a closed rectangle because what
     holds them together is a decision rather than a thing: see
     `lib/groups.ts`. */
  group: [
    "M3 7V3h4",
    "M17 3h4v4",
    "M21 17v4h-4",
    "M7 21H3v-4",
    "M7 8h4v4H7z",
    "M13 12h4v4h-4z",
  ],
  trash: ["M4 7h16", "M9 7V4h6v3", "M6 7l1 14h10l1-14"],
  rename: "M4 20l4-1 10-10-3-3L5 16l-1 4Z",
  copy: ["M8 8h12v12H8z", "M4 16V4h12"],
  code: ["m9 8-5 4 5 4", "m15 8 5 4-5 4"],
  publish: ["M12 19V5", "M5 12l7-7 7 7"],
  menu: ["M4 7h16", "M4 12h16", "M4 17h16"],
  /* An arrow curving back on itself, and its mirror. Undo and redo: the same
     glyph pair the two header buttons carry, drawn so the difference between
     them is legible at 17px — the hook is on opposite sides. */
  undo: ["M9 14 4 9l5-5", "M4 9h10a6 6 0 0 1 0 12h-3"],
  redo: ["m15 14 5-5-5-5", "M20 9H10a6 6 0 0 0 0 12h3"],
  /* An open book, for the reference along the bottom of the code modal. */
  book: ["M12 7v13", "M12 7C9.5 5 6.5 4.6 4 5v13c2.5-.4 5.5 0 8 2", "M12 7c2.5-2 5.5-2.4 8-2v13c-2.5-.4-5.5 0-8 2"],
  pin: ["M9 4h6", "M10 4v6l-3 4v2h10v-2l-3-4V4", "M12 16v5"],
  /** A panel with a column down one side: the file browser's own toggle. */
  sidebar: ["M4 5h16v14H4z", "M10 5v14"],
  /* A magnifying glass, for both Finds: the floating one over a file and the
     strip over the file column. One glyph, because they are one question
     asked of one document or of all of them. */
  search: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Z", "m16.2 16.2 4.3 4.3"],
  /* Sliders — Project Options, which is settings rather than navigation. */
  sliders: ["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9", "M15 5v4", "M9 15v4"],
  /* The three kinds of layer, as the dropdown under the `+` offers them and
     as each row carries afterwards. A stack of sheets for the ordinary one,
     a scatter for the pattern, and a framed field for the backdrop — three
     silhouettes rather than three variations, because the point of the chip
     is to be read without being looked at. */
  layerObject: ["m12 3 9 5-9 5-9-5 9-5Z", "m3 13 9 5 9-5"],
  layerPattern: [
    "M6 6h.01",
    "M13 4h.01",
    "M19 8h.01",
    "M8 13h.01",
    "M15 12h.01",
    "M5 19h.01",
    "M12 19h.01",
    "M19 17h.01",
  ],
  layerBackground: ["M3 5h18v14H3z", "m3 16 5-5 4 4 3-3 6 5"],
  /* Two stops fading into each other: a gradient backdrop's own row. */
  gradient: ["M4 4h16v16H4z", "M4 12h16", "M4 8h16", "M4 16h16"],
  /* A triangle with a bar in it — the one glyph here that means something is
     wrong rather than something is available. */
  warning: ["M12 3 22 20H2L12 3Z", "M12 10v4", "M12 17h.01"],
  /* The three chips on the properties sidebar's zone headings — TOOL, LAYER,
     OBJECT. They are there to say *these three are not sections*: the panel
     is one column of foldable headings, and without something to separate
     them a zone reads as another section of whatever is above it.

     A brush standing on its ferrule, a stack of sheets, and a box with its
     corner handles: what is in my hand, where it is going, what is under it,
     which is the sentence the three zones are in that order to make. */
  zoneTool: ["M12 3v7", "M9 10h6l-1.2 7.6a1.8 1.8 0 0 1-3.6 0L9 10Z"],
  zoneLayer: ["m12 3 9 5-9 5-9-5 9-5Z", "m3 13 9 5 9-5", "m3 17 9 5 9-5"],
  zoneObject: ["M7 7h10v10H7z", "M4 4h.01", "M20 4h.01", "M4 20h.01", "M20 20h.01"],
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
