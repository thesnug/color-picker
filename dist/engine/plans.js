/**
 * Recolor planning for print files: which pigments to substitute so a design
 * reads on more garment colors. Two methods, both expressed as pigment
 * substitutions that `substitutePigments` applies:
 *
 * - Legible ink: each ink under 3:1 on a garment family's median color keeps
 *   its hue and moves darker (for light garments) or lighter (for dark ones)
 *   until it reads. Ported from POD's `ink-legibility-v2`; since engine 1.1.0
 *   each tolerance reaches halfway to the nearest other ink, not just the
 *   ink's spread, so distressed pixels change with their ink.
 * - Wada: the design's colors mapped onto a book combination or harmony
 *   around a garment's Wada equivalent, keeping their lightness order
 *   (`recolorPlans`).
 *
 * `planArtworkOptions` screens both on the measured pixels and keeps the few
 * that add the most legible garment colors.
 */
import { contrastRatio, relativeLuminance } from "../color/contrast.js";
import { distance, hexToOklch, hexToRgb, normalizeHex, oklchToHex, reduceChroma } from "../color/convert.js";
import { recolorPlansFor } from "../recolor.js";
import { garmentColor } from "./garments.js";
import { garmentFamily, inkOnGarment, judgeLegibility, seenOn, } from "./legibility.js";
import { measureInkPixels } from "./measure.js";
import { LEGIBILITY_PROTOCOL, LEGIBILITY_RULES } from "./rules.js";
import { RecolorPigmentError, substitutePigments } from "./substitute.js";
const HEX = /^#[a-fA-F0-9]{6}$/;
/**
 * Check a plan against the `SubstitutionPlan` limits and return it.
 *
 * @throws {TypeError} naming the first limit the plan breaks.
 */
export function validateSubstitutionPlan(plan) {
    const fail = (what) => {
        throw new TypeError(`Invalid substitution plan ${JSON.stringify(plan.key)}: ${what}.`);
    };
    const keys = Object.keys(plan).sort().join(",");
    if (keys !== "key,label,rationale,replacements")
        fail(`unexpected fields ${keys}`);
    if (typeof plan.key !== "string" || !/^[a-z0-9-]{1,60}$/.test(plan.key))
        fail("key must be 1 to 60 of a-z, 0-9 and -");
    if (typeof plan.label !== "string" || plan.label.length < 1 || plan.label.length > 100)
        fail("label must be 1 to 100 characters");
    if (typeof plan.rationale !== "string" || plan.rationale.length < 1 || plan.rationale.length > 2000) {
        fail("rationale must be 1 to 2000 characters");
    }
    if (!Array.isArray(plan.replacements) || plan.replacements.length < 1 || plan.replacements.length > 6) {
        fail("needs 1 to 6 replacements");
    }
    for (const r of plan.replacements) {
        if (Object.keys(r).sort().join(",") !== "from,to,tolerance")
            fail("a replacement has unexpected fields");
        if (!HEX.test(r.from) || !HEX.test(r.to))
            fail("replacement pigments must be #rrggbb");
        if (!Number.isInteger(r.tolerance) || r.tolerance < 0 || r.tolerance > LEGIBILITY_RULES.recolorMaximumTolerance) {
            fail(`tolerance must be an integer from 0 to ${LEGIBILITY_RULES.recolorMaximumTolerance}`);
        }
    }
    return plan;
}
const chebyshev = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
/**
 * The largest tolerance, up to `ceiling`, that recolors the ink's pixels without reaching
 * another ink's: just under half the per-channel gap to the nearest other measured ink. Two
 * inks' tolerances so computed never overlap. The engine's own plans pass the 35 ceiling, so
 * every pixel nearer the ink than halfway to its neighbor changes, distressed and textured
 * pixels included; the ink's spread (its 90th percentile) would leave a tenth of them behind.
 */
function recolorTolerance(cluster, measurement, ceiling) {
    const rgb = hexToRgb(cluster.hex);
    const gap = Math.min(...measurement.clusters.filter((other) => other.hex !== cluster.hex).map((other) => chebyshev(rgb, hexToRgb(other.hex))));
    const half = Number.isFinite(gap) ? Math.floor((gap - 1) / 2) : ceiling;
    return Math.max(0, Math.min(ceiling, half));
}
/**
 * The nearest color of the same hue, moved toward dark or light, that reaches `target` on the
 * median garment and, when any color can, 3:1 on the family's hardest garment as well.
 */
