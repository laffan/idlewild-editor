/**
 * The bridges out of the drawing layer.
 *
 * A sketch is not the point; what it becomes is. Two of these were the spec's
 * — hand a group of strokes to a layer as a PSD to flesh out elsewhere, or
 * turn it into a boundary — and the third is the pencil's half of a pattern
 * shape. All three are actions on a lasso selection rather than tools of
 * their own.
 *
 * Every one of them consumes the strokes. The PSD, the zone and the shape are
 * the same outline in a better form, and leaving the ink behind means every
 * sketch you convert is drawn twice: once as strokes and once as the thing it
 * became, in the same place, at the same size.
 */

import { sourceScale } from "../lib/print";
import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import { addPatternShapePoints } from "../lib/layer-kinds";
import type { Selection } from "../lib/types";
import * as log from "../lib/log";
import { openPsdProgress } from "./psd-progress";
import type { DrawingLayer } from "../drawing";
import { strokesBox, strokesToPsd, strokesToZonePoints } from "../drawing";
import type { WorldScene } from "../game/world-scene";
import {
  footprintForBox,
  IMPORT_SCALE,
  marksForCells,
  scaleMarks,
} from "./import-anchor";

type StrokeSelection = Extract<Selection, { kind: "strokes" }>;

export async function convertStrokesToPsd(
  projectId: string,
  store: DocStore,
  grid: Grid,
  drawing: DrawingLayer,
  scene: WorldScene,
  selection: StrokeSelection,
  /**
   * The layer the PSD lands on, when it is not the one being worked on — the
   * plan's, whose ink is on no layer and goes to the top object layer. See
   * `editor/plan-mode.ts`.
   */
  onLayer?: string,
): Promise<boolean> {
  const strokes = drawing.strokesById(selection.ids);
  const box = strokesBox(strokes);
  if (!box) {
    log.warn("Those strokes have nothing to rasterise");
    return false;
  }

  // Something on screen for the whole wait. Stamping the ink, encoding it and
  // running the pipeline over the file are seconds of work between one tap and
  // anything appearing — and the first two of those block this thread, so the
  // sheet has to be up and painted before they start. See `psd-progress.ts`;
  // the stage lines the pipeline itself emits arrive on it as they happen.
  const progress = openPsdProgress(
    "Converting to PSD",
    `${strokes.length} stroke${strokes.length === 1 ? "" : "s"} · ` +
      `${Math.round(box.width)} × ${Math.round(box.height)} px`,
    "Drawing the strokes…",
  );

  // How long each stage took, for the line in the console at the end: the
  // conversion is several seconds on a large sketch, and which of drawing,
  // writing and placing that time went on is the first thing to know about
  // one that seems slow.
  const timer = stageTimer();
  try {
    const name = `sketch-${Date.now().toString(36)}`;
    // A sketch knows exactly which spaces it was drawn over, so it is marked
    // like a fill rather than centred like an import: the footprint is the
    // spaces the ink covers, and `art` says where the ink sits inside them.
    // Whoever opens the PSD to paint over the sketch then has the same grid
    // under it that the drawing was made on.
    const { cells, anchor } = footprintForBox(grid, box);
    const anchorWorld = grid.cellToWorld(anchor);

    // The layer's own atlas, so the export carries the brush textures that
    // have already decoded rather than the procedural stand-in.
    const result = await strokesToPsd(projectId, name, strokes, {
      atlas: drawing.atlas,
      scale: sourceScale(),
      stage: (line) => {
        timer.mark(line);
        return progress.stage(line);
      },
      marks: (raster) => ({
        ...scaleMarks(
          marksForCells(grid, cells, anchor, {
            x: raster.bounds.x - anchorWorld.x,
            y: raster.bounds.y - anchorWorld.y,
          }),
          sourceScale(),
        ),
      }),
    });
    if (!result) return false;

    // The ink going and the artwork arriving are one thing — and only one
    // thing. Placing can refuse: a locked layer, a file the pipeline found
    // nothing placeable in. Taking the strokes away anyway is how a sketch
    // becomes nothing at all, which is the worst outcome available here and
    // silent besides, so the ink stays until there is artwork standing in
    // its place.
    timer.mark("Placing the artwork…");
    await progress.stage("Placing the artwork…");
    store.history.begin();
    // Placing lands on the scene's active layer, so for another layer it is
    // made the active one for the length of the place and given back after.
    const working = scene.activeLayerId;
    if (onLayer) scene.activeLayerId = onLayer;
    try {
      const placed = await scene.placePsd(
        result.key,
        result.manifest,
        anchor,
        IMPORT_SCALE,
      );
      if (!placed) {
        log.warn(
          `${result.key}.psd was written but nothing was placed — ` +
            "keeping the strokes",
        );
        return false;
      }
      drawing.removeStrokes(selection.ids);
    } finally {
      if (onLayer) scene.activeLayerId = working;
      store.history.end();
    }
    log.info(
      `${strokes.length} strokes → ${result.key}.psd ` +
        `(${result.width}×${result.height}) — ${timer.done()}`,
    );
    return true;
  } catch (err) {
    log.error("Could not turn the strokes into a PSD:", err);
    return false;
  } finally {
    // However it went. A refusal has to take the sheet with it, or the app is
    // held behind a wait that is over.
    progress.close();
  }
}

