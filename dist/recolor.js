/**
 * Recommend product colors for a design with recoloring: for each garment, a
 * Wada combination around the garment's equivalent, a from-to mapping of the
 * design's colors onto it, and a prompt describing the change. Deterministic;
 * the Jev plausibility check that vets each swap consumes this output. See
 * docs/DESIGN.md, "Pipelines", "Recommend shirts, with recoloring".
 *
 * Applying a mapping to pixels reads and writes files, so `applyRecolor` lives
 * in the fingerprint entry point.
 */
import { check } from "./accessibility.js";
import { combinations } from "./combinations.js";
import { contrastRatio } from "./color/contrast.js";
import { distance, normalizeHex, toOklab } from "./color/convert.js";
import { hasHex, loadAccessibility, loadColors, loadProduct, loadProductIndex, } from "./data/index.js";
import { equivalentsFor } from "./equivalents.js";
import { nearest } from "./nearest.js";
export const RECOLOR_PLAN_DEFAULTS = {
    n: 5,
    within: 6,
};
export const RECOLOR_WEIGHTS = Object.freeze({
    contrast: 0.6,
    vanish: 0.6,
    fidelity: 0.3,
});
// ---------------------------------------------------------------------------
// Helpers
const round = (value, places) => Number(value.toFixed(places));
const clamp01 = (value) => Math.min(1, Math.max(0, value));
const percent = (share) => `${Math.round(share * 100)}%`;
const RANK_WORDS = ["", "nearest", "second nearest", "third nearest"];
let cachedRules;
let wadaByIndex;
function wadaColor(index) {
    wadaByIndex ??= new Map(loadColors().map((c) => [c.index, c]));
    const color = wadaByIndex.get(index);
    if (!color)
        throw new RangeError(`No Wada color with index ${index}.`);
    return color;
}
const ref = (c) => ({ index: c.index, name: c.name, hex: c.hex });
function resolveProduct(product) {
    if (product === undefined)
        return loadProduct(loadProductIndex().default);
    return typeof product === "string" ? loadProduct(product) : product;
}
/**
 * The garment's equivalents: the committed ones when the product is indexed,
 * else a live nearest match, as `recommendProductColors` falls back.
 */
function garmentEquivalents(product, color, within) {
    let stored;
    try {
        stored = equivalentsFor(product, color.slug)?.matches;
    }
    catch {
        // A product passed in directly may not be in the index.
    }
    const matches = stored ??
        nearest(color.hex, { k: 3 }).matches.map((m) => ({ index: m.color.index, name: m.color.name, distance: m.distance }));
    return matches
        .map((m, i) => ({ index: m.index, name: m.name, distance: m.distance, rank: i + 1 }))
        .filter((m) => m.rank === 1 || m.distance <= within);
}
/** Every `k`-element subset of `items`, each in the items' order. */
function subsets(items, k) {
    if (k === 0)
        return [[]];
    if (items.length < k)
        return [];
    const [head, ...rest] = items;
    return [...subsets(rest, k - 1).map((s) => [head, ...s]), ...subsets(rest, k)];
}
/**
 * Book combinations containing the equivalent, then harmonies generated from
 * it, each with its other members. Cached per Wada index for one call.
 */
function candidatesFor(equivalent, cache) {
    const cached = cache.get(equivalent.index);
    if (cached)
        return cached.map((c) => ({ ...c, combination: { ...c.combination, equivalent } }));
    const { palettes } = combinations(wadaColor(equivalent.index).name, {
        limit: Number.MAX_SAFE_INTEGER,
        // Only this equivalent's own combinations; the others are separate equivalents.
        secondaryWithin: 0,
        // Always generate harmonies, so a garment whose book combinations are all
        // too small still has candidates.
        min: Number.MAX_SAFE_INTEGER,
    });
    const found = [];
    for (const palette of palettes) {
        if (!palette.colors.some((c) => c.index === equivalent.index))
            continue;
        const inks = palette.colors.filter((c) => c.index !== equivalent.index);
        if (inks.length === 0)
            continue;
        const colors = palette.colors.map(ref);
        found.push({
            inks,
            combination: palette.source === "book"
                ? { source: "book", id: palette.combination.id, colors, equivalent }
                : { source: "harmony", harmony: palette.harmony, colors, equivalent },
        });
    }
    cache.set(equivalent.index, found);
    return found;
}
/**
 * Map design colors onto inks by lightness rank, so hierarchy survives: the
 * darkest design color takes the darkest ink, and so on. With fewer inks than
 * design colors, the lightness-sorted design colors are split into as many
 * contiguous runs as there are inks, and each run shares one ink.
 */
