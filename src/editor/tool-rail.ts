/**
 * The tools, on two columns down the left edge of the canvas.
 *
 * They were one column, split by a gap into "the game canvas's" and "the
 * drawing layer's". The gap was doing too much work: it was the only thing
 * saying that Pencil and Select answer to different owners, and the column
 * grew a *second* column under it whenever PSD Edit mode was up — a rail
 * whose buttons moved under your hand.
 *
 * Two columns now, and which end of the screen a column hangs from is the
 * distinction the gap was carrying:
 *
 * **The rail**, from the top, is what you do *to* the canvas: Select and
 * Pan, the pointer and the camera, which is what the canvas does when nothing
 * else is chosen. Point and Boundary used to hang under them and are off the
 * toolbar now — see `UNOFFERED`.
 *
 * **The drawing toolbar**, from the bottom, is the ink: Pencil, Pattern,
 * Shape, Fill and Text. Fill and Pattern used to be reachable only inside PSD
 * Edit mode, from that second rail. They are the same tools everywhere, so
 * they are on the toolbar with the rest of the ink, and PSD Edit mode borrows
 * them rather than owning them.
 *
 * **Lasso and Slice stand just above it, as a group of their own.** Neither
 * lays a mark down: both act on strokes that are already there, one picking
 * them up and the other cutting them, so they are held a few pixels apart
 * from the brushes rather than mixed in among them.
 *
 * **Text is on the ink column rather than the rail**, although what it makes
 * is a document object and its gesture is a tap, the way Point's is. The two
 * columns are about *ownership*, and what a word on the canvas is for is
 * saying something on the artwork — it is a note in the margin, and the next
 * thing anybody does with one is turn it into pixels. It is the only tool on
 * that column that does not hand the pointer to the drawing layer, which is
 * the cost of putting it where it belongs.
 *
 * Three of the six paint with the **library** rather than with a colour —
 * Pattern always, Shape always, Fill when it is aimed at one — and all three
 * are set from the same control in the inspector's TOOL zone. See
 * `editor/paint-picker.ts`.
 *
 * Both are columns of the same 45px buttons, so the two read as one
 * vocabulary held apart rather than as two kinds of chrome. A hand resting on
 * an iPad's glass is nearer the bottom corner than the top one, which is the
 * right way round: the ink is what a hand is doing most of the time.
 *
 * There is still no Fill *region* tool and no Boundary-from-strokes tool.
 * Both of those are actions on something already selected — a run of grid
 * spaces, a group of strokes — rather than modes you enter.
 */

import { h, ICONS, icon } from "../lib/dom";
import type { TileVerb } from "../lib/tile-tools";
import type { LayerKind, ToolId } from "../lib/types";

/**
 * Which column a tool sits in. `strokes` is the short group standing on top
 * of the drawing toolbar — see the header.
 */
export type Bar = "rail" | "strokes" | "draw";

export interface ToolSpec {
  id: ToolId;
  name: string;
  path: string | readonly string[];
  bar: Bar;
}

export const TOOLS: ToolSpec[] = [
  { id: "select", name: "Select", bar: "rail", path: ICONS.select },
  { id: "pan", name: "Pan", bar: "rail", path: ICONS.hand },
  { id: "point", name: "Point", bar: "rail", path: ICONS.point },
  { id: "zone", name: "Boundary", bar: "rail", path: ICONS.boundary },
  { id: "lasso", name: "Lasso", bar: "strokes", path: ICONS.lasso },
  // Its id is still "eraser" — a document says nothing about tools, but the
  // type and the routing do, and renaming those would be churn for a label.
  { id: "eraser", name: "Slice", bar: "strokes", path: ICONS.slice },
  { id: "pencil", name: "Pencil", bar: "draw", path: ICONS.pencil },
  { id: "pattern", name: "Pattern", bar: "draw", path: ICONS.pixels },
  { id: "shape", name: "Shape", bar: "draw", path: ICONS.shape },
  { id: "fill", name: "Fill", bar: "draw", path: ICONS.fill },
  { id: "text", name: "Text", bar: "draw", path: ICONS.text },
  // A tile layer's three, and nowhere else's. They stand where the ink does,
  // on the bottom column, because they are what a hand is doing most of the
  // time on a tile layer — the same argument that put the brushes there.
  { id: "stamp", name: "Stamp", bar: "draw", path: ICONS.stamp },
  { id: "sweep", name: "Sweep fill", bar: "draw", path: ICONS.sweep },
  { id: "shapefill", name: "Shape fill", bar: "draw", path: ICONS.shapefill },
];