export function convertStrokesToZone(
  store: DocStore,
  drawing: DrawingLayer,
  selection: StrokeSelection,
): void {
  const strokes = drawing.strokesById(selection.ids);
  const points = strokesToZonePoints(strokes, store.gridSize);
  if (points.length < 3) {
    log.warn("A boundary needs an outline — that selection has no region");
    return;
  }

  const zone = store.history.group(() => {
    const made = store.addZone(selection.layerId, {
      name: `Boundary ${(store.layer(selection.layerId)?.zones.length ?? 0) + 1}`,
      points,
      // A boundary is drawn to stop something; play mode reads this when it
      // builds the navigation grid.
      blocking: true,
    });
    drawing.removeStrokes(selection.ids);
    return made;
  });
  log.info(`${strokes.length} strokes → ${zone.name} (${points.length} points)`);
}

/**
 * Strokes → an area a pattern is confined to.
 *
 * The one route into a pattern shape that keeps the line somebody drew — mask
 * mode sweeps rectangles, so a shape adjusted there is spaces and nothing
 * else. The same outline a boundary would have been: `strokesToZonePoints` simplifies the path the same way, because a
 * shape only has to be accurate to the space it confines. What is stored is
 * the outline *and* the spaces under it — see `addPatternShapePoints` — so the
 * canvas can draw the line somebody drew and the pattern can ask a set rather
 * than walking a polygon per element per frame.
 *
 * The layer is named rather than taken from the selection: the ink is often
 * drawn on whatever layer was active, and the shape belongs to the pattern
 * layer the panel asked from.
 */
export function convertStrokesToPatternShape(
  store: DocStore,
  grid: Grid,
  drawing: DrawingLayer,
  selection: StrokeSelection,
  layerId: string,
): void {
  const strokes = drawing.strokesById(selection.ids);
  const points = strokesToZonePoints(strokes, store.gridSize);
  if (points.length < 3) {
    log.warn("A pattern mask needs an outline — that selection has no region");
    return;
  }

  const shape = store.history.group(() => {
    const made = addPatternShapePoints(store, layerId, grid, points);
    if (made) drawing.removeStrokes(selection.ids);
    return made;
  });
  if (!shape) {
    log.warn("That outline covers no whole space — draw a larger one");
    return;
  }
  log.info(
    `${strokes.length} strokes → ${shape.name} ` +
      `(${shape.cells?.length ?? 0} spaces)`,
  );
}

/**
 * Times named stages back to back: each `mark` ends the stage before it.
 * `done` closes the last and says them all, as `drawing 120 ms · writing …`.
 */
function stageTimer(): { mark: (line: string) => void; done: () => string } {
  const spans: string[] = [];
  let current: { name: string; at: number } | null = null;
  const close = () => {
    if (!current) return;
    spans.push(`${current.name} ${Math.round(performance.now() - current.at)} ms`);
    current = null;
  };
  return {
    mark: (line) => {
      close();
      // "Drawing the strokes…" → "drawing": the verb is the name.
      const name = line.split(" ")[0].toLowerCase();
      current = { name, at: performance.now() };
    },
    done: () => {
      close();
      return spans.join(" · ");
    },
  };
}
