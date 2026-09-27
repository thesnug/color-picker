/**
 * `@thesnug/color-picker/data`: the vendored and derived JSON assets, typed.
 *
 * Files are read at call time so consumers only pay for the assets they use.
 * `assets/colors.json` is the Wada source and is never edited by hand.
 * `scripts/build-data.ts` derives `assets/derived/colors.json` and
 * `assets/derived/combinations.json` from it; CI fails when they are stale.
 * Products live one file each in `assets/products/`, validated against
 * `assets/schemas/product.schema.json` by `scripts/validate-products.ts`.
 * `scripts/build-equivalents.ts` writes each product's nearest Wada colors to
 * `assets/products/<id>.equivalents.json`; CI fails when they are stale.
 * See docs/DESIGN.md, "Data".
 */
import { readFileSync } from "node:fs";
/** True when the color has a hex to match, render, or print against. */
export function hasHex(color) {
    return color.hex !== null;
}
// ---------------------------------------------------------------------------
// Loaders
/** URL of the assets directory. Resolves correctly from both `src/` and `dist/`. */
export const ASSETS_URL = new URL("../../assets/", import.meta.url);
function readJson(name) {
    const url = new URL(name, ASSETS_URL);
    return JSON.parse(readFileSync(url, "utf8"));
}
/** Drop the editor-only `$schema` pointer that product files carry. */
function withoutSchema(value) {
    const { $schema: _schema, ...rest } = value;
    return rest;
}
/** Load the vendored Wada dataset, untouched. */
export function loadWadaDataset() {
    return readJson("colors.json");
}
/** Load the vendored Wada colors, untouched. */
export function loadWadaColors() {
    return loadWadaDataset().colors;
}
/** Load the cleaned Wada colors with OKLab and OKLCH values. */
export function loadColors() {
    return readJson("derived/colors.json").colors;
}
/** Load the book's combinations as first-class objects. */
export function loadCombinations() {
    return readJson("derived/combinations.json").combinations;
}
/** Load a bundled color-name dictionary: CSS named colors or the xkcd color survey. */
export function loadColorNames(source) {
    return readJson(`names/${source}.json`);
}
/** Load `assets/products/index.json`. */
export function loadProductIndex() {
    return withoutSchema(readJson("products/index.json"));
}
/**
 * Load one product by ID. Only IDs listed in the index are accepted, so the ID
 * never reaches the file system unchecked.
 */
export function loadProduct(id) {
    const index = loadProductIndex();
    if (!index.products.some((p) => p.id === id)) {
        const known = index.products.map((p) => p.id).join(", ");
        throw new Error(`Unknown product "${id}". Known products: ${known}.`);
    }
    return withoutSchema(readJson(`products/${id}.json`));
}
/**
 * Load a product's committed Wada equivalents. Only IDs listed in the index are
 * accepted, as for {@link loadProduct}.
 */
export function loadProductEquivalents(id) {
    const index = loadProductIndex();
    if (!index.products.some((p) => p.id === id)) {
        const known = index.products.map((p) => p.id).join(", ");
        throw new Error(`Unknown product "${id}". Known products: ${known}.`);
    }
    return readJson(`products/${id}.equivalents.json`);
}
/** Load the default product, Comfort Colors 1717 unless the index says otherwise. */
export function defaultProduct() {
    return loadProduct(loadProductIndex().default);
}
/** Load the accessibility and print thresholds, `assets/accessibility.json`. */
export function loadAccessibility() {
    const { $comment: _comment, ...rest } = readJson("accessibility.json");
    return rest;
}
//# sourceMappingURL=index.js.map