/**
 * Recommend product colors for a design, with the design unchanged. Scoring is
 * deterministic and every component is exposed, so a caller (or the Jev
 * re-rank) can reweigh picks without re-running the analysis. See
 * docs/DESIGN.md, "Pipelines", "Recommend shirts, unchanged".
 */

import { allowsDarkInk, type AccessibilityOptions } from "./accessibility.js";
import { contrastRatio } from "./color/contrast.js";
import { distance, type Hex, normalizeHex } from "./color/convert.js";
import {
  type Accessibility,
  type DerivedColor,
  hasHex,
  loadAccessibility,
  loadColors,
  loadProduct,
  loadProductIndex,
  type Product,
  type ProductColorWithHex,
} from "./data/index.js";
import { equivalentsFor } from "./equivalents.js";
import { nearest } from "./nearest.js";

// ---------------------------------------------------------------------------
// Inputs

/** One color of a design. `PaletteEntry` from the fingerprint entry point fits. */
export interface DesignColor {
  hex: string;
  /** Fraction of the design's opaque coverage, 0 to 1. */
  share: number;
  /**
   * What the color paints ("strawberry body"), from a vision description of the
   * design (`describeDesign` in the fingerprint entry point); recolor prompts
   * name it when present.
   */
  element?: string;
}

/**
 * The parts of a design fingerprint recommendations read. A `Fingerprint` from
 * `@thesnug/color-picker/fingerprint` fits.
 */
export interface DesignSummary {
  /** Top colors by coverage, largest first. */
  palette: readonly DesignColor[];
  /** Alpha-weighted mean WCAG relative luminance of the visible pixels, 0 to 1. */
  inkLuminance: number;
}

/**
 * How much each score component counts. `vanish` is subtracted; the others add.
 * Every component is 0 to 1, so the score is at most the sum of the positive
 * weights.
 */
export interface RecommendWeights {
  contrast: number;
  vanish: number;
  inkFit: number;
  bookPairing: number;
}

/**
 * Default weights. Contrast leads; a vanishing color costs about as much as the
 * contrast it would otherwise have earned; ink fit breaks ties between garments
 * with similar contrast; a shared book combination is a small nudge.
 */
export const RECOMMEND_WEIGHTS: Readonly<RecommendWeights> = Object.freeze({
  contrast: 0.6,
  vanish: 0.6,
  inkFit: 0.3,
  bookPairing: 0.1,
});

export interface RecommendOptions extends AccessibilityOptions {
  /** A product ID or a loaded product. Defaults to the index's default product. */
  product?: string | Product;
  /** How many picks to return. Default 5. */
  n?: number;
  /** Skip colors the print provider does not stock. Default true. */
  availableOnly?: boolean;
  /** Replaces `RECOMMEND_WEIGHTS`. */
  weights?: RecommendWeights;
}

// ---------------------------------------------------------------------------
// Results

/** The score's parts, each 0 to 1. */
export interface ScoreComponents {
  /**
   * Coverage-weighted contrast: each design color's WCAG contrast against the
   * garment, as progress from 1:1 to the body-text AA ratio (4.5:1) and capped
   * there, weighted by the color's share.
   */
  contrast: number;
  /** Summed share of the design colors within the print minimum distance of the garment. */
  vanish: number;
  /**
   * 1 when the ink suits the garment by the dark-ink cutoff: dark ink on a
   * garment above it, light ink on one at or below it. 0 otherwise.
   */
  inkFit: number;
  /**
   * 1 when the garment's nearest Wada color shares a book combination with the
   * nearest Wada color of the design's dominant color. 0 otherwise.
   */
  bookPairing: number;
}

/** A design color measured against one garment. */
export interface DesignColorOnGarment {
  hex: Hex;
  share: number;
  /** The nearest Wada color, used to name the design color in sentences. */
  wada: { index: number; name: string };
  /** WCAG contrast ratio against the garment, rounded to two places. */
  ratio: number;
  /** `distance()` from the garment, rounded to one place. */
  distance: number;
  /** True when closer to the garment than the print minimum distance. */
  vanishes: boolean;
}

export interface ProductColorRecommendation {
  color: ProductColorWithHex;
  /** Weighted sum of `components`, rounded to three places. */
  score: number;
  components: ScoreComponents;
  /** Every design color against this garment, in palette order. */
  designColors: DesignColorOnGarment[];
  /** The garment's nearest Wada color. */
  wada: { index: number; name: string };
  /** The book combination behind `bookPairing`, when there is one. */
  sharedCombination?: number;
  /** Plain sentences saying why the garment scored as it did. */
  reasons: string[];
  /** One sentence per design color that would vanish on this garment. */
  warnings: string[];
}

