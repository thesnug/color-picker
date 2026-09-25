/**
 * Words to color: resolve a free-text description ("dusty rose", "the brick
 * shirt", "something autumnal for a coffee brand") to a Wada color or a product
 * color. See docs/DESIGN.md, "Jev (TypeSafe System One)".
 *
 * The deterministic name lookup runs first. Only a description it cannot read
 * goes to Jev, as one Choice question whose options are every color in the
 * chosen set plus `none`.
 */
import { type Hex } from "../color/convert.js";
import { type DerivedColor, type Product, type ProductColor } from "../data/index.js";
import { type ResolvedQuery } from "../nearest.js";
import { type AskOptions } from "./index.js";
/** Bump when the question's wording, option descriptions, or meaning changes, to invalidate cached answers. */
export declare const DESCRIBE_COLOR_VERSION = 1;
/** Number of candidates returned. */
export declare const DESCRIBE_COLOR_TOP = 3;
/**
 * `acceptedColor` takes Jev's top match as the answer when its probability is
 * at least this and `none` is not Jev's top option. Below it, the matches are
 * suggestions to show, not an answer to act on. The lowest threshold with
 * precision at least 0.9 on the labeled phrases, from
 * docs/evaluations/2026-09-24.md (INT-2273).
 */
export declare const DESCRIBE_COLOR_ACCEPT = 0.35;
/** The option Jev picks when no color in the set fits. */
export declare const NONE_LABEL = "none";
/**
 * OKLCH lightness cutoffs for the lightness word in each option's description.
 * They split the 157 Wada colors roughly into thirds.
 */
export declare const LIGHTNESS_WORD: {
    /** Below this, "dark". */
    readonly darkBelow: 0.55;
    /** At or above this, "light". Between the two, "mid". */
    readonly lightFrom: 0.72;
};
export type LightnessWord = "light" | "mid" | "dark";
export type DescribeSet = "wada" | "product";
export interface DescribeToColorOptions extends Partial<Pick<AskOptions, "cache" | "model" | "client" | "signal">> {
    /** Which colors to choose from. Defaults to `"wada"`. */
    set?: DescribeSet;
    /** The product for `set: "product"`, by ID or as loaded. Defaults to the index's default product. */
    product?: string | Product;
}
/** A color from the chosen set: a Wada color, or a product color. */
export type DescribedColor = DerivedColor | ProductColor;
/** How a description was read by the name lookup: as a hex code, a dictionary name, or a product color name. */
export type DescribeResolved = ResolvedQuery | {
    via: "product";
    hex: Hex;
    name: string;
};
/** Resolved by the deterministic name lookup; Jev was not asked. */
export interface DescribeByName<C extends DescribedColor = DescribedColor> {
    via: "name";
    text: string;
    set: DescribeSet;
    /** The product ID for `set: "product"`. */
    product?: string;
    /** How the text was read as a color. */
    resolved: DescribeResolved;
    /** Closest colors in the set, by ascending OKLab distance (scaled by 100). */
    matches: {
        color: C;
        distance: number;
    }[];
}
/** Resolved by Jev. */
export interface DescribeByJev<C extends DescribedColor = DescribedColor> {
    via: "jev";
    text: string;
    set: DescribeSet;
    product?: string;
    /** The most probable colors, highest first, excluding `none`. */
    matches: {
        color: C;
        probability: number;
    }[];
    /** Jev's reported confidence in its top option, which may be `none`. */
    confidence: number;
    /** Probability that no color in the set fits. */
    none: number;
    /** True when `none` was Jev's top option. */
    noneTop: boolean;
    model: string;
    cached: boolean;
}
export type DescribeResult<C extends DescribedColor = DescribedColor> = DescribeByName<C> | DescribeByJev<C>;
/**
 * Resolve a free-text color description to colors in the Wada set or a
 * product's colors.
 *
 * A description that the name lookup reads (a Wada, product, CSS, or xkcd
 * name, or a hex code) never reaches Jev. Anything else is one cached Choice
 * request. Callers decide how to use the spread: the probabilities, the
 * confidence, and the probability of `none` are returned as they came.
 *
 * @throws {JevUnavailableError} when Jev is needed, the answer is not cached,
 *   and the SDK or `TYPESAFE_API_KEY` is missing.
 * @throws {TypeError} when `text` is blank.
 */
export declare function describeToColor(text: string, options?: DescribeToColorOptions): Promise<DescribeResult>;
/**
 * The color a description resolved to, when it is safe to act on: the nearest
 * match for a name lookup, or Jev's top match when it clears `threshold` and
 * `none` is not Jev's top option. Undefined otherwise, so the caller shows
 * `matches` as suggestions or asks again.
 */
export declare function acceptedColor<C extends DescribedColor>(result: DescribeResult<C>, threshold?: number): C | undefined;
/** The lightness word for a color, from its OKLCH lightness. */
export declare function lightnessWord(hex: string): LightnessWord;
/**
 * The Choice question for a set: one option per color, labeled by name and
 * described by hex, family, and lightness word, plus `none`. Exported so the
 * question can be inspected and audited.
 */
export declare function describeQuestion(set: DescribeSet, product?: string | Product): {
    readonly color: {
        readonly type: "choice";
        readonly instructions: string;
        readonly criteria: Record<string, string | OptionDescription>;
    };
};
type OptionDescription = Record<string, string | boolean>;
export {};
//# sourceMappingURL=describe.d.ts.map