function towardContrast(cluster, garments, direction, target) {
    const R = LEGIBILITY_RULES;
    const origin = hexToOklch(cluster.hex);
    const on = (hex, garment) => contrastRatio(seenOn(hex, cluster.alpha, garment), garment);
    const steps = [];
    for (let step = 0; step <= 200; step++) {
        const l = Math.min(1, Math.max(0, origin.l + (direction === "darker" ? -1 : 1) * step * 0.005));
        steps.push(oklchToHex(reduceChroma({ l, c: origin.c, h: origin.h })));
        if (l === (direction === "darker" ? 0 : 1))
            break;
    }
    return (steps.find((hex) => on(hex, garments.median) >= target && on(hex, garments.hardest) >= R.minimumContrast) ??
        steps.find((hex) => on(hex, garments.median) >= target) ??
        // Black or white is the furthest any ink can go; take it if it is at least legible.
        steps.filter((hex) => on(hex, garments.median) >= R.minimumContrast).at(-1) ??
        null);
}
const RECOLOR_KEYS = {
    light: { key: "legible-dark-ink-v1", label: "Dark ink for light garments" },
    dark: { key: "legible-light-ink-v1", label: "Light ink for dark garments" },
};
/**
 * Recolor plans that make the artwork's ink readable on each needed garment family. Each ink
 * under 3:1 on the family's median-luminance garment keeps its OKLCH hue and moves toward dark
 * (for light garments) or light (for dark garments) until it reaches 4.5:1, losing chroma only
 * to stay in sRGB. Inks that already read stay as they are. A plan is dropped when two inks
 * that were distinct would end up closer than 10, since the artwork would lose a color.
 */
export function planLegibleInkOptions(input) {
    const R = LEGIBILITY_RULES;
    const plans = [];
    for (const family of input.families) {
        const members = input.garments
            .filter((g) => garmentFamily(g.hex) === family)
            .sort((a, b) => relativeLuminance(a.hex) - relativeLuminance(b.hex));
        if (!members.length)
            continue;
        const median = members[Math.floor((members.length - 1) / 2)];
        // Dark ink is hardest to read on the darkest light garment, light ink on the lightest dark one.
        const hardest = family === "light" ? members[0] : members[members.length - 1];
        const replacements = [];
        const next = new Map();
        for (const cluster of input.measurement.clusters) {
            if (replacements.length >= 6)
                break;
            if (cluster.share < R.recolorMinimumShare)
                continue;
            if (inkOnGarment(cluster.hex, cluster.alpha, median.hex).ratio >= R.minimumContrast)
                continue;
            const to = towardContrast(cluster, { median: median.hex, hardest: hardest.hex }, family === "light" ? "darker" : "lighter", R.synthesizedContrast);
            if (!to || to === cluster.hex)
                continue;
            next.set(cluster.hex, to);
            replacements.push({
                from: cluster.hex,
                to,
                tolerance: recolorTolerance(cluster, input.measurement, R.recolorMaximumTolerance),
            });
        }
        if (!replacements.length)
            continue;
        const before = input.measurement.clusters.map((c) => c.hex);
        const after = before.map((hex) => next.get(hex) ?? hex);
        const merges = before.some((a, i) => before.some((b, j) => j > i && distance(a, b) >= R.vanishDistance && distance(after[i], after[j]) < R.vanishDistance));
        if (merges)
            continue;
        const medianRatio = (hex, alpha) => contrastRatio(seenOn(hex, alpha, median.hex), median.hex).toFixed(1);
        const plan = {
            ...RECOLOR_KEYS[family],
            rationale: `Measured ink legibility (${LEGIBILITY_PROTOCOL}): ${replacements
                .map((r) => {
                const alpha = input.measurement.clusters.find((c) => c.hex === r.from).alpha;
                return `${r.from} → ${r.to} (${medianRatio(r.from, alpha)}:1 → ${medianRatio(r.to, alpha)}:1)`;
            })
                .join(", ")} on ${median.colorName}, the median ${family} garment. Hue, wording, composition and alpha are unchanged.`.slice(0, 2000),
            replacements,
        };
        plans.push(validateSubstitutionPlan(plan));
    }
    return plans;
}
/**
 * Bind a planner's recolor plan to the measured inks: each `from` moves to the measured ink
 * within 5 of it, so the recolor finds its pigment, and its tolerance stays clear of every
 * other ink. A replacement matching no measured ink is dropped, and so is an empty plan.
 */
