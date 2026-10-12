/**
 * Harmony helpers and lightness ramps, all in OKLCH.
 *
 * Every helper returns in-gamut OKLCH colors. Hue rotations keep lightness and
 * hue exact and reduce chroma only as far as sRGB requires (`reduceChroma`),
 * so a rotated color can be less saturated than the input. A
 * neutral input (chroma 0) has no hue to rotate and returns copies of itself.
 */
import { type ColorInput, type Oklch } from "./convert.js";
/**
 * OKLab chroma at or below which a color counts as neutral. Chosen so White,
 * Black, the four named grays, Slate Color, Deep Slate Olive, Deep Slate Green,
 * Deep Violet (Plumbeous), and Fawn are neutral while Ecru (0.051) is not.
 */
export declare const NEUTRAL_CHROMA = 0.045;
/** Smallest arc containing every hue, in degrees. 0 for fewer than two hues. */
export declare function hueArc(hues: readonly number[]): number;
/** The color and the hue opposite it. */
export declare function complementary(input: ColorInput): Oklch[];
/**
 * The color and the two hues either side of its complement.
 * @param spread degrees between each split hue and the complement, default 30.
 */
export declare function splitComplementary(input: ColorInput, spread?: number): Oklch[];
/** The color and the hues 120 and 240 degrees around from it. */
export declare function triadic(input: ColorInput): Oklch[];
/**
 * The color with its neighbors, ordered by hue: `[h - spread, h, h + spread]`.
 * @param spread degrees between neighbors, default 30.
 */
export declare function analogous(input: ColorInput, spread?: number): Oklch[];
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
export declare function ramp(input: ColorInput, options?: RampOptions): Oklch[];
//# sourceMappingURL=harmony.d.ts.map