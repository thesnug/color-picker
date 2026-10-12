/**
 * Garment ranking for a measured design. The `ink-legibility-v2` verdict is
 * the hard gate: garments the design passes on rank first. Within each group
 * the recommendation score ranks, with its vanish penalty counting only the
 * ink the verdict calls lost, so a pale fill inside a dark outline costs
 * nothing on a pale garment. See docs/DESIGN.md, "Print legibility".
 */
import { diversityCounts, withDiversityPenalty } from "../batch.js";
import { storedProductIndex } from "../data/store.js";
import { RECOMMEND_WEIGHTS, scoreComponents, scoreGarments, } from "../recommend.js";
import { garmentColor } from "./garments.js";
import { judgeLegibility } from "./legibility.js";
import { LEGIBILITY_RULES } from "./rules.js";
const percent = (share) => `${Math.round(share * 100)}%`;
function lostWarning(ink, garment) {
    return ink.ratio < LEGIBILITY_RULES.minimumContrast
        ? `${ink.hex}, ${percent(ink.share)} of the ink, is ${ink.ratio.toFixed(2)}:1 on ${garment}, under 3:1, and no legible ink frames it; it will not read on the shirt.`
        : `${ink.hex}, ${percent(ink.share)} of the ink, is only ${ink.distance.toFixed(0)} from ${garment}, under the print minimum of 10, and no legible ink frames it; it will vanish into the shirt.`;
}
/** Every garment, in input order, judged and scored. */
function judgeAndScore(analysis, garments, options) {
    const weights = options.weights ?? RECOMMEND_WEIGHTS;
    const colors = garments.map(garmentColor);
    const base = scoreGarments(analysis.summary, colors, {
        product: options.product ?? storedProductIndex().default,
        weights,
        ...(options.rules && { rules: options.rules }),
    });
    return base.map((pick, i) => {
        const color = colors[i];
        const legibility = judgeLegibility(analysis.measurement, { colorName: color.name, hex: color.hex });
        const components = { ...pick.components, vanish: legibility.lostShare };
        const ranked = {
            garment: {
                colorName: color.name,
                hex: color.hex,
                slug: color.slug,
                ...(color.family !== undefined && { family: color.family }),
            },
            score: scoreComponents(components, weights),
            components,
            vanishBasis: "lost-ink",
            designColors: pick.designColors,
            wada: pick.wada,
            legibility,
            reasons: [legibility.reason, ...pick.reasons],
            warnings: legibility.inks.filter((ink) => ink.lost).map((ink) => lostWarning(ink, color.name)),
        };
        if (pick.sharedCombination !== undefined)
            ranked.sharedCombination = pick.sharedCombination;
        return ranked;
    });
}
/**
 * Rank garment colors for a measured design: garments the design passes the
 * legibility verdict on first, then by score, then in input order. The score
 * is the recommendation score with the vanish penalty taken from the verdict:
 * only ink the verdict calls lost counts.
 *
 * @throws {RangeError} when the design has no visible ink, or `n` is not a positive integer.
 * @throws {Error} when the product ID is unknown.
 */
export function rankGarments(analysis, garments, options = {}) {
    const n = options.n ?? garments.length;
    if (options.n !== undefined && !(Number.isInteger(n) && n > 0)) {
        throw new RangeError(`n must be a positive integer, got ${n}`);
    }
    return judgeAndScore(analysis, garments, options)
        .map((ranked, i) => ({ ranked, i }))
        .sort((a, b) => Number(b.ranked.legibility.pass) - Number(a.ranked.legibility.pass) ||
        b.ranked.score - a.ranked.score ||
        a.i - b.i)
        .slice(0, n)
        .map(({ ranked }) => ranked);
}
/** Least departure first: the original, then hue-keeping options, then Wada repaints. */
const DEPARTURE = { original: 0, "legible-ink": 1, wada: 2 };
const words = (counts) => [
    counts.exact ? `${counts.exact} exact repeat${counts.exact === 1 ? "" : "s"}` : "",
    counts.near ? `${counts.near} near shade${counts.near === 1 ? "" : "s"}` : "",
    counts.family ? `${counts.family} of the same family` : "",
]
    .filter(Boolean)
    .join(", ");
/**
 * Order artwork and garment pairs for inspection. Only pairs that pass the
 * legibility verdict appear.
 *
 * Each color leads with the artwork that departs least from the approved art
 * and reads on it: the original, else a hue-keeping (`legible-ink`) option,
 * else a Wada repaint; score, then least ink lost, then input order break
 * ties within a source. So a Wada repaint leads only on colors no
 * hue-keeping artwork reads on, however well it scores elsewhere.
 *
 * Colors follow in the same order of departure: first every color the
 * original reads on, then the colors only a hue-keeping option reads on,
 * then the colors only a Wada repaint reads on. An Artwork Option fills what
 * the approved art cannot, so it never pushes the original out of the first
 * picks, however well it scores. Within each band colors are chosen greedily
 * by their lead's score less the batch variety penalty against recent use
 * and the colors already chosen, so near shades fall later; `preferred` leads
 * when any artwork reads on it. Then the other legible artworks for each
 * color, in the same color order.
 *
 * @throws {RangeError} when `colorCount` is not a positive integer.
 */
