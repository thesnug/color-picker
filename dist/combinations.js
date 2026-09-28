/**
 * Combinations for a color: the book's combinations for the nearest Wada
 * matches, then generated harmonies snapped to Wada colors when the book gives
 * too few. Pure math, no model. See docs/DESIGN.md, "Pipelines".
 */
import { contrastRatio } from "./color/contrast.js";
import { toHex, toOklch } from "./color/convert.js";
import { analogous, complementary, hueArc, splitComplementary, triadic } from "./color/harmony.js";
import { loadColors, loadCombinations, } from "./data/index.js";
import { nearest } from "./nearest.js";
/** Defaults for `combinations`. */
export const COMBINATION_DEFAULTS = {
    /** Generate harmonies when the book gives fewer palettes than this. */
    min: 6,
    /** Maximum palettes returned. */
    limit: 12,
    /** Second and third matches within this distance contribute their combinations. */
    secondaryWithin: 6,
    /** A harmony is skipped when any generated color snaps farther than this. */
    snapWithin: 8,
    /**
     * OKLab chroma at or below which the input counts as gray and the
     * neutral-anchor rule is considered. The same cutoff as the neutral color
     * family. Among Comfort Colors 1717 it catches Black, White, Grey, Granite,
     * Graphite, and Pepper; Navy (0.0195) is the first color above it.
     */
    neutralChroma: 0.015,
    /**
     * The nearest Wada neutral replaces the plain nearest match only when it is
     * no farther than this multiple of the plain distance.
     */
    neutralMargin: 1.5,
};
const GENERATORS = [
    ["complementary", complementary],
    ["split-complementary", (c) => splitComplementary(c)],
    ["triadic", triadic],
    ["analogous", (c) => analogous(c)],
];
/**
 * Ranked palettes for a hex code, a color name, or any other color input.
 * Unknown names return no palettes and a `reason`; they never throw.
 *
 * @throws {RangeError} for a non-integer or out-of-range `size`, `limit`, or
 * `min`, or an `anchor` that names no Wada color.
 */
export function combinations(input, options = {}) {
    const { includeNeutrals = true, limit = COMBINATION_DEFAULTS.limit, min = COMBINATION_DEFAULTS.min, secondaryWithin = COMBINATION_DEFAULTS.secondaryWithin, snapWithin = COMBINATION_DEFAULTS.snapWithin, neutralChroma = COMBINATION_DEFAULTS.neutralChroma, neutralMargin = COMBINATION_DEFAULTS.neutralMargin, } = options;
    if (!(Number.isInteger(limit) && limit > 0)) {
        throw new RangeError(`limit must be a positive integer, got ${limit}`);
    }
    if (!(Number.isInteger(min) && min >= 0)) {
        throw new RangeError(`min must be zero or a positive integer, got ${min}`);
    }
    const sizes = options.size === undefined ? undefined : [options.size].flat();
    for (const s of sizes ?? []) {
        if (!(Number.isInteger(s) && s > 0)) {
            throw new RangeError(`size must be a positive integer, got ${s}`);
        }
    }
    const sizeOk = (n) => (sizes ? sizes.includes(n) : n >= 2);
    const given = options.anchor === undefined ? undefined : findWadaColor(options.anchor);
    if (options.anchor !== undefined && !given) {
        throw new RangeError(`anchor must be a Wada index or slug, got ${JSON.stringify(options.anchor)}`);
    }
    const plain = nearest(input);
    const { resolved } = plain;
    if (!resolved || plain.matches.length === 0) {
        return { ...(resolved && { resolved }), palettes: [], reason: plain.reason ?? "No match." };
    }
    const anchor = given
        ? givenAnchor(given, resolved.hex, plain.matches)
        : resolveAnchor(resolved.hex, plain.matches, neutralChroma, neutralMargin);
    const anchorMatch = { color: anchor.color, distance: anchor.distance };
    const keep = (colors, ref) => sizeOk(colors.length) &&
        (includeNeutrals || colors.every((c) => !c.neutral || c.index === ref.index));
    // Book palettes: the anchor's combinations, then those of up to two more
    // matches within reach.
    const matches = [
        anchorMatch,
        ...plain.matches
            .filter((m) => m.color.index !== anchorMatch.color.index && m.distance <= secondaryWithin)
            .slice(0, 2),
    ];
    const seen = new Set();
    const book = [];
    matches.forEach((m, i) => {
        const found = [];
        for (const id of m.color.combinations) {
            if (seen.has(id))
                continue;
            seen.add(id);
            const combination = combinationsById().get(id);
            const members = combination.colors.map((index) => colorsByIndex().get(index));
            if (!keep(members, m.color))
                continue;
            found.push({
                source: "book",
                combination,
                match: { ...m, rank: i + 1 },
                ...measure(members, m.color),
            });
        }
        book.push(...found.sort(byScore));
    });
    // Harmonies only when the book gives too few.
    const harmonies = [];
    if (book.length < min) {
        // Skip a harmony that repeats a book combination or an earlier harmony.
        const listed = new Set(bookSetKeys());
        for (const [harmony, generate] of GENERATORS) {
            const snaps = generate(anchor.color.hex).map((lch) => {
                const target = toHex(lch);
                const { color, distance } = nearest(target, { k: 1 }).matches[0];
                return { target, color, distance };
            });
            const members = snaps.map((s) => s.color);
            const distinct = new Set(members.map((c) => c.index));
            if (snaps.some((s) => s.distance > snapWithin))
                continue;
            if (distinct.size !== members.length)
                continue;
            if (listed.has(setKey(members)))
                continue;
            listed.add(setKey(members));
            if (!keep(members, anchor.color))
                continue;
            harmonies.push({ source: "harmony", harmony, snaps, ...measure(members, anchor.color) });
        }
        harmonies.sort(byScore);
    }
    const palettes = [...book, ...harmonies].slice(0, limit);
    if (palettes.length === 0) {
        return {
            resolved,
            anchor,
            palettes,
            reason: `No palettes for ${anchor.color.name} match the given options.`,
        };
    }
    return { resolved, anchor, palettes };
}
// ---------------------------------------------------------------------------
// Anchor
function givenAnchor(color, hex, plain) {
    const match = nearest(hex, { k: 1, colors: [color] }).matches[0];
    return { color, distance: match.distance, via: "anchor", nearest: plain };
}
/**
 * The plain nearest match, unless the input is gray and the nearest Wada
 * neutral is within `margin` times the plain distance. Muted hues such as
 * Navy or Moss stay on their plain nearest match, and a gray whose nearest
 * neutral is far (the web edition's neutrals are tinted) does too.
 */
