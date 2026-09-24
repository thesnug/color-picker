/**
 * Combinations for a color: the book's combinations for the nearest Wada
 * matches, then generated harmonies snapped to Wada colors when the book gives
 * too few. Pure math, no model. See docs/DESIGN.md, "Pipelines".
 */
import { type ColorInput } from "./color/convert.js";
import { type Combination, type DerivedColor } from "./data/index.js";
import { type NearestMatch, type ResolvedQuery } from "./nearest.js";
/** Defaults for `combinations`. */
export declare const COMBINATION_DEFAULTS: {
    /** Generate harmonies when the book gives fewer palettes than this. */
    readonly min: 6;
    /** Maximum palettes returned. */
    readonly limit: 12;
    /** Second and third matches within this distance contribute their combinations. */
    readonly secondaryWithin: 6;
    /** A harmony is skipped when any generated color snaps farther than this. */
    readonly snapWithin: 8;
    /**
     * OKLab chroma at or below which the input counts as gray and the
     * neutral-anchor rule is considered. The same cutoff as the neutral color
     * family. Among Comfort Colors 1717 it catches Black, White, Grey, Granite,
     * Graphite, and Pepper; Navy (0.0195) is the first color above it.
     */
    readonly neutralChroma: 0.015;
    /**
     * The nearest Wada neutral replaces the plain nearest match only when it is
     * no farther than this multiple of the plain distance.
     */
    readonly neutralMargin: 1.5;
};
export type GeneratedHarmony = "complementary" | "split-complementary" | "triadic" | "analogous";
export interface CombinationsOptions {
    /**
     * Only palettes with this many colors. Defaults to every size from 2 up;
     * the book's ten single-color combinations appear only when 1 is asked for.
     */
    size?: number | readonly number[];
    /**
     * When false, drop palettes with a neutral member other than the matched
     * color itself. Default true.
     */
    includeNeutrals?: boolean;
    /** Maximum palettes returned. Default 12. */
    limit?: number;
    /** Generate harmonies when the book gives fewer palettes than this. Default 6. */
    min?: number;
    /** Distance within which the second and third matches contribute. Default 6. */
    secondaryWithin?: number;
    /** Skip a harmony when any of its colors snaps farther than this. Default 8. */
    snapWithin?: number;
    /**
     * OKLab chroma at or below which the input counts as gray and may anchor on
     * the nearest neutral Wada color. Default 0.015.
     */
    neutralChroma?: number;
    /**
     * A gray input anchors on the nearest neutral Wada color only when it is no
     * farther than this multiple of the plain nearest distance. Default 1.5.
     */
    neutralMargin?: number;
    /**
     * Build palettes around this Wada color, given by index or slug, instead of
     * resolving an anchor from the input. For callers that already know the
     * color, such as a garment's stored equivalent. The input still resolves,
     * for `resolved`, the anchor distance, and the second and third matches.
     */
    anchor?: number | string;
}
export interface CombinationAnchor {
    /** The Wada color palettes are built around. */
    color: DerivedColor;
    /** Distance from the input to the anchor. */
    distance: number;
    /**
     * `nearest` for the plain nearest match; `nearest-neutral` when the input is
     * gray and the nearest neutral Wada color is close enough to win; `anchor`
     * when the caller passed the anchor.
     */
    via: "nearest" | "nearest-neutral" | "anchor";
    /** The plain nearest matches by pure distance, reported alongside. */
    nearest: NearestMatch[];
    /**
     * When the input was gray and the neutral-anchor rule was considered, the
     * candidate that lost: the nearest neutral when `via` is `nearest`, the
     * plain nearest when `via` is `nearest-neutral`. Absent when the rule was
     * not considered or both candidates are the same color.
     */
    rejected?: {
        name: string;
        index: number;
        distance: number;
    };
}
interface PaletteBase {
    /** Palette members. Every one is a Wada color. */
    colors: DerivedColor[];
    /**
     * Ranking score from 0 to 1, weighting contrast three to one over hue
     * spread. Exposed so callers can re-rank.
     */
    score: number;
    /** Mean WCAG contrast ratio of the other members against the matched color. */
    contrast: number;
    /** Smallest hue arc containing every chromatic member, in degrees. */
    hueSpread: number;
}
export interface BookPalette extends PaletteBase {
    source: "book";
    combination: Combination;
    /** The nearest match this combination was found through. Rank 1 is the anchor. */
    match: NearestMatch & {
        rank: number;
    };
}
export interface HarmonySnap {
    /** The generated color before snapping. */
    target: string;
    color: DerivedColor;
    distance: number;
}
export interface HarmonyPalette extends PaletteBase {
    source: "harmony";
    harmony: GeneratedHarmony;
    /** Each generated color and the Wada color it snapped to, in palette order. */
    snaps: HarmonySnap[];
}
export type Palette = BookPalette | HarmonyPalette;
export interface CombinationsResult {
    /** How the input was read. Absent when it could not be resolved. */
    resolved?: ResolvedQuery;
    anchor?: CombinationAnchor;
    /**
     * Book palettes first, ordered by match rank then score; then harmonies by
     * score.
     */
    palettes: Palette[];
    /** Why `palettes` is empty. Absent when there are palettes. */
    reason?: string;
}
/**
 * Ranked palettes for a hex code, a color name, or any other color input.
 * Unknown names return no palettes and a `reason`; they never throw.
 *
 * @throws {RangeError} for a non-integer or out-of-range `size`, `limit`, or
 * `min`, or an `anchor` that names no Wada color.
 */
export declare function combinations(input: ColorInput, options?: CombinationsOptions): CombinationsResult;
export {};
//# sourceMappingURL=combinations.d.ts.map