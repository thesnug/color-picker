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

// ---------------------------------------------------------------------------
// Hex

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** True when the input is a three- or six-digit hex color, with or without `#`. */
export function isHex(input: string): boolean {
  return HEX_PATTERN.test(input.trim());
}

/**
 * Normalize a hex color string to the six-digit lowercase form with a leading `#`.
 * Accepts three- or six-digit input with or without the `#`.
 *
 * @throws {TypeError} when the input is not a valid hex color.
 */
export function normalizeHex(input: string): Hex {
  const match = HEX_PATTERN.exec(input.trim());
  if (!match) {
    throw new TypeError(`Not a hex color: ${JSON.stringify(input)}`);
  }
  const digits = match[1]!.toLowerCase();
  const six =
    digits.length === 3
      ? digits
          .split("")
          .map((d) => d + d)
          .join("")
      : digits;
  return `#${six}`;
}

/** @throws {TypeError} when the input is not a valid hex color. */
export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(normalizeHex(hex).slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Round and clip each channel to 0 to 255, then format as `#rrggbb`. */
export function rgbToHex(rgb: Rgb): Hex {
  const part = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(rgb[0])}${part(rgb[1])}${part(rgb[2])}`;
}

// ---------------------------------------------------------------------------
// sRGB transfer function (IEC 61966-2-1)

/** Decode one sRGB channel, 0 to 1, to linear light. */
export function srgbChannelToLinear(v: number): number {
  const s = Math.sign(v);
  const x = Math.abs(v);
  return x <= 0.04045 ? v / 12.92 : s * ((x + 0.055) / 1.055) ** 2.4;
}

/** Encode one linear-light channel to sRGB, 0 to 1. Extends to negatives by symmetry. */
export function linearChannelToSrgb(v: number): number {
  const s = Math.sign(v);
  const x = Math.abs(v);
  return x <= 0.0031308 ? v * 12.92 : s * (1.055 * x ** (1 / 2.4) - 0.055);
}

export function rgbToLinear(rgb: Rgb): LinearRgb {
  return [
    srgbChannelToLinear(rgb[0] / 255),
    srgbChannelToLinear(rgb[1] / 255),
    srgbChannelToLinear(rgb[2] / 255),
  ];
}

/** Convert linear RGB to sRGB 0 to 255, clipping each channel to the gamut. */
export function linearToRgb(linear: LinearRgb): Rgb {
  const enc = (v: number) => 255 * linearChannelToSrgb(Math.min(1, Math.max(0, v)));
  return [enc(linear[0]), enc(linear[1]), enc(linear[2])];
}

// ---------------------------------------------------------------------------
// OKLab and OKLCH

export function linearToOklab([r, g, b]: LinearRgb): Oklab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** Convert OKLab to linear RGB. Not clipped: out-of-gamut colors have channels outside 0 to 1. */
export function oklabToLinear({ l: L, a, b }: Oklab): LinearRgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/**
 * Chroma below which hue is treated as undefined and reported as 0. Grays
 * converted from sRGB carry chroma noise around 1e-8 from the matrices.
 */
const ACHROMATIC = 1e-6;

export function oklabToOklch({ l, a, b }: Oklab): Oklch {
  const c = Math.hypot(a, b);
  const h = c < ACHROMATIC ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { l, c, h };
}

export function oklchToOklab({ l, c, h }: Oklch): Oklab {
  const rad = (h * Math.PI) / 180;
  return { l, a: c * Math.cos(rad), b: c * Math.sin(rad) };
}

export function rgbToOklab(rgb: Rgb): Oklab {
  return linearToOklab(rgbToLinear(rgb));
}

export function hexToOklab(hex: string): Oklab {
  return rgbToOklab(hexToRgb(hex));
}

export function hexToOklch(hex: string): Oklch {
  return oklabToOklch(hexToOklab(hex));
}

function isOklch(input: Oklab | Oklch): input is Oklch {
  return "c" in input;
}

/** Convert any accepted color input to OKLab. */
export function toOklab(input: ColorInput): Oklab {
  if (typeof input === "string") return hexToOklab(input);
  if (Array.isArray(input)) return rgbToOklab(input as Rgb);
  const obj = input as Oklab | Oklch;
  return isOklch(obj) ? oklchToOklab(obj) : obj;
}

/** Convert any accepted color input to OKLCH. */
export function toOklch(input: ColorInput): Oklch {
  if (typeof input === "object" && !Array.isArray(input) && isOklch(input as Oklab | Oklch)) {
    return input as Oklch;
  }
  return oklabToOklch(toOklab(input));
}

// ---------------------------------------------------------------------------
// Distance

/**
 * Perceptual distance between two colors: Euclidean distance in OKLab, scaled
 * by 100 so lightness runs 0 to 100.
 *
 * Scale: about 2 is a just-noticeable difference (CSS Color 4 uses 0.02 in
 * unscaled OKLab units). Black to white is 100.
 */
export function distance(a: ColorInput, b: ColorInput): number {
  const p = toOklab(a);
  const q = toOklab(b);
  return 100 * Math.hypot(p.l - q.l, p.a - q.a, p.b - q.b);
}

// ---------------------------------------------------------------------------
// Gamut

/** Tolerance for round-trip error when testing whether linear RGB is in gamut. */
const GAMUT_EPSILON = 1e-6;

/** True when the color lies inside the sRGB gamut. */
export function inGamut(input: ColorInput): boolean {
  if (typeof input === "string" || Array.isArray(input)) return true;
  const lin = oklabToLinear(toOklab(input));
  return lin.every((v) => v >= -GAMUT_EPSILON && v <= 1 + GAMUT_EPSILON);
}

function clip(lab: Oklab): Oklab {
  return rgbToOklab(linearToRgb(oklabToLinear(lab)));
}

/**
 * Bring a color into the sRGB gamut with the CSS Color 4 gamut-mapping
 * algorithm (https://www.w3.org/TR/css-color-4/#gamut-mapping): hold
 * lightness and hue, reduce chroma by binary search until clipping the result
 * changes it by less than a just-noticeable difference (0.02 in OKLab).
 * Lightness at or beyond 0 or 1 maps to black or white.
 */
export function gamutMap(input: ColorInput): Oklch {
  const origin = toOklch(input);
  if (origin.l >= 1) return { l: 1, c: 0, h: 0 };
  if (origin.l <= 0) return { l: 0, c: 0, h: 0 };
  if (inGamut(origin)) return origin;

  const JND = 0.02;
  const EPSILON = 0.0001;
  const deltaE = (p: Oklab, q: Oklab) => Math.hypot(p.l - q.l, p.a - q.a, p.b - q.b);

  let clipped = clip(oklchToOklab(origin));
  if (deltaE(clipped, oklchToOklab(origin)) < JND) return oklabToOklch(clipped);

  let min = 0;
  let max = origin.c;
  let minInGamut = true;
  while (max - min > EPSILON) {
    const current: Oklch = { ...origin, c: (min + max) / 2 };
    if (minInGamut && inGamut(current)) {
      min = current.c;
      continue;
    }
    const lab = oklchToOklab(current);
    clipped = clip(lab);
    const e = deltaE(clipped, lab);
    if (e < JND) {
      if (JND - e < EPSILON) break;
      minInGamut = false;
      min = current.c;
    } else {
      max = current.c;
    }
  }
  return oklabToOklch(clipped);
}

/**
 * Reduce chroma, holding lightness and hue exactly, until the color is inside
 * sRGB. Stricter than `gamutMap`, which accepts a final clip that can move
 * lightness and hue by up to a just-noticeable difference; use this where the
 * lightness or hue is the point, as in ramps and harmonies.
 */
export function reduceChroma(input: ColorInput): Oklch {
  const origin = toOklch(input);
  if (origin.l >= 1) return { l: 1, c: 0, h: 0 };
  if (origin.l <= 0) return { l: 0, c: 0, h: 0 };
  if (inGamut(origin)) return origin;
  let min = 0;
  let max = origin.c;
  while (max - min > 1e-6) {
    const c = (min + max) / 2;
    if (inGamut({ ...origin, c })) min = c;
    else max = c;
  }
  return { ...origin, c: min };
}

export interface ToHexOptions {
  /**
   * How to handle colors outside sRGB. `map` (default) reduces chroma with the
   * CSS Color 4 algorithm, keeping hue and lightness. `clip` clamps each RGB
   * channel, which is faster but can shift hue.
   */
  gamut?: "map" | "clip";
}

export function oklabToRgb(lab: Oklab, options: ToHexOptions = {}): Rgb {
  const inside = options.gamut === "clip" ? lab : oklchToOklab(gamutMap(lab));
  return linearToRgb(oklabToLinear(inside));
}

export function oklabToHex(lab: Oklab, options: ToHexOptions = {}): Hex {
  return rgbToHex(oklabToRgb(lab, options));
}

export function oklchToHex(lch: Oklch, options: ToHexOptions = {}): Hex {
  return oklabToHex(oklchToOklab(lch), options);
}

/** Convert any accepted color input to sRGB channels, 0 to 255, gamut-mapped. */
export function toRgb(input: ColorInput, options: ToHexOptions = {}): Rgb {
  if (typeof input === "string") return hexToRgb(input);
  if (Array.isArray(input)) return input as Rgb;
  return oklabToRgb(toOklab(input), options);
}

/** Convert any accepted color input to `#rrggbb`, gamut-mapped. */
export function toHex(input: ColorInput, options: ToHexOptions = {}): Hex {
  if (typeof input === "string") return normalizeHex(input);
  return rgbToHex(toRgb(input, options));
}
