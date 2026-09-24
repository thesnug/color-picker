/**
 * Palette extraction and ink luminance from decoded RGBA pixels. Pure: no I/O,
 * no decoder. `fingerprint` in ./index.ts decodes the file and calls these.
 *
 * Quantization is median cut in OKLab, refined by a few rounds of k-means, then
 * cleaned up in two passes so antialiasing does not create palette entries:
 * clusters closer than `mergeDistance` are merged, and small clusters lying
 * between two larger ones (the blended edge where two flat colors meet) are
 * folded into those two.
 */

import {
  type Hex,
  hexToOklab,
  linearToRgb,
  type Oklab,
  oklabToLinear,
  rgbToHex,
  rgbToOklab,
  srgbChannelToLinear,
} from "../color/convert.js";

/** Decoded pixels: 8-bit RGBA, straight (not premultiplied) alpha, row-major. */
export interface RgbaPixels {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface PaletteEntry {
  hex: Hex;
  oklab: Oklab;
  /** Fraction of the design's opaque coverage this color accounts for, 0 to 1. */
  share: number;
}

export interface PaletteOptions {
  /** Pixels at or below this alpha (0 to 1) are ignored. Default 0.5. */
  alphaThreshold?: number;
  /** How many colors to return. Default 5. */
  colors?: number;
  /**
   * Clusters closer than this OKLab distance (scaled by 100, as `distance`) are
   * one color. Also the tolerance for treating a small cluster as a blend of two
   * larger ones. Default 5: wide enough to absorb JPEG noise at quality 70,
   * narrow enough to keep white (#ffffff) and cream (#f3e9d2), about 5.5 apart,
   * as separate inks.
   */
  mergeDistance?: number;
}

export const PALETTE_DEFAULTS = {
  alphaThreshold: 0.5,
  colors: 5,
  mergeDistance: 5,
} as const satisfies Required<PaletteOptions>;

/** Boxes produced by median cut before refinement and merging. */
const MEDIAN_CUT_BOXES = 16;
const KMEANS_ROUNDS = 4;
/** Clusters below this share are candidates for folding into two larger neighbors. */
const BLEND_SHARE = 0.05;

// ---------------------------------------------------------------------------
// Points

interface Point {
  lab: Oklab;
  /** Summed alpha of the pixels behind this point. */
  weight: number;
}

/**
 * Collapse opaque pixels into a histogram of 15-bit RGB buckets (5 bits per
 * channel), each carrying the alpha-weighted mean of its pixels. Keeps the
 * quantizer's cost independent of image size.
 */
function histogram(pixels: RgbaPixels, alphaThreshold: number): { points: Point[]; total: number } {
  const { data } = pixels;
  const sums = new Map<number, [r: number, g: number, b: number, w: number]>();
  const cutoff = alphaThreshold * 255;
  let total = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const alpha = data[i + 3]!;
    if (alpha <= cutoff) continue;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const w = alpha / 255;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const s = sums.get(key);
    if (s) {
      s[0] += r * w;
      s[1] += g * w;
      s[2] += b * w;
      s[3] += w;
    } else {
      sums.set(key, [r * w, g * w, b * w, w]);
    }
    total += w;
  }
  const points = [...sums.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, [r, g, b, w]]) => ({ lab: rgbToOklab([r / w, g / w, b / w]), weight: w }));
  return { points, total };
}

// ---------------------------------------------------------------------------
// Clusters

interface Cluster {
  lab: Oklab;
  weight: number;
}

const AXES = ["l", "a", "b"] as const;

function mean(points: readonly Point[]): Cluster {
  let l = 0,
    a = 0,
    b = 0,
    weight = 0;
  for (const p of points) {
    l += p.lab.l * p.weight;
    a += p.lab.a * p.weight;
    b += p.lab.b * p.weight;
    weight += p.weight;
  }
  return { lab: { l: l / weight, a: a / weight, b: b / weight }, weight };
}

