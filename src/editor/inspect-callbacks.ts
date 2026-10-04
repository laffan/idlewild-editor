/**
 * Everything the properties sidebar can ask the shell to do.
 *
 * One interface, assembled from the five panels' own action types and the
 * handful of things that belong to the panel as a whole rather than to any of
 * them. It is in a file of its own because it is a *contract* rather than a
 * control: `inspect-wiring.ts` implements it against the editor's own state,
 * `inspector.ts` consumes it, and neither of those files is about the list.
 * It was the last eighty lines of `inspector.ts`, which is against the
 * 700-line rule.
 *
 * Re-exported from `inspector.ts`, so nothing that already imports it from
 * there has to move.
 */

import type { StrokeStyle, FillMode } from "../drawing";
import type { PatternActions } from "./inspect-pattern";
import type { PanelActions } from "./inspect-panels";
import type { PlacementActions } from "./inspect-placement";
import type { TextActions } from "./inspect-text";
import type { TileActions } from "./inspect-tiles";
import type { PsdLayerEditor } from "./psd-layers";
import type { Paint } from "../lib/paint";
import type { ToolId } from "../lib/types";

export interface InspectorCallbacks
  extends PatternActions,
    PanelActions,
    PlacementActions,
    TextActions,
    TileActions {
  /**
   * The paint control settled on something — a colour, a pattern or a shape.
   *
   * One callback rather than one per kind, because what it means depends on
   * the selection rather than on the kind: a fill selected is repainted, and a
   * run of grid spaces is filled. See `fill-actions.ts`.
   */
  onFillPaint: (paint: Paint) => void;
  /**
   * Get rid of a whole document layer, and everything drawn on it.
   *
   * Its own callback rather than a case of `onDeleteSelection`, because it is
   * the one delete in this panel that asks first — a layer is a container and
   * the Delete key must not reach it, which is also why `shortcuts.ts` counts
   * a layer selection as nothing to delete.
   */
  onDeleteLayer: (layerId: string) => void;
  /** Rename a named place. Its own callback because a point's name is the
   *  only thing about it the panel can change. */
  onRenamePoint: (layerId: string, pointId: string, name: string) => void;
  /** Say where the open scene starts play, or that it starts nowhere. */
  onSetStartPoint: (pointId: string | null) => void;
  /** Write the selected grid area out as a transparent PNG. */
  onExportSelection: () => void;
  onUsePatternImage: () => void;
  /** Hand a stroke selection on as a placed PSD, or as a boundary zone. */
  onStrokesToPsd: () => void;
  onStrokesToZone: () => void;
  /**
   * The selected PSD's own layer stack, as an editor that loads itself. Built
   * by the shell rather than here, because it needs the project id and a way
   * back to the scene once it has rewritten the file.
   */
  createPsdLayers: (key: string) => PsdLayerEditor;
  /** The pencil's brush, size and colour changed. */
  onStrokeStyle: (patch: Partial<StrokeStyle>) => void;
  /**
   * Which layer the LAYER zone falls back to when nothing on the canvas is
   * selected — the one new work lands on.
   *
   * Asked rather than stored, because the active layer is the shell's and can
   * change without the document changing: picking a row in the left sidebar
   * moves it, and nothing is written.
   */
  activeLayerId: () => string;
  /** Which half of the sweep fill is aimed, and the way to change it. */
  fillMode: () => FillMode;
  onFillMode: (mode: FillMode) => void;
  /**
   * How many corners the point-to-point fill has down.
   *
   * A readout: what to *do* about them is on the bar floating beside the
   * shape — see `fill-bar.ts`.
   */
  fillPoints: () => number;
  /**
   * Whether a tool is turned round to erase, and the way to turn it.
   *
   * By tool rather than by style, because that is where the flag is kept —
   * see `editor/tool-routing.ts`. Setting it re-renders this panel, so the
   * row and the toolbar button agree about which way round the tool is.
   */
  erasing: (tool: ToolId) => boolean;
  onErasing: (tool: ToolId, on: boolean) => void;
  /**
   * Whether a drag under Select moves by whole grid spaces, and the way to
   * change it.
   *
   * Asked of the routing rather than kept here, for the reason `erasing` is:
   * it is a tool's own setting and it outlives every rebuild of this panel.
   */
  snapToGrid: () => boolean;
  onSnapToGrid: (on: boolean) => void;
  /**
   * Auto depth sort on the active layer, or null where it means nothing —
   * anything but an object layer of an isometric, non-platformer project.
   */
  autoDepth: () => boolean | null;
  onAutoDepth: (on: boolean) => void;
}
