/**
 * Colour conversions for the picker.
 *
 * Hex values are `#rrggbb`, or `#rrggbbaa` when they carry an opacity. The
 * eight-digit form is CSS Color 4's, which a Canvas 2D context understands as
 * a `fillStyle` on its own — so everything drawn on a 2D canvas gets opacity
 * for free, and only the two places that hand a colour to *Phaser* have to
 * split it (`hexToNumber` and `alphaOf`), because Phaser takes a packed RGB
 * number and an alpha as separate arguments.
 *
 * **Opaque is six digits.** `withAlpha` drops the pair back off at 1, so a
 * colour nobody has made transparent is written exactly as it always was: no
 * document changes shape, no older build reads a colour it cannot parse, and
 * the diff of a project where nobody touched the slider is empty.
 */

export interface Hsv {
  h: number; // 0–360
  s: number; // 0–1
  v: number; // 0–1
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * The digits of a hex colour, shorthand expanded, as `rrggbb` and `aa`.
 *
 * One place that knows the four shapes a hex can arrive in — `rgb`, `rgba`,
 * `rrggbb`, `rrggbbaa` — so nothing else has to count characters. An alpha
 * that was not written is `"ff"`, because a colour with nothing to say about
 * its opacity is opaque.
 */
function digits(hex: string): { rgb: string; alpha: string } {
  const clean = hex.replace("#", "").trim();
  const short = clean.length === 3 || clean.length === 4;
  const full = short
    ? clean
        .split("")
        .map((c) => c + c)
        .join("")
    : clean;
  return {
    rgb: full.padEnd(6, "0").slice(0, 6),
    alpha: full.length >= 8 ? full.slice(6, 8) : "ff",
  };
}

export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(digits(hex).rgb, 16);
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

/**
 * How opaque a colour is, 0–1. A six-digit hex is 1.
 *
 * The one question every consumer asks that `hexToRgb` cannot answer, and the
 * reason it is a function rather than a second field on a record: a colour is
 * a *string* everywhere in this document — on a fill, on a backdrop, on a
 * stroke, in the config the exported game reads — and adding an `alpha`
 * beside each of them would be five places to keep in step for a number that
 * is already in the value.
 */
export function alphaOf(hex: string): number {
  const parsed = Number.parseInt(digits(hex).alpha, 16);
  return Number.isFinite(parsed) ? parsed / 255 : 1;
}

/**
 * The same colour at a given opacity.
 *
 * Six digits at 1 — see the note at the top. Rounded to the byte the hex can
 * actually hold, so `alphaOf(withAlpha(c, a))` is stable rather than drifting
 * by a 255th every time a slider is touched.
 */
export function withAlpha(hex: string, alpha: number): string {
  const byte = Math.max(0, Math.min(255, Math.round(alpha * 255)));
  const rgb = `#${digits(hex).rgb}`;
  return byte >= 255 ? rgb : `${rgb}${byte.toString(16).padStart(2, "0")}`;
}

/** The colour with its opacity taken off — what Phaser's packed number is. */
export function opaqueHex(hex: string): string {
  return `#${digits(hex).rgb}`;
}

/**
 * A colour as the packed `0xrrggbb` Phaser wants, opacity dropped.
 *
 * Phaser takes a colour and an alpha as two arguments, so every call site that
 * uses this pairs it with `alphaOf` on the same string. It reads the *digits*
 * rather than parsing the whole thing, which is the bug this replaced: a
 * straight `parseInt` over an eight-digit hex comes back a thousand times too
 * large and paints something nobody chose.
 *
 * The accent for anything unreadable, which only a hand-edited document can
 * hold. It is the editor's own "here is a thing" colour, and a shape that came
 * out loud and wrong is a shape somebody will look at — black would read as a
 * decision.
 */
export function hexToNumber(hex: string): number {
  const parsed = Number.parseInt(digits(hex).rgb, 16);
  return Number.isFinite(parsed) ? parsed : 0xec3013;
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${((clamp(r) << 16) | (clamp(g) << 8) | clamp(b))
    .toString(16)
    .padStart(6, "0")}`;
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];

  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export function hexToHsv(hex: string): Hsv {
  return rgbToHsv(hexToRgb(hex));
}

export function hsvToHex(hsv: Hsv): string {
  return rgbToHex(hsvToRgb(hsv));
}

export function isValidHex(value: string): boolean {
  return /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.trim());
}

/** Shorthand expanded and the case settled, opacity carried through. */
export function normaliseHex(value: string): string {
  return withAlpha(rgbToHex(hexToRgb(value)), alphaOf(value));
}

/** Readable ink over a given ground — for the swatch's own label. */
export function contrastInk(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  // Rec. 601 luma is good enough to pick between two fixed inks.
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.6 ? "#201e1d" : "#f3f2f2";
}
