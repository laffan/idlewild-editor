/**
 * What the tool would lay down, where it would land, while the pointer is
 * merely hovering — the eraser's disc and every brush's own tip.
 *
 * See `cursor.ts` for what each tool draws; the eraser's is a plain ring
 * because what it takes out is not a mark it could show you. Split out of
 * `drawing-layer.ts` when that reached its seven hundred lines.
 *
 * Batched through `onFrame` for the reason a stroke is — a 120 Hz pointer
 * against a 60 Hz frame means every paint but the last is thrown away
 * unlooked at — and it matters more here than for the eraser's plain disc,
 * because a pattern preview fills every lattice cell under the tip.
 */

import type { AtlasCache } from "./atlas";
import { drawToolCursor, hasToolCursor } from "./cursor";
import { onFrame } from "./frame";
import type { Surface } from "./surface";
import { drawEraserCursor } from "./tools";
import type { StampBox } from "./tools-stamp";
import type { DrawingTool, StrokeStyle } from "./types";

/** Whether this tool draws something under the pointer while hovering. */
export function previews(tool: DrawingTool): boolean {
  return tool === "eraser" || hasToolCursor(tool);
}

export interface HoverHost {
  surface: Surface;
  atlas: AtlasCache;
  tool: () => DrawingTool | null;
  style: () => StrokeStyle;
  /** Whether a gesture is under way, which owns the live canvas. */
  busy: () => boolean;
  stampBox: (x: number, y: number) => StampBox | null;
}

export class HoverCursor {
  private readonly host: HoverHost;
  private at: { x: number; y: number } | null = null;
  private readonly frame = onFrame(() => this.paint());

  constructor(host: HoverHost) {
    this.host = host;
  }

  /** The pointer is hovering here, in world pixels. */
  show(at: { x: number; y: number }): void {
    this.at = at;
    this.frame.request();
  }

  /**
   * Take the preview away.
   *
   * The live canvas is about to be somebody else's — a session's first stamp
   * clears what the preview reported and paints over it — so this is only
   * about the *queued* frame: one that fired after a press would paint the
   * cursor over the stroke and leave its rectangle behind as the next clear.
   */
  drop(): void {
    this.frame.cancel();
    this.at = null;
  }

  private paint(): void {
    const { at, host } = this;
    const tool = host.tool();
    if (!at || host.busy() || !tool) return;
    if (tool === "eraser") {
      drawEraserCursor(host.surface, at.x, at.y);
      return;
    }
    drawToolCursor(host.surface, host.atlas, tool, host.style(), at.x, at.y, host.stampBox);
  }
}
