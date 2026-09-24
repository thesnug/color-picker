/**
 * `@thesnug/color-picker/data`: the vendored and derived JSON assets, typed.
 *
 * Files are read at call time so consumers only pay for the assets they use.
 * `assets/colors.json` is the Wada source and is never edited by hand.
 * `scripts/build-data.ts` derives `assets/derived/colors.json` and
 * `assets/derived/combinations.json` from it; CI fails when they are stale.
 * Products live one file each in `assets/products/`, validated against
 * `assets/schemas/product.schema.json` by `scripts/validate-products.ts`.
 * See docs/DESIGN.md, "Data".
 */

import { readFileSync } from "node:fs";

import type { Oklab, Oklch } from "../color/convert.js";
import type { Deficiency } from "../color/cvd.js";

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

export type { Oklab, Oklch };

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
// Products. Shapes match assets/schemas/product.schema.json and
// assets/schemas/products-index.schema.json.

export type PrintMethod = "dtg" | "dtf" | "screen" | "embroidery" | "sublimation";

/** A printable region of a product. */
export interface PrintArea {
  /** For example `front`, `back`, `left-sleeve`. */
  position: string;
  /** Inches. */
  width: number;
  /** Inches. */
  height: number;
}

/**
 * Where a product hex came from: the Printify catalog, a named retail chart
 * (`retail-chart:<name>`), or a manual review against the garment image.
 * `reviewed` values are never overwritten by an import script.
 */
export type ProductColorSource = "printify" | "reviewed" | `retail-chart:${string}`;

/** One color of a product. */
export interface ProductColor {
  name: string;
  slug: string;
  /** Lowercase `#rrggbb`. */
  hex: string;
  aliases: string[];
  /** Broad color family used for grouping, lowercase. */
  family: string;
  /** False for colors the print provider does not stock. */
  available: boolean;
  source: ProductColorSource;
  /** When the hex was fetched or reviewed, `YYYY-MM-DD`. */
  sourceDate: string;
  /** Public garment image. A pointer, never the bytes. */
  image?: { url: string; sha256: string };
  /** A pointer for the picker. Never authority over which render version is current. */
  pod?: { colorAssetVersionId: string };
}

/** One garment product. This repo owns these facts; see docs/DESIGN.md, "Products". */
export interface Product {
  /** Stable product ID. Matches the file name without `.json`. */
  id: string;
  brand: string;
  model: string;
  /** Display name. */
  name: string;
  printMethod: PrintMethod;
  printAreas: PrintArea[];
  colors: ProductColor[];
}

export interface ProductIndex {
  /** Product used when no product is named. */
  default: string;
  products: { id: string; name: string }[];
}

// ---------------------------------------------------------------------------
// Accessibility. Shape matches assets/accessibility.json.

/** A threshold group from WCAG 2.2. `AAA` is null where WCAG defines no AAA level. */
export interface WcagThresholds {
  AA: number;
  AAA: number | null;
  source: string;
  definition?: string;
  note?: string;
}

export interface ApcaLevel {
  minimum: number;
  preferred?: number;
  note: string;
}

export interface Accessibility {
  wcag: {
    version: string;
    source: string;
    body: WcagThresholds;
    large: WcagThresholds;
    nonText: WcagThresholds;
  };
  apca: {
    version: string;
    source: string;
    body: ApcaLevel;
    content: ApcaLevel;
    large: ApcaLevel;
    nonText: ApcaLevel;
    invisible: { maximum: number; note: string };
  };
  print: {
    /** Minimum `distance()` between two colors printed together. */
    minimumDistance: { value: number; units: string; note: string; source: string };
    /** Garments at or below this WCAG relative luminance are dark: dark ink is not recommended. */
    darkInkGarmentLuminance: { value: number; units: string; note: string; source: string };
    underbase: { note: string; source: string };
  };
  cvd: {
    simulations: Deficiency[];
    note: string;
    source: string;
  };
}

// ---------------------------------------------------------------------------
// Loaders

/** URL of the assets directory. Resolves correctly from both `src/` and `dist/`. */
export const ASSETS_URL = new URL("../../assets/", import.meta.url);

function readJson<T>(name: string): T {
  const url = new URL(name, ASSETS_URL);
  return JSON.parse(readFileSync(url, "utf8")) as T;
}

/** Drop the editor-only `$schema` pointer that product files carry. */
function withoutSchema<T extends object>(value: T & { $schema?: string }): T {
  const { $schema: _schema, ...rest } = value;
  return rest as T;
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

/** Load `assets/products/index.json`. */
export function loadProductIndex(): ProductIndex {
  return withoutSchema(readJson<ProductIndex>("products/index.json"));
}

/**
 * Load one product by ID. Only IDs listed in the index are accepted, so the ID
 * never reaches the file system unchecked.
 */
export function loadProduct(id: string): Product {
  const index = loadProductIndex();
  if (!index.products.some((p) => p.id === id)) {
    const known = index.products.map((p) => p.id).join(", ");
    throw new Error(`Unknown product "${id}". Known products: ${known}.`);
  }
  return withoutSchema(readJson<Product>(`products/${id}.json`));
}

/** Load the default product, Comfort Colors 1717 unless the index says otherwise. */
export function defaultProduct(): Product {
  return loadProduct(loadProductIndex().default);
}

/** Load the accessibility and print thresholds, `assets/accessibility.json`. */
export function loadAccessibility(): Accessibility {
  const { $comment: _comment, ...rest } = readJson<Accessibility & { $comment?: string }>("accessibility.json");
  return rest;
}
