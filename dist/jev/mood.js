/**
 * Mood re-rank: deterministic scoring gets a shortlist right on contrast; Jev
 * decides which of the shortlist suits the design's subject and mood. See
 * docs/DESIGN.md, "Jev (TypeSafe System One)".
 *
 * One request per shortlist: the state is the design's vision description and
 * palette, with one Score question per candidate (fan-out). Jev's scores are
 * combined with the shortlist order in code, so changing the weight never
 * calls Jev again.
 */
import { colorFamily } from "../color/family.js";
import { lightnessWord } from "./describe.js";
import { ask, JevUnavailableError } from "./index.js";
/** Bump when the question's wording, levels, or state layout changes, to invalidate cached answers. */
export const MOOD_VERSION = 1;
/** How many of the deterministic candidates go to Jev by default. */
export const MOOD_TOP = 10;
/**
 * How much the mood score counts in `combinedScore`, from 0 (shortlist order
 * only) to 1 (mood only). Unchanged by the first threshold evaluation
 * (docs/evaluations/2026-09-24.md, INT-2273): the measured direction favors a
 * higher weight, but on draft garment picks that Jill has not yet reviewed.
 */
export const MOOD_WEIGHT = 0.4;
/** The Score levels, lowest first. `moodLevel` is the one nearest Jev's expected score. */
export const MOOD_LEVELS = ["clashes", "neutral", "complements", "elevates"];
/**
 * Each level as Jev reads it. Every level is judged on its own, so each
 * describes a situation rather than a degree.
 */
const LEVEL_DESCRIPTIONS = [
    "Clashes: the colors work against what the design depicts or the feeling it gives, so the pairing looks wrong, jarring, or off-message.",
    "Neutral: the colors neither help nor hurt; they are a plain backdrop with no particular connection to the design's subject or mood.",
    "Complements: the colors suit the design's subject and mood, and the design looks at home with them.",
    "Elevates: the colors strengthen the design's subject and mood, so it looks more striking and more itself than it would with plainer colors.",
];
/** Legibility is scored deterministically; Jev judges fit only. */
const JUDGE_NOTE = "Judge only how the colors fit what the design depicts and the feeling it gives. " +
    "Legibility and contrast are measured separately; ignore them.";
/**
 * Re-rank the leading candidates (garment recommendations or palettes, in
 * their deterministic order) by how well each suits the design's subject and
 * mood, with one Score question per candidate in a single cached request.
 *
 * Never fails for want of Jev: without a vision description, or when Jev is
 * unavailable and the answer is not cached, it returns the deterministic
 * order with `moodScore: null` and a `note` saying why.
 *
 * @throws {RangeError} for a `top` that is not a positive integer or a `weight` outside 0 to 1.
 * @throws the SDK's `APIError` or `APIConnectionError` when the request fails after its retries.
 */
export async function rerankByMood(candidates, design, options = {}) {
    const top = options.top ?? MOOD_TOP;
    const weight = options.weight ?? MOOD_WEIGHT;
    if (!(Number.isInteger(top) && top > 0))
        throw new RangeError(`top must be a positive integer, got ${top}`);
    checkWeight(weight);
    const shortlist = candidates.slice(0, top);
    const rest = candidates.slice(top);
    const deterministic = (note) => ({
        candidates: [
            ...shortlist.map((c, i) => withMood(c, shortlistScore(i, shortlist.length), null, weight)),
            ...rest.map((c) => withMood(c, null, null, weight)),
        ],
        applied: false,
        weight,
        note,
    });
    if (shortlist.length === 0)
        return deterministic("There were no candidates to re-rank.");
    if (!design.description) {
        return deterministic("Mood re-ranking needs a vision description of the design (describeDesign), so the order is the deterministic one.");
    }
    const state = moodState(design);
    const questions = moodQuestions(shortlist);
    const askOptions = { version: MOOD_VERSION };
    if (options.cache !== undefined)
        askOptions.cache = options.cache;
    if (options.model !== undefined)
        askOptions.model = options.model;
    if (options.client !== undefined)
        askOptions.client = options.client;
    if (options.signal !== undefined)
        askOptions.signal = options.signal;
    let result;
    try {
        result = await ask(state, questions, askOptions);
    }
    catch (error) {
        if (error instanceof JevUnavailableError) {
            return deterministic(`${error.message} The order is the deterministic one.`);
        }
        throw error;
    }
    const ranked = shortlist.map((c, i) => {
        const answer = result.answers[moodCandidateId(c)];
        return withMood(c, shortlistScore(i, shortlist.length), answer ?? null, weight);
    });
    return {
        candidates: [...combineMood(ranked, weight), ...rest.map((c) => withMood(c, null, null, weight))],
        applied: true,
        weight,
        model: result.model,
        cached: result.cached,
    };
}
/**
 * Recombine re-ranked candidates with another weight and sort them again,
 * without calling Jev. Candidates outside the shortlist stay last, in order.
 *
 * @throws {RangeError} for a `weight` outside 0 to 1.
 */
