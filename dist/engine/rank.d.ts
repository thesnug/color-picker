/**
 * Garment ranking for a measured design. The `ink-legibility-v2` verdict is
 * the hard gate: garments the design passes on rank first. Within each group
 * the recommendation score ranks, with its vanish penalty counting only the
 * ink the verdict calls lost, so a pale fill inside a dark outline costs
 * nothing on a pale garment. See docs/DESIGN.md, "Print legibility".
 */
import type { Hex } from "../color/convert.js";
import { type GarmentUse } from "../batch.js";
import { type DesignColorOnGarment, type RecommendWeights, type ScoreComponents } from "../recommend.js";
import type { AccessibilityOptions } from "../accessibility.js";
import { type GarmentInput } from "./garments.js";
import { type LegibilityVerdict } from "./legibility.js";
import type { DesignAnalysis } from "./measure.js";
/** One garment for a design: its legibility verdict and its recommendation score. */
export interface RankedGarment {
    /** The garment as given, with its hex normalized and a slug. */
    garment: {
        colorName: string;
        hex: Hex;
        slug: string;
        family?: string;
    };
    /** Weighted sum of `components`, rounded to three places. */
    score: number;
    /** As `recommendProductColors` gives them, except `vanish`: the share of ink the verdict calls lost. */
    components: ScoreComponents;
    vanishBasis: "lost-ink";
    /**
     * Every design color against this garment. `vanishes` is the print minimum
     * distance alone; such a color is not lost when legible ink frames it.
     */
    designColors: DesignColorOnGarment[];
    /** The garment's nearest Wada color. */
    wada: {
        index: number;
        name: string;
    };
    /** The book combination behind `bookPairing`, when there is one. */
    sharedCombination?: number;
    legibility: LegibilityVerdict;
    /** The verdict's reason first, then why the garment scored as it did. */
    reasons: string[];
    /** One sentence per ink that is lost on this garment. */
    warnings: string[];
}
export interface RankGarmentsOptions extends AccessibilityOptions {
    /**
     * The catalog the garments come from, for stored Wada equivalents (used
     * only for a garment whose hex they were computed from) and the print
     * method. Defaults to the index's default product, Comfort Colors 1717.
     */
    product?: string;
    /** Replaces `RECOMMEND_WEIGHTS`. */
    weights?: RecommendWeights;
    /** How many garments to return. Default all. */
    n?: number;
}
/**
 * Rank garment colors for a measured design: garments the design passes the
 * legibility verdict on first, then by score, then in input order. The score
 * is the recommendation score with the vanish penalty taken from the verdict:
 * only ink the verdict calls lost counts.
 *
 * @throws {RangeError} when the design has no visible ink, or `n` is not a positive integer.
 * @throws {Error} when the product ID is unknown.
 */
export declare function rankGarments(analysis: DesignAnalysis, garments: readonly GarmentInput[], options?: RankGarmentsOptions): RankedGarment[];
/**
 * Where an artwork came from, which sets how far it departs from the approved
 * art: the approved `original`; a `legible-ink` option, which keeps every
 * ink's hue (any hue-keeping pigment substitution counts as one); or a `wada`
 * recolor, which repaints the inks onto a Wada combination.
 */
export type ArtworkSource = "original" | "legible-ink" | "wada";
/** An artwork and a garment color worth inspecting together. */
export interface ArtworkGarmentPair {
    artworkId: string;
    /** The artwork's source, as given. */
    source: ArtworkSource;
    colorName: string;
    /** The pair's recommendation score, before the variety penalty. */
    score: number;
    legibility: LegibilityVerdict;
    /** Why the pair is where it is: at most 2000 characters. */
    reason: string;
}
/** One artwork version to consider for each color. */
export interface PairArtwork {
    artworkId: string;
    analysis: DesignAnalysis;
    source: ArtworkSource;
}
export interface RankArtworkGarmentPairsInput {
    /** The artwork versions to consider for each color: the approved art and any Artwork Options. */
    artworks: readonly PairArtwork[];
    garments: readonly GarmentInput[];
    /** How many colors the assortment wants. Picks beyond it are fallbacks. */
    colorCount: number;
    /** A color to place first, when any artwork reads on it. */
    preferred?: string;
    /** Recent garment use, for the variety penalty. Only uses of `product` count. */
    recent?: readonly GarmentUse[];
    /** As for `rankGarments`; also the product recent uses must name. */
    product?: string;
    weights?: RecommendWeights;
}
/**
 * Order artwork and garment pairs for inspection. Only pairs that pass the
 * legibility verdict appear.
 *
 * Each color leads with the artwork that departs least from the approved art
 * and reads on it: the original, else a hue-keeping (`legible-ink`) option,
 * else a Wada repaint; score, then least ink lost, then input order break
 * ties within a source. So a Wada repaint leads only on colors no
 * hue-keeping artwork reads on, however well it scores elsewhere.
 *
 * Colors follow in the same order of departure: first every color the
 * original reads on, then the colors only a hue-keeping option reads on,
 * then the colors only a Wada repaint reads on. An Artwork Option fills what
 * the approved art cannot, so it never pushes the original out of the first
 * picks, however well it scores. Within each band colors are chosen greedily
 * by their lead's score less the batch variety penalty against recent use
 * and the colors already chosen, so near shades fall later; `preferred` leads
 * when any artwork reads on it. Then the other legible artworks for each
 * color, in the same color order.
 *
 * @throws {RangeError} when `colorCount` is not a positive integer.
 */
export declare function rankArtworkGarmentPairs(input: RankArtworkGarmentPairsInput): ArtworkGarmentPair[];
//# sourceMappingURL=rank.d.ts.map