function resolveAnchor(hex, plain, neutralChroma, margin) {
    const closest = plain[0];
    const base = { nearest: plain };
    if (toOklch(hex).c > neutralChroma) {
        return { ...base, color: closest.color, distance: closest.distance, via: "nearest" };
    }
    const neutral = nearest(hex, { k: 1, colors: wadaNeutrals() }).matches[0];
    const same = neutral.color.index === closest.color.index;
    const wins = !same && neutral.distance <= margin * closest.distance;
    const [chosen, other] = wins ? [neutral, closest] : [closest, neutral];
    return {
        ...base,
        color: chosen.color,
        distance: chosen.distance,
        via: wins ? "nearest-neutral" : "nearest",
        ...(!same && {
            rejected: { name: other.color.name, index: other.color.index, distance: other.distance },
        }),
    };
}
function findWadaColor(ref) {
    if (typeof ref === "number")
        return colorsByIndex().get(ref);
    const slug = ref.trim().toLowerCase();
    return [...colorsByIndex().values()].find((c) => c.slug === slug);
}
// ---------------------------------------------------------------------------
// Scoring
const LOG_MAX_CONTRAST = Math.log(21);
function measure(members, ref) {
    const others = members.filter((c) => c.index !== ref.index);
    const contrast = others.length
        ? others.reduce((sum, c) => sum + contrastRatio(c.hex, ref.hex), 0) / others.length
        : 1;
    const hueSpread = hueArc(members.filter((c) => !c.neutral).map((c) => c.oklch.h));
    // WCAG ratios run from 1 to 21; a log scale keeps low ratios distinguishable.
    const contrastPart = Math.log(contrast) / LOG_MAX_CONTRAST;
    const spreadPart = Math.min(hueSpread, 180) / 180;
    return {
        colors: members,
        score: round(0.75 * contrastPart + 0.25 * spreadPart),
        contrast: round(contrast),
        hueSpread: round(hueSpread),
    };
}
function byScore(a, b) {
    return b.score - a.score;
}
function round(value) {
    return Math.round(value * 1e4) / 1e4;
}
// ---------------------------------------------------------------------------
// Cached lookups. The assets are read once, on first use.
let colorsCache;
let combinationsCache;
function colorsByIndex() {
    return (colorsCache ??= new Map(loadColors().map((c) => [c.index, c])));
}
function combinationsById() {
    return (combinationsCache ??= new Map(loadCombinations().map((c) => [c.id, c])));
}
/** The Wada colors flagged neutral in the derived data (chroma at or below 0.045). */
function wadaNeutrals() {
    return [...colorsByIndex().values()].filter((c) => c.neutral);
}
function setKey(members) {
    return members
        .map((c) => c.index)
        .sort((a, b) => a - b)
        .join(",");
}
function bookSetKeys() {
    return [...combinationsById().values()].map((c) => c.colors.join(","));
}
//# sourceMappingURL=combinations.js.map