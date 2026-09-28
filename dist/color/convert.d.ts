/**
 * Conversions between hex, sRGB, linear RGB, OKLab, and OKLCH, plus OKLab
 * distance and sRGB gamut mapping.
 *
 * OKLab is Björn Ottosson's perceptual color space (2020,
 * https://bottosson.github.io/posts/oklab/). The matrices below are the ones
 * published in that post, so values agree with `assets/derived/colors.json`.
 */
/** A normalized six-digit lowercase hex color, for example `#ffb3f0`. */
export type Hex = `#${string}`;
/** sRGB channels, 0 to 255. Not necessarily integers; `rgbToHex` rounds. */
export type Rgb = readonly [r: number, g: number, b: number];
/** Linear-light sRGB channels, 0 to 1 inside the gamut. */
export type LinearRgb = readonly [r: number, g: number, b: number];
export interface Oklab {
    /** Lightness, 0 to 1. */
    l: number;
    a: number;
    b: number;
}
export interface Oklch {
    /** Lightness, 0 to 1. */
    l: number;
    /** Chroma. 0 for neutrals; sRGB colors reach about 0.32. */
    c: number;
    /** Hue in degrees, 0 to 360. 0 when chroma is 0. */
    h: number;
}
/** Anything the color functions accept: a hex string, sRGB channels, OKLab, or OKLCH. */
export type ColorInput = string | Rgb | Oklab | Oklch;
/** True when the input is a three- or six-digit hex color, with or without `#`. */
export declare function isHex(input: string): boolean;
/**
 * Normalize a hex color string to the six-digit lowercase form with a leading `#`.
 * Accepts three- or six-digit input with or without the `#`.
 *
 * @throws {TypeError} when the input is not a valid hex color.
 */
export declare function normalizeHex(input: string): Hex;
/** @throws {TypeError} when the input is not a valid hex color. */
export declare function hexToRgb(hex: string): Rgb;
/** Round and clip each channel to 0 to 255, then format as `#rrggbb`. */
export declare function rgbToHex(rgb: Rgb): Hex;
/** Decode one sRGB channel, 0 to 1, to linear light. */
export declare function srgbChannelToLinear(v: number): number;
/** Encode one linear-light channel to sRGB, 0 to 1. Extends to negatives by symmetry. */
export declare function linearChannelToSrgb(v: number): number;
export declare function rgbToLinear(rgb: Rgb): LinearRgb;
/** Convert linear RGB to sRGB 0 to 255, clipping each channel to the gamut. */
export declare function linearToRgb(linear: LinearRgb): Rgb;
export declare function linearToOklab([r, g, b]: LinearRgb): Oklab;
/** Convert OKLab to linear RGB. Not clipped: out-of-gamut colors have channels outside 0 to 1. */
export declare function oklabToLinear({ l: L, a, b }: Oklab): LinearRgb;
export declare function oklabToOklch({ l, a, b }: Oklab): Oklch;
export declare function oklchToOklab({ l, c, h }: Oklch): Oklab;
export declare function rgbToOklab(rgb: Rgb): Oklab;
export declare function hexToOklab(hex: string): Oklab;
export declare function hexToOklch(hex: string): Oklch;
/** Convert any accepted color input to OKLab. */
export declare function toOklab(input: ColorInput): Oklab;
/** Convert any accepted color input to OKLCH. */
export declare function toOklch(input: ColorInput): Oklch;
/**
 * Perceptual distance between two colors: Euclidean distance in OKLab, scaled
 * by 100 so lightness runs 0 to 100.
 *
 * Scale: about 2 is a just-noticeable difference (CSS Color 4 uses 0.02 in
 * unscaled OKLab units). Black to white is 100.
 */
export declare function distance(a: ColorInput, b: ColorInput): number;
/** True when the color lies inside the sRGB gamut. */
export declare function inGamut(input: ColorInput): boolean;
/**
 * Bring a color into the sRGB gamut with the CSS Color 4 gamut-mapping
 * algorithm (https://www.w3.org/TR/css-color-4/#gamut-mapping): hold
 * lightness and hue, reduce chroma by binary search until clipping the result
 * changes it by less than a just-noticeable difference (0.02 in OKLab).
 * Lightness at or beyond 0 or 1 maps to black or white.
 */
export declare function gamutMap(input: ColorInput): Oklch;
/**
 * Reduce chroma, holding lightness and hue exactly, until the color is inside
 * sRGB. Stricter than `gamutMap`, which accepts a final clip that can move
 * lightness and hue by up to a just-noticeable difference; use this where the
 * lightness or hue is the point, as in ramps and harmonies.
 */
export declare function reduceChroma(input: ColorInput): Oklch;
export interface ToHexOptions {
    /**
     * How to handle colors outside sRGB. `map` (default) reduces chroma with the
     * CSS Color 4 algorithm, keeping hue and lightness. `clip` clamps each RGB
     * channel, which is faster but can shift hue.
     */
    gamut?: "map" | "clip";
}
export declare function oklabToRgb(lab: Oklab, options?: ToHexOptions): Rgb;
export declare function oklabToHex(lab: Oklab, options?: ToHexOptions): Hex;
export declare function oklchToHex(lch: Oklch, options?: ToHexOptions): Hex;
/** Convert any accepted color input to sRGB channels, 0 to 255, gamut-mapped. */
export declare function toRgb(input: ColorInput, options?: ToHexOptions): Rgb;
/** Convert any accepted color input to `#rrggbb`, gamut-mapped. */
export declare function toHex(input: ColorInput, options?: ToHexOptions): Hex;
//# sourceMappingURL=convert.d.ts.map