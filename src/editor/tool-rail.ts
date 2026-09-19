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
 * **The rail**, from the top, is what you do *to* the canvas: Select, Pan,
 * Point and Boundary. The first two are the camera and the pointer, which is
 * what the canvas does when nothing else is chosen. The other two make
 * something out of bare ground — nothing already on the canvas can be
 * promoted into either, so putting one down has to be a thing you do to a
 * patch of empty grid.
 *
 * **The drawing toolbar**, from the bottom, is the ink: Pencil, Pattern,
 * Shape, Slice, Lasso, Fill and Text. Fill and Pattern used to be reachable
 * only inside PSD Edit mode, from that second rail. They are the same tools
 * everywhere, so they are on the toolbar with the rest of the ink, and PSD
 * Edit mode borrows them rather than owning them.
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
 * Both are columns, and both are 56px buttons, so the two read as one
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

/** Which column a tool sits in. */
export type Bar = "rail" | "draw";

export interface ToolSpec {
  id: ToolId;
  name: string;
  /** What the button's tooltip says after the name, when there is more. */
  hint?: string;
  path: string | readonly string[];
  bar: Bar;
}

export const TOOLS: ToolSpec[] = [
  { id: "select", name: "Select", bar: "rail", path: ICONS.select },
  { id: "pan", name: "Pan", bar: "rail", path: ICONS.hand },
  {
    id: "point",
    name: "Point",
    hint: "Tap to put a named place down; a drag still pans",
    bar: "rail",
    path: ICONS.point,
  },
  {
    id: "zone",
    name: "Boundary",
    hint: "Sweep an outline and it becomes a blocking zone",
    bar: "rail",
    path: ICONS.boundary,
  },
  { id: "pencil", name: "Pencil", bar: "draw", path: ICONS.pencil },
  {
    id: "pattern",
    name: "Pattern",
    hint: "Reveal a pixel pattern, pinned to the world",
    bar: "draw",
    path: ICONS.pixels,
  },
  {
    id: "shape",
    name: "Shape",
    hint: "Stamp a shape into every grid space you cross",
    bar: "draw",
    path: ICONS.shape,
  },
  {
    // Its id is still "eraser" — a document says nothing about tools, but the
    // type and the routing do, and renaming those would be churn for a label.
    id: "eraser",
    name: "Slice",
    hint: "Drag across a stroke to cut it in two where the blade passes",
    bar: "draw",
    path: ICONS.slice,
  },
  {
    id: "lasso",
    name: "Lasso",
    hint: "Sweep around strokes to select them",
    bar: "draw",
    path: ICONS.lasso,
  },
  {
    id: "fill",
    name: "Fill",
    hint: "Sweep a closed shape, or tap its corners out",
    bar: "draw",
    path: ICONS.fill,
  },
  {
    id: "text",
    name: "Text",
    hint: "Tap to write on the canvas; it becomes a PSD when you say so",
    bar: "draw",
    path: ICONS.text,
  },
  // A tile layer's two, and nowhere else's. They stand where the ink does,
  // on the bottom column, because they are what a hand is doing most of the
  // time on a tile layer — the same argument that put the brushes there.
  {
    id: "stamp",
    name: "Stamp",
    hint: "Put the tiles picked in the palette down; drag to lay a run",
    bar: "draw",
    path: ICONS.stamp,
  },
  {
    id: "sweep",
    name: "Sweep fill",
    hint: "Draw a shape and every space inside it is filled",
    bar: "draw",
    path: ICONS.sweep,
  },
];

/** The two a tile layer offers, and the two nothing else does. */
const TILE_TOOLS: readonly ToolId[] = ["stamp", "sweep"];

/**
 * What is left of the rail on a tile layer.
 *
 * **Select and Pan, and not Point or Boundary.** The first two are what the
 * canvas does when nothing else is chosen — Pan is the camera, and Select
 * catches a run of tiles there the way it catches placed images elsewhere,
 * so both do something. The other two make a *document object* on the layer
 * they are used on, and a tile layer is ground rather than a place things
 * stand: a named place belongs on the layer the thing it names is on, and a
 * boundary belongs with the objects it blocks. Showing them would be showing
 * two buttons whose result is invisible on the layer you used them on.
 */
