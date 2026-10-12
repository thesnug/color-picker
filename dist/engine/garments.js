/**
 * Garment colors as the engine takes them: a name and a hex, from this
 * package's catalog or from the caller's own (a print provider's variants,
 * reviewed swatches). Pure lookups over the bundled catalog.
 */
import { normalizeHex } from "../color/convert.js";
import { storedDefaultProduct, storedProduct } from "../data/store.js";
import { hasHex } from "../data/types.js";
/** `Chalky Mint` → `chalky-mint`. */
export function garmentSlug(name) {
    return name
        .normalize("NFKD")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
/** The garment as the scoring core names it, with its hex normalized. */
export function garmentColor(garment) {
    return {
        name: garment.colorName,
        slug: garment.slug ?? garmentSlug(garment.colorName),
        hex: normalizeHex(garment.hex),
        ...(garment.family !== undefined && { family: garment.family }),
    };
}
/**
 * A catalog product's garment colors with a hex, in product file order: the
 * stocked ones by default, every one with `availableOnly: false`.
 *
 * @param productId Defaults to the index's default product, Comfort Colors 1717.
 * @throws {Error} when the product ID is unknown.
 */
export function garmentsFromProduct(productId, options = {}) {
    const product = productId === undefined ? storedDefaultProduct() : storedProduct(productId);
    const availableOnly = options.availableOnly ?? true;
    return product.colors
        .filter(hasHex)
        .filter((c) => !availableOnly || c.available)
        .map((c) => ({
        colorName: c.name,
        hex: c.hex,
        slug: c.slug,
        family: c.family,
        source: c.source,
        available: c.available,
    }));
}
//# sourceMappingURL=garments.js.map