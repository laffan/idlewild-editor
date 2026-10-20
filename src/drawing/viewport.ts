/**
 * The camera as the drawing layer sees it, and the two conversions across it.
 */

/** How the world maps onto the screen: `screen = (world − origin) × zoom`. */
export interface Viewport {
  originX: number;
  originY: number;
  zoom: number;
  /** The host's size in CSS pixels. */
  width: number;
  height: number;
}

export function screenToWorld(
  view: Viewport,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  return {
    x: screenX / view.zoom + view.originX,
    y: screenY / view.zoom + view.originY,
  };
}

export function worldToScreen(
  view: Viewport,
  worldX: number,
  worldY: number,
): { x: number; y: number } {
  return {
    x: (worldX - view.originX) * view.zoom,
    y: (worldY - view.originY) * view.zoom,
  };
}
