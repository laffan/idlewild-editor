/**
 * Plan mode: tracing paper over the scene.
 *
 * The pencil beside the scene dropdown opens it. The canvas — artboards and
 * all — goes under a white wash, the toolbars give way to two tools, a Pencil
 * that draws only in the plan's blue and an Eraser, and whatever is drawn
 * goes on the scene's plan rather than on a layer (`lib/plan.ts`). A Lasso
 * catches plan strokes to move, scale and turn in the box they then wear
 * (`drawing/transform-box.ts`), to Delete, or to Convert to PSD — which
 * hands them, as a placed PSD, to the top object layer in the stack and takes
 * them off the plan, the way a sketch converted on its own layer leaves it.
 * Holding the pen tip or a finger still borrows the Lasso from the tool in
 * hand (`drawing/hold-lasso.ts`), and a double tap on the Pencil's barrel
 * swaps the pencil and the eraser (`lib/pencil.ts`). The pencil and the
 * eraser have every brush control in the inspector's TOOL zone but the
 * colour — a plan is blue — and each keeps its own. Done, the pencil again, or Escape puts the
 * mode away.
 *
 * Out of the mode the plan stays on the canvas as an overlay: the strokes
 * alone, without the tint, over the scene's own ink and taking no pointer, so
 * nothing about drawing or arranging the scene changes with a plan on top of
 * it. The Overlays section in the left sidebar gets a Plan row — a switch and
 * an opacity slider — whenever the open scene has a plan to show, and a Plan
 * overlay row for the wash, the same pair, while the mode is up.
 *
 * It is the same ink engine as every other stroke, a second `DrawingLayer`
 * reading the plan through a `StrokeSource` rather than a layer. Its sheet
 * sits just over the scene's own ink and under the rail and the artboards'
 * labels; in the mode it takes the pointer, and the tint sits between the
 * scene and it. Fingers still pan and pinch, as they do on the ink.
 */

import { DrawingLayer, type StrokeStyle, type Viewport } from "../drawing";
import type { DocStore } from "../lib/doc-store";
import { h, ICONS, icon } from "../lib/dom";
import { withAlpha } from "../lib/color";
import { hasPlan, PLAN_COLOR, PLAN_INK_ALPHA, planSource } from "../lib/plan";
import { Grid } from "../lib/grid";
import { layerKind } from "../lib/layer-kinds";
import * as log from "../lib/log";
import type { WorldScene } from "../game/world-scene";
import { convertStrokesToPsd } from "./stroke-actions";
import { brushSection } from "./inspect-brush";
import type { Inspector } from "./inspector";
import { isTyping } from "./shortcuts";
import { onPencilDoubleTap } from "../lib/pencil";

/** What the plan's pencil starts as: Charcoal, thin, unsmoothed, only ever blue. */
const PENCIL = { brushId: 2, size: 4, smoothing: 0 };
/** And its eraser: what the pencil would draw, wide, taken out. */
const ERASER = { size: 28, smoothing: 0 };

type PlanTool = "pencil" | "eraser" | "lasso";

const TOOL_NAMES: Record<PlanTool, string> = { pencil: "Pencil", eraser: "Eraser", lasso: "Lasso" };
const TOOL_HINTS: Record<PlanTool, string> = {
  pencil:
    "Draws the plan, in its blue, on no layer. Hold the tip still to lasso " +
    "instead, and double-tap the Pencil for the eraser.",
  eraser: "Takes plan ink out. Double-tap the Pencil for the pencil again.",
  lasso:
    "Draw around plan strokes to catch them. Drag inside the box to move them, " +
    "a corner to scale, the knob to turn; Delete removes them.",
};