/** Weighted variance along each axis, and the largest. */
function spread(points: readonly Point[]): { axis: (typeof AXES)[number]; variance: number } {
  const center = mean(points);
  let best: { axis: (typeof AXES)[number]; variance: number } = { axis: "l", variance: -1 };
  for (const axis of AXES) {
    let v = 0;
    for (const p of points) v += p.weight * (p.lab[axis] - center.lab[axis]) ** 2;
    if (v > best.variance) best = { axis, variance: v };
  }
  return best;
}

/** Split the box with the most weighted variance at its weighted median, until `count` boxes. */
function medianCut(points: readonly Point[], count: number): Point[][] {
  const boxes: Point[][] = [[...points]];
  while (boxes.length < count) {
    let pick = -1;
    let pickSpread = { axis: "l" as (typeof AXES)[number], variance: 0 };
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const s = spread(box);
      if (s.variance > pickSpread.variance) {
        pick = i;
        pickSpread = s;
      }
    });
    if (pick < 0) break;
    const box = boxes[pick]!.sort((p, q) => p.lab[pickSpread.axis] - q.lab[pickSpread.axis]);
    const half = mean(box).weight / 2;
    let acc = 0;
    let cut = 1;
    for (; cut < box.length - 1; cut++) {
      acc += box[cut - 1]!.weight;
      if (acc >= half) break;
    }
    boxes.splice(pick, 1, box.slice(0, cut), box.slice(cut));
  }
  return boxes;
}

const dist = (p: Oklab, q: Oklab) => 100 * Math.hypot(p.l - q.l, p.a - q.a, p.b - q.b);

/** Lloyd's algorithm from the median-cut centers. Empty clusters are dropped. */
function kmeans(points: readonly Point[], seeds: Cluster[], rounds: number): Cluster[] {
  let centers = seeds;
  for (let round = 0; round < rounds; round++) {
    const groups: Point[][] = centers.map(() => []);
    for (const p of points) {
      let best = 0;
      let bestD = Infinity;
      centers.forEach((c, i) => {
        const d = dist(p.lab, c.lab);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      groups[best]!.push(p);
    }
    centers = groups.filter((g) => g.length > 0).map(mean);
  }
  return centers;
}

function combine(p: Cluster, q: Cluster): Cluster {
  const w = p.weight + q.weight;
  const mix = (axis: (typeof AXES)[number]) => (p.lab[axis] * p.weight + q.lab[axis] * q.weight) / w;
  return { lab: { l: mix("l"), a: mix("a"), b: mix("b") }, weight: w };
}

/** Merge the closest pair while it is closer than `threshold`. */
function mergeNear(clusters: Cluster[], threshold: number): Cluster[] {
  const out = [...clusters];
  for (;;) {
    let pair: [number, number] | undefined;
    let best = threshold;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const d = dist(out[i]!.lab, out[j]!.lab);
        if (d < best) {
          best = d;
          pair = [i, j];
        }
      }
    }
    if (!pair) return out;
    const [i, j] = pair;
    out[i] = combine(out[i]!, out[j]!);
    out.splice(j, 1);
  }
}

/**
 * Where `c` sits on the segment from `p` to `q`: the parameter `t` of its
 * projection, 0 at `p` and 1 at `q`, and its distance from the segment.
 */
function onSegment(c: Oklab, p: Oklab, q: Oklab): { t: number; offset: number } {
  const d = { l: q.l - p.l, a: q.a - p.a, b: q.b - p.b };
  const len2 = d.l ** 2 + d.a ** 2 + d.b ** 2;
  if (len2 === 0) return { t: 0, offset: dist(c, p) };
  const t = ((c.l - p.l) * d.l + (c.a - p.a) * d.a + (c.b - p.b) * d.b) / len2;
  const at = { l: p.l + t * d.l, a: p.a + t * d.a, b: p.b + t * d.b };
  return { t, offset: dist(c, at) };
}

/**
 * Fold small clusters that lie between two larger ones into those two, in
 * proportion to where they fall on the line between them. An antialiased edge
 * between two flat colors produces exactly such a cluster.
 */
