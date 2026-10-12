/**
 * Measure a print file's ink: its palette, each ink's share, median alpha and
 * spread, and the 4-neighbor edges between inks and transparency. Pure: the
 * caller decodes the exact file (see `legibilitySampling`) and passes RGBA.
 *
 * Ported unchanged from POD's `ink-legibility-v2` (`lib/ink-legibility.ts`):
 * every float operation keeps its order, so both produce the same bytes.
 */
import { hexToRgb, rgbToOklab } from "../color/convert.js";
import { extractPalette, inkLuminance } from "../fingerprint/quantize.js";
import { LEGIBILITY_PROTOCOL, LEGIBILITY_RULES } from "./rules.js";
/** Smallest share of the ink a cluster needs to join a `DesignAnalysis` summary. */
export const SUMMARY_MINIMUM_SHARE = 0.02;
/** Most colors in a `DesignAnalysis` summary. */
export const SUMMARY_MAXIMUM_COLORS = 8;
const round = (value, places) => Number(value.toFixed(places));
const oklabDistance = (p, q) => 100 * Math.hypot(p.l - q.l, p.a - q.a, p.b - q.b);
/**
 * Measure decoded RGBA pixels: the ink palette, each ink's share, median alpha and spread, and
 * the edges between inks and transparency. The quantizer keeps only its largest colors, so
 * every visible pixel is reassigned to its nearest palette color and the shares sum to one.
 */
export function measureInkPixels(pixels, bytesChecksum) {
    const R = LEGIBILITY_RULES;
    const { data, width, height } = pixels;
    const palette = extractPalette(pixels, {
        colors: R.paletteColors,
        mergeDistance: R.mergeDistance,
        alphaThreshold: R.alphaThreshold,
    });
    const coverage = round(palette.reduce((sum, entry) => sum + entry.share, 0), 4);
    const k = palette.length;
    const cutoff = R.alphaThreshold * 255;
    // The quantizer's 15-bit buckets, each assigned to its nearest palette color by its
    // alpha-weighted mean, exactly as the quantizer saw it.
    const sums = new Float64Array(32768 * 4);
    for (let i = 0; i + 3 < data.length; i += 4) {
        const alpha = data[i + 3];
        if (alpha <= cutoff)
            continue;
        const w = alpha / 255;
        const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
        sums[key * 4] += data[i] * w;
        sums[key * 4 + 1] += data[i + 1] * w;
        sums[key * 4 + 2] += data[i + 2] * w;
        sums[key * 4 + 3] += w;
    }
    const bucketLabel = new Int16Array(32768).fill(-1);
    // Ink no palette color comes near: gradients and photographs, not antialiased flat color.
    let unmatched = 0;
    let visible = 0;
    for (let key = 0; key < 32768; key++) {
        const w = sums[key * 4 + 3];
        if (!w)
            continue;
        const lab = rgbToOklab([sums[key * 4] / w, sums[key * 4 + 1] / w, sums[key * 4 + 2] / w]);
        let best = 0;
        let bestDistance = Infinity;
        palette.forEach((entry, index) => {
            const d = oklabDistance(lab, entry.oklab);
            if (d < bestDistance) {
                bestDistance = d;
                best = index;
            }
        });
        bucketLabel[key] = best;
        visible += w;
        if (bestDistance >= R.vanishDistance)
            unmatched += w;
    }
    const paletteRgb = palette.map((entry) => hexToRgb(entry.hex));
    const labels = new Int16Array(width * height);
    const weight = new Float64Array(k);
    const alphas = Array.from({ length: k }, () => new Uint32Array(256));
    const count = new Float64Array(k);
    const differences = Array.from({ length: k }, () => new Uint32Array(256));
    let total = 0;
    for (let p = 0; p < width * height; p++) {
        const i = p * 4;
        const alpha = data[i + 3];
        if (alpha <= cutoff) {
            labels[p] = k;
            continue;
        }
        const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
        const c = bucketLabel[key];
        labels[p] = c;
        const w = alpha / 255;
        weight[c] += w;
        alphas[c][alpha]++;
        count[c]++;
        total += w;
        const rgb = paletteRgb[c];
        differences[c][Math.max(Math.abs(data[i] - rgb[0]), Math.abs(data[i + 1] - rgb[1]), Math.abs(data[i + 2] - rgb[2]))]++;
    }
    const enclosedBy = enclosingInks(labels, width, height, k);
    const raw = Array.from({ length: k + 1 }, () => new Array(k + 1).fill(0));
    const enclosed = Array.from({ length: k + 1 }, () => new Array(k + 1).fill(0));
    const count4 = (p, q) => {
        const a = labels[p];
        const b = labels[q];
        if (a === b)
            return;
        raw[a][b]++;
        raw[b][a]++;
        // A mark of `b` that only `a` surrounds lies inside `a`'s shape, and the reverse.
        if (enclosedBy[q] === a)
            enclosed[a][b]++;
        if (enclosedBy[p] === b)
            enclosed[b][a]++;
    };
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const p = y * width + x;
            if (x + 1 < width)
                count4(p, p + 1);
            if (y + 1 < height)
                count4(p, p + width);
        }
    // Drop inks no pixel kept, order by share, and remap the edge matrix to match.
    const order = [...Array(k).keys()]
        .filter((c) => count[c] > 0)
        .sort((a, b) => weight[b] - weight[a] || a - b);
    const index = [...order, k];
    const percentile = (histogram, n, q) => {
        let seen = 0;
        for (let d = 0; d < 256; d++) {
            seen += histogram[d];
            if (seen >= q * n)
                return d;
        }
        return 255;
    };
    return {
        protocol: LEGIBILITY_PROTOCOL,
        bytesChecksum,
        sampledWidth: width,
        sampledHeight: height,
        coverage,
        unmatchedShare: round(visible ? unmatched / visible : 0, 4),
        approximate: k > 0 &&
            (coverage < R.minimumPaletteCoverage ||
                (visible ? unmatched / visible : 0) > R.maximumUnmatchedShare),
        clusters: order.map((c) => ({
            hex: palette[c].hex,
            share: round(weight[c] / total, 4),
            alpha: round(percentile(alphas[c], count[c], 0.5) / 255, 4),
            spread: percentile(differences[c], count[c], 0.9),
        })),
        edges: index.map((a) => index.map((b) => raw[a][b])),
        enclosedEdges: index.map((a) => index.map((b) => enclosed[a][b])),
    };
}
/**
 * For every ink pixel, the one ink that surrounds its connected mark (4-neighbor, same ink),
 * or -1 when the mark touches transparency, the canvas edge or more than one other ink.
 * Transparent pixels (`transparent`) get -1.
 */
