/**
 * The marks the canvas draws about the game rather than in it — the screen
 * guide — and, on a print project, the list of artboards that steers it, the
 * rulers and handles each artboard wears (`artboard-chrome.ts`), and the
 * artboard shown in the inspector once one is picked (`inspect-artboard.ts`).
 * Built here too: the veil over the canvas while its PSDs load
 * (`psd-veil.ts`), which is the other thing the wrapper wears over the canvas
 * rather than inside it.
 *
 * Built together because they talk both ways: a row picked in the list or a
 * label tapped on the canvas picks the artboard everywhere — its row, its
 * frame drawn stronger, and the inspector's OBJECT zone — and the canvas
 * selecting anything, or a tap on empty canvas, puts it down again. Split out
 * of `editor.ts` for the 700-line rule.
 */

import type { Viewport } from "../drawing";
import type { DocStore } from "../lib/doc-store";
import { ICONS } from "../lib/dom";
import { currentArtboards, isPrint, onPageChange, type PagePatch } from "../lib/print";
import { projectPresentation, type ProjectMeta } from "../lib/types";
import { ArtboardChrome } from "./artboard-chrome";
import { ArtboardsPanel } from "./artboards-panel";
import { renderArtboard } from "./inspect-artboard";
import type { Inspector } from "./inspector";
import type { LayersPanel } from "./layers-panel";
import type { OverlaysPanel } from "./overlays-panel";
import { changePage } from "./print-page";
import { PlanMode, type PlanModeDeps } from "./plan-mode";
import { openPrintSetup } from "./print-setup";
import { createPsdVeil } from "./psd-veil";
import { ScreenGuide } from "./screen-guide";

export interface CanvasGuidesDeps {
  meta: ProjectMeta;
  /** The row a running game fills — see `ScreenGuideConfig.main`. */
  main: HTMLElement;
  canvasWrap: HTMLElement;
  overlays: OverlaysPanel;
  inspector: Inspector;
  store: DocStore;
  layers: LayersPanel;
  /** The game camera, for the plan's two-finger gestures — see `plan-mode.ts`. */
  camera: PlanModeDeps["camera"];
  defaultZoom: () => number;
  centreOn: (x: number, y: number) => void;
  /** Put down whatever the canvas has selected. */
  clearSelection: () => void;
}

export interface CanvasGuides {
  guide: ScreenGuide;
  plan: PlanMode;
  /** The camera moved: the guide, and the plan's sheet, follow it. */
  sync: (view: Viewport) => void;
  destroy: () => void;
}

/** How far a press on the canvas may wander and still be a tap. */
const TAP_SLOP_PX = 6;

