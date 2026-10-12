/**
 * Recolor plausibility: ask Jev whether each swap in a recolor plan keeps the
 * design reading as the same subject, so a plan never turns a strawberry blue.
 * See docs/DESIGN.md, "Jev (TypeSafe System One)".
 *
 * The state is the design's vision description: its subject, mood, and named
 * elements with their colors in words. Each changed mapping entry is one Noul
 * question in the plan's request. A swap without a named element is asked
 * about the design as a whole.
 */
import type { DesignDescription } from "../fingerprint/describe.js";
import { type RecolorMapping, type RecolorOptions, type RecolorPlan } from "../recolor.js";
import type { DesignSummary } from "../recommend.js";
import { type AskOptions, type JevUnavailableReason, type Questions } from "./index.js";
/** Bump when the question's wording, state, or meaning changes, to invalidate cached answers. */
export declare const VET_RECOLOR_VERSION = 1;
/**
 * A plan whose least plausible swap scores below this is implausible. Jev's
 * Noul answers for swaps run high (0.49 to 0.93 on the labeled set), so the
 * cutoff sits high too: the most accurate on the labeled swaps, from
 * docs/evaluations/2026-09-24.md (INT-2273). A wrongly dropped plan costs a
 * garment slot; a wrongly kept one ships a blue pumpkin.
 */
export declare const PLAUSIBILITY_THRESHOLD = 0.8;
/**
 * Below this `distance()` a swap is not a change (the prompt says "keep"), so
 * it is not asked about and counts as fully plausible. Matches `recolorPrompt`.
 */
export declare const UNCHANGED_DISTANCE = 2;
export interface VetOptions extends Partial<Pick<AskOptions, "cache" | "model" | "client" | "signal">> {
    /** Replaces `PLAUSIBILITY_THRESHOLD`. */
    threshold?: number;
}
/** A mapping entry with Jev's judgment of its swap. */
export type VettedMapping = RecolorMapping & {
    /**
     * Probability that the design still reads as the same subject after this
     * swap. 1 for a swap that is not a change; `null` when it was not vetted.
     */
    plausibility: number | null;
};
export type VettedPlan = Omit<RecolorPlan, "mapping"> & {
    mapping: VettedMapping[];
    /** The lowest plausibility across the mapping, or `null` when the plan was not vetted. */
    plausibility: number | null;
    /** True when `plausibility` is below the threshold. The offending swaps are named in `reasons`. */
    implausible: boolean;
};
/** Why plans went unvetted: Jev cannot be called, or the design has no vision description. */
export type VetSkipReason = JevUnavailableReason | "no-description";
export interface VetResult {
    plans: VettedPlan[];
    /** Plans Jev judged; the rest carry `plausibility: null`. */
    vetted: number;
    /** Set when any plan went unvetted, saying why. */
    skipped?: {
        reason: VetSkipReason;
        note: string;
    };
    /** The model that answered, when any plan was vetted. */
    model?: string;
}
/** The part of a fingerprint vetting reads. */
export interface VetDesign {
    description?: Pick<DesignDescription, "subject" | "mood" | "elements">;
}
/**
 * Judge each swap of each plan with Jev and mark implausible plans. Plans keep
 * their order; nothing is dropped here (see `vettedRecolorPlans`).
 *
 * One request per plan, sent concurrently, each cached through `ask`: the key
 * covers the description (itself keyed on the design file's hash) and every
 * swap, so a mapping seen before for the same design costs nothing.
 *
 * Without Jev (no SDK or `TYPESAFE_API_KEY` on a cache miss) or without a
 * vision description, plans pass with `plausibility: null` and `skipped` says why.
 *
 * @throws the SDK's API errors when a request fails after its retries.
 */
export declare function vetRecolorPlans(plans: readonly RecolorPlan[], design: VetDesign, options?: VetOptions): Promise<VetResult>;
export interface VettedRecolorOptions extends RecolorOptions, VetOptions {
    /** Keep implausible plans, marked, instead of dropping them. Default false. */
    includeImplausible?: boolean;
}
export interface VettedRecolorResult extends VetResult {
    /** Implausible plans left out, best first. Empty when `includeImplausible` is set. */
    dropped: VettedPlan[];
}
/**
 * `recolorPlans` with vetting: the best `n` garments whose plans are plausible.
 * Garments are vetted in rank order, `n` at a time, and an implausible plan's
 * place goes to the next garment, so dropping does not shorten the list while
 * plausible plans remain. With `includeImplausible`, the top `n` are returned
 * as ranked, each marked.
 *
 * @throws as `recolorPlans` and `vetRecolorPlans` do.
 */
export declare function vettedRecolorPlans(design: DesignSummary & VetDesign, options?: VettedRecolorOptions): Promise<VettedRecolorResult>;
/**
 * The request state: what the design depicts, and each named element with its
 * color in words. Hexes are left out; Jev judges from words.
 */
export declare function vetState(description: NonNullable<VetDesign["description"]>): {
    subject: string;
    mood: string;
    elements: {
        name: string;
        color: string;
    }[];
};
/** Whether a mapping entry changes its color enough to ask about. */
export declare function isChange(entry: Pick<RecolorMapping, "from" | "to">): boolean;
/**
 * One Noul question per changed mapping entry, named `swap_<index>` for the
 * entry's position in the mapping. Exported so the questions can be audited.
 */
export declare function vetQuestions(mapping: readonly RecolorMapping[], description: Pick<DesignDescription, "elements">): Questions;
/** The question for one swap, in the wording the issue fixes. */
export declare function swapQuestion(entry: Pick<RecolorMapping, "from" | "to">, description: Pick<DesignDescription, "elements">): string;
//# sourceMappingURL=vet.d.ts.map