/**
 * `@thesnug/color-picker/data`: the vendored and derived JSON assets, typed.
 *
 * Files are read at call time so consumers only pay for the assets they use.
 * `assets/colors.json` is the Wada source and is never edited by hand.
 * `scripts/build-data.ts` derives `assets/derived/colors.json` and
 * `assets/derived/combinations.json` from it; CI fails when they are stale.
 * See docs/DESIGN.md, "Data".
 */

import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Source

/** One color from Sanzo Wada's A Dictionary of Color Combinations, as vendored. */
export interface WadaColor {
  /** 1-based position in the source dataset. */
  index: number;
  /** Display name as printed in the source, typos included. */
  name: string;
  slug: string;
  /** CMYK percentages from the book. */
  cmyk_array: [number, number, number, number];
  cmyk: string;
  /** The web edition's sRGB conversion of the CMYK value. Not authoritative. */
  rgb_array: [number, number, number];
  rgb: string;
  /** Lowercase `#rrggbb`. */
  hex: string;
  /** IDs of the combinations this color belongs to. */
  combinations: number[];
  use_count: number;
}

export interface WadaDataset {
  colors: WadaColor[];
}

// ---------------------------------------------------------------------------
// Derived

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

/** A Wada color after cleanup, with color-space conversions precomputed. */
export interface DerivedColor {
  /** 1-based position in the source dataset. Stable across cleanups. */
  index: number;
  /** Canonical name with source typos corrected. */
  name: string;
  /** Slug of the canonical name. */
  slug: string;
  /** Other names that resolve to this color, including the source name when it differs. */
  aliases: string[];
  /** Name exactly as vendored. */
  sourceName: string;
  /** Slug exactly as vendored. */
  sourceSlug: string;
  /** For lettered variants such as "Eugenia Red A", the letter. */
  variant?: string;
  /** Lowercase `#rrggbb`. */
  hex: string;
  /** sRGB, 0 to 255. The web edition's conversion of the book's CMYK. */
  rgb: [number, number, number];
  /** CMYK percentages from the book. */
  cmyk: [number, number, number, number];
  oklab: Oklab;
  oklch: Oklch;
  /** True when OKLab chroma is at or below the neutral threshold. */
  neutral: boolean;
  /** IDs of the combinations this color belongs to, ascending. */
  combinations: number[];
}

export interface DerivedColorsFile {
  colors: DerivedColor[];
}

/** Harmony label computed from the OKLCH hues of a combination's chromatic members. */
export type Harmony =
  | "monochromatic"
  | "analogous"
  | "complementary"
  | "split-complementary"
  | "triadic"
  | "other";

/** One of the book's combinations as a first-class object. */
export interface Combination {
  /** The source's combination ID, 1 to 348. */
  id: number;
  /** Member color indexes, ascending. The source records no in-book order. */
  colors: number[];
  /** Number of members. Ten combinations are singletons. */
  size: number;
  harmony: Harmony;
  /** Mean OKLab lightness of all members, 0 to 1. */
  averageLightness: number;
  /** Smallest hue arc containing every chromatic member, in degrees. */
  hueSpread: number;
  /** True when any member is neutral. */
  hasNeutral: boolean;
}

export interface CombinationsFile {
  combinations: Combination[];
}

// ---------------------------------------------------------------------------
// Loaders

/** URL of the assets directory. Resolves correctly from both `src/` and `dist/`. */
export const ASSETS_URL = new URL("../../assets/", import.meta.url);

function readJson<T>(name: string): T {
  const url = new URL(name, ASSETS_URL);
  return JSON.parse(readFileSync(url, "utf8")) as T;
}

/** Load the vendored Wada dataset, untouched. */
export function loadWadaDataset(): WadaDataset {
  return readJson<WadaDataset>("colors.json");
}

/** Load the vendored Wada colors, untouched. */
export function loadWadaColors(): WadaColor[] {
  return loadWadaDataset().colors;
}

/** Load the cleaned Wada colors with OKLab and OKLCH values. */
export function loadColors(): DerivedColor[] {
  return readJson<DerivedColorsFile>("derived/colors.json").colors;
}

/** Load the book's combinations as first-class objects. */
export function loadCombinations(): Combination[] {
  return readJson<CombinationsFile>("derived/combinations.json").combinations;
}
