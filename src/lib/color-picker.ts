/**
 * A full colour picker: saturation/value field, hue and opacity sliders, an
 * eyedropper, hex entry, recent colours and the working palette.
 *
 * Hand-built rather than `<input type="color">` because that control is
 * unreliable in WKWebView on iPadOS, and this is a touch-first editor — the
 * field and the sliders read pointer events directly, so a finger and an Apple
 * Pencil behave identically.
 *
 * **Opacity is a second slider beside hue, not a separate control.** It is
 * part of the colour rather than a property of the thing wearing it: a
 * half-transparent wash and a pale opaque one are two different answers to the
 * same question, and putting them a panel apart makes the picker lie about
 * what it is showing. So what this hands back is one string — `#rrggbb`, or
 * `#rrggbbaa` once the slider leaves the top — and the opaque case is spelt
 * exactly as it always was. See `color.ts`.
 *
 * **Two rows of swatches, and they are opposite kinds of list.** The recents
 * are a record of what has been used; the palette under them is a set of
 * decisions, and nothing enters or leaves it without being asked. They look
 * alike because they are both a row of colours to tap, and the palette is the
 * one with buttons under it because it is the one you can change. See
 * `palette.ts` and `color-palette.ts`.
 */

import { h, ICONS, icon } from "./dom";
import { createPaletteRow } from "./color-palette";
import { pickColor } from "./eyedropper";
import {
  alphaOf,
  contrastInk,
  hexToHsv,
  hsvToHex,
  isValidHex,
  normaliseHex,
  withAlpha,
  type Hsv,
} from "./color";

const RECENT_KEY = "idlewild.recentColors";
const MAX_RECENT = 8;

export interface ColorPickerOptions {
  value: string;
  onChange: (hex: string) => void;
  /** Fires once when the interaction settles — commit point for undo. */
  onCommit?: (hex: string) => void;
}

export interface ColorPicker {
  root: HTMLElement;
  setValue: (hex: string) => void;
  getValue: () => string;
  /**
   * Let go of the palette subscription.
   *
   * Optional for a caller to bother with: the row drops its own listener the
   * first time it fires against an element that has left the page, which is
   * how every panel in the inspector already behaves. This is for the callers
   * that know exactly when they are done.
   */
  destroy: () => void;
}

