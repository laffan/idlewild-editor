/**
 * The marks the canvas draws about the game rather than in it — the screen
 * guide — and, on a print project, the list of artboards that steers it.
 *
 * Built together because they talk both ways: a row picked in the list draws
 * its frame stronger on the canvas, and a label tapped on the canvas picks
 * its row. Split out of `editor.ts` for the 700-line rule.
 */

import { isPrint } from "../lib/print";
import { projectPresentation, type ProjectMeta } from "../lib/types";
import { ArtboardsPanel } from "./artboards-panel";
import type { OverlaysPanel } from "./overlays-panel";
import { ScreenGuide } from "./screen-guide";

export interface CanvasGuidesDeps {
  meta: ProjectMeta;
  /** The row a running game fills — see `ScreenGuideConfig.main`. */
  main: HTMLElement;
  canvasWrap: HTMLElement;
  overlays: OverlaysPanel;
  defaultZoom: () => number;
  centreOn: (x: number, y: number) => void;
}

export interface CanvasGuides {
  guide: ScreenGuide;
  destroy: () => void;
}

export function createCanvasGuides(deps: CanvasGuidesDeps): CanvasGuides {
  let artboards: ArtboardsPanel | null = null;
  const guide = new ScreenGuide({
    main: deps.main,
    defaultZoom: deps.defaultZoom,
    presentation: () => projectPresentation(deps.meta),
    onPickArtboard: (id) => artboards?.pick(id, false),
  });
  deps.canvasWrap.appendChild(guide.root);
  deps.overlays.setGuide(guide);
  if (isPrint(deps.meta)) {
    artboards = new ArtboardsPanel(deps.meta, {
      centreOn: deps.centreOn,
      setActive: (id) => guide.setActive(id),
    });
    // Above Overlays, at the foot of the left sidebar.
    deps.overlays.root.prepend(artboards.root);
  }
  return {
    guide,
    destroy: () => {
      artboards?.destroy();
      guide.destroy();
    },
  };
}
