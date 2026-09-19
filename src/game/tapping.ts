/**
 * What a tap on the canvas means, and what two taps mean.
 *
 * The other half of `scene-gestures.ts`: that file says who gets a pointer,
 * and this says what the shortest gesture then does with it. They were both
 * `world-scene.ts` until that file reached its seven hundred lines, and this
 * is the piece of it with the clearest edges — a tap reads the tool, the mode
 * and the document, and touches nothing about the camera.
 *
 * **A tap is a precedence, like a drag.** A canvas mode that is up takes it;
 * then the three tools whose whole gesture is a tap on bare ground — Tile,
 * Point and Text; then what is under the finger. Each of the three falls
 * through when the layer will not take what it makes, so a tap that cannot
 * do the thing clears the selection rather than doing nothing at all.
 *
 * **Two taps are about opening a placed file up**, which is why every tool
 * whose first tap *made* something has to refuse them: two taps under Point
 * are two points, two with a tile in hand are two tiles, and a second tap in
 * collider mode is a second space painted.
 */

import type { DocStore } from "../lib/doc-store";
import type { Grid } from "../lib/grid";
import type { Point, Selection } from "../lib/types";
import * as log from "../lib/log";
import { addPointAt, addTextAt, type TapHost } from "./tap-makes";
import { addToSelection, toggleUnit, widenToGroup } from "./adjusting";
import type { PickResult } from "./picking";
import type { TextStyle } from "./text-style";

/** Which tool is in hand, as the tap cares about it. */
export type TapMode = "select" | "pan" | "point" | "text" | "tile";

export interface TappingHost {
  store: DocStore;
  grid: Grid;
  /** Whether the canvas is the thing in front of the user. The running game
   *  is a frame over it and takes its own input. */
  editing: () => boolean;
  mode: () => TapMode;
  activeLayerId: () => string;
  selection: () => Selection;
  setSelection: (selection: Selection) => void;
  worldAt: (screenX: number, screenY: number) => Point;
  textStyle: () => TextStyle;
  /** The canvas modes, which are asked before anything else. */
  modeTap: (screenX: number, screenY: number) => boolean;
  colliderActive: () => boolean;
  /** A tile tool's tap: one space, or one pour. */
  tileTap: (world: Point) => boolean;
  /** What is under a point, and which unit is open — `doc-renderer.ts`. */
  pickAt: (world: Point, layerId: string) => Selection;
  pick: (x: number, y: number) => PickResult | undefined;
  adjusting: () => string | null;
  setAdjusting: (unit: string | null) => void;
}

export function handleTap(
  host: TappingHost,
  screenX: number,
  screenY: number,
  adding: boolean,
): void {
  if (!host.editing()) return;
  const world = host.worldAt(screenX, screenY);

  // While a collider is being drawn, a tap paints the space under the finger;
  // while a shape is being extruded, it takes hold of one of the shape's
  // faces. Either way it never reaches the document underneath.
  if (host.modeTap(screenX, screenY)) return;

  const mode = host.mode();
  // The three tools whose tap makes something out of bare ground. Point and
  // Text are `tap-makes.ts` — same gesture, same three things that have to be
  // true about it, and the difference between a space and a position is the
  // only thing in either of them. A tile tool is the third and the plainest:
  // a tile layer has nothing on it to pick, so there is nothing else a tap
  // there could mean.
  if (mode === "tile" && host.tileTap(world)) return;
  const tapHost: TapHost = {
    store: host.store,
    grid: host.grid,
    activeLayerId: host.activeLayerId(),
    setSelection: host.setSelection,
  };
  if (mode === "point" && addPointAt(tapHost, world)) return;
  if (mode === "text" && addTextAt(tapHost, world, host.textStyle())) return;

  // A tap on a grouped file means the group — the same rule a placed PSD
  // keeps, one level out. See `widenToGroup`.
  const hit = widenToGroup(
    host.store,
    host.pickAt(world, host.activeLayerId()),
    host.adjusting(),
  );
  // ⌘ or ⇧ means *and this one as well*, which is the same gesture as
  // ⌘-clicking a row in the layer panel and goes through the same arithmetic
  // — see `addToSelection`.
  host.setSelection(
    adding ? addToSelection(host.store, host.selection(), hit) : hit,
  );
}

/** Open the placed PSD under the finger up into its layers, or close it. */
export function handleDoubleTap(
  host: TappingHost,
  screenX: number,
  screenY: number,
): void {
  if (!host.editing()) return;
  const mode = host.mode();
  if (mode === "point" || mode === "tile" || host.colliderActive()) return;
  const world = host.worldAt(screenX, screenY);
  const hit = host.pick(world.x, world.y);
  if (!hit) return;

  const next = toggleUnit(hit, host.adjusting());
  host.setAdjusting(next.adjusting);
  log.info(next.message);
  host.setSelection(next.selection);
}