/** Ranked picks: highest score first, ties in product file order. */
export type Recommendations = ProductColorRecommendation[];

// ---------------------------------------------------------------------------
// Helpers

const round = (value: number, places: number) => Number(value.toFixed(places));
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = (n: number) => COUNT_WORDS[n] ?? String(n);
const percent = (share: number) => `${Math.round(share * 100)}%`;
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

let cachedRules: Accessibility | undefined;
let wadaByIndex: Map<number, DerivedColor> | undefined;

function wadaColor(index: number): DerivedColor {
  wadaByIndex ??= new Map(loadColors().map((c) => [c.index, c]));
  const color = wadaByIndex.get(index);
  if (!color) throw new RangeError(`No Wada color with index ${index}.`);
  return color;
}

function nearestWada(hex: string): DerivedColor {
  return nearest(hex, { k: 1 }).matches[0]!.color;
}

/** The stored equivalent when the product has one, so the answer matches `equivalentsFor`. */
function garmentWada(product: Product, color: ProductColorWithHex): DerivedColor {
  let stored: number | undefined;
  try {
    stored = equivalentsFor(product, color.slug)?.matches[0]?.index;
  } catch {
    // A product passed in directly may not be in the index; fall back to the math.
  }
  return stored === undefined ? nearestWada(color.hex) : wadaColor(stored);
}

function resolveProduct(product: RecommendOptions["product"]): Product {
  if (product === undefined) return loadProduct(loadProductIndex().default);
  return typeof product === "string" ? loadProduct(product) : product;
}

function designName(color: DesignColorOnGarment): string {
  return `${color.hex} (near ${color.wada.name})`;
}

/** Sum of the weighted components, rounded as `score` is. */
export function scoreComponents(components: ScoreComponents, weights: RecommendWeights = RECOMMEND_WEIGHTS): number {
  return round(
    weights.contrast * components.contrast -
      weights.vanish * components.vanish +
      weights.inkFit * components.inkFit +
      weights.bookPairing * components.bookPairing,
    3,
  );
}

// ---------------------------------------------------------------------------
// Sentences

function contrastReason(colors: DesignColorOnGarment[], garment: string, target: number): string {
  const clearing = colors.filter((c) => c.ratio >= target);
  const lowest = colors.reduce((a, b) => (b.ratio < a.ratio ? b : a));
  if (colors.length === 1) {
    return lowest.ratio >= target
      ? `The design's one color, ${designName(lowest)}, clears ${target}:1 on ${garment} at ${lowest.ratio}:1.`
      : `The design's one color, ${designName(lowest)}, reaches only ${lowest.ratio}:1 on ${garment}, below ${target}:1.`;
  }
  if (clearing.length === colors.length) {
    const all = colors.length === 2 ? "Both" : `All ${count(colors.length)}`;
    return `${all} design colors clear ${target}:1 on ${garment}; ${designName(lowest)} is the closest at ${lowest.ratio}:1.`;
  }
  const share = colors.filter((c) => c.ratio < target).reduce((sum, c) => sum + c.share, 0);
  return (
    `${capitalize(count(clearing.length))} of ${count(colors.length)} design colors ${clearing.length === 1 ? "clears" : "clear"} ${target}:1 on ${garment}; ` +
    `${designName(lowest)} is the lowest at ${lowest.ratio}:1, and colors below ${target}:1 cover ${percent(share)} of the design.`
  );
}

function inkReason(
  inkLuminance: number,
  darkInkGarment: boolean,
  garment: string,
  cutoff: number,
  printMethod: Product["printMethod"],
): string {
  const ink = round(inkLuminance, 2);
  const darkInk = inkLuminance <= cutoff;
  if (darkInkGarment) {
    return darkInk
      ? `The ink is dark overall (luminance ${ink}), which suits a light garment like ${garment}.`
      : `The ink is light overall (luminance ${ink}), and ${garment} is a light garment, so the design reads faintly.`;
  }
  return darkInk
    ? `The ink is dark overall (luminance ${ink}), and ${garment} is a dark garment, so the design sinks into the fabric.`
    : `The ink is light overall (luminance ${ink}), which suits a dark garment like ${garment}` +
        (printMethod === "dtg" ? "; DTG prints it over a white underbase." : ".");
}

// ---------------------------------------------------------------------------
// recommendProductColors

