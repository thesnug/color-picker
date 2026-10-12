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
import { readFileSync } from "node:fs";
import { storedAccessibility, storedColorNames, storedColors, storedCombinations, storedProduct, storedProductEquivalents, storedProductIndex, } from "./store.js";
export * from "./types.js";
// ---------------------------------------------------------------------------
// Loaders
/** URL of the assets directory. Resolves correctly from both `src/` and `dist/`. */
export const ASSETS_URL = new URL("../../assets/", import.meta.url);
/** Load the vendored Wada dataset, untouched. Read from `assets/colors.json`. */
export function loadWadaDataset() {
    return JSON.parse(readFileSync(new URL("colors.json", ASSETS_URL), "utf8"));
}
/** Load the vendored Wada colors, untouched. */
export function loadWadaColors() {
    return loadWadaDataset().colors;
}
/** Load the cleaned Wada colors with OKLab and OKLCH values. */
export function loadColors() {
    return structuredClone([...storedColors()]);
}
/** Load the book's combinations as first-class objects. */
export function loadCombinations() {
    return structuredClone([...storedCombinations()]);
}
/** Load a bundled color-name dictionary: CSS named colors or the xkcd color survey. */
export function loadColorNames(source) {
    return structuredClone(storedColorNames(source));
}
/** Load `assets/products/index.json`. */
export function loadProductIndex() {
    return structuredClone(storedProductIndex());
}
/**
 * Load one product by ID. Only IDs listed in the index are accepted.
 *
 * @throws {Error} when the ID is not in the product index.
 */
export function loadProduct(id) {
    return structuredClone(storedProduct(id));
}
/**
 * Load a product's committed Wada equivalents. Only IDs listed in the index are
 * accepted, as for {@link loadProduct}.
 */
export function loadProductEquivalents(id) {
    return structuredClone(storedProductEquivalents(id));
}
/** Load the default product, Comfort Colors 1717 unless the index says otherwise. */
export function defaultProduct() {
    return loadProduct(storedProductIndex().default);
}
/** Load the accessibility and print thresholds, `assets/accessibility.json`. */
export function loadAccessibility() {
    return structuredClone(storedAccessibility());
}
//# sourceMappingURL=index.js.map