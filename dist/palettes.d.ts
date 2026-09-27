/**
 * Palettes for a product color by name: "give me palettes for Blue Spruce".
 * Reads the garment's committed Wada equivalents, never a live nearest match,
 * and builds each palette around the real garment hex, since ink goes on the
 * shirt and not on its Wada stand-in. See docs/DESIGN.md, "Pipelines".
 */
import { type GeneratedHarmony, type HarmonySnap } from "./combinations.js";
import { type Combination, type DerivedColor, type EquivalentMatch, type Product, type ProductColor } from "./data/index.js";
export interface ProductPalettesOptions {
    /** A product ID or a loaded product. Defaults to the index's default product. */
    product?: string | Product;
    /** Maximum palettes returned. Default 12. */
    limit?: number;
    /**
     * Only palettes with this many colors, counting the garment. Defaults to
     * every size from 2 up, as for `combinations`.
     */
    size?: number | readonly number[];
    /**
     * Equivalents after the first contribute only within this distance of the
     * garment hex. The nearest always contributes. Default 6, the same reach
     * `combinations` gives its second and third matches.
     */
    within?: number;
}
/** The garment, standing in for its Wada equivalent at the head of a palette. */
export interface GarmentAnchor {
    anchor: true;
    name: string;
    slug: string;
    /** The product hex, lowercase `#rrggbb`. */
    hex: string;
    available: boolean;
    /** Public garment image, when the product has one. */
    image?: {
        url: string;
        sha256: string;
    };
}
/** A Wada color printed on the garment. */
export type InkColor = DerivedColor & {
    anchor: false;
};
/** One of the garment's stored equivalents, with its rank among them. */
export type PaletteEquivalent = EquivalentMatch & {
    rank: number;
};
interface ProductPaletteBase {
    /** The garment first, then the Wada colors printed on it. */
    colors: [GarmentAnchor, ...InkColor[]];
    /** The equivalent the palette was found through; the garment replaces it. */
    equivalent: PaletteEquivalent;
    /** Mean WCAG contrast ratio of the ink colors against the garment hex. */
    contrast: number;
    /** Lowest WCAG contrast ratio of any ink color against the garment hex. */
    minContrast: number;
}
export interface ProductBookPalette extends ProductPaletteBase {
    source: "book";
    combination: Combination;
}
export interface ProductHarmonyPalette extends ProductPaletteBase {
    source: "harmony";
    harmony: GeneratedHarmony;
    /** Each generated color and the Wada color it snapped to, as `combinations` returns them. */
    snaps: HarmonySnap[];
}
export type ProductPalette = ProductBookPalette | ProductHarmonyPalette;
export interface ProductPalettesResult {
    product: {
        id: string;
        name: string;
    };
    /** The resolved product color. Absent when the name matched none. */
    color?: ProductColor;
    /** False when the print provider does not stock the color, so callers can warn. */
    available?: boolean;
    /** The equivalents that contributed palettes, nearest first. */
    equivalents: PaletteEquivalent[];
    /**
     * Book palettes first, then harmonies; each group by mean contrast against
     * the garment hex, highest first.
     */
    palettes: ProductPalette[];
    /** Why `palettes` is empty. Absent when there are palettes. */
    reason?: string;
}
/**
 * Ranked palettes for a product color named by its name, slug, or an alias,
 * ignoring case. Each palette leads with the garment, marked as the anchor,
 * then the Wada colors to print on it. Unknown names return no palettes and a
 * `reason`; they never throw.
 *
 * @throws {Error} when the product ID is unknown.
 * @throws {RangeError} for a non-integer or out-of-range `size` or `limit`.
 */
export declare function palettesForProductColor(colorNameOrSlug: string, options?: ProductPalettesOptions): ProductPalettesResult;
/**
 * The product color whose name, slug, or alias matches, ignoring case and
 * treating spaces, hyphens, and underscores alike.
 */
export declare function findProductColor(product: Product, nameOrSlug: string): ProductColor | undefined;
export {};
//# sourceMappingURL=palettes.d.ts.map