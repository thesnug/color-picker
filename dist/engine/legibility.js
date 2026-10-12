/**
 * Ink legibility (`ink-legibility-v2`): can the ink of a print file be read on
 * a garment color? A deterministic measurement, not a model's opinion.
 *
 * On a garment, an ink is legible when, laid over the garment at its median
 * alpha, it reaches WCAG 2.2's 3:1 for large-scale text and graphics and sits
 * at least 10 apart in OKLab (the print minimum distance).
 *
 * Faint ink is not lost when legible ink draws its boundary: the fill inside an
 * outline, or a cream highlight inside dark linework, keeps its shape. Only the
 * ink's own boundary counts. Legible marks the faint ink fully encloses (texture
 * speckles, lettering on a panel, a face's eyes) sit inside its shape and draw
 * none of it. Boundary shared with another faint ink is as framed as that ink
 * is, so a faint fill inside a faint outline is lost with its outline. The pair
 * passes when less than a fifth of the ink is lost and at least a fifth of it
 * reads on its own.
 *
 * Ported unchanged from POD's `lib/ink-legibility.ts`, which now re-exports it.
 */
import { contrastRatio, relativeLuminance } from "../color/contrast.js";
import { distance, hexToRgb, linearToRgb, rgbToLinear } from "../color/convert.js";
import { LEGIBILITY_PROTOCOL, LEGIBILITY_RULES } from "./rules.js";
const round = (value, places) => Number(value.toFixed(places));
const percent = (share) => `${Math.round(share * 100)}%`;
/** The ink as it reads on the garment: laid over it at `alpha`, in linear light. */
export function seenOn(inkHex, alpha, garmentHex) {
    const ink = rgbToLinear(hexToRgb(inkHex));
    const garment = rgbToLinear(hexToRgb(garmentHex));
    const mix = (i) => alpha * ink[i] + (1 - alpha) * garment[i];
    const mixed = [mix(0), mix(1), mix(2)];
    return linearToRgb(mixed);
}
/**
 * How an ink reads on a garment, laid over it at `alpha` (1 for opaque ink):
 * legible at 3:1 or better and at least the print minimum distance apart.
 */
export function inkOnGarment(inkHex, alpha, garmentHex) {
    const seen = seenOn(inkHex, alpha, garmentHex);
    const ratio = round(contrastRatio(seen, garmentHex), 2);
    const separation = round(distance(seen, garmentHex), 1);
    return {
        ratio,
        distance: separation,
        vanishes: separation < LEGIBILITY_RULES.vanishDistance,
        legible: ratio >= LEGIBILITY_RULES.minimumContrast && separation >= LEGIBILITY_RULES.vanishDistance,
    };
}
/** Judge one measured print file on one garment color. */
export function judgeLegibility(measurement, garment) {
    const R = LEGIBILITY_RULES;
    const judged = measurement.clusters.map((cluster) => ({
        cluster,
        ...inkOnGarment(cluster.hex, cluster.alpha, garment.hex),
    }));
    const framings = faintFraming(measurement, judged.map((ink) => ink.legible));
    const inks = judged.map((ink, c) => {
        const framing = ink.legible ? null : framings[c];
        const framed = !ink.legible && !measurement.approximate && framing !== null && framing >= R.framedEdgeShare;
        return {
            hex: ink.cluster.hex,
            share: ink.cluster.share,
            ratio: ink.ratio,
            distance: ink.distance,
            vanishes: ink.vanishes,
            legible: ink.legible,
            framing: framing === null ? null : round(framing, 3),
            lost: !ink.legible && !framed,
        };
    });
    const sum = (pick) => round(inks.reduce((total, ink) => total + (pick(ink) ? ink.share : 0), 0), 4);
    const legibleShare = sum((ink) => ink.legible);
    const lostShare = sum((ink) => ink.lost);
    const framedShare = sum((ink) => !ink.legible && !ink.lost);
    const pass = inks.length > 0 && lostShare < R.maximumLostShare && legibleShare >= R.minimumLegibleShare;
    return {
        protocol: LEGIBILITY_PROTOCOL,
        colorName: garment.colorName,
        garmentHex: garment.hex.toLowerCase(),
        bytesChecksum: measurement.bytesChecksum,
        pass,
        legibleShare,
        framedShare,
        lostShare,
        inks,
        reason: legibilityReason(inks, garment.colorName, {
            pass,
            legibleShare,
            framedShare,
            lostShare,
        }),
    };
}
/**
 * How much of each faint ink's own boundary legible ink draws (null for legible ink, and 0 for
 * a faint ink with no boundary at all, such as a full-bleed panel).
 *
 * A faint ink's boundary runs along legible ink (framed), transparency (the bare garment), and
 * other faint inks. Marks it alone surrounds are inside its shape and left out. Boundary with
 * another faint ink is as framed as that ink is: a random walk across the boundary, absorbed
 * by legible ink (1) or the garment (0). So a faint fill inside a faint outline is framed only
 * as far as its outline is, and faint inks that border only each other are lost.
 */
