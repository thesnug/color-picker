/**
 * Contrast formulas: WCAG 2.x relative luminance and contrast ratio, and APCA
 * lightness contrast (Lc).
 */

import { type ColorInput, rgbToLinear, toRgb } from "./convert.js";

// ---------------------------------------------------------------------------
// WCAG 2.x

/**
 * WCAG 2.x relative luminance, 0 (black) to 1 (white).
 * https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
 *
 * Uses the sRGB threshold 0.04045 rather than WCAG's historical 0.03928; the
 * two differ by less than 0.0001 for any 8-bit value.
 */
export function relativeLuminance(input: ColorInput): number {
  const [r, g, b] = rgbToLinear(toRgb(input));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 2.x contrast ratio, 1 to 21. Symmetric in its arguments.
 * AA needs 4.5 for body text and 3 for large text; AAA needs 7 and 4.5.
 * https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
 */
export function contrastRatio(a: ColorInput, b: ColorInput): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ---------------------------------------------------------------------------
// APCA

/**
 * APCA-W3 constants, algorithm 0.0.98G-4g, as shipped in the `apca-w3` 0.1.9
 * reference library by Andrew Somers (https://github.com/Myndex/apca-w3).
 */
export const APCA = {
  mainTRC: 2.4,
  sRco: 0.2126729,
  sGco: 0.7151522,
  sBco: 0.072175,
  normBG: 0.56,
  normTXT: 0.57,
  revTXT: 0.62,
  revBG: 0.65,
  blkThrs: 0.022,
  blkClmp: 1.414,
  scaleBoW: 1.14,
  scaleWoB: 1.14,
  loBoWoffset: 0.027,
  loWoBoffset: 0.027,
  deltaYmin: 0.0005,
  loClip: 0.1,
} as const;

/** APCA screen luminance (Y) of an sRGB color: a simple 2.4 power curve, not the sRGB piecewise one. */
export function apcaLuminance(input: ColorInput): number {
  const [r, g, b] = toRgb(input);
  const exp = (v: number) => (v / 255) ** APCA.mainTRC;
  return APCA.sRco * exp(r) + APCA.sGco * exp(g) + APCA.sBco * exp(b);
}

/**
 * APCA lightness contrast (Lc) of text on a background, about -108 to 106.
 * Positive for dark text on a light background, negative for light text on a
 * dark background. Order matters: the first argument is the text.
 *
 * Rough guide: |Lc| 90 for body text, 75 minimum for body text, 60 for other
 * content text, 45 for large headlines, 30 for non-text elements.
 */
export function apcaContrast(text: ColorInput, background: ColorInput): number {
  const clamp = (y: number) => (y > APCA.blkThrs ? y : y + (APCA.blkThrs - y) ** APCA.blkClmp);
  const txtY = clamp(apcaLuminance(text));
  const bgY = clamp(apcaLuminance(background));

  if (Math.abs(bgY - txtY) < APCA.deltaYmin) return 0;

  if (bgY > txtY) {
    // Normal polarity: dark text on a light background.
    const sapc = (bgY ** APCA.normBG - txtY ** APCA.normTXT) * APCA.scaleBoW;
    return sapc < APCA.loClip ? 0 : (sapc - APCA.loBoWoffset) * 100;
  }
  // Reverse polarity: light text on a dark background.
  const sapc = (bgY ** APCA.revBG - txtY ** APCA.revTXT) * APCA.scaleWoB;
  return sapc > -APCA.loClip ? 0 : (sapc + APCA.loWoBoffset) * 100;
}