export function mapByLightness(design, inks) {
    if (inks.length === 0)
        throw new RangeError("No inks to map onto.");
    const byLight = [...design].sort((a, b) => a.lightness - b.lightness);
    const targets = [...inks].sort((a, b) => a.oklab.l - b.oklab.l);
    const k = byLight.length;
    const m = Math.min(targets.length, k);
    // More inks than design colors is resolved by the caller choosing a subset.
    const used = targets.length > k ? targets.slice(0, k) : targets;
    return new Map(byLight.map((d, j) => [d, used[Math.floor((j * m) / k)]]));
}
/** Sum of the weighted components, rounded as `score` is. */
export function scoreRecolor(components, weights = RECOLOR_WEIGHTS) {
    return round(weights.contrast * components.contrast -
        weights.vanish * components.vanish +
        weights.fidelity * components.fidelity, 3);
}
/** `a`, `a and b`, `a, b, and c`. */
function list(items) {
    if (items.length <= 2)
        return items.join(" and ");
    return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}
// ---------------------------------------------------------------------------
// Sentences
function swapPhrase(entry) {
    const subject = entry.from.element ? `the ${entry.from.element}` : `the ${entry.from.hex} areas`;
    const target = `${entry.to.name} ${entry.to.hex}`;
    // Below a just-noticeable difference the swap is not a change.
    return distance(entry.from.hex, entry.to.hex) < 2 ? `keep ${subject} as ${target}` : `change ${subject} to ${target}`;
}
/**
 * The recolor prompt: a short imperative paragraph naming every swap, from a
 * template, not a model.
 */
export function recolorPrompt(garment, mapping) {
    const swaps = mapping.map(swapPhrase);
    return (`Recolor the artwork for a ${garment} shirt: ${swaps.join("; ")}. ` +
        `Keep the shapes, line work, and transparent areas unchanged.`);
}
function combinationPhrase(combination) {
    return combination.source === "book"
        ? `book combination ${combination.id}`
        : `the ${combination.harmony} harmony`;
}
/** Whether `a` is strictly better than `b` within one garment. */
function better(a, b) {
    if (a.tier !== b.tier)
        return a.tier < b.tier;
    if (a.shortfall !== b.shortfall)
        return a.shortfall < b.shortfall;
    return a.plan.score > b.plan.score;
}
/**
 * For each garment, the best recolor plan: a Wada combination containing one
 * of the garment's equivalents, and the design's colors mapped onto its other
 * members by lightness.
 *
 * Within a garment, plans are preferred in this order, and the highest score
 * wins within the first tier that has any:
 *
 * 1. a book combination with at least as many other members as the design has
 *    colors;
 * 2. a harmony with enough members;
 * 3. a book combination with fewer, where neighbors in lightness share an ink;
 * 4. a harmony with fewer.
 *
 * In tiers 3 and 4, the combination with the most other members wins before
 * score, so as few design colors as possible share an ink.
 *
 * With more members than design colors, every subset of the right size is
 * tried. A plan where any new ink is within the print minimum distance of the
 * garment is flagged, and used only when the garment has no other plan.
 * Garments are ranked unflagged first, then by score.
 *
 * @throws {RangeError} when the design has no colors, or `n` is not a positive integer.
 * @throws {Error} when the product ID is unknown.
 */
