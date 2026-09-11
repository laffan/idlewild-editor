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
 */

import { h } from "../lib/dom";
import { describeCollider } from "../lib/collider";
import type { Grid } from "../lib/grid";
import type { Collider, FillPatch } from "../lib/types";

export interface ColliderSectionOptions {
  grid: Grid;
  /** The PSD the collider belongs to; the toggle is written against the key. */
  psdKey: string;
  /**
   * What the document holds for it. Undefined only in the moment between a
   * document being read and the scene filling its defaults in, which the
   * panel says rather than papering over.
   */
  collider: Collider | undefined;
  onToggle: (key: string, blocking: boolean) => void;
  onEdit: () => void;
}

export function colliderSection(options: ColliderSectionOptions): HTMLElement {
  const { collider, grid } = options;
  const section = h(
    "div",
    { class: "inspect-section" },
    h("div", { class: "inspect-section-title m", text: "Collider" }),
  );

  if (!collider) {
    section.appendChild(
      h("div", { class: "field-hint", text: "Not worked out yet." }),
    );
    return section;
  }

  section.append(
    row("Blocks", collider.blocking ? "Yes" : "No"),
    // Whether the shape is still the one the editor chose is worth saying:
    // it is what decides whether re-importing the artwork or extruding it
    // again will move the collider with it.
    row(
      "Shape",
      `${describeCollider(grid, collider)}${collider.edited ? " · edited" : " · default"}`,
    ),
    h("button", {
      class: "panel-btn",
      text: collider.blocking ? "Make walkable" : "Make blocking",
      onClick: () => options.onToggle(options.psdKey, !collider.blocking),
    }),
  );

  // Drawing spaces needs spaces to draw on. A blank project's collider is the
  // box the artwork covers and there is nothing to paint, so the button is
  // replaced by the reason rather than being offered and refused.
  if (grid.snaps) {
    section.appendChild(
      h("button", {
        class: "panel-btn",
        text: "Edit collider",
        onClick: () => options.onEdit(),
      }),
    );
  } else {
    section.appendChild(
      h("div", {
        class: "field-hint",
        text: "This project has no grid to draw a collider on, so it is the image's own box.",
      }),
    );
  }
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
