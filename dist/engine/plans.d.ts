/**
 * Recolor planning for print files: which pigments to substitute so a design
 * reads on more garment colors. Two methods, both expressed as pigment
 * substitutions that `substitutePigments` applies:
 *
 * - Legible ink: each ink under 3:1 on a garment family's median color keeps
 *   its hue and moves darker (for light garments) or lighter (for dark ones)
 *   until it reads. Ported from POD's `ink-legibility-v2`; since engine 1.1.0
 *   each tolerance reaches halfway to the nearest other ink, not just the
 *   ink's spread, so distressed pixels change with their ink.
 * - Wada: the design's colors mapped onto a book combination or harmony
 *   around a garment's Wada equivalent, keeping their lightness order
 *   (`recolorPlans`).
 *
 * `planArtworkOptions` screens both on the measured pixels and keeps the few
 * that add the most legible garment colors.
 */
import type { RgbaPixels } from "../fingerprint/quantize.js";
import { type RecolorPlan } from "../recolor.js";
import type { GarmentColor } from "../recommend.js";
import { type GarmentInput } from "./garments.js";
import { type Garment, type GarmentFamily, type LegibilityVerdict } from "./legibility.js";
import { type DesignAnalysis, type InkMeasurement } from "./measure.js";
import { type PigmentReplacement } from "./substitute.js";
/**
 * A recolor as pigment substitutions, the shape POD stores as a
 * `CreativeRecolorPlan`: a key of `[a-z0-9-]`, 1 to 60 characters; a label
 * of 1 to 100; a rationale of 1 to 2000; and 1 to 6 replacements of
 * `#rrggbb` pigments with an integer tolerance from 0 to 35.
 */
export interface SubstitutionPlan {
    key: string;
    label: string;
    rationale: string;
    replacements: PigmentReplacement[];
}
/**
 * Check a plan against the `SubstitutionPlan` limits and return it.
 *
 * @throws {TypeError} naming the first limit the plan breaks.
 */
export declare function validateSubstitutionPlan<T extends SubstitutionPlan>(plan: T): T;
/**
 * Recolor plans that make the artwork's ink readable on each needed garment family. Each ink
 * under 3:1 on the family's median-luminance garment keeps its OKLCH hue and moves toward dark
 * (for light garments) or light (for dark garments) until it reaches 4.5:1, losing chroma only
 * to stay in sRGB. Inks that already read stay as they are. A plan is dropped when two inks
 * that were distinct would end up closer than 10, since the artwork would lose a color.
 */
export declare function planLegibleInkOptions(input: {
    measurement: InkMeasurement;
    garments: readonly Garment[];
    families: readonly GarmentFamily[];
}): SubstitutionPlan[];
/**
 * Bind a planner's recolor plan to the measured inks: each `from` moves to the measured ink
 * within 5 of it, so the recolor finds its pigment, and its tolerance stays clear of every
 * other ink. A replacement matching no measured ink is dropped, and so is an empty plan.
 */
export declare function snapSubstitutionPlan(plan: SubstitutionPlan, measurement: InkMeasurement): SubstitutionPlan | null;
/**
 * Pigment substitutions for a from-to color mapping (a `RecolorPlan`'s
 * `mapping`) on a measured design: each `from` binds to the measured ink
 * within 5 of it, with a tolerance reaching just under halfway to the nearest
 * other measured ink (at most 35), so it never reaches another ink's pixels.
 * Mappings that keep their ink are left out unless `keepIdentity` is set.
 * Null when a `from` matches no measured ink, or two map one ink apart.
 */
export declare function substitutionReplacements(mapping: ReadonlyArray<{
    from: {
        hex: string;
    };
    to: {
        hex: string;
    };
}>, measurement: InkMeasurement, options?: {
    keepIdentity?: boolean;
}): PigmentReplacement[] | null;
/**
 * A Wada recolor plan as pigment substitutions on a measured design, so it
 * can be applied exactly with `substitutePigments`. Null when the plan merges
 * design colors into one ink (the artwork would lose a color), when one of its
 * colors matches no measured ink within 5, or when it changes nothing.
 */
export declare function toSubstitutionPlan(plan: RecolorPlan<GarmentColor>, measurement: InkMeasurement): SubstitutionPlan | null;
/**
 * How a recolored design reads on a garment: the mapping's pigments
 * substituted in the measured pixels (`substitutionReplacements`, merges
 * allowed), measured again, and judged. The verdict's `bytesChecksum` is the
 * original's with `:recolor` appended, since no file holds these pixels.
 * Null when the mapping cannot be substituted exactly.
 */
export declare function judgeRecolor(input: {
    measurement: InkMeasurement;
    /** The pixels `measurement` was measured from. */
    pixels: RgbaPixels;
    mapping: ReadonlyArray<{
        from: {
            hex: string;
        };
        to: {
            hex: string;
        };
    }>;
    garment: Garment;
}): LegibilityVerdict | null;
/** A candidate Artwork Option and the garment colors it makes legible. */
export interface ArtworkOption {
    plan: SubstitutionPlan;
    source: "legible-ink" | "wada";
    /** Garment colors the recolored design passes on that the original does not, in input order. */
    addsColors: string[];
}
export interface PlanArtworkOptionsInput {
    analysis: DesignAnalysis;
    /** The pixels `analysis` was measured from, as `legibilitySampling` sampled them. */
    pixels: RgbaPixels;
    garments: readonly GarmentInput[];
    /** The garment families that need another ink (`legibleInkNeeds`). */
    needs: readonly GarmentFamily[];
    /** The garment colors the original already passes on. */
    legibleColors: ReadonlySet<string>;
    /** At most this many Wada options. Default 3. */
    maxPalettePlans?: number;
    /** Wada mappings screened, best first. Default 12. */
    maxCandidates?: number;
    /** The catalog the garments come from, as for `rankGarments`. */
    product?: string;
}
export declare const ARTWORK_OPTION_DEFAULTS: {
    readonly maxPalettePlans: 3;
    readonly maxCandidates: 12;
};
/**
 * Plan Artwork Options for the garment families that need another ink. The
 * candidates are the legible-ink plan for each needed family, then the
 * distinct Wada mappings of the best unflagged recolor plans for the
 * garments the design does not read on. Each is applied to the measured
 * pixels with `substitutePigments`, measured, and judged on every garment;
 * one that adds no legible garment color is dropped. Every legible-ink option
 * that adds a color is kept, since it changes only the faint inks' lightness.
 * Wada options, which repaint the design, follow as a greedy cover of what is
 * still missing: each next one adds the most garment colors not yet covered
 * (the better recolor plan on ties), at most `maxPalettePlans` of them.
 * Deterministic: the same input gives the same plans and keys.
 */
export declare function planArtworkOptions(input: PlanArtworkOptionsInput): ArtworkOption[];
//# sourceMappingURL=plans.d.ts.map