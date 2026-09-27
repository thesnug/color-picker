/**
 * Recommend product colors for a design, with the design unchanged. Scoring is
 * deterministic and every component is exposed, so a caller (or the Jev
 * re-rank) can reweigh picks without re-running the analysis. See
 * docs/DESIGN.md, "Pipelines", "Recommend shirts, unchanged".
 */
import { type AccessibilityOptions } from "./accessibility.js";
import { type Hex } from "./color/convert.js";
import { type Product, type ProductColorWithHex } from "./data/index.js";
/** One color of a design. `PaletteEntry` from the fingerprint entry point fits. */
export interface DesignColor {
    hex: string;
    /** Fraction of the design's opaque coverage, 0 to 1. */
    share: number;
    /**
     * What the color paints ("strawberry body"), from a vision description of the
     * design (`describeDesign` in the fingerprint entry point); recolor prompts
     * name it when present.
     */
    element?: string;
}
/**
 * The parts of a design fingerprint recommendations read. A `Fingerprint` from
 * `@thesnug/color-picker/fingerprint` fits.
 */
export interface DesignSummary {
    /** Top colors by coverage, largest first. */
    palette: readonly DesignColor[];
    /** Alpha-weighted mean WCAG relative luminance of the visible pixels, 0 to 1. */
    inkLuminance: number;
}
/**
 * How much each score component counts. `vanish` is subtracted; the others add.
 * Every component is 0 to 1, so the score is at most the sum of the positive
 * weights.
 */
export interface RecommendWeights {
    contrast: number;
    vanish: number;
    inkFit: number;
    bookPairing: number;
}
/**
 * Default weights. Contrast leads; a vanishing color costs about as much as the
 * contrast it would otherwise have earned; ink fit breaks ties between garments
 * with similar contrast; a shared book combination is a small nudge.
 */
export declare const RECOMMEND_WEIGHTS: Readonly<RecommendWeights>;
export interface RecommendOptions extends AccessibilityOptions {
    /** A product ID or a loaded product. Defaults to the index's default product. */
    product?: string | Product;
    /** How many picks to return. Default 5. */
    n?: number;
    /** Skip colors the print provider does not stock. Default true. */
    availableOnly?: boolean;
    /** Replaces `RECOMMEND_WEIGHTS`. */
    weights?: RecommendWeights;
}
/** The score's parts, each 0 to 1. */
export interface ScoreComponents {
    /**
     * Coverage-weighted contrast: each design color's WCAG contrast against the
     * garment, as progress from 1:1 to the body-text AA ratio (4.5:1) and capped
     * there, weighted by the color's share.
     */
    contrast: number;
    /** Summed share of the design colors within the print minimum distance of the garment. */
    vanish: number;
    /**
     * 1 when the ink suits the garment by the dark-ink cutoff: dark ink on a
     * garment above it, light ink on one at or below it. 0 otherwise.
     */
    inkFit: number;
    /**
     * 1 when the garment's nearest Wada color shares a book combination with the
     * nearest Wada color of the design's dominant color. 0 otherwise.
     */
    bookPairing: number;
}
/** A design color measured against one garment. */
export interface DesignColorOnGarment {
    hex: Hex;
    share: number;
    /** The nearest Wada color, used to name the design color in sentences. */
    wada: {
        index: number;
        name: string;
    };
    /** WCAG contrast ratio against the garment, rounded to two places. */
    ratio: number;
    /** `distance()` from the garment, rounded to one place. */
    distance: number;
    /** True when closer to the garment than the print minimum distance. */
    vanishes: boolean;
}
export interface ProductColorRecommendation {
    color: ProductColorWithHex;
    /** Weighted sum of `components`, rounded to three places. */
    score: number;
    components: ScoreComponents;
    /** Every design color against this garment, in palette order. */
    designColors: DesignColorOnGarment[];
    /** The garment's nearest Wada color. */
    wada: {
        index: number;
        name: string;
    };
    /** The book combination behind `bookPairing`, when there is one. */
    sharedCombination?: number;
    /** Plain sentences saying why the garment scored as it did. */
    reasons: string[];
    /** One sentence per design color that would vanish on this garment. */
    warnings: string[];
}
/** Ranked picks: highest score first, ties in product file order. */
export type Recommendations = ProductColorRecommendation[];
/** Sum of the weighted components, rounded as `score` is. */
export declare function scoreComponents(components: ScoreComponents, weights?: RecommendWeights): number;
/**
 * Rank a product's colors for a design printed as is.
 *
 * Each garment gets four components, exposed on the result: coverage-weighted
 * contrast, a vanish penalty for design colors within the print minimum
 * distance of the garment, ink fit by the dark-ink luminance cutoff, and a book
 * pairing bonus. `score` combines them with `weights`; `scoreComponents`
 * recombines them with other weights without re-running the analysis.
 *
 * @throws {RangeError} when the design has no colors, or `n` is not a positive integer.
 * @throws {Error} when the product ID is unknown.
 */
export declare function recommendProductColors(design: DesignSummary, options?: RecommendOptions): Recommendations;
//# sourceMappingURL=recommend.d.ts.map