export function createCanvasGuides(deps: CanvasGuidesDeps): CanvasGuides {
  let artboards: ArtboardsPanel | null = null;
  const guide = new ScreenGuide({
    main: deps.main,
    defaultZoom: deps.defaultZoom,
    presentation: () => projectPresentation(deps.meta),
    onPickArtboard: (id) => artboards?.pick(id, false),
  });
  deps.canvasWrap.appendChild(guide.root);
  const veil = createPsdVeil();
  deps.canvasWrap.appendChild(veil.root);
  deps.overlays.setGuide(guide);
  const stops: Array<() => void> = [];
  // The scene's plan: the pencil beside the scene's name, the sheet over the
  // canvas, and its row in Overlays while there is a plan to show.
  const plan: PlanMode = new PlanMode({
    store: deps.store,
    wrap: deps.canvasWrap,
    projectId: deps.meta.id,
    inspector: deps.inspector,
    camera: deps.camera,
    onChange: () => deps.overlays.showPlanSwitch(plan.present, (shown, o) => plan.setOverlay(shown, o)),
  });
  deps.layers.addSceneAction(plan.toggle);
  deps.overlays.showPlanSwitch(plan.present, (shown, o) => plan.setOverlay(shown, o));
  stops.push(() => plan.destroy());
  if (isPrint(deps.meta)) {
    const chrome = new ArtboardChrome({ preview: (board) => guide.previewBoard(board) });
    guide.setChrome(chrome);
    // The boundary switch shows and hides the artboards here, so it says so.
    deps.overlays.relabel("boundary", "Artboards", "The sheets this project prints", ICONS.file);
    // The guides have a switch of their own, beside the canvas's other marks.
    deps.overlays.addGuidesSwitch((on) => chrome.setGuidesVisible(on));
    stops.push(() => chrome.destroy());
    artboards = new ArtboardsPanel(deps.meta, {
      centreOn: deps.centreOn,
      setActive: (id) => show(id),
    });
    // Above Overlays, at the foot of the left sidebar.
    deps.overlays.root.prepend(artboards.root);
    const { inspector } = deps;

    /**
     * The artboard showing. Moved before the inspector is told, so the one
     * being replaced knows it is not the one being put down.
     */
    let shown: string | null = null;
    /** The sheet as it was when Resize was pressed — what Cancel goes back to. */
    let before: PagePatch | null = null;

    /** Put an artboard in the inspector, or take it out. */
    const show = (id: string | null) => {
      shown = id;
      guide.setActive(id);
      chrome.setResizing(null);
      if (!id) {
        inspector.setArtboard(null);
        return;
      }
      deps.clearSelection();
      inspector.setArtboard({
        id,
        onDismiss: () => {
          if (shown !== id) return;
          shown = null;
          chrome.setResizing(null);
          guide.setActive(null);
          artboards?.unpick();
        },
        render: (panel) => {
          const boards = currentArtboards();
          const board = boards.find((b) => b.id === id);
          renderArtboard(panel, board, boards.length, {
            rename: (name) => void changePage({ artboard: id, name }),
            rulers: chrome.rulers,
            setRulers: (on) => void changePage({ rulers: on }),
            resizing: chrome.resizing === id,
            setResizing: (on) => {
              before = on && board ? sheetOf(board) : null;
              chrome.setResizing(on ? id : null);
              inspector.render();
            },
            cancelResize: () => {
              const back = before;
              before = null;
              chrome.setResizing(null);
              inspector.render();
              if (back) void changePage({ artboard: id, ...back });
            },
            pageSetup: () => openPrintSetup(deps.meta, id),
            remove: () => {
              if (board) void artboards?.remove(board);
            },
          });
        },
      });
    };

    // The panel says what is true now: a new name, a size dragged, a guide.
    stops.push(onPageChange(() => {
      if (inspector.artboardId) inspector.render();
    }));
    stops.push(dismissOnTap(deps.canvasWrap, () => {
      if (inspector.artboardId) inspector.setArtboard(null);
    }));
  }
  return {
    guide,
    plan,
    sync: (view) => {
      guide.sync(view);
      plan.sync(view);
    },
    destroy: () => {
      for (const stop of stops) stop();
      artboards?.destroy();
      guide.destroy();
      veil.destroy();
    },
  };
}

/** The fields a resize changes, as a patch that puts them back. */
function sheetOf(board: PagePatch): PagePatch {
  const { paper, landscape, customWidth, customHeight, x, y } = board;
  return { paper, landscape, customWidth, customHeight, x, y };
}

/**
 * A tap on the canvas itself — not a drag, and not on a label or a ruler — is
 * a tap on nothing as far as an artboard is concerned, the way it is for
 * anything else selected.
 */
function dismissOnTap(wrap: HTMLElement, onTap: () => void): () => void {
  let start: { x: number; y: number; id: number } | null = null;
  const down = (event: PointerEvent) => {
    start =
      event.target instanceof HTMLCanvasElement
        ? { x: event.clientX, y: event.clientY, id: event.pointerId }
        : null;
  };
  const up = (event: PointerEvent) => {
    if (!start || start.id !== event.pointerId) return;
    const near = Math.hypot(event.clientX - start.x, event.clientY - start.y) <= TAP_SLOP_PX;
    start = null;
    if (near) onTap();
  };
  wrap.addEventListener("pointerdown", down, true);
  window.addEventListener("pointerup", up, true);
  return () => {
    wrap.removeEventListener("pointerdown", down, true);
    window.removeEventListener("pointerup", up, true);
  };
}
