/**
 * The CLI commands. Each builds a `View`: the same result as JSON, terminal
 * text, and SVG sections, so every command supports every output flag.
 */
import { type ProductColorWithHex } from "../data/index.js";
import { type ArtworkSource, type ContentBounds, type DesignColor, type GarmentInput, type GarmentUse, type RankedGarment } from "../engine/index.js";
import { type AnalyzedDesignFile, type DesignDescription, type VisionProvider } from "../fingerprint/index.js";
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
    /** Only these product colors, by name, slug, or alias. Default every stocked color. */
    colors?: readonly string[];
    /** The print's visible content, for the measurement. */
    contentBounds?: ContentBounds | null;
}
/** A recommendation: the engine's ranked garment, with its catalog color for cards and batches. */
export type RecommendPick = RankedGarment & {
    color: ProductColorWithHex;
};
/** The engine version and legibility protocol every engine-backed result carries. */
export declare const ENGINE_INFO: {
    readonly version: "1.1.0";
    readonly protocol: "ink-legibility-v2";
};
/**
 * Garment colors ranked by the engine (`rankGarments`): those the design
 * passes the ink legibility verdict on first, then by score. With `mood`,
 * Jev re-ranks the leading legible picks; illegible ones stay after them.
 */
export declare function recommendView({ file, bytes, n, product: productId, mood, colors, contentBounds, }: RecommendArgs): Promise<View>;
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
    /** The print's visible content, for the legibility measurement. */
    contentBounds?: ContentBounds | null;
}
/**
 * Recolor plans per garment (`recolorPlans` on the engine's measured summary,
 * the inks `artwork_options` and POD plan from), each with its pigment
 * substitution on the measured inks (`toSubstitutionPlan`; null for a plan
 * that merges inks) and how the recolored design reads on its garment
 * (`judgeRecolor`). With `vet`, the vision description of the fingerprint
 * names the measured inks it matches (`measuredRecolorDesign`).
 */
export declare function recolorView({ file, bytes, n, product: productId, apply, vet, includeImplausible, contentBounds, }: RecolorArgs): Promise<View>;
export interface LegibilityArgs extends DesignArgs {
    product?: string;
    /** Product colors by name, slug, or alias. Default every stocked color. */
    colors?: readonly string[];
    /** Garment colors given directly, judged after `colors`. */
    garments?: readonly GarmentInput[];
    contentBounds?: ContentBounds | null;
}
/** The `ink-legibility-v2` verdict of a print file on each garment color (`judgeLegibility`). */
export declare function legibilityView({ file, bytes, product: productId, colors, garments: given, contentBounds, }: LegibilityArgs): Promise<View>;
export interface ArtworkOptionsArgs extends DesignArgs {
    product?: string;
    /** Product colors by name, slug, or alias. Default every stocked color. */
    colors?: readonly string[];
    /** How many garment colors the assortment wants, for `legibleInkNeeds`. Default 8. */
    colorCount?: number;
    /** At most this many Wada options. Default 3. */
    maxPalettePlans?: number;
    contentBounds?: ContentBounds | null;
    /** Directory to write each option's recolored PNG to, at full size. */
    apply?: string;
}
export declare const DEFAULT_COLOR_COUNT = 8;
/**
 * Artwork Options for the garment families the design does not read on
 * (`planArtworkOptions`): pigment substitutions, each screened on the
 * measured pixels, with the garment colors it adds.
 */
export declare function artworkOptionsView({ file, bytes, product: productId, colors, colorCount, maxPalettePlans, contentBounds, apply, }: ArtworkOptionsArgs): Promise<View>;
/** One artwork `pairsView` ranks: a print file and where it came from. */
export interface PairArtworkArgs {
    /** The ID the pairs name this artwork by. */
    artworkId: string;
    file: string;
    bytes?: Uint8Array;
    source: ArtworkSource;
    contentBounds?: ContentBounds | null;
}
export interface PairsArgs {
    /** The approved original and any Artwork Options, each as its own print file. */
    artworks: readonly PairArtworkArgs[];
    product?: string;
    /** Product colors by name, slug, or alias. Default every stocked color. */
    colors?: readonly string[];
    /** How many garment colors the assortment wants. Default 8. */
    colorCount?: number;
    /** A product color, by name, slug, or alias, to place first when any artwork reads on it. */
    preferred?: string;
    /** Recent garment use, for the variety penalty. */
    recent?: readonly GarmentUse[];
}
/**
 * The order POD's Creative color study inspects artwork and garment pairs in
 * (`rankArtworkGarmentPairs`): only pairs the verdict passes; each color led
 * by the artwork that departs least from the approved art; colors a
 * hue-keeping artwork leads before colors only a Wada repaint reads on; and
 * within each, chosen greedily by score less the variety penalty.
 */
export declare function pairsView({ artworks, product: productId, colors, colorCount, preferred, recent, }: PairsArgs): Promise<View>;
/** The measured design as a result carries it. */
declare function designJson(design: AnalyzedDesignFile): {
    hash: string;
    palette: readonly DesignColor[];
    inkLuminance: number;
    approximate: boolean;
};
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
/** The measured design a recolor plans from: `designJson`, with the vision description once described. */
export type RecolorDesign = ReturnType<typeof designJson> & {
    palette: readonly DesignColor[];
    description?: DesignDescription;
};
/**
 * Bind a fingerprint's vision description to the engine's measured inks:
 * each described element moves to the measured ink nearest its fingerprint
 * color when that ink is within the print minimum distance (10), and each
 * measured ink is labeled with the elements it paints. An element whose color
 * no measured ink is near keeps its fingerprint hex and labels nothing.
 */
export declare function measuredRecolorDesign(measured: RecolorDesign, description: DesignDescription): RecolorDesign;
export {};
//# sourceMappingURL=commands.d.ts.map