function foldBlends(clusters: Cluster[], total: number, tolerance: number): Cluster[] {
  const out = [...clusters].sort((p, q) => q.weight - p.weight);
  for (let k = out.length - 1; k >= 0; k--) {
    const c = out[k]!;
    if (c.weight / total >= BLEND_SHARE) continue;
    let best: { i: number; j: number; t: number; offset: number } | undefined;
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        const s = onSegment(c.lab, out[i]!.lab, out[j]!.lab);
        if (s.t <= 0 || s.t >= 1 || s.offset >= tolerance) continue;
        if (!best || s.offset < best.offset) best = { i, j, ...s };
      }
    }
    if (!best) continue;
    out[best.i] = { ...out[best.i]!, weight: out[best.i]!.weight + c.weight * (1 - best.t) };
    out[best.j] = { ...out[best.j]!, weight: out[best.j]!.weight + c.weight * best.t };
    out.splice(k, 1);
  }
  return out;
}

const round = (value: number, places: number) => Number(value.toFixed(places));

function toEntry(cluster: Cluster, total: number): PaletteEntry {
  // Report the OKLab of the rounded hex, so `hex` and `oklab` name the same color.
  const hex = rgbToHex(linearToRgb(oklabToLinear(cluster.lab)));
  const lab = hexToOklab(hex);
  return {
    hex,
    oklab: { l: round(lab.l, 5), a: round(lab.a, 5), b: round(lab.b, 5) },
    share: round(cluster.weight / total, 4),
  };
}

/**
 * The design's top colors by coverage. Shares are fractions of all opaque
 * coverage, so for a photograph the five shares sum to less than one.
 * Returns an empty palette when no pixel clears `alphaThreshold`.
 */
export function extractPalette(pixels: RgbaPixels, options: PaletteOptions = {}): PaletteEntry[] {
  const { alphaThreshold, colors, mergeDistance } = { ...PALETTE_DEFAULTS, ...options };
  const { points, total } = histogram(pixels, alphaThreshold);
  if (points.length === 0) return [];

  const seeds = medianCut(points, MEDIAN_CUT_BOXES).map(mean);
  const refined = kmeans(points, seeds, KMEANS_ROUNDS);
  const merged = mergeNear(refined, mergeDistance);
  const cleaned = foldBlends(merged, total, mergeDistance);

  return cleaned
    .sort((p, q) => q.weight - p.weight || p.lab.l - q.lab.l)
    .slice(0, colors)
    .map((c) => toEntry(c, total));
}

// ---------------------------------------------------------------------------
// Ink luminance

/**
 * Pixels at or below this alpha do not count toward ink luminance. Matches
 * `measureInk` in maker-method-picker (app/prototype/color-study/model.ts) so
 * both tools agree on light versus dark ink.
 */
export const INK_ALPHA_THRESHOLD = 0.04;

/** What `inkLuminance` reports for an image with no visible pixels, as the picker does. */
export const INK_LUMINANCE_EMPTY = 0.5;

const LINEAR = Array.from({ length: 256 }, (_, v) => srgbChannelToLinear(v / 255));

/**
 * Alpha-weighted mean WCAG relative luminance of the visible pixels, 0 to 1.
 *
 * This is the picker's definition: each pixel's luminance, weighted by its
 * alpha, averaged over pixels above `INK_ALPHA_THRESHOLD`. It is computed from
 * every pixel rather than from the five-color palette, because averaging over
 * the palette drops whatever the palette leaves out and would disagree with
 * the picker on photographic art.
 */
export function inkLuminance(pixels: RgbaPixels): number {
  const { data } = pixels;
  const cutoff = INK_ALPHA_THRESHOLD * 255;
  let sum = 0;
  let weight = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const alpha = data[i + 3]!;
    if (alpha <= cutoff) continue;
    const w = alpha / 255;
    const y = 0.2126 * LINEAR[data[i]!]! + 0.7152 * LINEAR[data[i + 1]!]! + 0.0722 * LINEAR[data[i + 2]!]!;
    sum += y * w;
    weight += w;
  }
  return weight ? sum / weight : INK_LUMINANCE_EMPTY;
}

/** True when any pixel is less than fully opaque. */
export function hasTransparency(pixels: RgbaPixels): boolean {
  const { data } = pixels;
  for (let i = 3; i < data.length; i += 4) if (data[i]! < 255) return true;
  return false;
}