export function snapSubstitutionPlan(plan, measurement) {
    const replacements = [];
    for (const replacement of plan.replacements) {
        const nearest = measurement.clusters
            .map((cluster) => ({ cluster, d: distance(replacement.from, cluster.hex) }))
            .sort((a, b) => a.d - b.d)[0];
        if (!nearest || nearest.d > 5)
            continue;
        if (replacements.some((r) => r.from === nearest.cluster.hex))
            continue;
        replacements.push({
            ...replacement,
            from: nearest.cluster.hex,
            tolerance: recolorTolerance(nearest.cluster, measurement, replacement.tolerance),
        });
    }
    return replacements.length ? { ...plan, replacements } : null;
}
/**
 * Pigment substitutions for a from-to color mapping (a `RecolorPlan`'s
 * `mapping`) on a measured design: each `from` binds to the measured ink
 * within 5 of it, with a tolerance reaching just under halfway to the nearest
 * other measured ink (at most 35), so it never reaches another ink's pixels.
 * Mappings that keep their ink are left out unless `keepIdentity` is set.
 * Null when a `from` matches no measured ink, or two map one ink apart.
 */
export function substitutionReplacements(mapping, measurement, options = {}) {
    const R = LEGIBILITY_RULES;
    const replacements = [];
    const bound = new Map();
    for (const m of mapping) {
        const nearest = measurement.clusters
            .map((cluster) => ({ cluster, d: distance(m.from.hex, cluster.hex) }))
            .sort((a, b) => a.d - b.d)[0];
        if (!nearest || nearest.d > 5)
            return null;
        const { cluster } = nearest;
        const to = normalizeHex(m.to.hex);
        const already = bound.get(cluster.hex);
        if (already !== undefined) {
            if (already !== to)
                return null;
            continue;
        }
        bound.set(cluster.hex, to);
        if (to === cluster.hex && !options.keepIdentity)
            continue;
        replacements.push({ from: cluster.hex, to, tolerance: recolorTolerance(cluster, measurement, R.recolorMaximumTolerance) });
    }
    return replacements;
}
function wadaKey(plan) {
    const inks = [...new Set(plan.mapping.map((m) => m.to.index))].sort((a, b) => a - b).join("-");
    const via = plan.combination.source === "book" ? `b${plan.combination.id}` : plan.combination.harmony;
    return `wada-${via}-e${plan.combination.equivalent.index}-i${inks}-v1`;
}
function wadaSource(plan) {
    return plan.combination.source === "book"
        ? `Wada's book combination ${plan.combination.id}`
        : `the ${plan.combination.harmony} harmony of Wada's ${plan.combination.equivalent.name}`;
}
function listNames(names) {
    if (names.length <= 2)
        return names.join(" and ");
    return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}
function wadaRationale(plan, replacements, garments) {
    const swaps = replacements.map((r) => {
        const target = plan.mapping.find((m) => normalizeHex(m.to.hex) === r.to).to;
        return `${r.from} → ${target.name} ${r.to}`;
    });
    return (`Recolor onto ${wadaSource(plan)}, around ${plan.combination.equivalent.name}, keeping the design's lightness order: ` +
        `${swaps.join(", ")}. Planned for ${listNames(garments)}. The composition review confirms the subject still reads.`).slice(0, 2000);
}
/**
 * A Wada recolor plan as pigment substitutions on a measured design, so it
 * can be applied exactly with `substitutePigments`. Null when the plan merges
 * design colors into one ink (the artwork would lose a color), when one of its
 * colors matches no measured ink within 5, or when it changes nothing.
 */
export function toSubstitutionPlan(plan, measurement) {
    if (plan.merged)
        return null;
    const replacements = substitutionReplacements(plan.mapping, measurement);
    if (!replacements || replacements.length === 0 || replacements.length > 6)
        return null;
    const label = plan.combination.source === "book"
        ? `Wada combination ${plan.combination.id} inks`
        : `Wada ${plan.combination.harmony} harmony inks`;
    return validateSubstitutionPlan({
        key: wadaKey(plan),
        label,
        rationale: wadaRationale(plan, replacements, [plan.color.name]),
        replacements,
    });
}
/**
 * How a recolored design reads on a garment: the mapping's pigments
 * substituted in the measured pixels (`substitutionReplacements`, merges
 * allowed), measured again, and judged. The verdict's `bytesChecksum` is the
 * original's with `:recolor` appended, since no file holds these pixels.
 * Null when the mapping cannot be substituted exactly.
 */
