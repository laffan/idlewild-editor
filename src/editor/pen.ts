/**
 * Pen mode as the editor shell sees it: a bar, a frame worked out from the
 * document, and the two ends of a session.
 *
 * The counterpart to `editor/extrude.ts` and `editor/collider.ts`, split the
 * same way. The mode itself lives in the scene because it is a rectangle and
 * a dim; what is here is everything the mode cannot know — where the PSD's
 * canvas actually falls on the grid, which strokes belong to this session,
 * and how to get them into the file.
 *
 * ## Which strokes are the session's
 *
 * Pen mode does not invent a place to draw. The ink goes onto the document
 * layer being worked on, through the same drawing layer, with the same brush
 * and the same undo behind it — so what makes a stroke *this session's* is
 * simply that it was not there when the mode opened. The ids present at the
 * start are remembered, and anything else on that layer at the end is the
 * drawing.
 *
 * That reading has one honest edge: erase a stroke that was already there and
 * its surviving halves are new strokes, so they count as session ink and go
 * into the PSD. Both readings of that are defensible and this one is at least
 * simple to say out loud — the ink that was not there when the mode opened.
 *
 * ## Both ways out consume it
 *
 * Apply rasterises the session's strokes at the file's own resolution, lays
 * them into the target layer and re-parses; Cancel throws them away. Neither
 * leaves ink lying over the artwork, which is what a mode that framed a file
 * and then left a copy of the drawing on top of it would do. Cancel is a
 * document edit like any other, so ⌘Z brings the strokes back if it was the
 * wrong button.
 */

import { rasteriseStrokes, strokesBox, type DrawingLayer } from "../drawing";
import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import { psd, toBase64 } from "../lib/ipc";
import * as log from "../lib/log";
import { canvasBox, parseManifest } from "../lib/manifest";
import type { Bounds } from "../drawing/types";
import type { Stroke } from "../lib/types";
import type { PsdLayerInfo } from "../lib/ipc";
import type { WorldScene } from "../game/world-scene";
import { PenBar } from "./pen-bar";
import { PenRail, type PenTool } from "./pen-rail";

/**
 * How long the pen has to be held still inside a stroke before the rest of it
 * is drawn straight.
 *
 * Longer than the editor's other hold — `HOLD_MS` in extrude mode is 320ms,
 * because a hold *instead of* a drag has to be decided before the drag gets
 * going. This one interrupts something already happening, so it has to be
 * long enough that a pause for thought in the middle of a line is not read as
 * a request to straighten it.
 */
const STRAIGHTEN_HOLD_MS = 1000;

export interface PenUiOptions {
  projectId: string;
  store: DocStore;
  grid: Grid;
  /** The canvas column: the bar sits in it, and wears the mode's class. */
  host: HTMLElement;
  scene: () => WorldScene | null;
  drawing: () => DrawingLayer | null;
  /** Entering hands the pointer to the pencil, which is what draws here. */
  usePencil: () => void;
  /**
   * One of the pen rail's three has been picked, or put back.
   *
   * The shell owns the drawing layer's style, so what this reports is the
   * choice; what it *means* — a brush, a stroke mode, a different gesture —
   * is applied there. See `applyPenTool` in editor.ts.
   */
  onPenTool: (tool: PenTool) => void;
  /** The document layer new ink lands on, which is where a session's is. */
  inkLayerId: () => string;
  /** The file was rewritten and re-parsed; take the result back. */
  onWritten: (key: string, manifest: string) => Promise<void> | void;
}

export interface PenUi {
  /** Enter the mode over one layer of the selected PSD. */
  open: (key: string, layer: PsdLayerInfo) => void;
  /** The scene or the document says something changed; put it in the bar. */
  sync: () => void;
  destroy: () => void;
}

/** A session in flight, beside what the scene is holding. */
interface Session {
  key: string;
  /** The document layer the ink is on. */
  inkLayerId: string;
  /**
   * What was selected on the way in, so it can be selected again on the way
   * out. Entering clears it — the mode owns the canvas, and a set of resize
   * handles floating over a dimmed one is chrome about something you cannot
   * currently touch — but leaving with nothing selected costs the panel that
   * every one of these buttons is on, which is where the *next* layer to draw
   * in is listed.
   */
  from: { layerId: string; placementId: string };
  /** The strokes that were already there, which are not this session's. */
  before: Set<string>;
}

