/**
 * Nearest match: the closest Wada colors to a hex code, a color name, or any
 * other color input, by OKLab distance. Pure math, no model. See
 * docs/DESIGN.md, "Pipelines".
 *
 * Names resolve in order: Wada canonical names and aliases, then CSS named
 * colors, then the xkcd color survey. The dictionaries and their licenses are
 * in `assets/names/`.
 */
import { distance, hexToOklab, isHex, normalizeHex, toHex, } from "./color/convert.js";
import { loadColorNames, loadColors } from "./data/index.js";
/** Default number of matches when neither `k` nor `within` is given. */
export const DEFAULT_NEAREST_K = 3;
/**
 * Find the Wada colors closest to a hex code, a color name, or any other
 * color input. Unknown names return no matches and a `reason`; they never throw.
 *
 * @throws {RangeError} when `k` is not a positive integer or `within` is negative.
 */
export function nearest(input, options = {}) {
    const { within } = options;
    const k = options.k ?? (within === undefined ? DEFAULT_NEAREST_K : Infinity);
    if (k !== Infinity && !(Number.isInteger(k) && k > 0)) {
        throw new RangeError(`k must be a positive integer, got ${k}`);
    }
    if (within !== undefined && !(within >= 0)) {
        throw new RangeError(`within must be zero or more, got ${within}`);
    }
    const resolved = resolveQuery(input);
    if (!resolved) {
        return { matches: [], reason: `Unknown color name ${JSON.stringify(input)}.` };
    }
    const query = hexToOklab(resolved.hex);
    const matches = (options.colors ?? wadaColors())
        .map((color) => ({ color, distance: distance(query, exactOklab(color)) }))
        .filter((m) => within === undefined || m.distance <= within)
        .sort((a, b) => a.distance - b.distance || a.color.index - b.color.index)
        .slice(0, k);
    if (matches.length === 0) {
        return { resolved, matches, reason: `No color within ${within} of ${resolved.hex}.` };
    }
    return { resolved, matches };
}
/**
 * Read a query as a color. Hex strings are taken as hex; other strings are
 * looked up as names. Returns undefined for an unknown name.
 */
export function resolveQuery(input) {
    if (typeof input !== "string")
        return { via: "color", hex: toHex(input) };
    if (isHex(input))
        return { via: "hex", hex: normalizeHex(input) };
    return resolveName(input);
}
/**
 * Resolve a color name, ignoring case, spacing, and punctuation, and treating
 * "grey" as "gray". Wada names win over CSS names, which win over xkcd names.
 * An ambiguous Wada name such as "Eugenia Red" resolves to the lowest index.
 */
export function resolveName(name) {
    const key = nameKey(name);
    if (!key)
        return undefined;
    for (const [via, index] of nameIndexes()) {
        const hit = index.get(key);
        if (hit)
            return { via, hex: hit.hex, name: hit.name };
    }
    return undefined;
}
/** Lowercase, "grey" as "gray", and only letters and digits. */
export function nameKey(name) {
    return name
        .normalize("NFKD")
        .toLowerCase()
        .replaceAll("grey", "gray")
        .replace(/[^a-z0-9]/g, "");
}
// ---------------------------------------------------------------------------
// Cached lookups. The assets are read once, on first use.
let colorsCache;
function wadaColors() {
    return (colorsCache ??= loadColors());
}
// The derived OKLab values are rounded to five places, which would put an exact
// hex match about 0.001 away. Distances use full precision from the hex instead.
const oklabCache = new WeakMap();
function exactOklab(color) {
    let lab = oklabCache.get(color);
    if (!lab)
        oklabCache.set(color, (lab = hexToOklab(color.hex)));
    return lab;
}
let indexesCache;
function nameIndexes() {
    if (indexesCache)
        return indexesCache;
    // Wada colors in index order, so an alias shared by variants resolves to the first.
    const wada = new Map();
    for (const c of wadaColors()) {
        for (const name of [c.name, c.slug, c.sourceName, ...c.aliases]) {
            const key = nameKey(name);
            if (!wada.has(key))
                wada.set(key, { name: c.name, hex: c.hex });
        }
    }
    // The dictionaries are sorted by name, so when spellings collide after
    // normalizing ("blue green", "blue/green", "bluegreen") the spaced one wins.
    const dictionary = (source) => {
        const index = new Map();
        for (const { name, hex } of loadColorNames(source).colors) {
            const key = nameKey(name);
            if (!index.has(key))
                index.set(key, { name, hex: normalizeHex(hex) });
        }
        return index;
    };
    indexesCache = [
        ["wada", wada],
        ["css", dictionary("css")],
        ["xkcd", dictionary("xkcd")],
    ];
    return indexesCache;
}
//# sourceMappingURL=nearest.js.map