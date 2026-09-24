/**
 * Palettes for a product color by name: "give me palettes for Blue Spruce".
 * Reads the garment's committed Wada equivalents, never a live nearest match,
 * and builds each palette around the real garment hex, since ink goes on the
 * shirt and not on its Wada stand-in. See docs/DESIGN.md, "Pipelines".
 */

import { contrastRatio } from "./color/contrast.js";
import {
  combinations,
  COMBINATION_DEFAULTS,
  type GeneratedHarmony,
  type HarmonySnap,
  type Palette,
} from "./combinations.js";
import {
  type Combination,
  type DerivedColor,
  type EquivalentMatch,
  loadProduct,
  loadProductIndex,
  type Product,
  type ProductColor,
} from "./data/index.js";
import { equivalentsFor } from "./equivalents.js";

export interface ProductPalettesOptions {
  /** A product ID or a loaded product. Defaults to the index's default product. */
  product?: string | Product;
  /** Maximum palettes returned. Default 12. */
  limit?: number;
  /**
   * Only palettes with this many colors, counting the garment. Defaults to
   * every size from 2 up, as for `combinations`.
   */
  size?: number | readonly number[];
  /**
   * Equivalents after the first contribute only within this distance of the
   * garment hex. The nearest always contributes. Default 6, the same reach
   * `combinations` gives its second and third matches.
   */
  within?: number;
}

/** The garment, standing in for its Wada equivalent at the head of a palette. */
export interface GarmentAnchor {
  anchor: true;
  name: string;
  slug: string;
  /** The product hex, lowercase `#rrggbb`. */
  hex: string;
  available: boolean;
  /** Public garment image, when the product has one. */
  image?: { url: string; sha256: string };
}

/** A Wada color printed on the garment. */
export type InkColor = DerivedColor & { anchor: false };

/** One of the garment's stored equivalents, with its rank among them. */
export type PaletteEquivalent = EquivalentMatch & { rank: number };

interface ProductPaletteBase {
  /** The garment first, then the Wada colors printed on it. */
  colors: [GarmentAnchor, ...InkColor[]];
  /** The equivalent the palette was found through; the garment replaces it. */
  equivalent: PaletteEquivalent;
  /** Mean WCAG contrast ratio of the ink colors against the garment hex. */
  contrast: number;
  /** Lowest WCAG contrast ratio of any ink color against the garment hex. */
  minContrast: number;
}

export interface ProductBookPalette extends ProductPaletteBase {
  source: "book";
  combination: Combination;
}

export interface ProductHarmonyPalette extends ProductPaletteBase {
  source: "harmony";
  harmony: GeneratedHarmony;
  /** Each generated color and the Wada color it snapped to, as `combinations` returns them. */
  snaps: HarmonySnap[];
}

export type ProductPalette = ProductBookPalette | ProductHarmonyPalette;

export interface ProductPalettesResult {
  product: { id: string; name: string };
  /** The resolved product color. Absent when the name matched none. */
  color?: ProductColor;
  /** False when the print provider does not stock the color, so callers can warn. */
  available?: boolean;
  /** The equivalents that contributed palettes, nearest first. */
  equivalents: PaletteEquivalent[];
  /**
   * Book palettes first, then harmonies; each group by mean contrast against
   * the garment hex, highest first.
   */
  palettes: ProductPalette[];
  /** Why `palettes` is empty. Absent when there are palettes. */
  reason?: string;
}

/**
 * Ranked palettes for a product color named by its name, slug, or an alias,
 * ignoring case. Each palette leads with the garment, marked as the anchor,
 * then the Wada colors to print on it. Unknown names return no palettes and a
 * `reason`; they never throw.
 *
 * @throws {Error} when the product ID is unknown.
 * @throws {RangeError} for a non-integer or out-of-range `size` or `limit`.
 */