export interface PlanModeDeps {
  store: DocStore;
  /** The canvas column the plan's sheet and bar go in. */
  wrap: HTMLElement;
  /** Whose TOOL zone the plan's brush controls take over in the mode. */
  inspector: Inspector;
  /** Whose `psd/` a converted plan is written into. */
  projectId: string;
  /** The scene: its camera, which the sheet's two-finger gestures drive, and
   *  where a converted plan is placed. */
  camera: () => WorldScene | null;
  /** The open scene's plan appeared, went, or the mode was entered or left. */
  onChange?: () => void;
}

export class PlanMode {
  /** The pencil beside the scene dropdown. */
  readonly toggle: HTMLButtonElement;
  private readonly deps: PlanModeDeps;
  private readonly layer: DrawingLayer;
  /** The tint and the sheet, together just over the scene's own ink. */
  private readonly sheet: HTMLElement;
  /** The wash over the scene while planning. */
  private readonly tint: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly buttons = new Map<PlanTool, HTMLButtonElement>();
  private activeValue = false;
  private tool: PlanTool = "pencil";
  /**
   * Whether a held pen or finger has lent the plan's Lasso from `tool` — see
   * `drawing/hold-lasso.ts`. The bar and the panel show the Lasso meanwhile;
   * `tool` stays what it was, which is what comes back.
   */
  private borrowing = false;
  /** The pencil's and the eraser's own styles, kept apart. */
  private readonly styles: Record<"pencil" | "eraser", Partial<StrokeStyle>> = {
    pencil: { ...PENCIL },
    eraser: { ...ERASER },
  };
  /** What the plan's lasso caught. */
  private selected: string[] = [];
  /** The Overlays panel's Plan switch and slider, for outside the mode. */
  private shown = true;
  private opacity = 1;
  /** And its Plan overlay switch and slider, for the wash in the mode. */
  private tintShown = true;
  private tintOpacity = 0.5;
  private hadPlan: boolean;
  private readonly stop: Array<() => void> = [];

  constructor(deps: PlanModeDeps) {
    this.deps = deps;
    const { store } = deps;
    this.layer = new DrawingLayer(
      store,
      "",
      {
        onPan: (dx, dy) => deps.camera()?.panScreen(dx, dy),
        onZoom: (factor, x, y) => deps.camera()?.zoomAt(factor, x, y),
        onSelect: (ids) => {
          this.selected = ids;
          // The panel offers Convert to PSD for what was caught.
          if (this.activeValue) this.deps.inspector.setToolOverride(this.panel(this.inHand()));
        },
        onZone: () => {},
        onFillPoints: () => {},
        onBorrow: (tool) => {
          this.borrowing = tool === "lasso";
          if (this.activeValue) this.deps.inspector.setToolOverride(this.panel(this.inHand()));
          this.paint();
        },
      },
      planSource(store),
    );
    this.layer.root.classList.add("plan-surface");
    this.tint = h("div", { class: "plan-tint" });
    this.sheet = h("div", { class: "plan-sheet" }, this.tint, this.layer.root);

    this.toggle = h(
      "button",
      {
        class: "scene-plan",
        title: "Plan — draw over the scene in blue, on no layer",
        "aria-label": "Plan mode",
        "aria-pressed": "false",
        onClick: () => this.setActive(!this.activeValue),
      },
      icon(ICONS.pencil, 16),
    ) as HTMLButtonElement;

    this.bar = h(
      "div",
      { class: "tool-rail plan-bar" },
      h("div", { class: "plan-bar-head m", text: "Plan" }),
      this.toolButton("pencil", ICONS.pencil),
      this.toolButton("eraser", ICONS.pencil),
      this.toolButton("lasso", ICONS.lasso),
      h("button", {
        class: "tool-btn plan-done",
        title: "Leave plan mode (Esc)",
        text: "Done",
        onClick: () => this.setActive(false),
      }),
    );
    deps.wrap.append(this.sheet, this.bar);

    this.hadPlan = hasPlan(store.activeScene);
    const changed = () => {
      const now = hasPlan(store.activeScene);
      if (now !== this.hadPlan) {
        this.hadPlan = now;
        this.deps.onChange?.();
      }
    };
    store.addEventListener("change", changed);
    const switched = () => {
      this.layer.repaint();
      changed();
    };
    store.addEventListener("scene", switched);
    const onKey = (event: KeyboardEvent) => {
      if (!this.activeValue || isTyping(event.target)) return;
      if (event.key === "Escape") this.setActive(false);
      if ((event.key === "Delete" || event.key === "Backspace") && this.selected.length > 0) {
        event.preventDefault();
        this.layer.removeStrokes(this.selected);
        this.layer.select([]);
        this.selected = [];
      }
    };
    // The Pencil's double tap swaps the pencil and the eraser, as in Hush; from
    // the Lasso it goes back to the pencil. See `lib/pencil.ts`.
    const stopTap = onPencilDoubleTap(() => {
      if (!this.activeValue) return;
      this.pick(this.tool === "pencil" && !this.borrowing ? "eraser" : "pencil");
    });
    document.addEventListener("keydown", onKey);
    this.stop.push(
      stopTap,
      () => store.removeEventListener("change", changed),
      () => store.removeEventListener("scene", switched),
      () => document.removeEventListener("keydown", onKey),
    );
    this.paint();
  }

