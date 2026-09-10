/**
 * Movement controls for a platformer's play mode: three buttons over the
 * canvas, and the arrow keys behind them.
 *
 * DOM rather than objects in the scene, because the canvas's pointer events
 * belong to the gesture arbiter — `game/camera-rig.ts` takes them before
 * Phaser's own input plumbing sees them, which is what lets a finger pan the
 * world without fighting the drawing layer. A Phaser button over that canvas
 * would be a fourth claimant on the same pointer. The exported game has no
 * such arbiter and draws its pad in the scene instead.
 *
 * The pad reports *held* state rather than events. A platformer is held
 * controls: how long left is down is the input, not how many times it was
 * pressed.
 */

import { h } from "../lib/dom";
import type { PlayInput } from "../game/platformer";

type Action = keyof PlayInput;

const KEYS: Record<string, Action> = {
  ArrowLeft: "left",
  KeyA: "left",
  ArrowRight: "right",
  KeyD: "right",
  ArrowUp: "jump",
  KeyW: "jump",
  Space: "jump",
};

export class PlayPad {
  readonly root: HTMLElement;
  private readonly onChange: (input: PlayInput) => void;
  private readonly held = new Set<Action>();
  /** Which pointer is on which button, so two thumbs work independently. */
  private readonly pointers = new Map<number, Action>();
  private active = false;

  constructor(onChange: (input: PlayInput) => void) {
    this.onChange = onChange;
    this.root = h(
      "div",
      { class: "play-pad hidden" },
      h(
        "div",
        { class: "play-pad-side" },
        this.button("left", "◀", "Move left"),
        this.button("right", "▶", "Move right"),
      ),
      this.button("jump", "▲", "Jump"),
    );

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  /** Shown only in play mode, and only where there is something to drive. */
  setActive(active: boolean): void {
    this.active = active;
    this.root.classList.toggle("hidden", !active);
    if (!active) this.releaseAll();
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.root.remove();
  }

  private button(action: Action, glyph: string, label: string): HTMLElement {
    return h("button", {
      class: `play-btn ${action}`,
      type: "button",
      text: glyph,
      "aria-label": label,
      title: label,
      onPointerDown: (event: PointerEvent) => {
        event.preventDefault();
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        this.pointers.set(event.pointerId, action);
        this.press(action, true);
      },
      onPointerUp: (event: PointerEvent) => this.releasePointer(event),
      onPointerCancel: (event: PointerEvent) => this.releasePointer(event),
    });
  }

  private releasePointer(event: PointerEvent): void {
    const action = this.pointers.get(event.pointerId);
    if (!action) return;
    this.pointers.delete(event.pointerId);
    this.press(action, false);
  }

  /**
   * The keyboard.
   *
   * Read on `window` rather than on the canvas, which never holds focus —
   * every pointer handler over it calls `preventDefault`, so nothing in the
   * scene is ever the focused element. Ignored while a field has the caret,
   * because there "A" and the space bar mean what they say.
   */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const action = this.actionFor(event);
    if (!action) return;
    event.preventDefault();
    this.press(action, true);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const action = this.actionFor(event);
    if (!action) return;
    this.press(action, false);
  };

  private actionFor(event: KeyboardEvent): Action | null {
    if (!this.active) return null;
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return null;
    }
    return KEYS[event.code] ?? null;
  }

  private press(action: Action, down: boolean): void {
    const had = this.held.has(action);
    if (down) this.held.add(action);
    else this.held.delete(action);
    if (had === down) return;

    for (const el of this.root.querySelectorAll(`.play-btn.${action}`)) {
      el.classList.toggle("down", down);
    }
    this.publish();
  }

  private releaseAll(): void {
    if (this.held.size === 0) return;
    this.held.clear();
    this.pointers.clear();
    for (const el of this.root.querySelectorAll(".play-btn.down")) {
      el.classList.remove("down");
    }
    this.publish();
  }

  private publish(): void {
    this.onChange({
      left: this.held.has("left"),
      right: this.held.has("right"),
      jump: this.held.has("jump"),
    });
  }
}