export function recolorPlans(design, options = {}) {
    const n = options.n ?? RECOLOR_PLAN_DEFAULTS.n;
    if (!(Number.isInteger(n) && n > 0))
        throw new RangeError(`n must be a positive integer, got ${n}`);
    if (design.palette.length === 0) {
        throw new RangeError("The design has no visible colors to recolor.");
    }
    const rules = options.rules ?? (cachedRules ??= loadAccessibility());
    const product = resolveProduct(options.product);
    const availableOnly = options.availableOnly ?? true;
    const within = options.within ?? RECOLOR_PLAN_DEFAULTS.within;
    const target = rules.wcag.body.AA;
    const weights = options.weights ?? RECOLOR_WEIGHTS;
    const totalShare = design.palette.reduce((sum, c) => sum + c.share, 0);
    const entries = design.palette.map((c) => {
        const hex = normalizeHex(c.hex);
        const entry = {
            hex,
            share: c.share,
            weight: totalShare > 0 ? c.share / totalShare : 1 / design.palette.length,
            lightness: toOklab(hex).l,
        };
        if (c.element)
            entry.element = c.element;
        return entry;
    });
    const cache = new Map();
    const best = [];
    for (const color of product.colors) {
        if (!hasHex(color) || (availableOnly && !color.available))
            continue;
        let chosen;
        for (const equivalent of garmentEquivalents(product, color, within)) {
            for (const candidate of candidatesFor(equivalent, cache)) {
                const merged = candidate.inks.length < entries.length;
                const inkSets = merged ? [candidate.inks] : subsets(candidate.inks, entries.length);
                for (const inks of inkSets) {
                    const plan = buildPlan(color, candidate.combination, entries, inks, merged, { rules, target, weights });
                    const scored = {
                        plan,
                        tier: (plan.flagged ? 4 : 0) + (merged ? 2 : 0) + (candidate.combination.source === "harmony" ? 1 : 0),
                        shortfall: Math.max(0, entries.length - inks.length),
                    };
                    // Strictly better only, so ties keep the nearer equivalent and the
                    // earlier combination.
                    if (!chosen || better(scored, chosen))
                        chosen = scored;
                }
            }
        }
        if (chosen)
            best.push(chosen);
    }
    // Array sort is stable, so equal scores keep product file order.
    return best
        .sort((a, b) => Number(a.plan.flagged) - Number(b.plan.flagged) || b.plan.score - a.plan.score)
        .slice(0, n)
        .map((s) => s.plan);
}
function buildPlan(color, combination, entries, inks, merged, { rules, target, weights }) {
    const garment = color.name;
    const assigned = mapByLightness(entries, inks);
    const mapping = entries.map((e) => {
        const to = assigned.get(e);
        const from = { hex: e.hex, share: round(e.share, 4) };
        if (e.element)
            from.element = e.element;
        return { from, to: ref(to) };
    });
    // The new inks against the garment and against each other, as printed.
    const used = [...new Map(mapping.map((m) => [m.to.index, m.to])).values()];
    const printed = check([{ hex: color.hex, name: garment }, ...used.map((c) => ({ hex: c.hex, name: c.name }))], {
        context: "print",
        rules,
    });
    const vanishing = new Set(printed.pairs.filter((p) => p.tooClose && p.background.hex === normalizeHex(color.hex)).map((p) => p.foreground.hex));
    const crowded = printed.pairs.filter((p) => p.tooClose && p.background.hex !== normalizeHex(color.hex) && p.foreground.hex !== normalizeHex(color.hex));
    const ratios = mapping.map((m) => round(contrastRatio(m.to.hex, color.hex), 2));
    const components = {
        contrast: round(entries.reduce((sum, e, i) => sum + e.weight * clamp01((ratios[i] - 1) / (target - 1)), 0), 4),
        vanish: round(entries.reduce((sum, e, i) => sum + (vanishing.has(mapping[i].to.hex) ? e.weight : 0), 0), 4),
        fidelity: round(clamp01(1 - entries.reduce((sum, e, i) => sum + e.weight * distance(e.hex, mapping[i].to.hex), 0) / 100), 4),
    };
    const { equivalent } = combination;
    const reasons = [
        `Uses ${combinationPhrase(combination)} around Wada's ${equivalent.name}, the ${RANK_WORDS[equivalent.rank] ?? `rank ${equivalent.rank}`} Wada color to ${garment} (distance ${round(equivalent.distance, 1)}).`,
    ];
    const lowest = ratios.reduce((a, b) => Math.min(a, b));
    const lowestInk = mapping[ratios.indexOf(lowest)].to;
    reasons.push(ratios.every((r) => r >= target)
        ? `Every new ink clears ${target}:1 on ${garment}; ${lowestInk.name} is the lowest at ${lowest}:1.`
        : `${lowestInk.name} is the lowest-contrast new ink on ${garment} at ${lowest}:1, below ${target}:1.`);
    if (merged) {
        const shared = used
            .map((ink) => ({ ink, from: mapping.filter((m) => m.to.index === ink.index).map((m) => m.from.hex) }))
            .filter((s) => s.from.length > 1)
            .map((s) => `${list(s.from)} ${s.from.length === 2 ? "both" : "all"} become ${s.ink.name}`);
        reasons.push(`The design has ${entries.length} colors and the combination only ${inks.length} besides ${equivalent.name}, ` +
            `so neighbors in lightness share an ink: ${shared.join("; ")}.`);
    }
    const minimum = rules.print.minimumDistance.value;
    const warnings = mapping
        .filter((m) => vanishing.has(m.to.hex))
        .map((m) => `${m.from.hex}, ${percent(m.from.share)} of the design, becomes ${m.to.name} ${m.to.hex}, ` +
        `within the print minimum of ${minimum} of ${garment}; it will vanish into the shirt.`);
    // Each unordered pair appears twice among the ordered pairs.
    for (const p of crowded.filter((p) => p.foreground.hex < p.background.hex)) {
        warnings.push(`${p.foreground.name} and ${p.background.name} are only ${p.distance} apart; they will read as one color on fabric.`);
    }
    if (!printed.cvdSafe) {
        warnings.push(...printed.cvd.flatMap((r) => (r.collapsed.length ? r.reasons : [])));
    }
    return {
        color,
        combination,
        mapping,
        prompt: recolorPrompt(garment, mapping),
        score: scoreRecolor(components, weights),
        components,
        merged,
        flagged: vanishing.size > 0,
        reasons,
        warnings,
    };
}
//# sourceMappingURL=recolor.js.map