  get active(): boolean {
    return this.activeValue;
  }

  /** Whether the open scene has a plan — what decides the Overlays row. */
  get present(): boolean {
    return this.hadPlan;
  }

  setActive(on: boolean): void {
    if (on === this.activeValue) return;
    this.activeValue = on;
    // What was selected on the canvas is not what the plan is about, and a
    // Delete pressed while planning must not reach it.
    if (on) this.deps.camera()?.setSelection({ kind: "none" });
    if (!on) {
      this.layer.select([]);
      this.selected = [];
      this.borrowing = false;
    }
    this.useTool(on ? this.tool : null);
    this.paint();
    this.deps.onChange?.();
  }

  /** The Overlays panel's Plan switch and opacity, for outside the mode. */
  setOverlay(shown: boolean, opacity: number): void {
    this.shown = shown;
    this.opacity = opacity;
    this.paint();
  }

  /** The Overlays panel's Plan overlay switch and opacity, for the wash. */
  setTint(shown: boolean, opacity: number): void {
    this.tintShown = shown;
    this.tintOpacity = opacity;
    this.paint();
  }

  /** Follow the camera, and keep the sheet just over the scene's own ink. */
  sync(view: Viewport): void {
    const ink = this.deps.wrap.querySelector<HTMLElement>(":scope > .draw-surface");
    if (ink && ink.nextElementSibling !== this.sheet) ink.after(this.sheet);
    this.layer.sync(view);
  }

  destroy(): void {
    for (const stop of this.stop) stop();
    if (this.activeValue) this.deps.inspector.setToolOverride(null);
    this.layer.destroy();
    this.sheet.remove();
    this.bar.remove();
    this.deps.wrap.classList.remove("planning");
  }

  private toolButton(tool: PlanTool, path: string | readonly string[]): HTMLButtonElement {
    const name = TOOL_NAMES[tool];
    const button = h(
      "button",
      {
        class: tool === "eraser" ? "tool-btn erasing" : "tool-btn",
        title: name,
        "aria-label": name,
        onClick: () => this.pick(tool),
      },
      icon(path, 21),
    ) as HTMLButtonElement;
    this.buttons.set(tool, button);
    return button;
  }

  /** Put a tool in hand, from the bar or the Pencil's double tap. */
  private pick(tool: PlanTool): void {
    this.tool = tool;
    this.borrowing = false;
    this.useTool(tool);
    this.paint();
  }

  /** The tool the bar and the panel show: a borrowed Lasso, or the one in hand. */
  private inHand(): PlanTool {
    return this.borrowing ? "lasso" : this.tool;
  }

