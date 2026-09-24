/**
 * Stored Wada equivalents for product colors. The matches are computed once by
 * `scripts/build-equivalents.ts` and committed; this module only reads them, so
 * a shirt-name query never runs a nearest match. See docs/DESIGN.md, "Hex
 * provenance for Comfort Colors 1717".
 */

import {
  loadProductEquivalents,
  type Product,
  type ProductColorEquivalents,
  type ProductEquivalentsFile,
} from "./data/index.js";

export type { EquivalentMatch, ProductColorEquivalents } from "./data/index.js";

/**
 * The committed Wada equivalents of one product color, or undefined when the
 * product has no color with that slug.
 *
 * @param product A product ID or a loaded product.
 * @throws {Error} when the product is not listed in the index.
 */
export function equivalentsFor(
  product: string | Pick<Product, "id">,
  colorSlug: string,
): ProductColorEquivalents | undefined {
  const { colors } = equivalentsFile(typeof product === "string" ? product : product.id);
  return Object.hasOwn(colors, colorSlug) ? colors[colorSlug] : undefined;
}

// Each file is read once, on first use.
const cache = new Map<string, ProductEquivalentsFile>();

function equivalentsFile(id: string): ProductEquivalentsFile {
  let file = cache.get(id);
  if (!file) cache.set(id, (file = loadProductEquivalents(id)));
  return file;
}
