/**
 * Plan mode: tracing paper over the scene.
 *
 * The pencil beside the scene dropdown opens it. The canvas — artboards and
 * all — takes a faint blue cast, the toolbars give way to two tools, a Pencil
 * that draws only in the plan's blue and an Eraser, and whatever is drawn
 * goes on the scene's plan rather than on a layer (`lib/plan.ts`). Done, the
 * pencil again, or Escape puts it away.
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

import { DrawingLayer, type Viewport } from "../drawing";
import type { DocStore } from "../lib/doc-store";
import { h, ICONS, icon } from "../lib/dom";
import { hasPlan, PLAN_COLOR, planSource } from "../lib/plan";
import type { Selection } from "../lib/types";

/** The plan's pencil: thin, unsmoothed, and only ever blue. */
const PENCIL = { size: 4, smoothing: 0 };
/** The plan's eraser: what the pencil would draw, wide, taken out. */
const ERASER = { size: 28, smoothing: 0 };

type PlanTool = "pencil" | "eraser";

export interface PlanModeDeps {
  store: DocStore;
  /** The canvas column the plan's sheet and bar go in. */
  wrap: HTMLElement;
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
        onSelect: () => {},
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
      this.toolButton("pencil", "Pencil"),
      this.toolButton("eraser", "Eraser"),
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
      if (this.activeValue && event.key === "Escape") this.setActive(false);
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
    this.layer.destroy();
    this.sheet.remove();
    this.bar.remove();
    this.deps.wrap.classList.remove("planning");
  }

  private toolButton(tool: PlanTool, name: string): HTMLButtonElement {
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
      icon(ICONS.pencil, 21),
    ) as HTMLButtonElement;
    this.buttons.set(tool, button);
    return button;
  }

  private useTool(tool: PlanTool | null): void {
    if (!tool) {
      this.layer.setTool(null);
      return;
    }
    const size = tool === "eraser" ? ERASER : PENCIL;
    this.layer.style = {
      ...this.layer.style,
      ...size,
      color: PLAN_COLOR,
      mode: "ink",
      erase: tool === "eraser",
      paint: { kind: "color" },
    };
    // Re-picked, so a switch between the two lands even though both are the
    // engine's pencil.
    this.layer.setTool(null);
    this.layer.setTool("pencil");
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