export function palettesForProductColor(
  colorNameOrSlug: string,
  options: ProductPalettesOptions = {},
): ProductPalettesResult {
  const { limit = COMBINATION_DEFAULTS.limit, within = COMBINATION_DEFAULTS.secondaryWithin } = options;
  if (!(Number.isInteger(limit) && limit > 0)) {
    throw new RangeError(`limit must be a positive integer, got ${limit}`);
  }
  const product = resolveProduct(options.product);
  const summary = { id: product.id, name: product.name };

  const color = findProductColor(product, colorNameOrSlug);
  if (!color) {
    return {
      product: summary,
      equivalents: [],
      palettes: [],
      reason: `${product.name} has no color named ${JSON.stringify(colorNameOrSlug)}.`,
    };
  }
  const found = { product: summary, color, available: color.available };

  const matches = equivalentsFor(product, color.slug)?.matches ?? [];
  const equivalents = matches
    .map((m, i): PaletteEquivalent => ({ ...m, rank: i + 1 }))
    .filter((m) => m.rank === 1 || m.distance <= within);
  if (!color.hex || equivalents.length === 0) {
    return { ...found, equivalents, palettes: [], reason: `${color.name} has no hex to match.` };
  }

  const anchor: GarmentAnchor = {
    anchor: true,
    name: color.name,
    slug: color.slug,
    hex: color.hex,
    available: color.available,
    ...(color.image && { image: color.image }),
  };

  // Each equivalent's own palettes only; the stored equivalents replace the
  // nearest-match reach `combinations` would otherwise add. Nearest first, so
  // a combination reached twice keeps the closer equivalent.
  const seen = new Set<string>();
  const book: ProductBookPalette[] = [];
  const harmonies: ProductHarmonyPalette[] = [];
  for (const equivalent of equivalents) {
    const { palettes } = combinations(equivalent.name, {
      anchor: equivalent.index,
      limit: Number.MAX_SAFE_INTEGER,
      secondaryWithin: 0,
      ...(options.size !== undefined && { size: options.size }),
    });
    for (const palette of palettes) {
      const ink = palette.colors.filter((c) => c.index !== equivalent.index);
      const key =
        palette.source === "book"
          ? `book:${palette.combination.id}`
          : `ink:${ink.map((c) => c.index).sort((a, b) => a - b).join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const onGarment = onShirt(palette, anchor, ink, equivalent);
      if (onGarment.source === "book") book.push(onGarment);
      else harmonies.push(onGarment);
    }
  }

  const palettes = [...book.sort(byContrast), ...harmonies.sort(byContrast)].slice(0, limit);
  if (palettes.length === 0) {
    return { ...found, equivalents, palettes, reason: `No palettes for ${color.name} match the given options.` };
  }
  return { ...found, equivalents, palettes };
}

/**
 * The product color whose name, slug, or alias matches, ignoring case and
 * treating spaces, hyphens, and underscores alike.
 */
export function findProductColor(product: Product, nameOrSlug: string): ProductColor | undefined {
  const wanted = normalizeName(nameOrSlug);
  if (!wanted) return undefined;
  return product.colors.find((c) => [c.name, c.slug, ...c.aliases].some((n) => normalizeName(n) === wanted));
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

function resolveProduct(product: ProductPalettesOptions["product"]): Product {
  if (product === undefined) return loadProduct(loadProductIndex().default);
  return typeof product === "string" ? loadProduct(product) : product;
}

function onShirt(
  palette: Palette,
  anchor: GarmentAnchor,
  ink: DerivedColor[],
  equivalent: PaletteEquivalent,
): ProductPalette {
  const ratios = ink.map((c) => contrastRatio(c.hex, anchor.hex));
  const base: ProductPaletteBase = {
    colors: [anchor, ...ink.map((c): InkColor => ({ ...c, anchor: false }))],
    equivalent,
    contrast: round(ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 1),
    minContrast: round(ratios.length ? Math.min(...ratios) : 1),
  };
  return palette.source === "book"
    ? { source: "book", combination: palette.combination, ...base }
    : { source: "harmony", harmony: palette.harmony, snaps: palette.snaps, ...base };
}

// Array sort is stable, so equal contrasts keep equivalent order.
function byContrast(a: ProductPalette, b: ProductPalette): number {
  return b.contrast - a.contrast;
}

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}
