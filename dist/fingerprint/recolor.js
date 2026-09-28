/**
 * Deterministic recoloring of flat-color art from a recolor mapping. Pure: no
 * I/O, no decoder. `applyRecolor` in ./index.ts decodes the file, checks the
 * art is flat enough, calls `recolorPixels`, and writes the PNG. See
 * docs/DESIGN.md, "Pipelines", "Recommend shirts, with recoloring".
 */
import { hexToOklab, hexToRgb, rgbToOklab } from "../color/convert.js";
export const RECOLOR_DEFAULTS = {
    tolerance: 10,
    maxUnmatched: 0.05,
    minCoverage: 0.9,
};
/**
 * Replace every visible pixel with the `to` color of its nearest `from` color
 * in OKLab, keeping its alpha. Fully transparent pixels stay fully transparent
 * and become black, so the output holds only the mapped colors plus
 * transparency. Pixels beyond `tolerance` are still replaced, and counted in
 * `unmatched` so the caller can decide the art was not flat.
 *
 * @throws {RangeError} when the mapping is empty.
 */
export function recolorPixels(pixels, mapping, options = {}) {
    if (mapping.length === 0)
        throw new RangeError("A recolor mapping needs at least one swap.");
    const tolerance = (options.tolerance ?? RECOLOR_DEFAULTS.tolerance) / 100;
    const swaps = mapping.map((m) => ({ from: hexToOklab(m.from.hex), to: hexToRgb(m.to.hex) }));
    // Flat art has few distinct pixel values; look each up once.
    const lookup = new Map();
    const nearestSwap = (r, g, b) => {
        const key = (r << 16) | (g << 8) | b;
        let hit = lookup.get(key);
        if (!hit) {
            const lab = rgbToOklab([r, g, b]);
            let swap = 0;
            let best = Infinity;
            swaps.forEach((s, i) => {
                const d = gap(lab, s.from);
                if (d < best) {
                    best = d;
                    swap = i;
                }
            });
            hit = { swap, far: best > tolerance };
            lookup.set(key, hit);
        }
        return hit;
    };
    const { data, width, height } = pixels;
    const out = new Uint8Array(data.length);
    let visible = 0;
    let far = 0;
    for (let i = 0; i + 3 < data.length; i += 4) {
        const alpha = data[i + 3];
        if (alpha === 0)
            continue;
        const hit = nearestSwap(data[i], data[i + 1], data[i + 2]);
        const [r, g, b] = swaps[hit.swap].to;
        out[i] = r;
        out[i + 1] = g;
        out[i + 2] = b;
        out[i + 3] = alpha;
        visible += alpha;
        if (hit.far)
            far += alpha;
    }
    return {
        pixels: { data: out, width, height },
        unmatched: visible ? Number((far / visible).toFixed(4)) : 0,
    };
}
function gap(p, q) {
    return Math.hypot(p.l - q.l, p.a - q.a, p.b - q.b);
}
//# sourceMappingURL=recolor.js.map