/**
 * The tools no toolbar offers.
 *
 * Point and Boundary hung under Select and Pan, and came off the toolbar
 * because neither earned the room: both are things the PSD pipeline already
 * brings in from a file's own `P |` and `Z |` layers, and a button for
 * putting one down by hand was two more glyphs on a column whose job is the
 * pointer and the camera. What they leave behind is untouched — a point or a
 * boundary already in the document still draws, selects and inspects — and
 * so is the routing behind them, so putting either back is this line.
 */
const UNOFFERED: readonly ToolId[] = ["point", "zone"];

/**
 * The letter that picks a tool up, keyed by the letter.
 *
 * **S is two tools, and never both at once.** Stamp is a tile layer's and
 * Shape is everywhere else's — `toolsFor` never offers the two together — so
 * the key means whichever of them the layer has, the way the brush in hand
 * already follows the layer. The first one offered wins.
 *
 * Pan has no letter: it is the space bar, held, which `shortcuts.ts` owns,
 * and the tooltip says so.
 */
export const TOOL_KEYS: Readonly<Record<string, readonly ToolId[]>> = {
  v: ["select"],
  t: ["text"],
  l: ["lasso"],
  p: ["pattern"],
  s: ["stamp", "shape"],
  e: ["eraser"],
};

/**
 * The canvas states that take the toolbars away, or the pointer with them:
 * Plan mode, which has its own bar, and the three modes that own every
 * gesture. A tool key does nothing under any of them.
 */
export const TOOLBARS_DOWN = ".planning, .extruding, .colliding, .masking";

/** Which tool a key picks up among those on offer, if any. */
export function toolForKey(
  key: string,
  offered: readonly ToolId[],
): ToolId | null {
  const tools = TOOL_KEYS[key.toLowerCase()];
  return tools?.find((tool) => offered.includes(tool)) ?? null;
}

/** What a tool's tooltip names as its shortcut, or "" for one with none. */
export function shortcutFor(tool: ToolId): string {
  if (tool === "pan") return "Hold Space";
  for (const [key, tools] of Object.entries(TOOL_KEYS)) {
    if (tools.includes(tool)) return key.toUpperCase();
  }
  return "";
}

/** The three a tile layer offers, and the three nothing else does. */
const TILE_TOOLS: readonly ToolId[] = ["stamp", "sweep", "shapefill"];

/**
 * Which tools a layer of this kind offers.
 *
 * **A tile layer swaps the ink out rather than re-pointing it.** The first
 * version kept the Pencil and Fill and gave them a second meaning there, and
 * that was wrong in a way worth writing down: a tool whose meaning depends on
 * which layer is selected is a tool nobody can learn, and every panel
 * describing it has to describe two things. So the seven ink tools go and
 * Stamp, Sweep fill and Shape fill arrive — three tools that are exactly what
 * they are called, with their own options and their own panel.
 *
 * **The rail is the same on every layer**: Select and Pan, the pointer and
 * the camera, both of which do something on a tile layer too — Select
 * catches a run of tiles there the way it catches placed images elsewhere.
 * A toolbar is a list of what you can do; a button that cannot act on the
 * layer you are looking at is a question the user has to answer by pressing
 * it.
 *
 * **`psdEditing` is the one exception, and it is not one really.** A PSD
 * opened in PSD Edit mode over a tile layer is ordinary artwork being drawn
 * on — the layer underneath it happens to hold tiles, which has nothing to do
 * with what the pointer is for while a file is open. So the ink comes back
 * for the length of the session and the two tile tools step aside, because
 * there is nowhere for a tile to go while the canvas belongs to a file.
 *
 * The lineup will grow — a tile picker and a terrain brush are both things
 * Tiled has and this does not.
 */
export function toolsFor(kind: LayerKind, psdEditing = false): ToolId[] {
  const tiling = kind === "tile" && !psdEditing;
  return TOOLS.filter((tool) => {
    if (UNOFFERED.includes(tool.id)) return false;
    if (tool.bar === "rail") return true;
    return TILE_TOOLS.includes(tool.id) === tiling;
  }).map((tool) => tool.id);
}

/**
 * What the tool in hand means for tiles, if anything.
 *
 * `null` is every other tool, and it is what makes a tile layer still
 * selectable and pannable — see `toolsFor`.
 */
export function tileVerbOf(tool: ToolId): TileVerb {
  if (tool === "stamp") return "stamp";
  if (tool === "sweep") return "sweep";
  if (tool === "shapefill") return "shapefill";
  return null;
}

