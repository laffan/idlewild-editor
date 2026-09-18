/**
 * Which of the canvas's own marks are showing, above the minimap.
 *
 * Four of the things on this canvas are drawn *about* the document rather
 * than being part of it: the lattice itself, the dashed boundary around the
 * screen the game opens at, the crosshair on world `0, 0`, and the minimap.
 * They are all useful and none of them is useful all of the time — a boundary
 * is what you lay a building against and then want out of the way, and the map
 * is worth a third of the sidebar right up until you are working close in.
 *
 * So they get switches, and they get them **here** rather than behind the
 * header's menu. A switch belongs beside the thing it switches: the Minimap
 * row sits directly on top of the minimap it hides, and the rest are in
 * the column you are already looking at when you notice a mark is in the way.
 * The section is folded to begin with, because four rows of chrome
 * permanently above the map cost the map more than switches you act on rarely
 * are worth — and the heading stays, so what is behind it is one tap away and
 * named.
 *
 * **The grid belongs on this list for the same reason the others do.** It is
 * the most overlay-ish thing the canvas draws: it exists nowhere in the game,
 * it is recomputed from the camera rather than stored, and a scene drawn
 * mostly of artwork is one where a pale blue lattice printed over every sprite
 * is exactly the mark you want out of the way while you judge what you drew.
 * It sits **first**, because it is the ground the other three are marks *on* —
 * and because the list then reads outward from the canvas: the lattice, the
 * two things about the game's screen, and finally the picture of the whole
 * scene.
 *
 * A project with no lattice — the blank template, whose cells are single
 * pixels — gets no row rather than a dead one: see `hasLattice`.
 *
 * **The rest of the order is not the order they were asked for.** Boundary and
 * centre point are the two marks `screen-guide.ts` draws — one subject, so
 * they go together — and Minimap is last because that puts it against its own
 * map.
 *
 * **What is switched is the panel's state, not the document's.** Which marks
 * somebody wants on is a per-install convenience, like a sidebar's width or a
 * folded inspector section, so it lives in `localStorage` and never reaches
 * `doc.json`. Two people opening the same project see their own answer, and
 * no overlay switch has ever been a thing to undo.
 */

import { h, ICONS, icon } from "../lib/dom";
import type { Minimap } from "./minimap";
import type { ScreenGuide } from "./screen-guide";

/**
 * The half of the canvas this panel needs: whether the lattice is drawn.
 *
 * Named as what is wanted rather than typed as `WorldScene`, so the panel
 * carries no dependency on the scene — and so the switch can be exercised in a
 * test with four lines of object literal.
 */
export interface LatticeHost {
  setGridVisible(on: boolean): void;
}

const STORAGE_KEY = "idlewild.overlays";

/** What the panel remembers: the four marks, and whether it is folded. */
export interface OverlayState {
  grid: boolean;
  boundary: boolean;
  centre: boolean;
  minimap: boolean;
  open: boolean;
}

/**
 * Everything on, and the section folded. What a project opens as.
 *
 * The two halves of that are not the same decision. Every **mark** starts
 * showing, because a mark switched off by default is a mark somebody has to be
 * told exists. The **section** starts folded, because it is chrome about the
 * canvas rather than part of it: four rows permanently above the map cost the
 * map a third of what it had, every session, to say something you act on
 * rarely. The heading stays, so it is one tap away and still says what is
 * behind it.
 */
export const OVERLAY_DEFAULTS: OverlayState = {
  grid: true,
  boundary: true,
  centre: true,
  minimap: true,
  open: false,
};

/**
 * The stored state, with anything missing or malformed taken from the
 * defaults.
 *
 * Defensive in the way `inspect-collapse.ts` is, and for the same three
 * reasons: private browsing, blocked site data, and something else's JSON
 * under the same key. Everything on is a fine place to start from, and it is
 * the only starting point that cannot hide a mark somebody is looking for.
 */
export function readOverlays(raw: string | null): OverlayState {
  if (!raw) return { ...OVERLAY_DEFAULTS };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...OVERLAY_DEFAULTS };
    const record = parsed as Record<string, unknown>;
    const state = { ...OVERLAY_DEFAULTS };
    for (const key of Object.keys(OVERLAY_DEFAULTS) as (keyof OverlayState)[]) {
      if (typeof record[key] === "boolean") state[key] = record[key];
    }
    return state;
  } catch {
    return { ...OVERLAY_DEFAULTS };
  }
}

/** One switch, as the rows are described below. */
interface Row {
  key: Exclude<keyof OverlayState, "open">;
  label: string;
  title: string;
}

/**
 * Which rows a project gets.
 *
 * Every project has the three marks. The lattice is the one that can be
 * missing: the blank template's cells are single pixels, so `Grid` there would
 * be a switch over something that was never drawn — and `grid-renderer.ts`
 * returns before it strokes anything. A row that does nothing is worse than no
 * row, because it says the feature is broken rather than absent.
 */
