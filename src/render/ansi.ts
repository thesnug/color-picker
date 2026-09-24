/**
 * Terminal renderer: 24-bit truecolor blocks with names, for the CLI.
 */

import { hexToRgb } from "../color/convert.js";
import { type Swatch, swatchHex } from "./shared.js";

export interface AnsiOptions {
  /** Width of each block in characters. Default 6. */
  blockWidth?: number;
  /** Emit escape codes. When false, the block is left out and only text remains. Default true. */
  color?: boolean;
}

const RESET = "\u001b[0m";

/**
 * Render colors as one line each: a truecolor block, the hex, the name, and any
 * note. Returns the text; the caller prints it. Pass `color: false` when the
 * output is not a terminal or `NO_COLOR` is set.
 */
export function renderAnsi(colors: readonly Swatch[], options: AnsiOptions = {}): string {
  const blockWidth = options.blockWidth ?? 6;
  const color = options.color ?? true;
  return colors
    .map((swatch) => {
      const hex = swatchHex(swatch);
      const text = [hex, swatch.name, swatch.note].filter(Boolean).join("  ");
      if (!color) return text;
      const [r, g, b] = hexToRgb(hex);
      return `\u001b[48;2;${r};${g};${b}m${" ".repeat(blockWidth)}${RESET}  ${text}`;
    })
    .join("\n")
    .concat(colors.length ? "\n" : "");
}
