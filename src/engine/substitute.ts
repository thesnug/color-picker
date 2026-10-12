/**
 * Pigment substitution: the one way a recolor plan is applied to pixels.
 * Only the planned pigments change; alpha, geometry, and every other pigment
 * stay exact. Pure: the caller decodes the file and encodes the result.
 *
 * Ported unchanged from POD's `applyCreativeRecolor`, which now decodes,
 * calls `substitutePigments`, and encodes the PNG.
 */

import type { RgbaPixels } from "../fingerprint/quantize.js";

/** One pigment swap: pixels within `tolerance` (per channel, 0 to 255) of `from` become `to`. */
export interface PigmentReplacement {
  from: string;
  to: string;
  tolerance: number;
}

/** Why `substitutePigments` refused a plan. */
export class RecolorPigmentError extends Error {
  /** `overlap`: a pixel falls within two replacements. `absent`: no pixel matched any. */
  readonly code: "overlap" | "absent";

  constructor(code: "overlap" | "absent", message: string) {
    super(message);
    this.name = "RecolorPigmentError";
    this.code = code;
  }
}

export interface SubstitutedPixels {
  /** A new pixel buffer; the input is untouched. */
  pixels: RgbaPixels;
  /** Visible pixels that changed pigment. */
  changed: number;
}

/** Furthest a lighter or darker printing may move toward white or black and still count as the pigment. */
const MAX_PIGMENT_TINT = 0.75;

/** A lighter (toward white) or darker (toward black) edge pixel of the same pigment, not another color. */
function isPigmentTint(pixel: ArrayLike<number>, from: number[], tolerance: number) {
  for (const target of [255, 0]) {
    const span = from.map((c) => target - c);
    const axis = span.reduce((best, s, k) => (Math.abs(s) > Math.abs(span[best]!) ? k : best), 0);
    if (!span[axis]) continue;
    const t = (pixel[axis]! - from[axis]!) / span[axis]!;
    if (t <= 0 || t > MAX_PIGMENT_TINT) continue;
    if (from.every((c, k) => Math.abs(pixel[k]! - (c + t * span[k]!)) <= Math.max(tolerance, 2))) return true;
  }
  return false;
}

/**
 * Substitute pigments: each visible pixel within a replacement's tolerance of
 * its `from` takes its `to`, keeping its offset from the pigment (so shading,
 * antialiasing, and distress survive), and its alpha. A pixel just outside
 * every tolerance that is a lighter or darker tint of exactly one pigment is
 * substituted too, so edges don't print as streaks of the old ink.
 *
 * @throws {RecolorPigmentError} `overlap` when a pixel falls within two
 *   replacements' tolerances, `absent` when no pixel changes.
 */
export function substitutePigments(
  pixels: RgbaPixels,
  plan: { readonly replacements: readonly PigmentReplacement[] },
): SubstitutedPixels {
  const data = new Uint8Array(pixels.data);
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const replacements = plan.replacements.map((v) => ({
    ...v,
    fromRgb: rgb(v.from),
    toRgb: rgb(v.to),
  }));
  let changed = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    let matches = replacements.filter(
      (v) => Math.max(...v.fromRgb.map((c, k) => Math.abs(data[i + k]! - c))) <= v.tolerance,
    );
    if (matches.length > 1)
      throw new RecolorPigmentError("overlap", "Recolor pigment ranges overlap; review a narrower plan.");
    // Edge and distress pixels just outside tolerance would otherwise print as streaks of the old ink.
    if (!matches.length) {
      const pixel = data.subarray(i, i + 3);
      matches = replacements.filter((v) => isPigmentTint(pixel, v.fromRgb, v.tolerance));
      if (matches.length !== 1) continue;
    }
    const match = matches[0]!;
    for (let k = 0; k < 3; k++)
      data[i + k] = Math.max(0, Math.min(255, match.toRgb[k]! + data[i + k]! - match.fromRgb[k]!));
    changed++;
  }
  if (!changed) throw new RecolorPigmentError("absent", "Recolor pigment is absent from the approved artwork.");
  return { pixels: { data, width: pixels.width, height: pixels.height }, changed };
}
