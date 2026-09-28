/**
 * Stored Wada equivalents for product colors. The matches are computed once by
 * `scripts/build-equivalents.ts` and committed; this module only reads them, so
 * a shirt-name query never runs a nearest match. See docs/DESIGN.md, "Hex
 * provenance for Comfort Colors 1717".
 */
import { type Product, type ProductColorEquivalents } from "./data/index.js";
export type { EquivalentMatch, ProductColorEquivalents } from "./data/index.js";
/**
 * The committed Wada equivalents of one product color, or undefined when the
 * product has no color with that slug.
 *
 * @param product A product ID or a loaded product.
 * @throws {Error} when the product is not listed in the index.
 */
export declare function equivalentsFor(product: string | Pick<Product, "id">, colorSlug: string): ProductColorEquivalents | undefined;
//# sourceMappingURL=equivalents.d.ts.map