/**
 * Recolor plausibility: ask Jev whether each swap in a recolor plan keeps the
 * design reading as the same subject, so a plan never turns a strawberry blue.
 * See docs/DESIGN.md, "Jev (TypeSafe System One)".
 *
 * The state is the design's vision description: its subject, mood, and named
 * elements with their colors in words. Each changed mapping entry is one Noul
 * question in the plan's request. A swap without a named element is asked
 * about the design as a whole.
 */
import { colorFamily } from "../color/family.js";
import { distance } from "../color/convert.js";
import { RECOLOR_PLAN_DEFAULTS, recolorPlans, } from "../recolor.js";
import { lightnessWord } from "./describe.js";
import { ask, JevUnavailableError, } from "./index.js";
/** Bump when the question's wording, state, or meaning changes, to invalidate cached answers. */
export const VET_RECOLOR_VERSION = 1;
/**
 * A plan whose least plausible swap scores below this is implausible. Jev's
 * Noul answers for swaps run high (0.49 to 0.93 on the labeled set), so the
 * cutoff sits high too: the most accurate on the labeled swaps, from
 * docs/evaluations/2026-09-24.md (INT-2273). A wrongly dropped plan costs a
 * garment slot; a wrongly kept one ships a blue pumpkin.
 */
export const PLAUSIBILITY_THRESHOLD = 0.8;
/**
 * Below this `distance()` a swap is not a change (the prompt says "keep"), so
 * it is not asked about and counts as fully plausible. Matches `recolorPrompt`.
 */
export const UNCHANGED_DISTANCE = 2;
/**
 * Judge each swap of each plan with Jev and mark implausible plans. Plans keep
 * their order; nothing is dropped here (see `vettedRecolorPlans`).
 *
 * One request per plan, sent concurrently, each cached through `ask`: the key
 * covers the description (itself keyed on the design file's hash) and every
 * swap, so a mapping seen before for the same design costs nothing.
 *
 * Without Jev (no SDK or `TYPESAFE_API_KEY` on a cache miss) or without a
 * vision description, plans pass with `plausibility: null` and `skipped` says why.
 *
 * @throws the SDK's API errors when a request fails after its retries.
 */
export async function vetRecolorPlans(plans, design, options = {}) {
    const threshold = options.threshold ?? PLAUSIBILITY_THRESHOLD;
    const description = design.description;
    if (!description) {
        return {
            plans: plans.map(unvetted),
            vetted: 0,
            skipped: {
                reason: "no-description",
                note: "The design has no vision description, so swaps were not vetted; describe the design first.",
            },
        };
    }
    const state = vetState(description);
    const askOptions = { version: VET_RECOLOR_VERSION };
    if (options.cache !== undefined)
        askOptions.cache = options.cache;
    if (options.model !== undefined)
        askOptions.model = options.model;
    if (options.client !== undefined)
        askOptions.client = options.client;
    if (options.signal !== undefined)
        askOptions.signal = options.signal;
    let skipped;
    let model;
    const results = await Promise.all(plans.map(async (plan) => {
        const questions = vetQuestions(plan.mapping, description);
        if (Object.keys(questions).length === 0)
            return judged(plan, plan.mapping.map(() => 1), threshold);
        try {
            const { answers, model: answeredBy } = await ask(state, questions, askOptions);
            model ??= answeredBy;
            const yes = plan.mapping.map((_, i) => {
                const answer = answers[questionName(i)];
                return answer ? answer.noul : 1;
            });
            return judged(plan, yes, threshold);
        }
        catch (error) {
            if (!(error instanceof JevUnavailableError))
                throw error;
            skipped ??= { reason: error.reason, note: `Swaps were not vetted: ${error.message}` };
            return unvetted(plan);
        }
    }));
    const result = { plans: results, vetted: results.filter((p) => p.plausibility !== null).length };
    if (skipped)
        result.skipped = skipped;
    if (model !== undefined)
        result.model = model;
    return result;
}
/**
 * `recolorPlans` with vetting: the best `n` garments whose plans are plausible.
 * Garments are vetted in rank order, `n` at a time, and an implausible plan's
 * place goes to the next garment, so dropping does not shorten the list while
 * plausible plans remain. With `includeImplausible`, the top `n` are returned
 * as ranked, each marked.
 *
 * @throws as `recolorPlans` and `vetRecolorPlans` do.
 */
