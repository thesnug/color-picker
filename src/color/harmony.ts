/**
 * Harmony helpers and lightness ramps, all in OKLCH.
 *
 * Every helper returns in-gamut OKLCH colors. Hue rotations keep lightness and
 * hue exact and reduce chroma only as far as sRGB requires (`reduceChroma`),
 * so a rotated color can be less saturated than the input. A
 * neutral input (chroma 0) has no hue to rotate and returns copies of itself.
 */

import { type ColorInput, type Oklch, reduceChroma, toOklch } from "./convert.js";

/**
 * OKLab chroma at or below which a color counts as neutral. Chosen so White,
 * Black, the four named grays, Slate Color, Deep Slate Olive, Deep Slate Green,
 * Deep Violet (Plumbeous), and Fawn are neutral while Ecru (0.051) is not.
 */
export const NEUTRAL_CHROMA = 0.045;

/** Smallest arc containing every hue, in degrees. 0 for fewer than two hues. */
export function hueArc(hues: readonly number[]): number {
  if (hues.length < 2) return 0;
  const sorted = [...hues].sort((a, b) => a - b);
  let largestGap = 0;
  for (let i = 0; i < sorted.length; i++) {
    const next = i + 1 < sorted.length ? sorted[i + 1]! : sorted[0]! + 360;
    largestGap = Math.max(largestGap, next - sorted[i]!);
  }
  return 360 - largestGap;
}

function rotate(base: Oklch, degrees: number): Oklch {
  return reduceChroma({ ...base, h: (((base.h + degrees) % 360) + 360) % 360 });
}

function withHues(input: ColorInput, offsets: readonly number[]): Oklch[] {
  const base = reduceChroma(toOklch(input));
  return offsets.map((d) => (d === 0 ? base : rotate(base, d)));
}

/** The color and the hue opposite it. */
export function complementary(input: ColorInput): Oklch[] {
  return withHues(input, [0, 180]);
}

/**
 * The color and the two hues either side of its complement.
 * @param spread degrees between each split hue and the complement, default 30.
 */
export function splitComplementary(input: ColorInput, spread = 30): Oklch[] {
  return withHues(input, [0, 180 - spread, 180 + spread]);
}

/** The color and the hues 120 and 240 degrees around from it. */
export function triadic(input: ColorInput): Oklch[] {
  return withHues(input, [0, 120, 240]);
}

/**
 * The color with its neighbors, ordered by hue: `[h - spread, h, h + spread]`.
 * @param spread degrees between neighbors, default 30.
 */
export function analogous(input: ColorInput, spread = 30): Oklch[] {
  return withHues(input, [-spread, 0, spread]);
}

export interface RampOptions {
  /** Number of colors, at least 2. Default 9. */
  steps?: number;
  /** OKLCH lightness of the lightest tint. Default 0.97. */
  lightest?: number;
  /** OKLCH lightness of the darkest shade. Default 0.25. */
  darkest?: number;
}

/**
 * A lightness ramp of tints and shades, lightest first. Lightness steps evenly
 * from `lightest` to `darkest`; hue and chroma come from the input, and each
 * step reduces chroma only as far as sRGB requires, so chroma tapers naturally
 * toward white and black while lightness stays exact.
 *
 * @throws {RangeError} when `steps` is below 2 or the lightness bounds are outside 0 to 1.
 */
export function ramp(input: ColorInput, options: RampOptions = {}): Oklch[] {
  const { steps = 9, lightest = 0.97, darkest = 0.25 } = options;
  if (!Number.isInteger(steps) || steps < 2) {
    throw new RangeError(`ramp needs an integer steps of at least 2, got ${steps}`);
  }
  for (const [name, value] of [["lightest", lightest], ["darkest", darkest]] as const) {
    if (!(value >= 0 && value <= 1)) {
      throw new RangeError(`ramp ${name} must be between 0 and 1, got ${value}`);
    }
  }
  const base = toOklch(input);
  return Array.from({ length: steps }, (_, i) => {
    const l = lightest + ((darkest - lightest) * i) / (steps - 1);
    return reduceChroma({ l, c: base.c, h: base.h });
  });
}
