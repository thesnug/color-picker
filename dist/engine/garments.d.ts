/**
 * Garment colors as the engine takes them: a name and a hex, from this
 * package's catalog or from the caller's own (a print provider's variants,
 * reviewed swatches). Pure lookups over the bundled catalog.
 */
import { type Hex } from "../color/convert.js";
import { type ProductColorSource } from "../data/types.js";
import type { GarmentColor } from "../recommend.js";
/** A garment color to judge and rank: its display name and hex, plus catalog facts when known. */
export interface GarmentInput {
    colorName: string;
    /** `#rrggbb` (or `#rgb`), any case. */
    hex: string;
    /** Catalog slug. Defaults to the name in lowercase, words joined by hyphens. */
    slug?: string;
    /** Catalog family, for variety between picks. */
    family?: string;
}
/** A garment color from this package's catalog. */
export interface CatalogGarment extends GarmentInput {
    slug: string;
    family: string;
    /** Where the catalog's hex came from: `reviewed` hexes were checked against the garment. */
    source: ProductColorSource;
    /** False for colors the print provider does not stock. */
    available: boolean;
}
/** `Chalky Mint` → `chalky-mint`. */
export declare function garmentSlug(name: string): string;
/** The garment as the scoring core names it, with its hex normalized. */
export declare function garmentColor(garment: GarmentInput): GarmentColor & {
    hex: Hex;
    family?: string;
};
/**
 * A catalog product's garment colors with a hex, in product file order: the
 * stocked ones by default, every one with `availableOnly: false`.
 *
 * @param productId Defaults to the index's default product, Comfort Colors 1717.
 * @throws {Error} when the product ID is unknown.
 */
export declare function garmentsFromProduct(productId?: string, options?: {
    availableOnly?: boolean;
}): CatalogGarment[];
//# sourceMappingURL=garments.d.ts.map