export async function vettedRecolorPlans(design, options = {}) {
    const n = options.n ?? RECOLOR_PLAN_DEFAULTS.n;
    if (!(Number.isInteger(n) && n > 0))
        throw new RangeError(`n must be a positive integer, got ${n}`);
    // Every garment's best plan, ranked; recolorPlans scores them all either way.
    const ranked = recolorPlans(design, { ...options, n: Number.MAX_SAFE_INTEGER });
    if (options.includeImplausible) {
        return { ...(await vetRecolorPlans(ranked.slice(0, n), design, options)), dropped: [] };
    }
    const kept = [];
    const dropped = [];
    let vetted = 0;
    let skipped;
    let model;
    for (let start = 0; start < ranked.length && kept.length < n; start += n) {
        const batch = await vetRecolorPlans(ranked.slice(start, start + n), design, options);
        vetted += batch.vetted;
        skipped ??= batch.skipped;
        model ??= batch.model;
        for (const plan of batch.plans) {
            if (plan.implausible)
                dropped.push(plan);
            else if (kept.length < n)
                kept.push(plan);
        }
    }
    const result = { plans: kept, vetted, dropped };
    if (skipped)
        result.skipped = skipped;
    if (model !== undefined)
        result.model = model;
    return result;
}
// ---------------------------------------------------------------------------
// Questions
/**
 * The request state: what the design depicts, and each named element with its
 * color in words. Hexes are left out; Jev judges from words.
 */
export function vetState(description) {
    return {
        subject: description.subject,
        mood: description.mood,
        elements: description.elements.map((e) => ({ name: e.name, color: e.color })),
    };
}
const questionName = (index) => `swap_${index}`;
/** Whether a mapping entry changes its color enough to ask about. */
export function isChange(entry) {
    return distance(entry.from.hex, entry.to.hex) >= UNCHANGED_DISTANCE;
}
/**
 * One Noul question per changed mapping entry, named `swap_<index>` for the
 * entry's position in the mapping. Exported so the questions can be audited.
 */
export function vetQuestions(mapping, description) {
    const questions = {};
    mapping.forEach((entry, i) => {
        if (!isChange(entry))
            return;
        questions[questionName(i)] = {
            type: "noul",
            instructions: swapQuestion(entry, description),
            criteria: {
                true: "The subject is still recognizable, and its new color is natural for it or reads as a deliberate stylization.",
                false: "The new color makes the subject look wrong, spoiled, or like something else.",
            },
        };
    });
    return questions;
}
/** The question for one swap, in the wording the issue fixes. */
export function swapQuestion(entry, description) {
    const to = `${entry.to.name} (${colorFamily(entry.to.hex, entry.to.name)}, ${lightnessWord(entry.to.hex)})`;
    const tail = "does the design still read as the same subject with a natural or intentionally stylized color?";
    const from = fromWords(entry, description);
    if (entry.from.element)
        return `If the ${entry.from.element} changes from ${from} to ${to}, ${tail}`;
    const share = Math.round(entry.from.share * 100);
    return `If the ${from} areas (${share}% of the design) change to ${to}, ${tail.replace("the design", "the design as a whole")}`;
}
/** The from color in words: the description's words for the elements it paints, else lightness and family. */
function fromWords(entry, description) {
    const hex = entry.from.hex.toLowerCase();
    const words = [...new Set(description.elements.filter((e) => e.hex === hex).map((e) => e.color))];
    if (words.length)
        return words.join(" and ");
    return `${lightnessWord(hex)} ${colorFamily(hex)}`;
}
// ---------------------------------------------------------------------------
// Results
const fmt = (p) => p.toFixed(2);
function unvetted(plan) {
    return { ...plan, mapping: plan.mapping.map((m) => ({ ...m, plausibility: null })), plausibility: null, implausible: false };
}
function judged(plan, yes, threshold) {
    const mapping = plan.mapping.map((m, i) => ({ ...m, plausibility: yes[i] }));
    const plausibility = mapping.reduce((min, m) => Math.min(min, m.plausibility), 1);
    const implausible = plausibility < threshold;
    const reasons = [...plan.reasons];
    if (implausible) {
        for (const m of mapping.filter((m) => m.plausibility < threshold)) {
            const subject = m.from.element ? `the ${m.from.element}` : `the ${m.from.hex} areas`;
            reasons.push(`Implausible: ${subject} as ${m.to.name} ${m.to.hex} may not read as the same subject ` +
                `(plausibility ${fmt(m.plausibility)}, below ${threshold}).`);
        }
    }
    return { ...plan, mapping, plausibility, implausible, reasons };
}
//# sourceMappingURL=vet.js.map