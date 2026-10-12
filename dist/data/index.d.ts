/**
 * `@thesnug/color-picker/data`: the vendored and derived JSON assets, typed.
 *
 * `assets/colors.json` is the Wada source and is never edited by hand.
 * `scripts/build-data.ts` derives `assets/derived/colors.json` and
 * `assets/derived/combinations.json` from it; CI fails when they are stale.
 * Products live one file each in `assets/products/`, validated against
 * `assets/schemas/product.schema.json` by `scripts/validate-products.ts`.
 * `scripts/build-equivalents.ts` writes each product's nearest Wada colors to
 * `assets/products/<id>.equivalents.json`; CI fails when they are stale.
 *
 * `scripts/build-engine-data.ts` bundles those assets as TypeScript modules in
 * `./generated/`, so the loaders below read no files (CI fails when the
 * modules are stale). Each loader returns a fresh copy the caller may change.
 * Only the untouched Wada source, `loadWadaDataset`, is read from disk.
 * See docs/DESIGN.md, "Data".
 */
import type { Accessibility, ColorNameSource, ColorNamesFile, Combination, DerivedColor, Product, ProductEquivalentsFile, ProductIndex, WadaColor, WadaDataset } from "./types.js";
export * from "./types.js";
/** URL of the assets directory. Resolves correctly from both `src/` and `dist/`. */
export declare const ASSETS_URL: import("url").URL;
/** Load the vendored Wada dataset, untouched. Read from `assets/colors.json`. */
export declare function loadWadaDataset(): WadaDataset;
/** Load the vendored Wada colors, untouched. */
export declare function loadWadaColors(): WadaColor[];
/** Load the cleaned Wada colors with OKLab and OKLCH values. */
export declare function loadColors(): DerivedColor[];
/** Load the book's combinations as first-class objects. */
export declare function loadCombinations(): Combination[];
/** Load a bundled color-name dictionary: CSS named colors or the xkcd color survey. */
export declare function loadColorNames(source: ColorNameSource): ColorNamesFile;
/** Load `assets/products/index.json`. */
export declare function loadProductIndex(): ProductIndex;
/**
 * Load one product by ID. Only IDs listed in the index are accepted.
 *
 * @throws {Error} when the ID is not in the product index.
 */
export declare function loadProduct(id: string): Product;
/**
 * Load a product's committed Wada equivalents. Only IDs listed in the index are
 * accepted, as for {@link loadProduct}.
 */
export declare function loadProductEquivalents(id: string): ProductEquivalentsFile;
/** Load the default product, Comfort Colors 1717 unless the index says otherwise. */
export declare function defaultProduct(): Product;
/** Load the accessibility and print thresholds, `assets/accessibility.json`. */
export declare function loadAccessibility(): Accessibility;
//# sourceMappingURL=index.d.ts.map