/**
 * Pigment substitution: the one way a recolor plan is applied to pixels.
 * Only the planned pigments change; alpha, geometry, and every other pigment
 * stay exact. Pure: the caller decodes the file and encodes the result.
 *
 * Ported unchanged from POD's `applyCreativeRecolor`, which now decodes,
 * calls `substitutePigments`, and encodes the PNG.
 */
import type { RgbaPixels } from "../fingerprint/quantize.js";
/** One pigment swap: pixels within `tolerance` (per channel, 0 to 255) of `from` become `to`. */
export interface PigmentReplacement {
    from: string;
    to: string;
    tolerance: number;
}
/** Why `substitutePigments` refused a plan. */
export declare class RecolorPigmentError extends Error {
    /** `overlap`: a pixel falls within two replacements. `absent`: no pixel matched any. */
    readonly code: "overlap" | "absent";
    constructor(code: "overlap" | "absent", message: string);
}
export interface SubstitutedPixels {
    /** A new pixel buffer; the input is untouched. */
    pixels: RgbaPixels;
    /** Visible pixels that changed pigment. */
    changed: number;
    /**
     * Share of the visible pixels no replacement reached, weighted by alpha, 0
     * to 1 to four places. Near-transparent residue around a print counts for
     * almost nothing, as it prints.
     */
    unmatched: number;
}
/**
 * Substitute pigments: each visible pixel within a replacement's tolerance of
 * its `from` takes its `to`, keeping its offset from the pigment (so shading,
 * antialiasing, and distress survive), and its alpha. A pixel just outside
 * every tolerance that is a lighter or darker tint of exactly one pigment is
 * substituted too, so edges don't print as streaks of the old ink.
 *
 * @throws {RecolorPigmentError} `overlap` when a pixel falls within two
 *   replacements' tolerances, `absent` when no pixel changes.
 */
export declare function substitutePigments(pixels: RgbaPixels, plan: {
    readonly replacements: readonly PigmentReplacement[];
}): SubstitutedPixels;
//# sourceMappingURL=substitute.d.ts.map