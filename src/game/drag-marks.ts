/**
 * The three drags on things the document holds rather than places: a filled
 * run of grid spaces, a boundary, and a named point.
 *
 * Its own file for the reason `drag-text.ts` is one — `drag.ts` is against the
 * 700-line rule — and because these three are a set. None of them is a placed
 * file: there is no artwork to resize, no unit to move as one, and no PSD
 * behind them, so each is picked up from *inside the shape it describes* and
 * each is copied by adding a second record rather than by placing a file
 * twice. Everything here hands its answer back through the same `start` the
 * rest of the controller uses, so a mark's drag is a `DragState` like any
 * other.
 */

import { rectContains } from "../lib/grid";
import type {
  Cell,
  FillPatch,
  MapPoint,
  Point,
  Selection,
  Zone,
} from "../lib/types";
import { pointInPolygon, pointReach } from "./picking";
import type { DragHost, DragState } from "./drag";

/**
 * A filled run, picked up from any space it covers.
 *
 * The two shapes a fill can be are tested differently and have to be: a run
 * drawn on the lattice is a set of cells, so the question is whether the
 * space under the finger is one of them; a bare rectangle — what a drag on a
 * blank project makes — owes the grid nothing, so the question is whether the
 * world point is inside it.
 */
export function beginFillDrag(
  host: DragHost,
  selection: Extract<Selection, { kind: "fill" }>,
  world: Point,
  grabCell: Cell,
  alt: boolean,
  start: (state: DragState) => void,
): boolean {
  const layer = host.store.layer(selection.layerId);
  if (!layer || layer.locked) return false;
  const fill = layer.fills.find((f) => f.id === selection.fillId);
  if (!fill) return false;

  const inside = fill.rect
    ? rectContains(fill.rect, world)
    : fill.cells.some((c) => c.cx === grabCell.cx && c.cy === grabCell.cy);
  if (!inside) return false;

  const dragged = alt ? copyFill(host, layer.id, fill) : fill;
  start({
    kind: "fill",
    layerId: layer.id,
    id: dragged.id,
    grabCell,
    cells: dragged.cells,
    rect: dragged.rect,
  });
  return true;
}

/**
 * A boundary drags from anywhere inside its outline.
 *
 * Inside, not on the line: a zone is drawn as an outline but it describes
 * the region it encloses, and asking someone to catch a 1.5px stroke with a
 * finger would make the gesture unusable on the platform it is mostly for.
 */
export function beginZoneDrag(
  host: DragHost,
  selection: Extract<Selection, { kind: "zone" }>,
  world: Point,
  grabCell: Cell,
  alt: boolean,
  start: (state: DragState) => void,
): boolean {
  const layer = host.store.layer(selection.layerId);
  if (!layer || layer.locked) return false;
  const zone = layer.zones.find((z) => z.id === selection.zoneId);
  if (!zone || !pointInPolygon(world, zone.points)) return false;

  const dragged = alt ? copyZone(host, layer.id, zone) : zone;
  start({
    kind: "zone",
    layerId: layer.id,
    id: dragged.id,
    grabCell,
    points: dragged.points,
  });
  return true;
}

/**
 * A point drags from its marker, not from anywhere.
 *
 * Everything else here is picked up from inside a shape it fills; a point
 * has no inside, so the target is the marker itself — the same reach the
 * tap that selected it used, or there would be places where a point can be
 * chosen and not moved.
 */
export function beginPointDrag(
  host: DragHost,
  selection: Extract<Selection, { kind: "point" }>,
  world: Point,
  grabCell: Cell,
  alt: boolean,
  start: (state: DragState) => void,
): boolean {
  const layer = host.store.layer(selection.layerId);
  if (!layer || layer.locked) return false;
  const point = layer.points.find((p) => p.id === selection.pointId);
  if (!point) return false;
  const at = host.grid.cellCentre(point.cell);
  if (Math.hypot(at.x - world.x, at.y - world.y) > pointReach(host.grid)) {
    return false;
  }

  const dragged = alt ? copyPoint(host, layer.id, point) : point;
  start({
    kind: "point",
    layerId: layer.id,
    id: dragged.id,
    grabCell,
    cell: dragged.cell,
  });
  return true;
}

function copyZone(host: DragHost, layerId: string, source: Zone): Zone {
  const { id: _id, ...rest } = source;
  const copy = host.store.addZone(layerId, rest);
  host.setSelection({ kind: "zone", layerId, zoneId: copy.id });
  return copy;
}

/** The copy takes a name of its own: two points called the same thing is
 *  exactly what a name is for avoiding. */
function copyPoint(host: DragHost, layerId: string, source: MapPoint): MapPoint {
  const copy = host.store.addPoint(layerId, source.cell);
  host.setSelection({ kind: "point", layerId, pointId: copy.id });
  return copy;
}

function copyFill(
  host: DragHost,
  layerId: string,
  source: FillPatch,
): FillPatch {
  const { id: _id, ...rest } = source;
  const copy = host.store.addFill(layerId, rest);
  host.setSelection({ kind: "fill", layerId, fillId: copy.id });
  return copy;
}
