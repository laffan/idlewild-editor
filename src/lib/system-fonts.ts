/**
 * Which typefaces this device actually has.
 *
 * A note on the canvas is drawn in whatever the device can draw, and the
 * question "what can it draw" has no honest API behind it here. `queryLocalFonts`
 * — the Local Font Access API — would answer it outright, and it is Chromium's
 * alone: this editor runs in WKWebView on both of its platforms, where the
 * method does not exist. `document.fonts.check()` is no better, because it
 * answers about *loading* rather than about availability and says yes to
 * families that are not installed.
 *
 * So the families are **probed**, which is the technique every font picker on
 * the web has used for twenty years and is exact enough for this: a string is
 * measured in the candidate family with a generic behind it, and again in the
 * generic alone. A family that is not installed falls through to the generic
 * and the two measurements match; one that is installed almost always differs
 * from at least one of the three generics. It is measured against all three
 * because a face that happens to match `monospace`'s metrics will not also
 * match `serif`'s.
 *
 * **It is a list of candidates, not an enumeration.** Nothing here can find a
 * typeface it was not told to look for, so what the picker offers is the
 * intersection of `CANDIDATES` with what is installed — the system faces of
 * macOS, iPadOS and Windows, which is what somebody labelling a level reaches
 * for. A font that matters and is missing from the list is one line to add.
 *
 * **None of it reaches the game.** Text is temporary and converts to pixels —
 * see `text-items.ts` — which is exactly what makes using a local font safe
 * here: what ships is artwork, and the typeface never has to exist anywhere
 * but on the machine the words were typed on.
 */

/** The string to measure. Wide letters and narrow ones, so faces separate. */
const PROBE = "mmmmmmmmmmlliWWWW";

/** Big enough that a one-pixel difference per glyph is not lost to rounding. */
const PROBE_SIZE = 72;

/** What an unavailable family falls through to. All three, for the reason above. */
const GENERICS = ["monospace", "serif", "sans-serif"] as const;

/**
 * The families worth asking about.
 *
 * The system faces of the two platforms this runs on, and the Windows ones a
 * project may have been started on. Ordered roughly as a picker should read —
 * the workhorses first, the display faces after — because the list is offered
 * in this order and alphabetising it would bury Helvetica under American
 * Typewriter.
 */
export const CANDIDATES: readonly string[] = [
  // The two system UI faces, which is what almost every note wants.
  "SF Pro Text",
  "Helvetica Neue",
  "Helvetica",
  "Arial",
  "Segoe UI",
  // Sans-serifs with more character.
  "Avenir Next",
  "Avenir",
  "Futura",
  "Gill Sans",
  "Optima",
  "Trebuchet MS",
  "Verdana",
  "Tahoma",
  "Century Gothic",
  "Calibri",
  "Candara",
  "Corbel",
  "Franklin Gothic Medium",
  "Arial Black",
  "Impact",
  // Serifs.
  "Georgia",
  "Times New Roman",
  "Times",
  "Palatino",
  "Baskerville",
  "Charter",
  "Iowan Old Style",
  "Hoefler Text",
  "Didot",
  "Cochin",
  "Athelas",
  "Superclarendon",
  "Rockwell",
  "Bodoni 72",
  "Cambria",
  "Constantia",
  "Palatino Linotype",
  // Monospace, which a label on a technical drawing usually wants.
  "SF Mono",
  "Menlo",
  "Monaco",
  "Courier New",
  "Courier",
  "Consolas",
  "Lucida Console",
  "PT Mono",
  // Display and hand faces — a sign in a game is often one of these.
  "American Typewriter",
  "Chalkboard SE",
  "Marker Felt",
  "Noteworthy",
  "Bradley Hand",
  "Comic Sans MS",
  "Papyrus",
  "Copperplate",
  "Herculanum",
  "Luminari",
  "Phosphate",
  "Snell Roundhand",
  "Apple Chancery",
  "Zapfino",
  "Party LET",
  "Savoye LET",
];

/**
 * The generic stacks, which are always offered.
 *
 * Whatever the probe finds, these three work — they are what CSS falls back to
 * by definition — so the picker is never empty and a project opened on a
 * machine with an unusual set of fonts still has something sensible at the top
 * of the list. They are also what a `TextItem` written before this existed
 * carries, so keeping them offered keeps those notes' own family selectable.
 */
export const GENERIC_FONTS: ReadonlyArray<{ id: string; name: string }> = [
  { id: "system-ui, sans-serif", name: "System" },
  { id: "Georgia, 'Times New Roman', serif", name: "Serif" },
  { id: "'Fira Code', ui-monospace, monospace", name: "Mono" },
];

/** One family, as the picker offers it. */
export interface FontChoice {
  /** What goes in the document and into a `font` shorthand. */
  id: string;
  /** What the row says, and what it is drawn in. */
  name: string;
}

let found: FontChoice[] | null = null;

/**
 * Every family this device has, out of the ones asked about.
 *
 * Worked out once and kept: the probe is a few dozen `measureText` calls, which
 * is nothing on its own and is not something to repeat every time a panel is
 * drawn. The set cannot change under a running app — installing a font is not
 * something that happens between two renders of a sidebar.
 */
export function systemFonts(): FontChoice[] {
  if (found) return found;
  const context = probeContext();
  if (!context) {
    found = [...GENERIC_FONTS];
    return found;
  }

  const baseline = new Map<string, number>();
  for (const generic of GENERICS) {
    context.font = `${PROBE_SIZE}px ${generic}`;
    baseline.set(generic, context.measureText(PROBE).width);
  }

  const installed: FontChoice[] = [];
  for (const family of CANDIDATES) {
    if (!hasFamily(context, family, baseline)) continue;
    // Quoted, so a family with a space in it is one family rather than a
    // stack of nonsense, and backed by a generic for the day a document made
    // here is opened somewhere that does not have it.
    installed.push({ id: `"${family}", sans-serif`, name: family });
  }

  found = [...GENERIC_FONTS, ...installed];
  return found;
}

/** Whether one family renders differently from every generic behind it. */
function hasFamily(
  context: CanvasRenderingContext2D,
  family: string,
  baseline: ReadonlyMap<string, number>,
): boolean {
  return GENERICS.some((generic) => {
    context.font = `${PROBE_SIZE}px "${family}", ${generic}`;
    const width = context.measureText(PROBE).width;
    return Math.abs(width - (baseline.get(generic) ?? width)) > 0.5;
  });
}

/**
 * The name to show for whatever a note is set to.
 *
 * A document can name a family this device has not got — it was written
 * somewhere else, or somebody uninstalled something — and the row still has to
 * say what the note is set to rather than going blank or lying about it. The
 * stored id is unpicked back into a readable name for exactly that case.
 */
export function fontLabel(id: string): string {
  const known = systemFonts().find((font) => font.id === id);
  if (known) return known.name;
  const first = id.split(",")[0]?.trim() ?? id;
  return first.replace(/^["']|["']$/g, "") || id;
}

let probing: CanvasRenderingContext2D | null | undefined;
function probeContext(): CanvasRenderingContext2D | null {
  if (probing !== undefined) return probing;
  try {
    probing = document.createElement("canvas").getContext("2d");
  } catch {
    probing = null;
  }
  return probing;
}
