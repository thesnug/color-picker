/**
 * Helpers shared by the SVG, HTML, and terminal renderers.
 */
import { type Hex } from "../color/convert.js";
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
    /** False marks a product color the print provider does not stock. */
    available?: boolean;
}
/** The label every renderer shows on a color with `available: false`. */
export declare const NOT_STOCKED = "not stocked";
/** Escape text for use in XML or HTML content and attribute values. */
export declare function escapeXml(value: string): string;
/** Black or white, whichever has the higher WCAG contrast ratio on `background`. */
export declare function readableTextColor(background: string): Hex;
/** Normalize a swatch hex, so every renderer emits lowercase `#rrggbb`. */
export declare function swatchHex(swatch: Swatch): Hex;
/**
 * Break `text` into at most `maxLines` lines of at most `maxChars` characters,
 * on word boundaries where possible. Overflow ends in an ellipsis.
 */
export declare function wrapText(text: string, maxChars: number, maxLines?: number): string[];
/** Format a number with at most `digits` decimals and no trailing zeros. */
export declare function fmt(value: number, digits?: number): string;
//# sourceMappingURL=shared.d.ts.map