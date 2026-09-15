/**
 * The inspector's panel for a placed PSD.
 *
 * The longest of them, because a placed PSD is the most compound thing in the
 * document: a file with a name you can retype, a set of layers that move as one
 * unit, a footprint on the grid, a collider, a stack inside the file — and,
 * sometimes, one of several objects reading that same file. Split from
 * `inspector.ts` for the 700-line rule; the panel keeps the three things it
 * owns state for, and hands them in — the name field its `captureName` puts a
 * caret back into, the PSD layer list it keeps across re-renders, and which unit
 * is currently opened up.
 *
 * **Instances** are the part worth reading here. Two placed PSDs on the same
 * file are *instances* of it: equal objects, not one pointing at another, and an
 * edit to the file changes both. The panel used to call that a **Reference** and
 * offer **Remove Reference**, which described neither end of it — nothing is
 * being referenced, and nothing is removed. So it says what is true: how many
 * objects share this file, and that **Make Unique** will give this one a copy of
 * its own. The canvas says the same thing in its own vocabulary, by outlining an
 * instance with a dashed box — see `game/selection-overlay.ts`.
 */

import { h } from "../lib/dom";
import { colliderPanel, colliderSection } from "./inspect-collider";
import { patternSection, type PatternActions } from "./inspect-pattern";
import type { PanelSurface } from "./inspect-panels";
import { scaleOf, sizeControls } from "./inspect-transform";
import type { PsdLayerEditor } from "./psd-layers";
import { instanceCount } from "../game/instances";
import { layerName } from "../lib/manifest";
import { unitMembers, unitOf } from "../game/unit";
import type { DocStore } from "../lib/doc-store";
import { layerKind } from "../lib/layer-kinds";
import type { Grid } from "../lib/grid";

/** What this panel's buttons reach. */
export interface PlacementActions extends PatternActions {
  /**
   * Whether a PSD carries its anchor mark at the root of its stack — the rule
   * object layers enforce. Asked of the scene rather than read off the
   * document, for the reason `PsdPlacements.anchored` gives.
   */
  isAnchored: (psdKey: string) => boolean;
  /** Rename the file behind a placement. `name` is the stem, without ".psd". */
  onRenamePsd: (key: string, name: string) => void;
  /**
   * Give this object a copy of the PSD, so editing it stops changing the other
   * instances. **Make Unique**, which was Remove Reference.
   */
  onMakeUnique: (key: string) => void;
  /** Switch a placed PSD's collider on or off, without changing its shape. */
  onToggleCollider: (key: string, blocking: boolean) => void;
  /** Open the selected PSD's collider up to be drawn on the grid. */
  onEditCollider: () => void;
  onDeleteSelection: () => void;
}

/** The state the panel owns and this needs borrowed. */
export interface PlacementHost {
  store: DocStore;
  grid: Grid;
  actions: PlacementActions;
  /** The unit opened up into its own layers, if any — see `game/unit.ts`. */
  adjusting: string | null;
  /** The file's own layer list, made once and kept across re-renders. */
  psdLayers: (key: string) => PsdLayerEditor;
}

