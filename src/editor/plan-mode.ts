/**
 * Plan mode: tracing paper over the scene.
 *
 * The pencil beside the scene dropdown opens it. The canvas — artboards and
 * all — takes a faint blue cast, the toolbars give way to two tools, a Pencil
 * that draws only in the plan's blue and an Eraser, and whatever is drawn
 * goes on the scene's plan rather than on a layer (`lib/plan.ts`). A Lasso
 * catches plan strokes to move, scale and turn in the box they then wear
 * (`drawing/transform-box.ts`), or to Delete. The pencil and the eraser have
 * every brush control in the inspector's TOOL zone but the colour — a plan is
 * blue — and each keeps its own. Done, the pencil again, or Escape puts the
 * mode away.
 *
 * Out of the mode the plan stays on the canvas as an overlay: the strokes
 * alone, without the tint, over the scene's own ink and taking no pointer, so
 * nothing about drawing or arranging the scene changes with a plan on top of
 * it. The Overlays section in the left sidebar gets a Plan row — a switch and
 * an opacity slider — whenever the open scene has a plan to show.
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
import { hasPlan, PLAN_COLOR, planSource } from "../lib/plan";
import type { Selection } from "../lib/types";
import { brushSection } from "./inspect-brush";
import type { Inspector } from "./inspector";
import { isTyping } from "./shortcuts";

/** What the plan's pencil starts as: thin, unsmoothed, and only ever blue. */
const PENCIL = { size: 4, smoothing: 0 };
/** And its eraser: what the pencil would draw, wide, taken out. */
const ERASER = { size: 28, smoothing: 0 };

type PlanTool = "pencil" | "eraser" | "lasso";

const TOOL_NAMES: Record<PlanTool, string> = { pencil: "Pencil", eraser: "Eraser", lasso: "Lasso" };
const TOOL_HINTS: Record<PlanTool, string> = {
  pencil: "Draws the plan, in its blue, on no layer.",
  eraser: "Takes plan ink out.",
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
  /** The game camera, which the sheet's two-finger gestures drive. */
  camera: () => {
    panScreen: (dx: number, dy: number) => void;
    zoomAt: (factor: number, x: number, y: number) => void;
    setSelection: (selection: Selection) => void;
  } | null;
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
  private readonly bar: HTMLElement;
  private readonly buttons = new Map<PlanTool, HTMLButtonElement>();
  private activeValue = false;
  private tool: PlanTool = "pencil";
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
        },
        onZone: () => {},
        onFillPoints: () => {},
      },
      planSource(store),
    );
    this.layer.root.classList.add("plan-surface");
    this.sheet = h("div", { class: "plan-sheet" }, h("div", { class: "plan-tint" }), this.layer.root);

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
    document.addEventListener("keydown", onKey);
    this.stop.push(
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
        onClick: () => {
          this.tool = tool;
          this.useTool(tool);
          this.paint();
        },
      },
      icon(path, 21),
    ) as HTMLButtonElement;
    this.buttons.set(tool, button);
    return button;
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

  /** A plan tool's style: its own tip, size and smoothing, and the plan's blue. */
  private styleFor(tool: "pencil" | "eraser"): StrokeStyle {
    return {
      ...this.layer.style,
      ...this.styles[tool],
      color: PLAN_COLOR,
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
        // Nothing to set, so the zone says what the tool does instead.
        if (tool === "lasso") return [h("div", { class: "inspect-empty", text: TOOL_HINTS.lasso })];
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
      button.setAttribute("aria-pressed", String(tool === this.tool));
    }
    this.sheet.classList.toggle("hidden", !on && !this.shown);
    this.layer.root.style.opacity = on ? "" : String(this.opacity);
  }
}