export function createPenUi(options: PenUiOptions): PenUi {
  let session: Session | null = null;

  const bar = new PenBar({
    onApply: () => void apply(),
    onCancel: () => cancel(),
  });
  // The three tools that only exist in this mode, in a column under the
  // editor's own rail — see pen-rail.ts.
  const rail = new PenRail((tool) => options.onPenTool(tool));
  options.host.append(bar.root, rail.root);

  // The bar counts strokes, so it has to follow the document rather than
  // only the mode: every stroke drawn is a change here and nothing else
  // tells the shell about it.
  const onDocChange = (): void => sync();
  options.store.addEventListener("change", onDocChange);

  /** The ink this session has put down, oldest first. */
  function sessionStrokes(): Stroke[] {
    if (!session) return [];
    const layer = options.store.layer(session.inkLayerId);
    return (layer?.strokes ?? []).filter((s) => !session?.before.has(s.id));
  }

  /** Whether any of it is inside the frame, which is what Apply needs. */
  function insideFrame(strokes: readonly Stroke[], frame: Bounds): boolean {
    const box = strokesBox(strokes);
    if (!box) return false;
    return (
      box.x < frame.x + frame.width &&
      box.x + box.width > frame.x &&
      box.y < frame.y + frame.height &&
      box.y + box.height > frame.y
    );
  }

  function sync(): void {
    const mode = options.scene()?.modes.pen;
    const active = mode?.active ?? false;
    options.host.classList.toggle("penning", active);
    // Press and wait, and the rest of the stroke comes out straight. Set from
    // here rather than at the two ends of a session so it follows the mode
    // however it was left — including being stopped from outside, which play
    // mode and the other two canvas modes both do.
    const drawing = options.drawing();
    if (drawing) drawing.straightenHoldMs = active ? STRAIGHTEN_HOLD_MS : 0;
    // Hiding the rail puts the pencil back, which is why the shell is told
    // rather than left to notice: the mode ending is the tool ending.
    if (rail.tool !== null && !active) options.onPenTool(null);
    rail.setShown(active);
    if (!active) {
      // The mode can be taken away rather than left: play mode stops all
      // three, and entering extrude or collider stops the other two. The ink
      // stays where it is — nobody asked for it to go — but the session is
      // over, so a later Apply cannot write strokes nobody is still framing.
      session = null;
      bar.update({ active, key: "", layer: "", summary: "", canApply: false });
      return;
    }
    const strokes = sessionStrokes();
    const frame = mode?.frame ?? null;
    const inside = !!frame && insideFrame(strokes, frame);
    bar.update({
      active,
      key: mode?.target?.key ?? "",
      layer: mode?.target?.name ?? "",
      summary:
        strokes.length === 0
          ? "nothing drawn yet"
          : inside
            ? `${strokes.length} ${strokes.length === 1 ? "stroke" : "strokes"}`
            : `${strokes.length} outside the frame`,
      canApply: inside,
    });
  }

  /**
   * Enter the mode over one layer of the PSD the inspector is showing.
   *
   * The frame is the file's whole canvas rather than the selected layer's
   * artwork — see `canvasBox`. Working it out needs the manifest, which is
   * read from disk rather than taken off the placement: a placement knows how
   * big its own layer is and nothing at all about the document around it.
   */
  async function open(key: string, layer: PsdLayerInfo): Promise<void> {
    const scene = options.scene();
    const selection = scene?.getSelection();
    if (!scene || selection?.kind !== "placement") {
      log.warn("Select a placed image to draw into it");
      return;
    }
    const placement = options.store
      .layer(selection.layerId)
      ?.placements.find((p) => p.id === selection.placementId);
    if (!placement || placement.psdKey !== key) return;

    let frame: Bounds;
    let scale: number;
    try {
      const manifest = parseManifest(
        await psd.manifest(options.projectId, key),
      );
      scale = placement.width / (placement.naturalWidth || placement.width);
      frame = canvasBox(
        options.grid.cellToWorld(placement.anchor),
        manifest,
        scale,
      );
    } catch (err) {
      log.error(`Could not work out where ${key}.psd's canvas is:`, err);
      return;
    }

    const inkLayerId = options.inkLayerId();
    const held = options.store.layer(inkLayerId);
    if (!held || held.locked) {
      log.warn("The layer this PSD is on is locked — unlock it to draw");
      return;
    }

    options.usePencil();
    const started = scene.modes.startPen(
      { key, index: layer.index, name: layer.name },
      frame,
      scale,
    );
    if (!started) return;
    session = {
      key,
      inkLayerId,
      from: {
        layerId: selection.layerId,
        placementId: selection.placementId,
      },
      before: new Set(held.strokes.map((s) => s.id)),
    };
    sync();
  }

  /** Throw the session's ink away and leave. */
  function cancel(): void {
    const held = session;
    const strokes = sessionStrokes();
    if (held && strokes.length > 0) {
      discard(held.inkLayerId, strokes);
      log.info(
        `Pen mode cancelled — ${strokes.length} ` +
          `${strokes.length === 1 ? "stroke" : "strokes"} discarded ` +
          "(⌘Z brings them back)",
      );
    }
    session = null;
    options.scene()?.modes.pen.stop();
    reselect(held?.from ?? null);
    sync();
  }

  /** Take a run of strokes off a layer, leaving everything else on it. */
  function discard(layerId: string, strokes: readonly Stroke[]): void {
    const gone = new Set(strokes.map((s) => s.id));
    options.store.replaceStrokes(
      layerId,
      (options.store.layer(layerId)?.strokes ?? []).filter(
        (s) => !gone.has(s.id),
      ),
    );
  }

  /**
   * Put the selection back where the session found it.
   *
   * Only when the placement is still there: a re-parse can take one away, and
   * selecting an id the document no longer holds renders an empty panel that
   * looks like a bug rather than like nothing being selected.
   */
  function reselect(
    from: { layerId: string; placementId: string } | null,
  ): void {
    if (!from) return;
    const still = options.store
      .layer(from.layerId)
      ?.placements.some((p) => p.id === from.placementId);
    if (!still) return;
    options.scene()?.setSelection({ kind: "placement", ...from });
  }

  /**
   * Write the ink into the file and leave.
   *
   * Rasterised at `1 / scale` pixels per world unit, which is the file's own
   * resolution: a PSD placed at half size — every import is — takes ink at
   * twice the size it was drawn on screen, so what lands in the document is
   * the detail that was on the glass rather than a shrunken copy of it. Same
   * bargain as `EXPORT_SCALE` in import-anchor.ts, arrived at from the other
   * direction.
   *
   * The mode stays up until the write lands. A rewrite can be refused — a PSD
   * with masks or clipping cannot be rebuilt without flattening it — and a
   * session that had already closed would have taken the drawing with it.
   */
  async function apply(): Promise<void> {
    const scene = options.scene();
    const mode = scene?.modes.pen;
    const target = mode?.target;
    const frame = mode?.frame;
    if (!scene || !mode || !target || !frame || !session) return;

    const strokes = sessionStrokes();
    const raster = rasteriseStrokes(
      strokes,
      options.drawing()?.atlas,
      1 / mode.scale,
    );
    if (!raster) {
      log.warn("There is no ink to put in that layer");
      return;
    }

    try {
      // Where the ink sits in the file's own pixels. Rust trims whatever
      // falls off the canvas, so a stroke drawn over the edge of the frame is
      // simply cut there rather than refused.
      const manifest = await psd.paintLayer(
        options.projectId,
        target.key,
        target.index,
        target.name,
        {
          x: Math.round((raster.bounds.x - frame.x) / mode.scale),
          y: Math.round((raster.bounds.y - frame.y) / mode.scale),
          width: raster.width,
          height: raster.height,
          rgbaBase64: toBase64(
            new Uint8Array(
              raster.rgba.buffer,
              raster.rgba.byteOffset,
              raster.rgba.byteLength,
            ),
          ),
        },
      );

      // The ink becoming artwork is one thing that happened, so one step of
      // undo: the strokes go as the file comes back.
      options.store.history.begin();
      try {
        await options.onWritten(target.key, manifest);
        discard(session.inkLayerId, strokes);
      } finally {
        options.store.history.end();
      }
      log.info(
        `${strokes.length} ${strokes.length === 1 ? "stroke" : "strokes"} → ` +
          `"${target.name}" in ${target.key}.psd`,
      );
    } catch (err) {
      log.error(`Could not draw into ${target.key}.psd:`, err);
      return;
    }

    const from = session.from;
    session = null;
    mode.stop();
    // Back to the panel this was entered from, with the drawing in the layer
    // list above it — which is where the next one to draw in is.
    reselect(from);
    sync();
  }

  return {
    open: (key, layer) => void open(key, layer),
    sync,
    destroy: () => {
      options.store.removeEventListener("change", onDocChange);
      session = null;
      options.scene()?.modes.pen.stop();
      options.host.classList.remove("penning");
      rail.root.remove();
      bar.destroy();
    },
  };
}
