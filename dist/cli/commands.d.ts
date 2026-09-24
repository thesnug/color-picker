/**
 * The CLI commands. Each builds a `View`: the same result as JSON, terminal
 * text, and SVG sections, so every command supports every output flag.
 */
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
}
/** Palettes for a garment color: the garment first, then the ink colors printed on it. */
export declare function palettesView({ name, limit, size, product: productId }: PalettesArgs): View;
/** Default `-n` for `recommend`. */
export declare const DEFAULT_RECOMMEND_N = 5;
export interface RecommendArgs {
    /** The design file's path, or its label when `bytes` are given. */
    file: string;
    /** The design file's contents, read instead of `file` when given. */
    bytes?: Uint8Array;
    n: number;
    product?: string;
}
export declare function recommendView({ file, bytes, n, product: productId }: RecommendArgs): Promise<View>;
/** Default `-n` for `recolor`. */
export declare const DEFAULT_RECOLOR_N = 5;
export interface RecolorArgs {
    /** The design file's path, or its label when `bytes` are given. */
    file: string;
    /** The design file's contents, read instead of `file` when given. */
    bytes?: Uint8Array;
    n: number;
    product?: string;
    /** Directory to write each recolored PNG to. */
    apply?: string;
}
export declare function recolorView({ file, bytes, n, product: productId, apply }: RecolorArgs): Promise<View>;
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
//# sourceMappingURL=commands.d.ts.map