/**
 * `@thesnug/color-picker/data`: the vendored JSON assets, typed.
 *
 * Files are read at call time so consumers only pay for the assets they use.
 * `assets/colors.json` is the Wada source and is never edited by hand; cleanups
 * produce derived files alongside it. See docs/DESIGN.md.
 */

import { readFileSync } from "node:fs";

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

/** URL of the assets directory. Resolves correctly from both `src/` and `dist/`. */
export const ASSETS_URL = new URL("../../assets/", import.meta.url);

function readJson<T>(name: string): T {
  const url = new URL(name, ASSETS_URL);
  return JSON.parse(readFileSync(url, "utf8")) as T;
}

/** Load the vendored Wada dataset. */
export function loadWadaDataset(): WadaDataset {
  return readJson<WadaDataset>("colors.json");
}

/** Load the vendored Wada colors. */
export function loadWadaColors(): WadaColor[] {
  return loadWadaDataset().colors;
}