function faintFraming(measurement, legible) {
    const n = measurement.clusters.length;
    const open = (a, b) => measurement.edges[a][b] - measurement.enclosedEdges[a][b];
    const faint = [...Array(n).keys()].filter((c) => !legible[c]);
    const toLegible = new Map();
    const total = new Map();
    for (const c of faint) {
        let framed = 0;
        let boundary = measurement.edges[c][n];
        for (let j = 0; j < n; j++) {
            if (j === c)
                continue;
            const shared = open(c, j);
            boundary += shared;
            if (legible[j])
                framed += shared;
        }
        toLegible.set(c, framed);
        total.set(c, boundary);
    }
    const f = new Map(faint.map((c) => [c, 0]));
    // Gauss-Seidel on f(c) = (legible(c) + Σ shared(c, d)·f(d)) / boundary(c); it only rises
    // from zero toward the fixed point, and twelve inks settle in far fewer rounds.
    for (let sweep = 0; sweep < 500; sweep++) {
        let change = 0;
        for (const c of faint) {
            const boundary = total.get(c);
            if (!boundary)
                continue;
            let framed = toLegible.get(c);
            for (const d of faint)
                if (d !== c)
                    framed += open(c, d) * f.get(d);
            const next = framed / boundary;
            change = Math.max(change, Math.abs(next - f.get(c)));
            f.set(c, next);
        }
        if (change < 1e-9)
            break;
    }
    return [...Array(n).keys()].map((c) => (legible[c] ? null : f.get(c)));
}
function legibilityReason(inks, colorName, totals) {
    if (!inks.length)
        return `No visible ink to read on ${colorName}.`;
    if (totals.pass)
        return `${percent(totals.legibleShare)} of the ink reads at 3:1 or better on ${colorName}${totals.framedShare > 0 ? `, and it frames another ${percent(totals.framedShare)}` : ""}.`;
    const lost = inks.filter((ink) => ink.lost).sort((a, b) => b.share - a.share);
    const main = lost[0];
    if (!main || totals.lostShare < LEGIBILITY_RULES.maximumLostShare)
        return `Only ${percent(totals.legibleShare)} of the ink reads at 3:1 or better on ${colorName}; legible ink must carry at least ${percent(LEGIBILITY_RULES.minimumLegibleShare)}.`;
    const why = main.ratio < LEGIBILITY_RULES.minimumContrast
        ? `is ${main.ratio.toFixed(2)}:1 on ${colorName}, under 3:1,`
        : `is only ${main.distance.toFixed(0)} apart from ${colorName}, under 10,`;
    const rest = lost.length > 1 ? ` In all, ${percent(totals.lostShare)} of the ink is lost.` : "";
    return `${main.hex} (${percent(main.share)} of the ink) ${why} and isn't framed by legible ink.${rest}`;
}
/** Light garments take dark ink and dark garments light ink, at the print rules' luminance 0.3. */
export function garmentFamily(hex) {
    return relativeLuminance(hex) > LEGIBILITY_RULES.darkInkGarmentLuminance ? "light" : "dark";
}
/**
 * The garment families that need another ink: those where the existing inks read on fewer
 * than half of the family's colors, and, while fewer colors read than the caller asks for,
 * every family with a color no existing ink reads on.
 */
export function legibleInkNeeds(input) {
    const needs = [];
    for (const family of ["light", "dark"]) {
        const members = input.garments.filter((g) => garmentFamily(g.hex) === family);
        if (!members.length)
            continue;
        const legible = members.filter((g) => input.legibleColors.has(g.colorName)).length;
        if (legible * 2 < members.length || (input.legibleColors.size < input.colorCount && legible < members.length))
            needs.push(family);
    }
    return needs;
}
//# sourceMappingURL=legibility.js.map