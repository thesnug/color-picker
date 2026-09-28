/**
 * Nearest match: the closest Wada colors to a hex code, a color name, or any
 * other color input, by OKLab distance. Pure math, no model. See
 * docs/DESIGN.md, "Pipelines".
 *
 * Names resolve in order: Wada canonical names and aliases, then CSS named
 * colors, then the xkcd color survey. The dictionaries and their licenses are
 * in `assets/names/`.
 */
import { type ColorInput, type Hex } from "./color/convert.js";
import { type DerivedColor } from "./data/index.js";
/** Default number of matches when neither `k` nor `within` is given. */
export declare const DEFAULT_NEAREST_K = 3;
export interface NearestOptions {
    /**
     * Maximum number of matches. Defaults to 3, or to no limit when `within` is
     * given.
     */
    k?: number;
    /** Only return matches at or below this distance (see `distance` for the scale). */
    within?: number;
    /** Colors to search. Defaults to the 157 derived Wada colors. */
    colors?: readonly DerivedColor[];
}
export interface NearestMatch {
    color: DerivedColor;
    /** OKLab distance scaled by 100; about 2 is a just-noticeable difference. */
    distance: number;
}
/** Where a query's color came from. */
export type ResolvedVia = "hex" | "color" | "wada" | "css" | "xkcd";
export interface ResolvedQuery {
    via: ResolvedVia;
    hex: Hex;
    /** The dictionary name the query matched, when resolved by name. */
    name?: string;
}
export interface NearestResult {
    /** How the query was read. Absent when the query could not be resolved. */
    resolved?: ResolvedQuery;
    /** Sorted by ascending distance, ties by Wada index. */
    matches: NearestMatch[];
    /** Why `matches` is empty. Absent when there are matches. */
    reason?: string;
}
/**
 * Find the Wada colors closest to a hex code, a color name, or any other
 * color input. Unknown names return no matches and a `reason`; they never throw.
 *
 * @throws {RangeError} when `k` is not a positive integer or `within` is negative.
 */
export declare function nearest(input: ColorInput, options?: NearestOptions): NearestResult;
/**
 * Read a query as a color. Hex strings are taken as hex; other strings are
 * looked up as names. Returns undefined for an unknown name.
 */
export declare function resolveQuery(input: ColorInput): ResolvedQuery | undefined;
/**
 * Resolve a color name, ignoring case, spacing, and punctuation, and treating
 * "grey" as "gray". Wada names win over CSS names, which win over xkcd names.
 * An ambiguous Wada name such as "Eugenia Red" resolves to the lowest index.
 */
export declare function resolveName(name: string): ResolvedQuery | undefined;
/** Lowercase, "grey" as "gray", and only letters and digits. */
export declare function nameKey(name: string): string;
//# sourceMappingURL=nearest.d.ts.map