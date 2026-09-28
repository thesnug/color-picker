/**
 * Palettes for a product color by name: "give me palettes for Blue Spruce".
 * Reads the garment's committed Wada equivalents, never a live nearest match,
 * and builds each palette around the real garment hex, since ink goes on the
 * shirt and not on its Wada stand-in. See docs/DESIGN.md, "Pipelines".
 */
import { contrastRatio } from "./color/contrast.js";
import { combinations, COMBINATION_DEFAULTS, } from "./combinations.js";
import { loadProduct, loadProductIndex, } from "./data/index.js";
import { equivalentsFor } from "./equivalents.js";
/**
 * Ranked palettes for a product color named by its name, slug, or an alias,
 * ignoring case. Each palette leads with the garment, marked as the anchor,
 * then the Wada colors to print on it. Unknown names return no palettes and a
 * `reason`; they never throw.
 *
 * @throws {Error} when the product ID is unknown.
 * @throws {RangeError} for a non-integer or out-of-range `size` or `limit`.
 */
export function palettesForProductColor(colorNameOrSlug, options = {}) {
    const { limit = COMBINATION_DEFAULTS.limit, within = COMBINATION_DEFAULTS.secondaryWithin } = options;
    if (!(Number.isInteger(limit) && limit > 0)) {
        throw new RangeError(`limit must be a positive integer, got ${limit}`);
    }
    const product = resolveProduct(options.product);
    const summary = { id: product.id, name: product.name };
    const color = findProductColor(product, colorNameOrSlug);
    if (!color) {
        return {
            product: summary,
            equivalents: [],
            palettes: [],
            reason: `${product.name} has no color named ${JSON.stringify(colorNameOrSlug)}.`,
        };
    }
    const found = { product: summary, color, available: color.available };
    const matches = equivalentsFor(product, color.slug)?.matches ?? [];
    const equivalents = matches
        .map((m, i) => ({ ...m, rank: i + 1 }))
        .filter((m) => m.rank === 1 || m.distance <= within);
    if (!color.hex || equivalents.length === 0) {
        return { ...found, equivalents, palettes: [], reason: `${color.name} has no hex to match.` };
    }
    const anchor = {
        anchor: true,
        name: color.name,
        slug: color.slug,
        hex: color.hex,
        available: color.available,
        ...(color.image && { image: color.image }),
    };
    // Each equivalent's own palettes only; the stored equivalents replace the
    // nearest-match reach `combinations` would otherwise add. Nearest first, so
    // a combination reached twice keeps the closer equivalent.
    const seen = new Set();
    const book = [];
    const harmonies = [];
    for (const equivalent of equivalents) {
        const { palettes } = combinations(equivalent.name, {
            anchor: equivalent.index,
            limit: Number.MAX_SAFE_INTEGER,
            secondaryWithin: 0,
            ...(options.size !== undefined && { size: options.size }),
        });
        for (const palette of palettes) {
            const ink = palette.colors.filter((c) => c.index !== equivalent.index);
            const key = palette.source === "book"
                ? `book:${palette.combination.id}`
                : `ink:${ink.map((c) => c.index).sort((a, b) => a - b).join(",")}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            const onGarment = onShirt(palette, anchor, ink, equivalent);
            if (onGarment.source === "book")
                book.push(onGarment);
            else
                harmonies.push(onGarment);
        }
    }
    const palettes = [...book.sort(byContrast), ...harmonies.sort(byContrast)].slice(0, limit);
    if (palettes.length === 0) {
        return { ...found, equivalents, palettes, reason: `No palettes for ${color.name} match the given options.` };
    }
    return { ...found, equivalents, palettes };
}
/**
 * The product color whose name, slug, or alias matches, ignoring case and
 * treating spaces, hyphens, and underscores alike.
 */
export function findProductColor(product, nameOrSlug) {
    const wanted = normalizeName(nameOrSlug);
    if (!wanted)
        return undefined;
    return product.colors.find((c) => [c.name, c.slug, ...c.aliases].some((n) => normalizeName(n) === wanted));
}
function normalizeName(name) {
    return name.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}
function resolveProduct(product) {
    if (product === undefined)
        return loadProduct(loadProductIndex().default);
    return typeof product === "string" ? loadProduct(product) : product;
}
function onShirt(palette, anchor, ink, equivalent) {
    const ratios = ink.map((c) => contrastRatio(c.hex, anchor.hex));
    const base = {
        colors: [anchor, ...ink.map((c) => ({ ...c, anchor: false }))],
        equivalent,
        contrast: round(ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 1),
        minContrast: round(ratios.length ? Math.min(...ratios) : 1),
    };
    return palette.source === "book"
        ? { source: "book", combination: palette.combination, ...base }
        : { source: "harmony", harmony: palette.harmony, snaps: palette.snaps, ...base };
}
// Array sort is stable, so equal contrasts keep equivalent order.
function byContrast(a, b) {
    return b.contrast - a.contrast;
}
function round(value) {
    return Math.round(value * 1e4) / 1e4;
}
//# sourceMappingURL=palettes.js.map