/**
 * The tools that can be turned round and used as erasers.
 *
 * Every tool that *makes a mark*, which is the whole of the rule: what the
 * tool would have drawn is what it takes out instead, so a Pattern brush set
 * to erase removes exactly the lattice cells it would have revealed and a
 * Shape brush takes back the tiles it would have stamped. Slice is not here —
 * it cuts a stroke in two and leaves both halves, which is a different thing
 * that used to share the name Eraser — and neither are Lasso, Select, Pan,
 * Point or Boundary, none of which draw anything.
 *
 * These four are what PSD Edit mode erases with too. It used to carry a Rub
 * of its own — the pencil with erasing already on, as a toggle on that mode's
 * bar — and four brushes that can be turned round is the same capability with
 * nothing to learn twice. See `editor/tool-routing.ts`.
 */
export const ERASABLE: readonly ToolId[] = [
  "pencil",
  "pattern",
  "shape",
  "fill",
  // The three tile tools are erasers turned round like every other tool that
  // makes a mark: what Stamp would put down it takes off, and what a fill
  // would cover it clears. That is the whole of how tiles are removed —
  // there is no separate rubber, for the reason there is none anywhere else.
  "stamp",
  "sweep",
  "shapefill",
];

/** Whether a tool can be used as an eraser at all. */
export function canErase(tool: ToolId): boolean {
  return ERASABLE.includes(tool);
}

/**
 * How long a press on a tool has to be held before it means "and as an
 * eraser", in milliseconds.
 *
 * Long enough that tapping a tool quickly never trips it, short enough that
 * it is discoverable by leaning on a button — and it is the *second* way in,
 * not the only one: the same switch is the first row of the tool's own panel.
 */
export const ERASE_HOLD_MS = 500;

/**
 * What a tool is called, on its tooltip and to a screen reader.
 *
 * Empty for a tool nothing names, which is what the test guards against: a
 * tool added to `ToolId` and forgotten in `TOOLS` is a tool with no button
 * anywhere and a blank name the moment something puts it in your hand, and
 * nothing else would say so.
 *
 * There used to be a second table under this one for the tools with no button
 * on either column, and Rub — PSD Edit mode's own eraser — was its only
 * entry. The mode erases with the four brushes turned round now, so every
 * tool is in a column and the exception has nothing to hold.
 */
export function toolName(tool: ToolId): string {
  return TOOLS.find((t) => t.id === tool)?.name ?? "";
}

export class ToolRail {
  /** What you do to the canvas, hanging from the top-left corner. */
  readonly root: HTMLElement;
  /**
   * The strip above the first tool, for whatever belongs at the head of the
   * column without being one of its buttons.
   *
   * There is one thing that goes there — the zoom badge, which is a readout
   * about the *view* rather than a tool — and a slot is the honest way to say
   * so, exactly as the code modal's file column has one for its Find strip.
   * The rail keeps it across `setOffered`, which replaces the buttons.
   */
  readonly head: HTMLElement;
  /**
   * The ink, standing on the bottom-left corner: two groups in one column,
   * Lasso and Slice a gap above the brushes. One element, so a mode that
   * lifts or hides the toolbar moves both groups together.
   */
  readonly drawBar: HTMLElement;
  private readonly buttons = new Map<ToolId, HTMLButtonElement>();
  /** Which column each tool hangs in, so `setOffered` can put it back. */
  private readonly hosts: Record<Bar, HTMLElement>;
  /** What is currently in the DOM, so a re-offer of the same set is free. */
  private offered = "";
  private current: ToolId = "select";
  /** Which tools are turned round, so the buttons can carry the slash. */
  private erasing: ReadonlySet<ToolId> = new Set();

