/**
 * Lookups over the bundled assets in `./generated/`. Pure: no file reads, so
 * the core and the engine entry point can be bundled or vendored as is.
 *
 * The returned objects are shared, not copies: callers inside the package
 * treat them as read-only. The public loaders in `./index.ts` hand out copies.
 */

import { ACCESSIBILITY } from "./generated/accessibility.js";
import { COLORS } from "./generated/colors.js";
import { COMBINATIONS } from "./generated/combinations.js";
import { EQUIVALENTS } from "./generated/equivalents.js";
import { COLOR_NAMES } from "./generated/names.js";
import { PRODUCT_INDEX, PRODUCTS } from "./generated/products.js";
import type {
  Accessibility,
  ColorNameSource,
  ColorNamesFile,
  Combination,
  DerivedColor,
  Product,
  ProductEquivalentsFile,
  ProductIndex,
} from "./types.js";

/** The cleaned Wada colors with OKLab and OKLCH values, in index order. */
export function storedColors(): readonly DerivedColor[] {
  return COLORS;
}

/** The book's combinations as first-class objects. */
export function storedCombinations(): readonly Combination[] {
  return COMBINATIONS;
}

/** A color-name dictionary: CSS named colors or the xkcd color survey. */
export function storedColorNames(source: ColorNameSource): ColorNamesFile {
  return COLOR_NAMES[source];
}

/** The product index. */
export function storedProductIndex(): ProductIndex {
  return PRODUCT_INDEX;
}

function knownProduct(id: string): void {
  if (!PRODUCT_INDEX.products.some((p) => p.id === id) || !Object.hasOwn(PRODUCTS, id)) {
    const known = PRODUCT_INDEX.products.map((p) => p.id).join(", ");
    throw new Error(`Unknown product "${id}". Known products: ${known}.`);
  }
}

/**
 * One product by ID.
 *
 * @throws {Error} when the ID is not in the product index.
 */
export function storedProduct(id: string): Product {
  knownProduct(id);
  return PRODUCTS[id]!;
}

/**
 * A product's stored Wada equivalents.
 *
 * @throws {Error} when the ID is not in the product index.
 */
export function storedProductEquivalents(id: string): ProductEquivalentsFile {
  knownProduct(id);
  return EQUIVALENTS[id]!;
}

/** The default product, Comfort Colors 1717 unless the index says otherwise. */
export function storedDefaultProduct(): Product {
  return storedProduct(PRODUCT_INDEX.default);
}

/** The accessibility and print thresholds. */
export function storedAccessibility(): Accessibility {
  return ACCESSIBILITY;
}
