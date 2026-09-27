/**
 * Mood re-rank: deterministic scoring gets a shortlist right on contrast; Jev
 * decides which of the shortlist suits the design's subject and mood. See
 * docs/DESIGN.md, "Jev (TypeSafe System One)".
 *
 * One request per shortlist: the state is the design's vision description and
 * palette, with one Score question per candidate (fan-out). Jev's scores are
 * combined with the shortlist order in code, so changing the weight never
 * calls Jev again.
 */
import type { DesignDescription } from "../fingerprint/describe.js";
import type { ProductPalette } from "../palettes.js";
import type { ProductColorRecommendation } from "../recommend.js";
import { type AskOptions, type EntryType } from "./index.js";
/** Bump when the question's wording, levels, or state layout changes, to invalidate cached answers. */
export declare const MOOD_VERSION = 1;
/** How many of the deterministic candidates go to Jev by default. */
export declare const MOOD_TOP = 10;
/**
 * How much the mood score counts in `combinedScore`, from 0 (shortlist order
 * only) to 1 (mood only). Unchanged by the first threshold evaluation
 * (docs/evaluations/2026-09-24.md, INT-2273): the measured direction favors a
 * higher weight, but on draft garment picks that Jill has not yet reviewed.
 */
export declare const MOOD_WEIGHT = 0.4;
/** The Score levels, lowest first. `moodLevel` is the one nearest Jev's expected score. */
export declare const MOOD_LEVELS: readonly ["clashes", "neutral", "complements", "elevates"];
export type MoodLevel = (typeof MOOD_LEVELS)[number];
/**
 * Each level as Jev reads it. Every level is judged on its own, so each
 * describes a situation rather than a degree.
 */
declare const LEVEL_DESCRIPTIONS: readonly ["Clashes: the colors work against what the design depicts or the feeling it gives, so the pairing looks wrong, jarring, or off-message.", "Neutral: the colors neither help nor hurt; they are a plain backdrop with no particular connection to the design's subject or mood.", "Complements: the colors suit the design's subject and mood, and the design looks at home with them.", "Elevates: the colors strengthen the design's subject and mood, so it looks more striking and more itself than it would with plainer colors."];
/** The parts of a fingerprint the re-rank reads. A described `Fingerprint` fits. */
export interface MoodDesign {
    palette: readonly {
        hex: string;
        share: number;
        element?: string;
    }[];
    /** From `describeDesign`. Without it Jev is not asked. */
    description?: Pick<DesignDescription, "subject" | "mood" | "elements">;
}
/** A garment recommendation or a palette for one garment. */
export type MoodCandidate = ProductColorRecommendation | ProductPalette;
export interface MoodFields {
    /** Jev's expected level over the top level, 0 to 1, rounded to three places. Null when Jev was not asked. */
    moodScore: number | null;
    /** Jev's confidence in its score. Null when Jev was not asked. */
    confidence: number | null;
    /** The level nearest Jev's expected score. Null when Jev was not asked. */
    moodLevel: MoodLevel | null;
    /**
     * The candidate's place in the deterministic shortlist as 0 to 1: 1 for the
     * first, 0 for the last. Null outside the shortlist.
     */
    deterministicScore: number | null;
    /** The shortlist score and mood score combined by the weight. Null outside the shortlist. */
    combinedScore: number | null;
}
export type MoodRanked<C> = C & MoodFields;
export interface MoodRerank<C> {
    /** The shortlist by `combinedScore`, then the rest in their original order. */
    candidates: MoodRanked<C>[];
    /** True when Jev's scores were applied. */
    applied: boolean;
    /** The weight `combinedScore` used. */
    weight: number;
    /** Why Jev's scores were not applied. Absent when they were. */
    note?: string;
    /** The model that answered, when Jev was asked. */
    model?: string;
    /** True when the answers came from the cache. */
    cached?: boolean;
}
export interface RerankByMoodOptions extends Partial<Pick<AskOptions, "cache" | "model" | "client" | "signal">> {
    /** How many of the leading candidates go to Jev. Default `MOOD_TOP`. */
    top?: number;
    /** Replaces `MOOD_WEIGHT`. */
    weight?: number;
}
/**
 * Re-rank the leading candidates (garment recommendations or palettes, in
 * their deterministic order) by how well each suits the design's subject and
 * mood, with one Score question per candidate in a single cached request.
 *
 * Never fails for want of Jev: without a vision description, or when Jev is
 * unavailable and the answer is not cached, it returns the deterministic
 * order with `moodScore: null` and a `note` saying why.
 *
 * @throws {RangeError} for a `top` that is not a positive integer or a `weight` outside 0 to 1.
 * @throws the SDK's `APIError` or `APIConnectionError` when the request fails after its retries.
 */
export declare function rerankByMood<C extends MoodCandidate>(candidates: readonly C[], design: MoodDesign, options?: RerankByMoodOptions): Promise<MoodRerank<C>>;
/**
 * Recombine re-ranked candidates with another weight and sort them again,
 * without calling Jev. Candidates outside the shortlist stay last, in order.
 *
 * @throws {RangeError} for a `weight` outside 0 to 1.
 */
export declare function combineMood<C>(candidates: readonly MoodRanked<C>[], weight?: number): MoodRanked<C>[];
/**
 * The question name for a candidate: its garment slug, plus the combination
 * or harmony for a palette. Names do not depend on order, so the same
 * shortlist in another order hits the same cached answers.
 */
export declare function moodCandidateId(candidate: MoodCandidate): string;
/** The state Jev reads: the design's description and palette. Exported so it can be inspected and audited. */
export declare function moodState(design: MoodDesign): {
    design: {
        subject: string;
        mood: string;
        elements: {
            name: string;
            color: string;
        }[];
    };
    palette: {
        paints?: string;
        hex: string;
        coverage: string;
        family: "neutral" | "earth" | "red-pink" | "orange-yellow" | "green" | "blue" | "purple" | "neon";
        lightness: import("./describe.js").LightnessWord;
    }[];
};
/** One Score question per candidate, named by `moodCandidateId`. Exported so the questions can be inspected. */
export declare function moodQuestions(candidates: readonly MoodCandidate[]): Record<string, {
    type: "score";
    instructions: EntryType;
    criteria: typeof LEVEL_DESCRIPTIONS;
}>;
export {};
//# sourceMappingURL=mood.d.ts.map