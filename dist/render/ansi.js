/**
 * Terminal renderer: 24-bit truecolor blocks with names, for the CLI.
 */
import { hexToRgb } from "../color/convert.js";
import { NOT_STOCKED, swatchHex } from "./shared.js";
const RESET = "\u001b[0m";
/**
 * Render colors as one line each: a truecolor block, the hex, the name, and any
 * note. Returns the text; the caller prints it. Pass `color: false` when the
 * output is not a terminal or `NO_COLOR` is set.
 */
export function renderAnsi(colors, options = {}) {
    const blockWidth = options.blockWidth ?? 6;
    const color = options.color ?? true;
    return colors
        .map((swatch) => {
        const hex = swatchHex(swatch);
        const status = swatch.available === false ? `(${NOT_STOCKED})` : undefined;
        const text = [hex, swatch.name, swatch.note, status].filter(Boolean).join("  ");
        if (!color)
            return text;
        const [r, g, b] = hexToRgb(hex);
        return `\u001b[48;2;${r};${g};${b}m${" ".repeat(blockWidth)}${RESET}  ${text}`;
    })
        .join("\n")
        .concat(colors.length ? "\n" : "");
}
//# sourceMappingURL=ansi.js.map