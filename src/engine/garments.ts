/**
 * Garment colors as the engine takes them: a name and a hex, from this
 * package's catalog or from the caller's own (a print provider's variants,
 * reviewed swatches). Pure lookups over the bundled catalog.
 */

import { normalizeHex, type Hex } from "../color/convert.js";
import { storedDefaultProduct, storedProduct } from "../data/store.js";
import { hasHex, type ProductColorSource } from "../data/types.js";
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
}

/** `Chalky Mint` → `chalky-mint`. */
export function garmentSlug(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The garment as the scoring core names it, with its hex normalized. */
export function garmentColor(garment: GarmentInput): GarmentColor & { hex: Hex; family?: string } {
  return {
    name: garment.colorName,
    slug: garment.slug ?? garmentSlug(garment.colorName),
    hex: normalizeHex(garment.hex),
    ...(garment.family !== undefined && { family: garment.family }),
  };
}

/**
 * Every garment color of a catalog product that has a hex, in product file
 * order. The catalog holds no stock, so this includes colors a print provider
 * may not fulfill today: rank only the garments a live stock check passed.
 *
 * @param productId Defaults to the index's default product, Comfort Colors 1717.
 * @throws {Error} when the product ID is unknown.
 */
export function garmentsFromProduct(productId?: string): CatalogGarment[] {
  const product = productId === undefined ? storedDefaultProduct() : storedProduct(productId);
  return product.colors
    .filter(hasHex)
    .map((c) => ({
      colorName: c.name,
      hex: c.hex,
      slug: c.slug,
      family: c.family,
      source: c.source,
    }));
}
