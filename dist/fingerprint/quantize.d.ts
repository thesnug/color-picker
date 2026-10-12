/**
 * Palette extraction and ink luminance from decoded RGBA pixels. Pure: no I/O,
 * no decoder. `fingerprint` in ./index.ts decodes the file and calls these.
 *
 * Quantization is median cut in OKLab, refined by a few rounds of k-means, then
 * cleaned up in two passes so antialiasing does not create palette entries:
 * clusters closer than `mergeDistance` are merged, and small clusters lying
 * between two larger ones (the blended edge where two flat colors meet) are
 * folded into those two.
 */
import { type Hex, type Oklab } from "../color/convert.js";
/** Decoded pixels: 8-bit RGBA, straight (not premultiplied) alpha, row-major. */
export interface RgbaPixels {
    data: Uint8Array;
    width: number;
    height: number;
}
export interface PaletteEntry {
    hex: Hex;
    oklab: Oklab;
    /** Fraction of the design's opaque coverage this color accounts for, 0 to 1. */
    share: number;
}
export interface PaletteOptions {
    /** Pixels at or below this alpha (0 to 1) are ignored. Default 0.5. */
    alphaThreshold?: number;
    /** How many colors to return. Default 5. */
    colors?: number;
    /**
     * Clusters closer than this OKLab distance (scaled by 100, as `distance`) are
     * one color. Also the tolerance for treating a small cluster as a blend of two
     * larger ones. Default 5: wide enough to absorb JPEG noise at quality 70,
     * narrow enough to keep white (#ffffff) and cream (#f3e9d2), about 5.5 apart,
     * as separate inks.
     */
    mergeDistance?: number;
}
export declare const PALETTE_DEFAULTS: {
    readonly alphaThreshold: 0.5;
    readonly colors: 5;
    readonly mergeDistance: 5;
};
/**
 * The design's top colors by coverage. Shares are fractions of all opaque
 * coverage, so for a photograph the five shares sum to less than one.
 * Returns an empty palette when no pixel clears `alphaThreshold`.
 */
export declare function extractPalette(pixels: RgbaPixels, options?: PaletteOptions): PaletteEntry[];
/**
 * Pixels at or below this alpha do not count toward ink luminance. Matches
 * `measureInk` in maker-method-picker (app/prototype/color-study/model.ts) so
 * both tools agree on light versus dark ink.
 */
export declare const INK_ALPHA_THRESHOLD = 0.04;
/** What `inkLuminance` reports for an image with no visible pixels, as the picker does. */
export declare const INK_LUMINANCE_EMPTY = 0.5;
/**
 * Alpha-weighted mean WCAG relative luminance of the visible pixels, 0 to 1.
 *
 * This is the picker's definition: each pixel's luminance, weighted by its
 * alpha, averaged over pixels above `INK_ALPHA_THRESHOLD`. It is computed from
 * every pixel rather than from the five-color palette, because averaging over
 * the palette drops whatever the palette leaves out and would disagree with
 * the picker on photographic art.
 */
export declare function inkLuminance(pixels: RgbaPixels): number;
/** True when any pixel is less than fully opaque. */
export declare function hasTransparency(pixels: RgbaPixels): boolean;
//# sourceMappingURL=quantize.d.ts.map