/**
 * Recommend product colors for a design with recoloring: for each garment, a
 * Wada combination around the garment's equivalent, a from-to mapping of the
 * design's colors onto it, and a prompt describing the change. Deterministic;
 * the Jev plausibility check that vets each swap consumes this output. See
 * docs/DESIGN.md, "Pipelines", "Recommend shirts, with recoloring".
 *
 * Applying a mapping to pixels reads and writes files, so `applyRecolor` lives
 * in the fingerprint entry point.
 */
import { type AccessibilityOptions } from "./accessibility.js";
import { type GeneratedHarmony } from "./combinations.js";
import { type Hex } from "./color/convert.js";
import { type Product, type ProductColorWithHex } from "./data/index.js";
import type { DesignSummary } from "./recommend.js";
export interface RecolorOptions extends AccessibilityOptions {
    /** A product ID or a loaded product. Defaults to the index's default product. */
    product?: string | Product;
    /** How many garments to return. Default 5. */
    n?: number;
    /** Skip colors the print provider does not stock. Default true. */
    availableOnly?: boolean;
    /**
     * Equivalents after the first contribute combinations only within this
     * distance of the garment hex. The nearest always contributes. Default 6, as
     * for `palettesForProductColor`.
     */
    within?: number;
    /** Replaces `RECOLOR_WEIGHTS`. */
    weights?: RecolorWeights;
}
export declare const RECOLOR_PLAN_DEFAULTS: {
    readonly n: 5;
    readonly within: 6;
};
/**
 * How much each score component counts. `vanish` is subtracted; the others add.
 * Contrast and vanish match `RECOMMEND_WEIGHTS`; fidelity breaks ties between
 * plans that all clear the contrast target, favoring the one that changes the
 * design least.
 */
export interface RecolorWeights {
    contrast: number;
    vanish: number;
    fidelity: number;
}
export declare const RECOLOR_WEIGHTS: Readonly<RecolorWeights>;
/** A Wada color, as a mapping target or a combination member. */
export interface WadaRef {
    index: number;
    name: string;
    hex: Hex;
}
/** The garment equivalent a combination was found through. Rank 1 is the nearest. */
export interface RecolorEquivalent {
    index: number;
    name: string;
    distance: number;
    rank: number;
}
interface RecolorCombinationBase {
    /** Every member, the garment's equivalent included, in the source's order. */
    colors: WadaRef[];
    equivalent: RecolorEquivalent;
}
export type RecolorCombination = (RecolorCombinationBase & {
    source: "book";
    id: number;
}) | (RecolorCombinationBase & {
    source: "harmony";
    harmony: GeneratedHarmony;
});
/** One design color and the Wada color it becomes. */
export interface RecolorMapping {
    from: {
        hex: Hex;
        /** Fraction of the design's opaque coverage, as the fingerprint reported it. */
        share: number;
        /** What the color paints ("strawberry body"), when the design carries it. */
        element?: string;
    };
    to: WadaRef;
}
/** The score's parts, each 0 to 1. */
export interface RecolorComponents {
    /**
     * Coverage-weighted contrast of the new inks against the garment, as progress
     * from 1:1 to the body-text AA ratio (4.5:1) and capped there, as in
     * `recommendProductColors`.
     */
    contrast: number;
    /** Summed share of the design colors whose new ink is within the print minimum distance of the garment. */
    vanish: number;
    /**
     * How little the recolor changes the design: 1 minus the coverage-weighted
     * `distance()` from each design color to its new ink, over 100 (black to
     * white), floored at 0.
     */
    fidelity: number;
}
export interface RecolorPlan {
    color: ProductColorWithHex;
    combination: RecolorCombination;
    /** One entry per design color, in the design's palette order. */
    mapping: RecolorMapping[];
    /** A short imperative paragraph for a generative recolor, naming every swap. */
    prompt: string;
    /** Weighted sum of `components`, rounded to three places. */
    score: number;
    components: RecolorComponents;
    /**
     * True when the combination has fewer other members than the design has
     * colors, so neighbors in lightness share an ink.
     */
    merged: boolean;
    /** True when a new ink vanishes into the garment. Flagged plans rank last. */
    flagged: boolean;
    reasons: string[];
    warnings: string[];
}
/**
 * Map design colors onto inks by lightness rank, so hierarchy survives: the
 * darkest design color takes the darkest ink, and so on. With fewer inks than
 * design colors, the lightness-sorted design colors are split into as many
 * contiguous runs as there are inks, and each run shares one ink.
 */
export declare function mapByLightness<T extends {
    lightness: number;
}, U extends {
    oklab: {
        l: number;
    };
}>(design: readonly T[], inks: readonly U[]): Map<T, U>;
/** Sum of the weighted components, rounded as `score` is. */
export declare function scoreRecolor(components: RecolorComponents, weights?: RecolorWeights): number;
/**
 * The recolor prompt: a short imperative paragraph naming every swap, from a
 * template, not a model.
 */
export declare function recolorPrompt(garment: string, mapping: readonly RecolorMapping[]): string;
/**
 * For each garment, the best recolor plan: a Wada combination containing one
 * of the garment's equivalents, and the design's colors mapped onto its other
 * members by lightness.
 *
 * Within a garment, plans are preferred in this order, and the highest score
 * wins within the first tier that has any:
 *
 * 1. a book combination with at least as many other members as the design has
 *    colors;
 * 2. a harmony with enough members;
 * 3. a book combination with fewer, where neighbors in lightness share an ink;
 * 4. a harmony with fewer.
 *
 * In tiers 3 and 4, the combination with the most other members wins before
 * score, so as few design colors as possible share an ink.
 *
 * With more members than design colors, every subset of the right size is
 * tried. A plan where any new ink is within the print minimum distance of the
 * garment is flagged, and used only when the garment has no other plan.
 * Garments are ranked unflagged first, then by score.
 *
 * @throws {RangeError} when the design has no colors, or `n` is not a positive integer.
 * @throws {Error} when the product ID is unknown.
 */
export declare function recolorPlans(design: DesignSummary, options?: RecolorOptions): RecolorPlan[];
export {};
//# sourceMappingURL=recolor.d.ts.map