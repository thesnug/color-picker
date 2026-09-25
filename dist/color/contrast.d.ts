/**
 * Contrast formulas: WCAG 2.x relative luminance and contrast ratio, and APCA
 * lightness contrast (Lc).
 */
import { type ColorInput } from "./convert.js";
/**
 * WCAG 2.x relative luminance, 0 (black) to 1 (white).
 * https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
 *
 * Uses the sRGB threshold 0.04045 rather than WCAG's historical 0.03928; the
 * two differ by less than 0.0001 for any 8-bit value.
 */
export declare function relativeLuminance(input: ColorInput): number;
/**
 * WCAG 2.x contrast ratio, 1 to 21. Symmetric in its arguments.
 * AA needs 4.5 for body text and 3 for large text; AAA needs 7 and 4.5.
 * https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
 */
export declare function contrastRatio(a: ColorInput, b: ColorInput): number;
/**
 * APCA-W3 constants, algorithm 0.0.98G-4g, as shipped in the `apca-w3` 0.1.9
 * reference library by Andrew Somers (https://github.com/Myndex/apca-w3).
 */
export declare const APCA: {
    readonly mainTRC: 2.4;
    readonly sRco: 0.2126729;
    readonly sGco: 0.7151522;
    readonly sBco: 0.072175;
    readonly normBG: 0.56;
    readonly normTXT: 0.57;
    readonly revTXT: 0.62;
    readonly revBG: 0.65;
    readonly blkThrs: 0.022;
    readonly blkClmp: 1.414;
    readonly scaleBoW: 1.14;
    readonly scaleWoB: 1.14;
    readonly loBoWoffset: 0.027;
    readonly loWoBoffset: 0.027;
    readonly deltaYmin: 0.0005;
    readonly loClip: 0.1;
};
/** APCA screen luminance (Y) of an sRGB color: a simple 2.4 power curve, not the sRGB piecewise one. */
export declare function apcaLuminance(input: ColorInput): number;
/**
 * APCA lightness contrast (Lc) of text on a background, about -108 to 106.
 * Positive for dark text on a light background, negative for light text on a
 * dark background. Order matters: the first argument is the text.
 *
 * Rough guide: |Lc| 90 for body text, 75 minimum for body text, 60 for other
 * content text, 45 for large headlines, 30 for non-text elements.
 */
export declare function apcaContrast(text: ColorInput, background: ColorInput): number;
//# sourceMappingURL=contrast.d.ts.map