  private useTool(tool: PlanTool | null): void {
    this.deps.inspector.setToolOverride(tool ? this.panel(tool) : null);
    if (!tool) {
      this.layer.setTool(null);
      return;
    }
    if (tool === "lasso") {
      this.layer.setTool("lasso");
      return;
    }
    this.layer.style = this.styleFor(tool);
    // Re-picked, so a switch between the two lands even though both are the
    // engine's pencil.
    this.layer.setTool(null);
    this.layer.setTool("pencil");
  }

  /**
   * What the lasso caught, as a placed PSD on the top object layer in the
   * stack — the first one a person sees in the list — and off the plan.
   */
  private async convert(): Promise<void> {
    const scene = this.deps.camera();
    const { store } = this.deps;
    if (!scene || this.selected.length === 0) return;
    const target = store.layers.find((layer) => layerKind(layer) === "object");
    if (!target) {
      log.warn("The plan needs an object layer to become a PSD on — add one first");
      return;
    }
    const grid = new Grid(store.projection, store.gridSize);
    const ids = this.selected;
    const done = await convertStrokesToPsd(
      this.deps.projectId,
      store,
      grid,
      this.layer,
      scene,
      { kind: "strokes", layerId: target.id, ids },
      target.id,
    );
    if (!done) return;
    this.layer.select([]);
    this.selected = [];
    if (this.activeValue) this.deps.inspector.setToolOverride(this.panel(this.inHand()));
  }

  /**
   * A plan tool's style: its own tip, size and smoothing, and the plan's blue
   * — at the plan's ink opacity for the pencil, and opaque for the eraser,
   * whose alpha is how much it takes out: a 90% eraser leaves a ghost.
   */
  private styleFor(tool: "pencil" | "eraser"): StrokeStyle {
    return {
      ...this.layer.style,
      ...this.styles[tool],
      color: tool === "pencil" ? withAlpha(PLAN_COLOR, PLAN_INK_ALPHA) : PLAN_COLOR,
      mode: "ink",
      erase: tool === "eraser",
      paint: { kind: "color" },
    };
  }

  /** The TOOL zone while planning: the brush controls, but not the colour. */
  private panel(tool: PlanTool) {
    return {
      subject: `Plan ${TOOL_NAMES[tool].toLowerCase()}`,
      hint: TOOL_HINTS[tool],
      rows: () => {
        // Nothing to set, so the zone says what the tool does instead — and,
        // once something is caught, what can be done with it.
        if (tool === "lasso") {
          if (this.selected.length === 0) {
            return [h("div", { class: "inspect-empty", text: TOOL_HINTS.lasso })];
          }
          const n = this.selected.length;
          return [
            h(
              "div",
              { class: "inspect-section" },
              h("div", { class: "inspect-title", text: `${n} plan stroke${n === 1 ? "" : "s"}` }),
              h("button", {
                class: "panel-btn primary",
                text: "Convert to PSD",
                title: "A placed PSD on the top object layer; the strokes leave the plan",
                onClick: () => void this.convert(),
              }),
            ),
          ];
        }
        return [
          brushSection(this.styleFor(tool), (patch) => {
            this.styles[tool] = { ...this.styles[tool], ...patch };
            // Not re-rendered: the controls keep themselves current, and a
            // slider rebuilt under the finger dragging it is a dropped drag.
            this.layer.style = this.styleFor(tool);
          }),
        ];
      },
    };
  }

  private paint(): void {
    const on = this.activeValue;
    this.deps.wrap.classList.toggle("planning", on);
    this.toggle.setAttribute("aria-pressed", String(on));
    this.toggle.classList.toggle("on", on);
    for (const [tool, button] of this.buttons) {
      button.setAttribute("aria-pressed", String(tool === this.inHand()));
    }
    this.sheet.classList.toggle("hidden", !on && !this.shown);
    this.layer.root.style.opacity = on ? "" : String(this.opacity);
    this.tint.classList.toggle("hidden", !this.tintShown);
    this.tint.style.opacity = String(this.tintOpacity);
  }
}