export function rankArtworkGarmentPairs(input) {
    if (!(Number.isInteger(input.colorCount) && input.colorCount > 0)) {
        throw new RangeError(`colorCount must be a positive integer, got ${input.colorCount}`);
    }
    const product = input.product ?? storedProductIndex().default;
    const options = { product, ...(input.weights && { weights: input.weights }) };
    const byColor = new Map();
    const colorOrder = [];
    for (const garment of input.garments) {
        if (!colorOrder.includes(garment.colorName))
            colorOrder.push(garment.colorName);
    }
    input.artworks.forEach((artwork, order) => {
        if (!(artwork.source in DEPARTURE))
            throw new TypeError(`Unknown artwork source ${JSON.stringify(artwork.source)}`);
        if (artwork.analysis.summary.palette.length === 0)
            return;
        judgeAndScore(artwork.analysis, input.garments, options).forEach((ranked) => {
            if (!ranked.legibility.pass)
                return;
            const list = byColor.get(ranked.garment.colorName) ?? [];
            list.push({ artworkId: artwork.artworkId, source: artwork.source, order, ranked });
            byColor.set(ranked.garment.colorName, list);
        });
    });
    for (const list of byColor.values()) {
        list.sort((a, b) => DEPARTURE[a.source] - DEPARTURE[b.source] ||
            b.ranked.score - a.ranked.score ||
            a.ranked.legibility.lostShare - b.ranked.legibility.lostShare ||
            a.order - b.order);
    }
    const remaining = colorOrder.filter((name) => byColor.has(name));
    const lead = (name) => byColor.get(name)[0];
    /** How far the color's lead departs from the approved art: 0 the original, 1 hue-keeping, 2 Wada. */
    const band = (name) => DEPARTURE[lead(name).source];
    const history = (input.recent ?? []).filter((u) => u.product === product);
    const use = (entry) => ({
        product,
        slug: entry.ranked.garment.slug,
        name: entry.ranked.garment.colorName,
        hex: entry.ranked.garment.hex,
    });
    const color = (entry) => ({
        slug: entry.ranked.garment.slug,
        name: entry.ranked.garment.colorName,
        hex: entry.ranked.garment.hex,
    });
    const pairs = [];
    const chosen = [];
    const pair = (entry, reason) => ({
        artworkId: entry.artworkId,
        source: entry.source,
        colorName: entry.ranked.garment.colorName,
        score: entry.ranked.score,
        legibility: entry.ranked.legibility,
        reason: reason.slice(0, 2000),
    });
    const artworkWords = (entry) => entry.source === "original"
        ? `the original artwork ${entry.artworkId}`
        : entry.source === "legible-ink"
            ? `artwork ${entry.artworkId}, which keeps the design's hues, since the original does not read on it`
            : `artwork ${entry.artworkId}, a Wada repaint, since no artwork keeping the design's hues reads on it`;
    while (remaining.length) {
        let pick = 0;
        if (!(chosen.length === 0 && input.preferred !== undefined && remaining.includes(input.preferred))) {
            const firstBand = Math.min(...remaining.map(band));
            let best = -Infinity;
            remaining.forEach((name, i) => {
                if (band(name) !== firstBand)
                    return;
                const adjusted = withDiversityPenalty(lead(name).ranked.score, color(lead(name)), history);
                if (adjusted > best) {
                    best = adjusted;
                    pick = i;
                }
            });
        }
        else {
            pick = remaining.indexOf(input.preferred);
        }
        const name = remaining.splice(pick, 1)[0];
        const entry = lead(name);
        const counts = diversityCounts(color(entry), history);
        const variety = words(counts);
        const place = chosen.length < input.colorCount
            ? `Pick ${chosen.length + 1} of ${input.colorCount}`
            : `Fallback ${chosen.length + 1 - input.colorCount}`;
        const preferred = chosen.length === 0 && name === input.preferred ? " (the preferred color)" : "";
        pairs.push(pair(entry, `${place}${preferred}: ${name} with ${artworkWords(entry)}, score ${entry.ranked.score}. ` +
            `${entry.ranked.legibility.reason}` +
            (variety ? ` Variety penalty for ${variety} already chosen or recent.` : "")));
        chosen.push(name);
        history.push(use(entry));
    }
    for (const name of chosen) {
        for (const entry of byColor.get(name).slice(1)) {
            pairs.push(pair(entry, `Alternate artwork for ${name}: ${entry.artworkId} (${entry.source}), score ${entry.ranked.score}. ${entry.ranked.legibility.reason}`));
        }
    }
    return pairs;
}
//# sourceMappingURL=rank.js.map