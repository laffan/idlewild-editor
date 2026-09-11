/**
 * The Collider section, for a placed PSD and for a fill.
 *
 * One section in two shapes, because they are the same question asked of two
 * kinds of thing: *what does this stop?* A fill has always answered it with a
 * single switch, and that switch was the only collider in the editor; a
 * placed PSD now answers it with a switch and a shape, because a file covers
 * several spaces and rarely blocks all of them.
 *
 * Written here rather than in `inspector.ts` so that both panels read from
 * one place — the fill's version and the placement's version drifting apart
 * is how "walkable" and "blocking" came to mean two different things in the
 * first place.
 *
 * What the section *says* is worked out by `colliderPanel`, which is a
 * function of the document and nothing else. The two answers worth being sure
 * of — that there is always a shape to show, and that Edit is offered
 * wherever there is a grid to draw on — are then testable without a DOM, the
 * same bargain `game/resize.ts` and `lib/extrude.ts` make.
 */

import { h } from "../lib/dom";
import { describeCollider, resolveCollider } from "../lib/collider";
import type { Grid } from "../lib/grid";
import type { Collider, Extrusion, FillPatch, Layer } from "../lib/types";

/** What the section shows, before any of it is a DOM node. */
export interface ColliderPanel {
  /** Whether it stops a character at all. */
  blocks: boolean;
  /** The shape, and whether it is still the one the editor chose. */
  shape: string;
  /** The switch's label, which names what pressing it does. */
  toggle: string;
  /**
   * Whether the shape can be drawn.
   *
   * False only where the grid does not snap: a blank project's spaces are
   * single world pixels, so a collider there is the box the artwork covers
   * and there is nothing to paint. The panel says so rather than offering a
   * button that would be refused.
   */
  canEdit: boolean;
  /** The collider these are about, resolved — see `resolveCollider`. */
  collider: Collider;
}

export function colliderPanel(
  grid: Grid,
  layers: readonly Layer[],
  colliders: Record<string, Collider> | undefined,
  key: string,
  extrusion?: Extrusion,
): ColliderPanel {
  // Resolved rather than looked up: a key whose record has not been written
  // yet still has an answer, and it is the same one the document is about to
  // be given. A panel that said "nothing here" in that moment would be the
  // first thing anybody saw of this feature.
  const collider = resolveCollider(grid, layers, colliders, key, extrusion);
  return {
    blocks: collider.blocking,
    shape: `${describeCollider(grid, collider)}${
      collider.edited ? " · edited" : " · default"
    }`,
    toggle: collider.blocking ? "Make walkable" : "Make blocking",
    canEdit: grid.snaps,
    collider,
  };
}

export interface ColliderSectionOptions {
  /** The PSD the collider belongs to; the toggle is written against the key. */
  psdKey: string;
  panel: ColliderPanel;
  onToggle: (key: string, blocking: boolean) => void;
  onEdit: () => void;
}

export function colliderSection(options: ColliderSectionOptions): HTMLElement {
  const { panel } = options;
  const section = h(
    "div",
    { class: "inspect-section" },
    h("div", { class: "inspect-section-title m", text: "Collider" }),
    row("Blocks", panel.blocks ? "Yes" : "No"),
    // Whether the shape is still the one the editor chose is worth saying:
    // it is what decides whether re-importing the artwork or extruding it
    // again will move the collider with it.
    row("Shape", panel.shape),
    h("button", {
      class: "panel-btn",
      text: panel.toggle,
      onClick: () => options.onToggle(options.psdKey, !panel.blocks),
    }),
  );

  section.appendChild(
    panel.canEdit
      ? h("button", {
          class: "panel-btn primary",
          text: "Edit collider",
          onClick: () => options.onEdit(),
        })
      : h("div", {
          class: "field-hint",
          text:
            "This project has no grid to draw a collider on, " +
            "so it is the image's own box.",
        }),
  );
  return section;
}

/**
 * The same section for a fill, which has a switch and no shape.
 *
 * A fill *is* its spaces — they are the thing that was painted — so there is
 * nothing to draw here that dragging the fill would not do better. The one
 * difference worth keeping is the word: a fill has always stored `walkable`,
 * and the row says what it blocks so that both panels read alike.
 */
export function fillColliderSection(
  fill: FillPatch,
  onToggle: (walkable: boolean) => void,
): HTMLElement {
  return h(
    "div",
    { class: "inspect-section" },
    h("div", { class: "inspect-section-title m", text: "Collider" }),
    row("Blocks", fill.walkable ? "No" : "Yes"),
    h("button", {
      class: "panel-btn",
      text: fill.walkable ? "Make blocking" : "Make walkable",
      onClick: () => onToggle(!fill.walkable),
    }),
  );
}

function row(key: string, value: string): HTMLElement {
  return h(
    "div",
    { class: "inspect-row" },
    h("div", { class: "inspect-key m", text: key }),
    h("div", { class: "inspect-value", text: value }),
  );
}
