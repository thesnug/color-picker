/**
 * The CLI commands. Each builds a `View`: the same result as JSON, terminal
 * text, and SVG sections, so every command supports every output flag.
 */
import { type VisionProvider } from "../fingerprint/index.js";
import { type SystemOneClient } from "../jev/index.js";
import { type HtmlSection } from "../render/index.js";
import { type ThemeMode } from "../theme.js";
/** A command's output in every format the CLI can write. */
export interface View {
    /** Page and SVG title. */
    title: string;
    /** Machine-readable result for `--json`. */
    json: unknown;
    /** Terminal output. `color` is false when escape codes should be left out. */
    text: (color: boolean) => string;
    /** Sections for `--html`; those with SVG also go in `--svg`. */
    sections: HtmlSection[];
}
/** Input the user can fix: an unknown name, a malformed hex, an unknown ID. */
export declare class InputError extends Error {
}
export interface NearestArgs {
    query: string;
    k: number;
}
export declare function nearestView({ query, k }: NearestArgs): View;
export interface CombosArgs {
    query: string;
    size?: number;
    limit: number;
}
export declare function combosView({ query, size, limit }: CombosArgs): View;
export declare function showView(ids: readonly number[]): View;
export interface PalettesArgs {
    /** A product color name, slug, or alias. */
    name: string;
    limit: number;
    size?: number;
    product?: string;
    /** The design to judge palettes against, for `mood`. */
    design?: DesignArgs;
    /** Re-rank the palettes by how well each suits the design's mood, with Jev. Needs `design`. */
    mood?: boolean | MoodSetup;
}
/** Palettes for a garment color: the garment first, then the ink colors printed on it. */
export declare function palettesView({ name, limit, size, product: productId, design: designArgs, mood, }: PalettesArgs): Promise<View>;
/** Default `-n` for `recommend`. */
export declare const DEFAULT_RECOMMEND_N = 5;
export interface RecommendArgs extends DesignArgs {
    n: number;
    product?: string;
    /** Re-rank the picks by how well each garment suits the design's mood, with Jev. */
    mood?: boolean | MoodSetup;
}
export declare function recommendView({ file, bytes, n, product: productId, mood }: RecommendArgs): Promise<View>;
/** Default `-n` for `recolor`. */
export declare const DEFAULT_RECOLOR_N = 5;
export interface RecolorArgs extends DesignArgs {
    n: number;
    product?: string;
    /** Directory to write each recolored PNG to. */
    apply?: string;
    /** Describe the design and check each swap's plausibility with Jev. */
    vet?: boolean | VetSetup;
    /** With `vet`, keep implausible plans, marked, instead of dropping them. */
    includeImplausible?: boolean;
}
export declare function recolorView({ file, bytes, n, product: productId, apply, vet, includeImplausible, }: RecolorArgs): Promise<View>;
export type ThemeFormat = "css" | "tailwind" | "tokens";
export interface ThemeArgs {
    /** A hex code, a color name, or a book combination ID. */
    query: string;
    mode: ThemeMode;
    format?: ThemeFormat;
}
/** How many ranked palettes `theme` tries for a color before giving up. */
export declare const THEME_PALETTE_SEARCH = 24;
/**
 * A web theme from a book combination by ID, or from the highest-ranked
 * palette for a color that yields a legible theme in the mode.
 */
export declare function themeView({ query, mode, format }: ThemeArgs): View;
/** A design file for a command that reads one. */
export interface DesignArgs {
    /** The design file's path, or its label when `bytes` are given. */
    file: string;
    /** The design file's contents, read instead of `file` when given. */
    bytes?: Uint8Array;
}
/** Replaces the vision providers, Jev client, or Jev answer cache for a mood re-rank, as tests do. */
export interface MoodSetup {
    providers?: readonly VisionProvider[];
    client?: SystemOneClient;
    /** Jev answer cache directory, or `false` to skip it. Defaults to the `ask` default. */
    cache?: string | false;
}
/** How a view reports a requested mood re-rank. */
export interface MoodStatus {
    requested: true;
    applied: boolean;
    /** The weight the combined score used. */
    weight: number;
    /** Why the order is the deterministic one. Absent when Jev's scores were applied. */
    reason?: string;
    model?: string;
    cached?: boolean;
}
/** Replaces the vision providers, Jev client, Jev answer cache, or threshold for swap vetting, as tests do. */
export interface VetSetup extends MoodSetup {
    threshold?: number;
}
/** What swap vetting did, in the `vet` field of `recolor`'s JSON. */
export interface VetStatus {
    requested: true;
    /** True when at least one plan was judged by Jev. */
    applied: boolean;
    /** Plans judged. */
    vetted: number;
    /** Implausible plans left out, as garment and the reasons naming the swap. */
    dropped: {
        garment: string;
        plausibility: number;
        reasons: string[];
    }[];
    /** Why some or all plans went unvetted. */
    reason?: string;
    model?: string;
}
//# sourceMappingURL=commands.d.ts.map