export function overlayRows(hasLattice: boolean): readonly Row[] {
  return hasLattice ? ROWS : ROWS.filter((row) => row.key !== "grid");
}

const ROWS: readonly Row[] = [
  { key: "grid", label: "Grid", title: "The lattice the document is measured in" },
  {
    key: "boundary",
    label: "Camera boundary",
    title: "The screen the game opens at",
  },
  { key: "centre", label: "Centre point", title: "World 0, 0" },
  { key: "minimap", label: "Minimap", title: "Where you are standing" },
];

export class OverlaysPanel {
  /** The whole bottom of the sidebar: these switches, and the map under them. */
  readonly root: HTMLElement;

  private readonly minimap: Minimap;
  private readonly section: HTMLElement;
  private readonly body: HTMLElement;
  private readonly rows: readonly Row[];
  private readonly buttons = new Map<Row["key"], HTMLElement>();
  private state: OverlayState;
  /** Handed over once it exists — see `setGuide`. */
  private guide: ScreenGuide | null = null;
  /** And the canvas, once it has booted — see `setLattice`. */
  private lattice: LatticeHost | null = null;

  /**
   * @param hasLattice whether this project's grid draws one — `Grid.snaps`.
   */
  constructor(minimap: Minimap, hasLattice = true) {
    this.minimap = minimap;
    this.rows = overlayRows(hasLattice);
    this.state = readOverlays(get(STORAGE_KEY));

    this.body = h("div", { class: "overlays-body" });
    for (const row of this.rows) {
      // The whole width is the switch. Nothing else is on the row — no name to
      // type into, no grip — so a finger should be able to land anywhere, which
      // is the same argument Code's layer directory makes about its own rows.
      const button = h(
        "button",
        {
          class: "overlays-row",
          title: row.title,
          onClick: () => this.set(row.key, !this.state[row.key]),
        },
        h("span", { class: "overlays-name", text: row.label }),
        h("span", { class: "overlays-eye" }),
      );
      this.buttons.set(row.key, button);
      this.body.appendChild(button);
    }

    this.section = h(
      "div",
      { class: "overlays" },
      h(
        "button",
        {
          class: "overlays-head",
          title: "Show or hide the canvas's own marks",
          onClick: () => this.setOpen(!this.state.open),
        },
        h("span", { class: "overlays-chevron" }, icon(ICONS.chevronDown, 14)),
        h("span", { class: "panel-title m", text: "Overlays" }),
      ),
      this.body,
    );

    this.root = h("div", { class: "sidebar-footer" }, this.section, minimap.root);
    this.paint();
  }

  /**
   * The guide, once the canvas it draws on exists.
   *
   * Handed over rather than reached through a closure because the *first*
   * application is not deferred: a boundary somebody switched off last week
   * has to be off before the first frame, not after the first toggle. The
   * guide is built after this panel — it measures the row a running game
   * fills, which the layout has to exist for — so this is the moment it can
   * be told.
   */
  setGuide(guide: ScreenGuide): void {
    this.guide = guide;
    this.apply();
  }

  /**
   * The canvas, once it has booted.
   *
   * Same handoff as `setGuide` and for the same reason: a lattice somebody
   * switched off last week has to be off on the first frame of the scene
   * rather than on the first toggle. The scene is the last thing the editor
   * builds — it needs the element it draws into — so this is the moment it
   * exists to be told.
   */
  setLattice(lattice: LatticeHost): void {
    this.lattice = lattice;
    this.apply();
  }

  private set(key: Row["key"], on: boolean): void {
    this.state = { ...this.state, [key]: on };
    this.save();
    this.paint();
    this.apply();
  }

  private setOpen(open: boolean): void {
    this.state = { ...this.state, open };
    this.save();
    this.paint();
  }

  /** The switches, as they stand. */
  private paint(): void {
    this.section.classList.toggle("closed", !this.state.open);
    for (const row of this.rows) {
      const button = this.buttons.get(row.key);
      if (!button) continue;
      const on = this.state[row.key];
      button.classList.toggle("off", !on);
      const eye = button.lastElementChild;
      if (eye) {
        eye.replaceChildren(icon(on ? ICONS.eye : ICONS.eyeOff, 16));
      }
    }
  }

  /** And what they mean, on the canvas. */
  private apply(): void {
    this.minimap.setVisible(this.state.minimap);
    this.guide?.setMarksVisible(this.state.boundary, this.state.centre);
    this.lattice?.setGridVisible(this.state.grid);
  }

  destroy(): void {
    this.minimap.destroy();
    this.root.remove();
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Not worth a word: the switches still work for this session, and a
      // browser that refuses storage refuses every other panel's too.
    }
  }
}

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
