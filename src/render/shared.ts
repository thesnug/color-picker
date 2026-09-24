/**
 * Helpers shared by the SVG, HTML, and terminal renderers.
 */

import { contrastRatio } from "../color/contrast.js";
import { type Hex, normalizeHex } from "../color/convert.js";

/**
 * Anything with a hex can be rendered. `DerivedColor` and `ProductColor` both
 * fit, as does a plain `{ hex }`.
 */
export interface Swatch {
  hex: string;
  /** Shown on the tile. Omitted names show the hex alone. */
  name?: string;
  /** Wada index. When every member of a combination has one, tiles sort by it. */
  index?: number;
  /** An extra line under the hex, for example a nearest-match distance. */
  note?: string;
}

/** Escape text for use in XML or HTML content and attribute values. */
export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const BLACK: Hex = "#000000";
const WHITE: Hex = "#ffffff";

/** Black or white, whichever has the higher WCAG contrast ratio on `background`. */
export function readableTextColor(background: string): Hex {
  return contrastRatio(BLACK, background) >= contrastRatio(WHITE, background) ? BLACK : WHITE;
}

/** Normalize a swatch hex, so every renderer emits lowercase `#rrggbb`. */
export function swatchHex(swatch: Swatch): Hex {
  return normalizeHex(swatch.hex);
}

/**
 * Break `text` into at most `maxLines` lines of at most `maxChars` characters,
 * on word boundaries where possible. Overflow ends in an ellipsis.
 */
export function wrapText(text: string, maxChars: number, maxLines = 2): string[] {
  const limit = Math.max(1, maxChars);
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);

  const fitted = lines.map((line) => (line.length > limit ? `${line.slice(0, limit - 1)}…` : line));
  if (fitted.length <= maxLines) return fitted;
  const kept = fitted.slice(0, maxLines);
  const last = kept[maxLines - 1]!;
  kept[maxLines - 1] = last.length >= limit ? `${last.slice(0, limit - 1)}…` : `${last}…`;
  return kept;
}

/** Format a number with at most `digits` decimals and no trailing zeros. */
export function fmt(value: number, digits = 2): string {
  return String(Number(value.toFixed(digits)));
}