const TILE_RAIL: readonly ToolId[] = ["select", "pan"];

/**
 * Which tools a layer of this kind offers.
 *
 * **A tile layer swaps the ink out rather than re-pointing it.** The first
 * version kept the Pencil and Fill and gave them a second meaning there, and
 * that was wrong in a way worth writing down: a tool whose meaning depends on
 * which layer is selected is a tool nobody can learn, and every panel
 * describing it has to describe two things. So the seven ink tools go and
 * Stamp and Sweep fill arrive — two tools that are exactly what they are
 * called, with their own options and their own panel.
 *
 * **And the rail is cut to the two that do something there** — see
 * `TILE_RAIL`. A toolbar is a list of what you can do; a button that cannot
 * act on the layer you are looking at is a question the user has to answer by
 * pressing it.
 *
 * **`psdEditing` is the one exception, and it is not one really.** A PSD
 * opened in PSD Edit mode over a tile layer is ordinary artwork being drawn
 * on — the layer underneath it happens to hold tiles, which has nothing to do
 * with what the pointer is for while a file is open. So the ink comes back
 * for the length of the session and the two tile tools step aside, because
 * there is nowhere for a tile to go while the canvas belongs to a file.
 *
 * The lineup will grow — a rectangle, a tile picker and a terrain brush are
 * all things Tiled has and this does not. Two is where it starts.
 */
export function toolsFor(kind: LayerKind, psdEditing = false): ToolId[] {
  const tiling = kind === "tile" && !psdEditing;
  return TOOLS.filter((tool) => {
    if (tool.bar === "rail") return !tiling || TILE_RAIL.includes(tool.id);
    return TILE_TOOLS.includes(tool.id) === tiling;
  }).map((tool) => tool.id);
}

/**
 * What the tool in hand means for tiles, if anything.
 *
 * `null` is every other tool, and it is what makes a tile layer still
 * selectable, pannable and pointable — see `toolsFor`.
 */
export function tileVerbOf(tool: ToolId): TileVerb {
  if (tool === "stamp") return "stamp";
  if (tool === "sweep") return "sweep";
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
  // The two tile tools are erasers turned round like every other tool that
  // makes a mark: what Stamp would put down it takes off, and what a sweep
  // would fill it clears. That is the whole of how tiles are removed — there
  // is no separate rubber, for the reason there is none anywhere else here.
  "stamp",
  "sweep",
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
 * What the label beside the canvas calls a tool.
 *
 * Empty for a tool nothing names, which is what the test guards against: a
 * tool added to `ToolId` and forgotten in `TOOLS` is a tool with no button
 * anywhere and a blank label the moment something puts it in your hand, and
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
  /** The ink, standing on the bottom-left corner. */
  readonly drawBar: HTMLElement;
  readonly label: HTMLElement;
  private readonly buttons = new Map<ToolId, HTMLButtonElement>();
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
    this.label = h("div", { class: "tool-name m", text: "Select" });
    this.drawBar = h("div", { class: "tool-rail draw-bar" });

    const hosts: Record<Bar, HTMLElement> = {
      rail: this.root,
      draw: this.drawBar,
    };

    for (const tool of TOOLS) {
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

      const button = h(
        "button",
        {
          class: "tool-btn",
          title: tool.hint ? `${tool.name} — ${tool.hint}` : tool.name,
          "aria-label": tool.name,
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
        icon(tool.path, 21),
      );
      this.buttons.set(tool.id, button);
      hosts[tool.bar].appendChild(button);
    }
  }

  /**
   * Which tools this rail is offering.
   *
   * Hidden rather than disabled: a disabled button is a button somebody has
   * to work out the rule behind, and the rule here is about the layer rather
   * than about the moment — see `toolsFor`. The rail is re-read whenever the
   * active layer moves, because that is the only thing that changes it.
   */
  setOffered(tools: readonly ToolId[]): void {
    for (const [id, button] of this.buttons) button.hidden = !tools.includes(id);
  }

  setTool(tool: ToolId): void {
    this.current = tool;
    for (const [id, button] of this.buttons) {
      button.setAttribute("aria-pressed", String(id === tool));
    }
    this.label.textContent = toolName(tool);
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
