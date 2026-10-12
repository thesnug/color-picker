/**
 * Lookups over the bundled assets in `./generated/`. Pure: no file reads, so
 * the core and the engine entry point can be bundled or vendored as is.
 *
 * The returned objects are shared, not copies: callers inside the package
 * treat them as read-only. The public loaders in `./index.ts` hand out copies.
 */
import type { Accessibility, ColorNameSource, ColorNamesFile, Combination, DerivedColor, Product, ProductEquivalentsFile, ProductIndex } from "./types.js";
/** The cleaned Wada colors with OKLab and OKLCH values, in index order. */
export declare function storedColors(): readonly DerivedColor[];
/** The book's combinations as first-class objects. */
export declare function storedCombinations(): readonly Combination[];
/** A color-name dictionary: CSS named colors or the xkcd color survey. */
export declare function storedColorNames(source: ColorNameSource): ColorNamesFile;
/** The product index. */
export declare function storedProductIndex(): ProductIndex;
/**
 * One product by ID.
 *
 * @throws {Error} when the ID is not in the product index.
 */
export declare function storedProduct(id: string): Product;
/**
 * A product's stored Wada equivalents.
 *
 * @throws {Error} when the ID is not in the product index.
 */
export declare function storedProductEquivalents(id: string): ProductEquivalentsFile;
/** The default product, Comfort Colors 1717 unless the index says otherwise. */
export declare function storedDefaultProduct(): Product;
/** The accessibility and print thresholds. */
export declare function storedAccessibility(): Accessibility;
//# sourceMappingURL=store.d.ts.map