export function judgeRecolor(input) {
    const replacements = substitutionReplacements(input.mapping, input.measurement);
    if (!replacements)
        return null;
    let measurement = input.measurement;
    if (replacements.length) {
        let substituted;
        try {
            substituted = substitutePigments(input.pixels, { replacements });
        }
        catch (error) {
            if (error instanceof RecolorPigmentError)
                return null;
            throw error;
        }
        measurement = measureInkPixels(substituted.pixels, `${input.measurement.bytesChecksum}:recolor`);
    }
    return judgeLegibility(measurement, input.garment);
}
export const ARTWORK_OPTION_DEFAULTS = { maxPalettePlans: 3, maxCandidates: 12 };
/**
 * Plan Artwork Options for the garment families that need another ink. The
 * candidates are the legible-ink plan for each needed family, then the
 * distinct Wada mappings of the best unflagged recolor plans for the
 * garments the design does not read on. Each is applied to the measured
 * pixels with `substitutePigments`, measured, and judged on every garment;
 * one that adds no legible garment color is dropped. Every legible-ink option
 * that adds a color is kept, since it changes only the faint inks' lightness.
 * Wada options, which repaint the design, follow as a greedy cover of what is
 * still missing: each next one adds the most garment colors not yet covered
 * (the better recolor plan on ties), at most `maxPalettePlans` of them.
 * Deterministic: the same input gives the same plans and keys.
 */
export function planArtworkOptions(input) {
    if (input.needs.length === 0)
        return [];
    const maxPalettePlans = input.maxPalettePlans ?? ARTWORK_OPTION_DEFAULTS.maxPalettePlans;
    const maxCandidates = input.maxCandidates ?? ARTWORK_OPTION_DEFAULTS.maxCandidates;
    const { measurement, summary } = input.analysis;
    const garments = input.garments.map((g) => ({ input: g, color: garmentColor(g) }));
    const judged = garments.map(({ color }) => ({ colorName: color.name, hex: color.hex }));
    const candidates = planLegibleInkOptions({
        measurement,
        garments: judged,
        families: input.needs,
    }).map((plan) => ({ plan, source: "legible-ink" }));
    const targets = garments.filter(({ color }) => !input.legibleColors.has(color.name) && input.needs.includes(garmentFamily(color.hex)));
    if (targets.length && summary.palette.length) {
        const plans = recolorPlansFor(summary, targets.map(({ color }) => color), { n: targets.length, ...(input.product !== undefined && { product: input.product }) });
        const groups = new Map();
        for (const plan of plans) {
            if (plan.flagged || plan.merged)
                continue;
            const replacements = substitutionReplacements(plan.mapping, measurement);
            if (!replacements || replacements.length === 0 || replacements.length > 6)
                continue;
            const signature = replacements.map((r) => `${r.from}>${r.to}`).join(",");
            const group = groups.get(signature);
            if (group)
                group.garments.push(plan.color.name);
            else if (groups.size < maxCandidates)
                groups.set(signature, { plan, replacements, garments: [plan.color.name] });
        }
        const keys = new Set(candidates.map((c) => c.plan.key));
        for (const { plan, replacements, garments: planned } of groups.values()) {
            let key = wadaKey(plan);
            for (let n = 2; keys.has(key); n++)
                key = `${wadaKey(plan).slice(0, -3)}-${n}-v1`;
            keys.add(key);
            candidates.push({
                source: "wada",
                plan: validateSubstitutionPlan({
                    key,
                    label: plan.combination.source === "book"
                        ? `Wada combination ${plan.combination.id} inks`
                        : `Wada ${plan.combination.harmony} harmony inks`,
                    rationale: wadaRationale(plan, replacements, planned),
                    replacements,
                }),
            });
        }
    }
    const screened = [];
    for (const candidate of candidates) {
        let substituted;
        try {
            substituted = substitutePigments(input.pixels, candidate.plan);
        }
        catch (error) {
            if (error instanceof RecolorPigmentError)
                continue;
            throw error;
        }
        const after = measureInkPixels(substituted.pixels, `${measurement.bytesChecksum}:${candidate.plan.key}`);
        const adds = judged
            .filter((g) => !input.legibleColors.has(g.colorName) && judgeLegibility(after, g).pass)
            .map((g) => g.colorName);
        const addsColors = [...new Set(adds)];
        if (addsColors.length)
            screened.push({ plan: candidate.plan, source: candidate.source, addsColors });
    }
    // Legible-ink options change only the faint inks' lightness, so each that adds a color stays.
    const chosen = screened.filter((option) => option.source === "legible-ink");
    const covered = new Set(input.legibleColors);
    for (const option of chosen)
        for (const name of option.addsColors)
            covered.add(name);
    // Wada options repaint the design, so only as many as cover what is still missing.
    const wada = screened.filter((option) => option.source === "wada");
    for (let picked = 0; picked < maxPalettePlans; picked++) {
        let best;
        let bestGain = 0;
        for (const option of wada) {
            if (chosen.includes(option))
                continue;
            const gain = option.addsColors.filter((name) => !covered.has(name)).length;
            if (gain > bestGain) {
                best = option;
                bestGain = gain;
            }
        }
        if (!best)
            break;
        chosen.push(best);
        for (const name of best.addsColors)
            covered.add(name);
    }
    return chosen;
}
//# sourceMappingURL=plans.js.map