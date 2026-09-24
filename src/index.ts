/**
 * `@thesnug/color-picker` core entry point.
 *
 * Color math, nearest match, combinations, recommendations, and recolor plans
 * live here. No AI, no framework, no I/O. See docs/DESIGN.md for the design.
 *
 * This is the package scaffold; later issues fill in the modules.
 */

export type { WadaColor, WadaDataset } from "./data/index.js";

/** A normalized six-digit lowercase hex color, for example `#ffb3f0`. */
export type Hex = `#${string}`;

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Normalize a hex color string to the six-digit lowercase form with a leading `#`.
 * Accepts three- or six-digit input with or without the `#`.
 *
 * @throws {TypeError} when the input is not a valid hex color.
 */
export function normalizeHex(input: string): Hex {
  const match = HEX_PATTERN.exec(input.trim());
  if (!match) {
    throw new TypeError(`Not a hex color: ${JSON.stringify(input)}`);
  }
  const digits = match[1]!.toLowerCase();
  const six =
    digits.length === 3
      ? digits
          .split("")
          .map((d) => d + d)
          .join("")
      : digits;
  return `#${six}`;
}