function enclosingInks(labels, width, height, transparent) {
    const n = width * height;
    const mark = new Int32Array(n).fill(-1);
    const surrounding = [];
    const stack = new Int32Array(n);
    for (let start = 0; start < n; start++) {
        if (labels[start] === transparent || mark[start] !== -1)
            continue;
        const id = surrounding.length;
        const ink = labels[start];
        // -1: nothing seen yet; an ink index; -2: open to the garment or bordering several inks.
        let border = -1;
        let top = 0;
        const see = (q) => {
            const l = labels[q];
            if (l === ink) {
                if (mark[q] === -1) {
                    mark[q] = id;
                    stack[top++] = q;
                }
            }
            else if (l === transparent)
                border = -2;
            else if (border === -1)
                border = l;
            else if (border !== l)
                border = -2;
        };
        mark[start] = id;
        stack[top++] = start;
        while (top) {
            const p = stack[--top];
            const x = p % width;
            const y = (p - x) / width;
            if (x === 0 || y === 0 || x === width - 1 || y === height - 1)
                border = -2;
            if (x > 0)
                see(p - 1);
            if (x + 1 < width)
                see(p + 1);
            if (y > 0)
                see(p - width);
            if (y + 1 < height)
                see(p + width);
        }
        surrounding.push(border >= 0 ? border : -1);
    }
    const result = new Int16Array(n);
    for (let p = 0; p < n; p++)
        result[p] = mark[p] === -1 ? -1 : surrounding[mark[p]];
    return result;
}
/**
 * Measure a design and summarize it for ranking and recolor planning: the
 * measurement, plus the inks with at least 2% of the ink (at most eight) with
 * their shares, and the alpha-weighted ink luminance of every visible pixel
 * rounded as a fingerprint's is.
 */
export function analyzeDesign(pixels, bytesChecksum) {
    const measurement = measureInkPixels(pixels, bytesChecksum);
    const palette = measurement.clusters
        .filter((c) => c.share >= SUMMARY_MINIMUM_SHARE)
        .slice(0, SUMMARY_MAXIMUM_COLORS)
        .map((c) => ({ hex: c.hex, share: c.share }));
    return { measurement, summary: { palette, inkLuminance: Number(inkLuminance(pixels).toFixed(5)) } };
}
//# sourceMappingURL=measure.js.map