/**
 * Rank a product's colors for a design printed as is.
 *
 * Each garment gets four components, exposed on the result: coverage-weighted
 * contrast, a vanish penalty for design colors within the print minimum
 * distance of the garment, ink fit by the dark-ink luminance cutoff, and a book
 * pairing bonus. `score` combines them with `weights`; `scoreComponents`
 * recombines them with other weights without re-running the analysis.
 *
 * @throws {RangeError} when the design has no colors, or `n` is not a positive integer.
 * @throws {Error} when the product ID is unknown.
 */
export function recommendProductColors(design: DesignSummary, options: RecommendOptions = {}): Recommendations {
  const n = options.n ?? 5;
  if (!(Number.isInteger(n) && n > 0)) throw new RangeError(`n must be a positive integer, got ${n}`);
  if (design.palette.length === 0) {
    throw new RangeError("The design has no visible colors to recommend a garment for.");
  }

  const rules = options.rules ?? (cachedRules ??= loadAccessibility());
  const weights = options.weights ?? RECOMMEND_WEIGHTS;
  const product = resolveProduct(options.product);
  const availableOnly = options.availableOnly ?? true;
  const target = rules.wcag.body.AA;
  const minimum = rules.print.minimumDistance.value;
  const cutoff = rules.print.darkInkGarmentLuminance.value;

  // Shares may not sum to 1 when the fingerprint dropped small clusters.
  const totalShare = design.palette.reduce((sum, c) => sum + c.share, 0);
  const palette = design.palette.map((c) => {
    const hex = normalizeHex(c.hex);
    const wada = nearestWada(hex);
    return { hex, share: totalShare > 0 ? c.share / totalShare : 1 / design.palette.length, wada };
  });
  const dominant = palette.reduce((a, b) => (b.share > a.share ? b : a)).wada;
  const dominantCombos = new Set(dominant.combinations);

  const picks = product.colors
    .filter(hasHex)
    .filter((color) => !availableOnly || color.available)
    .map((color): ProductColorRecommendation => {
      const garment = color.name;
      const designColors = palette.map((c): DesignColorOnGarment => {
        const gap = round(distance(c.hex, color.hex), 1);
        return {
          hex: c.hex,
          share: round(c.share, 4),
          wada: { index: c.wada.index, name: c.wada.name },
          ratio: round(contrastRatio(c.hex, color.hex), 2),
          distance: gap,
          vanishes: gap < minimum,
        };
      });

      const darkInkGarment = allowsDarkInk(color.hex, { rules });
      const wada = garmentWada(product, color);
      const sharedCombination = wada.combinations.find((id) => dominantCombos.has(id));

      const components: ScoreComponents = {
        contrast: round(
          palette.reduce((sum, c, i) => sum + c.share * clamp01((designColors[i]!.ratio - 1) / (target - 1)), 0),
          4,
        ),
        vanish: round(
          palette.reduce((sum, c, i) => sum + (designColors[i]!.vanishes ? c.share : 0), 0),
          4,
        ),
        inkFit: darkInkGarment === design.inkLuminance <= cutoff ? 1 : 0,
        bookPairing: sharedCombination === undefined ? 0 : 1,
      };

      const reasons = [
        contrastReason(designColors, garment, target),
        inkReason(design.inkLuminance, darkInkGarment, garment, cutoff, product.printMethod),
      ];
      if (sharedCombination !== undefined) {
        reasons.push(
          wada.index === dominant.index
            ? `${garment} is nearest to Wada's ${wada.name}, the same Wada color as the design's dominant color.`
            : `${garment} is nearest to Wada's ${wada.name}, which the book pairs with ${dominant.name}, the design's dominant color, in combination ${sharedCombination}.`,
        );
      }
      const warnings = designColors
        .filter((c) => c.vanishes)
        .map(
          (c) =>
            `${designName(c)}, ${percent(c.share)} of the design, is only ${c.distance} from ${garment}; ` +
            `below the print minimum of ${minimum}, its edges will vanish into the shirt.`,
        );

      const pick: ProductColorRecommendation = {
        color,
        score: scoreComponents(components, weights),
        components,
        designColors,
        wada: { index: wada.index, name: wada.name },
        reasons,
        warnings,
      };
      if (sharedCombination !== undefined) pick.sharedCombination = sharedCombination;
      return pick;
    });

  // Array sort is stable, so equal scores keep product file order.
  return picks.sort((a, b) => b.score - a.score).slice(0, n);
}