export function renderPlacement(
  panel: PanelSurface,
  host: PlacementHost,
  layerId: string,
  placementId: string,
): void {
  const { store, actions } = host;
  const placement = store
    .layer(layerId)
    ?.placements.find((p) => p.id === placementId);
  if (!placement) return panel.empty();

  // On a pattern layer the file *is* the pattern's palette, and the only thing
  // there is to say about a palette is what the rule does with it. So the
  // pattern's own controls come first, over the file's facts rather than
  // instead of them: renaming it, sending it out to Photoshop and resizing it
  // all still mean what they mean anywhere else, and resizing it here resizes
  // every copy of it in the pattern.
  const layer = store.layer(layerId);
  if (layer && layerKind(layer) === "pattern") {
    panel.body.append(...patternSection(store, layer, actions));
  }

  // The title is the file's name, and the file's name is worth changing: an
  // import arrives called `pasted-m2k9f1` and stays that way through every list
  // that mentions it until someone can rename it here.
  panel.editableHead("Image", placement.psdKey, ".psd", (next) =>
    actions.onRenamePsd(placement.psdKey, next),
  );

  // The rule an object layer enforces, said where the file is described. Not a
  // refusal: the artwork is placed and it draws. What it cannot do is come home
  // from Photoshop lined up on the same space, because there is no mark in the
  // file for it to line up on.
  if (
    layer &&
    layerKind(layer) === "object" &&
    !actions.isAnchored(placement.psdKey)
  ) {
    panel.body.appendChild(
      h(
        "div",
        { class: "inspect-note warning" },
        h("span", {
          text:
            "No anchor · this PSD has no P | anchor at the root of its " +
            "stack, so an edit to it will not come back on this space",
        }),
      ),
    );
  }

  // Whether this is one of several objects on the same file — what an
  // option-drag makes. Said before anything else, because the consequence is
  // that editing the artwork edits all of them, and it is a fact about the
  // thing you have just selected rather than a footnote about the file.
  //
  // Counted in *objects*, not placements. The old count was of placements
  // sharing the key and the layer path, which is the same number for a
  // single-layer file and quietly a different question for anything else.
  const instances = instanceCount(store.allLayers, placement.psdKey);
  if (instances > 1) {
    panel.body.appendChild(
      h(
        "div",
        { class: "inspect-note instance" },
        h("span", {
          text:
            `Instance · ${instances} objects share this PSD, so an edit to ` +
            "it changes all of them",
        }),
        h("button", {
          class: "panel-btn",
          text: "Make Unique",
          // The file is copied and *this object* is pointed at the copy, so
          // every other instance is left exactly as it was.
          onClick: () => actions.onMakeUnique(placement.psdKey),
        }),
      ),
    );
  }

  // Whether the canvas is treating this as one thing or as its layers. Only
  // worth saying for a PSD with more than one placed layer — a single-layer file
  // is a unit of one either way.
  const members = unitMembers(store.layers, layerId, unitOf(placement));
  const open = host.adjusting === unitOf(placement);
  if (members.length > 1) {
    panel.body.appendChild(
      h(
        "div",
        { class: open ? "inspect-note adjusting" : "inspect-note quiet" },
        h("span", {
          text: open
            ? `Adjusting layers · ${members.length} in this PSD`
            : `${members.length} layers · moves as one`,
        }),
      ),
    );
  }

  panel.section("Info");
  panel.row("Layer path", placement.layerPath);
  panel.row("Position", `${Math.round(placement.x)}, ${Math.round(placement.y)}`);
  panel.row("Anchor cell", `${placement.anchor.cx}, ${placement.anchor.cy}`);

  // Size is the one property you change rather than read, so it sits with the
  // controls that change it rather than among the facts above — and directly
  // under Info, because between them they are what the thing *is*: where it
  // sits, and how big it is.
  const transform = panel.section("Transform");
  transform.appendChild(
    sizeControls(placement, (patch) => {
      store.updatePlacement(layerId, placementId, patch);
    }),
  );
  // Documents written before resizing existed carry no natural size, and for
  // those the displayed size is the source size.
  const source = {
    w: placement.naturalWidth || placement.width,
    h: placement.naturalHeight || placement.height,
  };
  panel.row("Source", `${Math.round(source.w)} × ${Math.round(source.h)} px`);
  panel.row("Scale", `${Math.round(scaleOf(placement) * 100)}%`);

  // The stack inside the file, and — over it — every button that is about the
  // file rather than about this placement of it: open it up on the canvas, send
  // it out to Photoshop, bring the edits back. They were in three different
  // places in this panel, with the list they are all about in between; they are
  // one row directly above it now. See psd-layer-actions.ts.
  const psdLayers = host.psdLayers(placement.psdKey);
  panel.body.appendChild(psdLayers.root);
  psdLayers.setAdjust({ members: members.length, adjusting: open });

  // Last of the named sections. A collider is the one thing here that is not
  // about the picture — it is what the picture *stops*, which is a question
  // you come to after the file, its size and its layers rather than in the
  // middle of them. It was second, above Transform, which put the least-read
  // section where the most-changed one belongs.
  panel.body.appendChild(
    colliderSection({
      psdKey: placement.psdKey,
      panel: colliderPanel(
        host.grid,
        store.allLayers,
        store.colliders,
        placement.psdKey,
        store.extrusion(placement.psdKey),
      ),
      onToggle: (key, blocking) => actions.onToggleCollider(key, blocking),
      onEdit: () => actions.onEditCollider(),
    }),
  );

  // What is left down here is about the placement rather than the file.
  //
  // The button says *what* it takes, because that is the one thing about it
  // worth knowing before pressing it and the answer is not always the same:
  // a file that moves as one goes whole, and one that has been opened up
  // loses the single layer under the pointer. "Remove from layer" said
  // neither, and left the two senses of "layer" — Phaser's and Photoshop's —
  // to be told apart by the reader.
  const one = open && members.length > 1;
  const foot = panel.section();
  foot.appendChild(
    h("button", {
      class: "panel-btn",
      text: one
        ? `Remove “${layerName(placement.layerPath)}” from layer`
        : "Remove PSD from layer",
      title: one
        ? "This PSD is opened up, so only the layer selected goes. Tap away " +
          "from it to close the file and take the whole thing."
        : "Takes every layer this PSD was placed with off the document layer. " +
          "The file itself stays in the project.",
      onClick: () => actions.onDeleteSelection(),
    }),
  );
}
