/**
 * Deterministic recoloring of flat-color art from a recolor mapping by snapping
 * every pixel to its nearest mapped color. Pure: no I/O, no decoder.
 *
 * Since 0.6.0 `applyRecolor` in ./index.ts no longer calls this: it applies a
 * mapping by pigment substitution (`substitutePigments` in the engine entry
 * point), which keeps antialiasing and leaves unmapped inks exact. This stays
 * for callers that want a snapped, mapped-colors-only result. See
 * docs/DESIGN.md, "Pipelines", "Recommend shirts, with recoloring".
 */
import type { RgbaPixels } from "./quantize.js";
/** One swap, as `RecolorMapping` from the core entry point carries it. */
export interface RecolorSwap {
    from: {
        hex: string;
    };
    to: {
        hex: string;
    };
}
export interface RecolorPixelOptions {
    /**
     * A visible pixel farther than this from every `from` color counts as
     * unmatched. OKLab distance scaled by 100, as `distance()`. Default 10, the
     * print minimum distance: closer than that, two colors read as one ink.
     */
    tolerance?: number;
}
/** Flatness limits for `applyRecolor`. Since 0.6.0 it ignores `tolerance`. */
export interface ApplyRecolorOptions extends RecolorPixelOptions {
    /**
     * Largest share of visible pixels, weighted by alpha, that may match no
     * mapped pigment before the art counts as not flat and nothing is written.
     * Default 0.05, which absorbs antialiased edges between two inks.
     */
    maxUnmatched?: number;
    /**
     * Smallest share of the design's measured ink the mapped colors must cover
     * for the art to count as flat. Default 0.9: flat art is covered almost
     * entirely by its few colors, a photograph is not.
     */
    minCoverage?: number;
}
export declare const RECOLOR_DEFAULTS: {
    readonly tolerance: 10;
    readonly maxUnmatched: 0.05;
    readonly minCoverage: 0.9;
};
export interface RecoloredPixels {
    pixels: RgbaPixels;
    /** Alpha-weighted share of visible pixels farther than `tolerance` from every `from` color. */
    unmatched: number;
}
/**
 * Replace every visible pixel with the `to` color of its nearest `from` color
 * in OKLab, keeping its alpha. Fully transparent pixels stay fully transparent
 * and become black, so the output holds only the mapped colors plus
 * transparency. Pixels beyond `tolerance` are still replaced, and counted in
 * `unmatched` so the caller can decide the art was not flat.
 *
 * @throws {RangeError} when the mapping is empty.
 */
export declare function recolorPixels(pixels: RgbaPixels, mapping: readonly RecolorSwap[], options?: RecolorPixelOptions): RecoloredPixels;
//# sourceMappingURL=recolor.d.ts.map