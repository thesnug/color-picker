/**
 * Terminal renderer: 24-bit truecolor blocks with names, for the CLI.
 */
import { type Swatch } from "./shared.js";
export interface AnsiOptions {
    /** Width of each block in characters. Default 6. */
    blockWidth?: number;
    /** Emit escape codes. When false, the block is left out and only text remains. Default true. */
    color?: boolean;
}
/**
 * Render colors as one line each: a truecolor block, the hex, the name, and any
 * note. Returns the text; the caller prints it. Pass `color: false` when the
 * output is not a terminal or `NO_COLOR` is set.
 */
export declare function renderAnsi(colors: readonly Swatch[], options?: AnsiOptions): string;
//# sourceMappingURL=ansi.d.ts.map