export function createColorPicker(options: ColorPickerOptions): ColorPicker {
  let hsv: Hsv = hexToHsv(options.value);
  let alpha = alphaOf(options.value);

  /** The value as the rest of the editor sees it: hue, tone and opacity. */
  const current = (): string => withAlpha(hsvToHex(hsv), alpha);

  const field = h("div", { class: "cp-field" });
  const fieldThumb = h("div", { class: "cp-thumb" });
  field.appendChild(fieldThumb);

  const hue = h("div", { class: "cp-hue" });
  const hueThumb = h("div", { class: "cp-thumb cp-thumb-hue" });
  hue.appendChild(hueThumb);

  // The opacity track is the colour itself fading out over a checker, so what
  // the slider shows is what the slider does. The checker is the stylesheet's
  // — `--cp-checker` — and the gradient is set here because it follows the
  // colour the field and the hue slider are choosing.
  const opacity = h("div", { class: "cp-alpha" });
  const opacityFade = h("div", { class: "cp-alpha-fade" });
  const opacityThumb = h("div", { class: "cp-thumb cp-thumb-hue" });
  opacity.append(opacityFade, opacityThumb);

  const preview = h("div", { class: "cp-preview" });
  const hexInput = h("input", {
    class: "cp-hex",
    spellcheck: "false",
    maxlength: "9",
    "aria-label": "Hex colour",
  });
  const recentRow = h("div", { class: "cp-recent" });

  /**
   * The eyedropper, at the head of the hex row.
   *
   * There rather than beside the field because it answers the same question
   * the two things next to it do — *what colour is this, exactly* — and the
   * row already reads left to right as pick it, see it, type it. Beside the
   * saturation field it would have read as a third way of choosing a colour
   * from scratch, which is not what it is.
   */
  const dropper = h("button", {
    class: "cp-dropper",
    type: "button",
    title: "Pick a colour off the canvas",
    "aria-label": "Pick a colour off the canvas",
    onClick: () => {
      void pickColor().then((hex) => {
        if (hex) settle(hex);
      });
    },
  });
  dropper.appendChild(icon(ICONS.dropper, 15));

  const paint = () => {
    const solid = hsvToHex(hsv);
    const hex = current();
    field.style.background = [
      "linear-gradient(to top, #000, transparent)",
      "linear-gradient(to right, #fff, transparent)",
      `hsl(${hsv.h} 100% 50%)`,
    ].join(", ");
    fieldThumb.style.left = `${hsv.s * 100}%`;
    fieldThumb.style.top = `${(1 - hsv.v) * 100}%`;
    fieldThumb.style.background = solid;
    hueThumb.style.top = `${(hsv.h / 360) * 100}%`;
    // Top is opaque, so the thumb is where the colour has got to.
    opacityFade.style.background =
      `linear-gradient(to bottom, ${solid}, ${withAlpha(solid, 0)})`;
    opacityThumb.style.top = `${(1 - alpha) * 100}%`;
    opacityThumb.style.background = solid;
    // `backgroundColor`, not the shorthand: the shorthand would take the
    // stylesheet's checker off with it, and the checker is what makes a
    // half-transparent colour look half transparent.
    preview.style.backgroundColor = hex;
    preview.style.color = contrastInk(solid);
    preview.textContent = hex.toUpperCase();
    if (document.activeElement !== hexInput) hexInput.value = hex;
    // The palette's one button is about the colour in hand — a `+` or a `−`
    // depending on whether the palette already holds it — so it moves with
    // every drag of the field. Guarded because `paint` runs once while the
    // control is still being assembled, before the row exists.
    paletteRow?.sync();
  };

  const emit = () => {
    paint();
    options.onChange(current());
  };

  /**
   * Move to a colour chosen whole, rather than dragged out of the field.
   *
   * What a recent swatch, a palette swatch and the eyedropper all do: there is
   * no in-flight gesture to settle, so the change and the commit happen in the
   * same breath, and the colour goes into the recents exactly as one dragged
   * out of the field would.
   */
  const settle = (hex: string): void => {
    hsv = hexToHsv(hex);
    alpha = alphaOf(hex);
    paint();
    rememberColor(hex);
    renderRecent();
    options.onChange(hex);
    options.onCommit?.(hex);
  };

  // One drag handler for both surfaces; each maps the position differently.
  const track = (
    el: HTMLElement,
    read: (fx: number, fy: number) => void,
  ): void => {
    let active = false;

    const update = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const fx = clamp01((event.clientX - rect.left) / rect.width);
      const fy = clamp01((event.clientY - rect.top) / rect.height);
      read(fx, fy);
      emit();
    };

    el.addEventListener("pointerdown", (event) => {
      active = true;
      el.setPointerCapture(event.pointerId);
      update(event);
      event.preventDefault();
    });
    el.addEventListener("pointermove", (event) => {
      if (active) update(event);
    });
    const end = (event: PointerEvent) => {
      if (!active) return;
      active = false;
      el.releasePointerCapture(event.pointerId);
      const hex = current();
      rememberColor(hex);
      renderRecent();
      options.onCommit?.(hex);
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  };

  track(field, (fx, fy) => {
    hsv = { ...hsv, s: fx, v: 1 - fy };
  });
  track(hue, (_fx, fy) => {
    hsv = { ...hsv, h: fy * 360 };
  });
  // Down the track is more transparent, so the two sliders read the same way:
  // the top of each is the strong end.
  track(opacity, (_fx, fy) => {
    alpha = 1 - fy;
  });

  hexInput.addEventListener("input", () => {
    if (!isValidHex(hexInput.value)) return;
    const typed = normaliseHex(hexInput.value);
    hsv = hexToHsv(typed);
    // Only from a hex that *said* something about opacity. Typing six digits
    // over an eight-digit value is a change of colour, not a request to make
    // it opaque — and the slider is right there for that.
    if (hexInput.value.replace("#", "").trim().length > 6) alpha = alphaOf(typed);
    paint();
    options.onChange(current());
  });
  hexInput.addEventListener("change", () => {
    if (!isValidHex(hexInput.value)) {
      paint();
      return;
    }
    const hex = current();
    rememberColor(hex);
    renderRecent();
    options.onCommit?.(hex);
  });

  function renderRecent(): void {
    recentRow.replaceChildren();
    for (const hex of readRecent()) {
      const swatch = h("button", {
        // The checker is behind it rather than beside it, so a swatch that is
        // half there looks half there instead of looking like a paler colour.
        class: "cp-swatch",
        title: hex,
        type: "button",
        onClick: () => settle(hex),
      });
      swatch.appendChild(
        h("span", { class: "cp-swatch-ink", style: { background: hex } }),
      );
      recentRow.appendChild(swatch);
    }
  }

  // The palette, which is the picker's only outward-facing row: a colour
  // added here shows up in every other copy of this control, and goes out
  // with the artwork when the toggle under it is on.
  const paletteRow = createPaletteRow({
    current,
    onPick: (hex) => settle(hex),
  });

  const root = h(
    "div",
    { class: "cp" },
    field,
    h("div", { class: "cp-side" }, hue, opacity),
    h("div", { class: "cp-row" }, dropper, preview, hexInput),
    recentRow,
    paletteRow.root,
  );

  renderRecent();
  paint();

  return {
    root,
    getValue: current,
    setValue: (hex: string) => {
      hsv = hexToHsv(hex);
      alpha = alphaOf(hex);
      paint();
    },
    destroy: () => paletteRow.destroy(),
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isValidHex).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function rememberColor(hex: string): void {
  // Not a colour nobody could tell from any other colour: at zero opacity
  // every swatch is the same empty square, and a row of them is a row of
  // buttons that all do nothing visible.
  if (alphaOf(hex) === 0) return;
  try {
    const next = [hex, ...readRecent().filter((c) => c !== hex)].slice(
      0,
      MAX_RECENT,
    );
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Blocked site data — recents just do not persist.
  }
}