export function combineMood(candidates, weight = MOOD_WEIGHT) {
    checkWeight(weight);
    const scored = candidates.map((c) => ({ ...c, combinedScore: combine(c.deterministicScore, c.moodScore, weight) }));
    const shortlist = scored.filter((c) => c.combinedScore !== null);
    const rest = scored.filter((c) => c.combinedScore === null);
    // Array sort is stable; ties fall back to the shortlist order.
    shortlist.sort((a, b) => b.combinedScore - a.combinedScore || (b.deterministicScore ?? 0) - (a.deterministicScore ?? 0));
    return [...shortlist, ...rest];
}
/**
 * The question name for a candidate: its garment slug, plus the combination
 * or harmony for a palette. Names do not depend on order, so the same
 * shortlist in another order hits the same cached answers.
 */
export function moodCandidateId(candidate) {
    if (!isPalette(candidate))
        return `garment:${candidate.color.slug}`;
    const garment = candidate.colors[0].slug;
    if (candidate.source === "book")
        return `palette:${garment}:book-${candidate.combination.id}`;
    const inks = candidate.colors
        .slice(1)
        .map((c) => c.index)
        .join("-");
    return `palette:${garment}:${candidate.harmony}-${inks}`;
}
/** The state Jev reads: the design's description and palette. Exported so it can be inspected and audited. */
export function moodState(design) {
    const description = design.description;
    if (!description)
        throw new TypeError("moodState needs a design with a vision description.");
    return {
        design: {
            subject: description.subject,
            mood: description.mood,
            elements: description.elements.map((e) => ({ name: e.name, color: e.color })),
        },
        palette: design.palette.map((c) => ({
            hex: c.hex,
            coverage: `${Math.round(c.share * 100)}%`,
            family: colorFamily(c.hex),
            lightness: lightnessWord(c.hex),
            ...(c.element !== undefined && { paints: c.element }),
        })),
    };
}
/** One Score question per candidate, named by `moodCandidateId`. Exported so the questions can be inspected. */
export function moodQuestions(candidates) {
    const questions = {};
    for (const candidate of candidates) {
        const id = moodCandidateId(candidate);
        if (questions[id])
            throw new Error(`Two candidates share the question name ${JSON.stringify(id)}.`);
        questions[id] = { type: "score", instructions: instructionsFor(candidate), criteria: LEVEL_DESCRIPTIONS };
    }
    return questions;
}
// ---------------------------------------------------------------------------
function isPalette(candidate) {
    return "source" in candidate && "colors" in candidate;
}
function instructionsFor(candidate) {
    if (!isPalette(candidate)) {
        const { name, hex, family } = candidate.color;
        return {
            question: "How well does this garment color suit the design's subject and mood?",
            garment: { name, hex, family, lightness: lightnessWord(hex) },
            note: `The design is printed as is on a shirt of this color. ${JUDGE_NOTE}`,
        };
    }
    const [garment, ...inks] = candidate.colors;
    return {
        question: "How well do these ink colors, printed on this garment, suit the design's subject and mood?",
        garment: { name: garment.name, hex: garment.hex, family: colorFamily(garment.hex), lightness: lightnessWord(garment.hex) },
        inks: inks.map((c) => ({ name: c.name, hex: c.hex, family: colorFamily(c.hex, c.name), lightness: lightnessWord(c.hex) })),
        note: `The design's colors would be redrawn in these inks on this garment. ${JUDGE_NOTE}`,
    };
}
function withMood(candidate, deterministicScore, answer, weight) {
    const top = MOOD_LEVELS.length - 1;
    const moodScore = answer ? round(answer.score / top) : null;
    return {
        ...candidate,
        moodScore,
        confidence: answer ? round(answer.confidence) : null,
        moodLevel: answer ? MOOD_LEVELS[Math.min(top, Math.max(0, Math.round(answer.score)))] : null,
        deterministicScore,
        combinedScore: combine(deterministicScore, moodScore, weight),
    };
}
function combine(deterministic, mood, weight) {
    if (deterministic === null)
        return null;
    if (mood === null)
        return deterministic;
    return round((1 - weight) * deterministic + weight * mood);
}
/** Place in the shortlist as 0 to 1, first highest. */
function shortlistScore(index, length) {
    return length === 1 ? 1 : round(1 - index / (length - 1));
}
function checkWeight(weight) {
    if (!(weight >= 0 && weight <= 1))
        throw new RangeError(`weight must be from 0 to 1, got ${weight}`);
}
function round(value) {
    return Number(value.toFixed(3));
}
//# sourceMappingURL=mood.js.map