  constructor(
    onPick: (tool: ToolId) => void,
    /**
     * A tool held down rather than tapped: pick it up *and* turn it round.
     *
     * Optional so that the rail can still be built on its own — the tool-bar
     * tests do exactly that — and because a rail with no eraser behind it is
     * a rail whose long press should simply be a press.
     */
    onHold?: (tool: ToolId) => void,
  ) {
    this.root = h("div", { class: "tool-rail" });
    this.head = h("div", { class: "tool-rail-head" });
    this.root.appendChild(this.head);
    const strokes = h("div", { class: "tool-group" });
    const draw = h("div", { class: "tool-group" });
    this.drawBar = h("div", { class: "tool-rail draw-bar" }, strokes, draw);

    const hosts: Record<Bar, HTMLElement> = {
      rail: this.root,
      strokes,
      draw,
    };
    this.hosts = hosts;

    for (const tool of TOOLS) {
      if (UNOFFERED.includes(tool.id)) continue;
      // A press held on an erasable tool turns it round. The timer is armed
      // on the way down and cancelled by anything that ends the press; when
      // it does fire, the click that follows is swallowed, or letting go
      // would immediately pick the tool up again in its ordinary mode.
      let timer: number | null = null;
      let held = false;
      const hold = canErase(tool.id) && onHold ? onHold : null;
      const disarm = (): void => {
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
      };

      const shortcut = shortcutFor(tool.id);
      const button = h(
        "button",
        {
          class: "tool-btn",
          "aria-label": tool.name,
          "aria-keyshortcuts": tool.id === "pan" ? "Space" : shortcut || null,
          "aria-pressed": String(tool.id === this.current),
          onPointerDown: () => {
            if (!hold) return;
            held = false;
            disarm();
            timer = window.setTimeout(() => {
              timer = null;
              held = true;
              this.setTool(tool.id);
              hold(tool.id);
            }, ERASE_HOLD_MS);
          },
          onPointerUp: disarm,
          onPointerLeave: () => {
            disarm();
            // Dragged off the button: the press is not a press any more, and
            // the click it would have made is not coming either.
            held = false;
          },
          onPointerCancel: disarm,
          onClick: () => {
            if (held) {
              held = false;
              return;
            }
            this.setTool(tool.id);
            onPick(tool.id);
          },
        },
        icon(tool.path, 17),
        // The tooltip: the name, and the key that picks the tool up. A child
        // rather than a `title`, which takes a second to appear, cannot be
        // styled, and shows a finger nothing — see `.tool-tip`.
        h(
          "span",
          { class: "tool-tip", "aria-hidden": "true" },
          tool.name,
          shortcut ? h("kbd", { text: shortcut }) : null,
        ),
      );
      this.buttons.set(tool.id, button);
      hosts[tool.bar].appendChild(button);
    }
  }

  /**
   * Which tools this rail is offering.
   *
   * Taken **out of the DOM** rather than hidden, which is not a style choice
   * and was a bug. `hidden` sets an attribute the browser's own stylesheet
   * turns into `display: none`, and `.tool-btn` sets `display: flex` — an
   * author rule, which beats the browser's whatever the specificity. So the
   * withheld tools went on showing, and a tile layer offered the whole ink
   * column beside its own two.
   *
   * Detaching is also the only thing that keeps the rule drawn *between*
   * buttons right: it is `:first-child` that has no top border, and with the
   * withheld ones still in the list the first tool you could actually see
   * would carry a line above it. There is no "first visible" selector, and a
   * sibling combinator matches across a hidden element.
   *
   * Withheld rather than disabled, for the reason that has not changed: a
   * disabled button is one somebody has to work out the rule behind, and the
   * rule here is about the layer rather than about the moment.
   */
  setOffered(tools: readonly ToolId[]): void {
    const wanted = tools.join(",");
    // Rebuilt only when the set really moved. `apply` runs on every tool
    // pick, and replacing eleven elements each time would take the focus
    // with it every time somebody tabbed to a tool and pressed it.
    if (wanted === this.offered) return;
    this.offered = wanted;
    // The head survives, because what is in it is not a tool: see `head`.
    this.root.replaceChildren(this.head);
    this.hosts.strokes.replaceChildren();
    this.hosts.draw.replaceChildren();
    for (const tool of TOOLS) {
      if (!tools.includes(tool.id)) continue;
      const button = this.buttons.get(tool.id);
      if (button) this.hosts[tool.bar].appendChild(button);
    }
  }

  setTool(tool: ToolId): void {
    this.current = tool;
    for (const [id, button] of this.buttons) {
      button.setAttribute("aria-pressed", String(id === tool));
    }
  }

  /** What this layer's toolbar has on it right now. */
  get offeredTools(): ToolId[] {
    return this.offered ? (this.offered.split(",") as ToolId[]) : [];
  }

  /**
   * Which tools are currently turned round.
   *
   * A class rather than an attribute because it is not a second pressed
   * state: a tool can be an eraser while another one is in hand, and the
   * button has to say so without claiming to be the tool you are holding.
   * The slash itself is CSS — see `.tool-btn.erasing` in `editor.css`.
   */
  setErasing(tools: ReadonlySet<ToolId>): void {
    this.erasing = tools;
    for (const [id, button] of this.buttons) {
      const on = tools.has(id);
      button.classList.toggle("erasing", on);
      const name = toolName(id);
      button.setAttribute("aria-label", on ? `${name} (eraser)` : name);
    }
  }

  /** Whether a tool is currently turned round. */
  isErasing(tool: ToolId): boolean {
    return this.erasing.has(tool);
  }

  get tool(): ToolId {
    return this.current;
  }
}
