/**
 * A full colour picker: saturation/value field, hue slider, hex entry and
 * recent colours.
 *
 * Hand-built rather than `<input type="color">` because that control is
 * unreliable in WKWebView on iPadOS, and this is a touch-first editor — the
 * field and slider read pointer events directly, so a finger and an Apple
 * Pencil behave identically.
 */

import { h } from "./dom";
import {
  contrastInk,
  hexToHsv,
  hsvToHex,
  isValidHex,
  normaliseHex,
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
}

export function createColorPicker(options: ColorPickerOptions): ColorPicker {
  let hsv: Hsv = hexToHsv(options.value);

  const field = h("div", { class: "cp-field" });
  const fieldThumb = h("div", { class: "cp-thumb" });
  field.appendChild(fieldThumb);

  const hue = h("div", { class: "cp-hue" });
  const hueThumb = h("div", { class: "cp-thumb cp-thumb-hue" });
  hue.appendChild(hueThumb);

  const preview = h("div", { class: "cp-preview" });
  const hexInput = h("input", {
    class: "cp-hex",
    spellcheck: "false",
    maxlength: "7",
    "aria-label": "Hex colour",
  });
  const recentRow = h("div", { class: "cp-recent" });

  const paint = () => {
    const hex = hsvToHex(hsv);
    field.style.background = [
      "linear-gradient(to top, #000, transparent)",
      "linear-gradient(to right, #fff, transparent)",
      `hsl(${hsv.h} 100% 50%)`,
    ].join(", ");
    fieldThumb.style.left = `${hsv.s * 100}%`;
    fieldThumb.style.top = `${(1 - hsv.v) * 100}%`;
    fieldThumb.style.background = hex;
    hueThumb.style.top = `${(hsv.h / 360) * 100}%`;
    preview.style.background = hex;
    preview.style.color = contrastInk(hex);
    preview.textContent = hex.toUpperCase();
    if (document.activeElement !== hexInput) hexInput.value = hex;
  };

  const emit = () => {
    paint();
    options.onChange(hsvToHex(hsv));
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
      const hex = hsvToHex(hsv);
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

  hexInput.addEventListener("input", () => {
    if (!isValidHex(hexInput.value)) return;
    hsv = hexToHsv(normaliseHex(hexInput.value));
    paint();
    options.onChange(hsvToHex(hsv));
  });
  hexInput.addEventListener("change", () => {
    if (!isValidHex(hexInput.value)) {
      paint();
      return;
    }
    const hex = normaliseHex(hexInput.value);
    rememberColor(hex);
    renderRecent();
    options.onCommit?.(hex);
  });

  function renderRecent(): void {
    recentRow.replaceChildren();
    for (const hex of readRecent()) {
      recentRow.appendChild(
        h("button", {
          class: "cp-swatch",
          style: { background: hex },
          title: hex,
          type: "button",
          onClick: () => {
            hsv = hexToHsv(hex);
            paint();
            options.onChange(hex);
            options.onCommit?.(hex);
          },
        }),
      );
    }
  }

  const root = h(
    "div",
    { class: "cp" },
    field,
    h("div", { class: "cp-side" }, hue),
    h("div", { class: "cp-row" }, preview, hexInput),
    recentRow,
  );

  renderRecent();
  paint();

  return {
    root,
    getValue: () => hsvToHex(hsv),
    setValue: (hex: string) => {
      hsv = hexToHsv(hex);
      paint();
    },
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
