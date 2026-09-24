/**
 * Recommend product colors for a design with recoloring: for each garment, a
 * Wada combination around the garment's equivalent, a from-to mapping of the
 * design's colors onto it, and a prompt describing the change. Deterministic;
 * the Jev plausibility check that vets each swap consumes this output. See
 * docs/DESIGN.md, "Pipelines", "Recommend shirts, with recoloring".
 *
 * Applying a mapping to pixels reads and writes files, so `applyRecolor` lives
 * in the fingerprint entry point.
 */

import { check, type AccessibilityOptions } from "./accessibility.js";
import { combinations, type GeneratedHarmony } from "./combinations.js";
import { contrastRatio } from "./color/contrast.js";
import { distance, type Hex, normalizeHex, toOklab } from "./color/convert.js";
import {
  type Accessibility,
  type DerivedColor,
  loadAccessibility,
  loadColors,
  loadProduct,
  loadProductIndex,
  type Product,
  type ProductColor,
} from "./data/index.js";
import { equivalentsFor } from "./equivalents.js";
import { nearest } from "./nearest.js";
import type { DesignSummary } from "./recommend.js";

// ---------------------------------------------------------------------------
// Options

export interface RecolorOptions extends AccessibilityOptions {
  /** A product ID or a loaded product. Defaults to the index's default product. */
  product?: string | Product;
  /** How many garments to return. Default 5. */
  n?: number;
  /** Skip colors the print provider does not stock. Default true. */
  availableOnly?: boolean;
  /**
   * Equivalents after the first contribute combinations only within this
   * distance of the garment hex. The nearest always contributes. Default 6, as
   * for `palettesForProductColor`.
   */
  within?: number;
  /** Replaces `RECOLOR_WEIGHTS`. */
  weights?: RecolorWeights;
}

export const RECOLOR_PLAN_DEFAULTS = {
  n: 5,
  within: 6,
} as const;

/**
 * How much each score component counts. `vanish` is subtracted; the others add.
 * Contrast and vanish match `RECOMMEND_WEIGHTS`; fidelity breaks ties between
 * plans that all clear the contrast target, favoring the one that changes the
 * design least.
 */
export interface RecolorWeights {
  contrast: number;
  vanish: number;
  fidelity: number;
}

export const RECOLOR_WEIGHTS: Readonly<RecolorWeights> = Object.freeze({
  contrast: 0.6,
  vanish: 0.6,
  fidelity: 0.3,
});

// ---------------------------------------------------------------------------
// Results

/** A Wada color, as a mapping target or a combination member. */
export interface WadaRef {
  index: number;
  name: string;
  hex: Hex;
}

/** The garment equivalent a combination was found through. Rank 1 is the nearest. */
export interface RecolorEquivalent {
  index: number;
  name: string;
  distance: number;
  rank: number;
}

interface RecolorCombinationBase {
  /** Every member, the garment's equivalent included, in the source's order. */
  colors: WadaRef[];
  equivalent: RecolorEquivalent;
}

export type RecolorCombination =
  | (RecolorCombinationBase & { source: "book"; id: number })
  | (RecolorCombinationBase & { source: "harmony"; harmony: GeneratedHarmony });

/** One design color and the Wada color it becomes. */
export interface RecolorMapping {
  from: {
    hex: Hex;
    /** Fraction of the design's opaque coverage, as the fingerprint reported it. */
    share: number;
    /** What the color paints ("strawberry body"), when the design carries it. */
    element?: string;
  };
  to: WadaRef;
}

/** The score's parts, each 0 to 1. */
export interface RecolorComponents {
  /**
   * Coverage-weighted contrast of the new inks against the garment, as progress
   * from 1:1 to the body-text AA ratio (4.5:1) and capped there, as in
   * `recommendProductColors`.
   */
  contrast: number;
  /** Summed share of the design colors whose new ink is within the print minimum distance of the garment. */
  vanish: number;
  /**
   * How little the recolor changes the design: 1 minus the coverage-weighted
   * `distance()` from each design color to its new ink, over 100 (black to
   * white), floored at 0.
   */
  fidelity: number;
}

export interface RecolorPlan {
  color: ProductColor;
  combination: RecolorCombination;
  /** One entry per design color, in the design's palette order. */
  mapping: RecolorMapping[];
  /** A short imperative paragraph for a generative recolor, naming every swap. */
  prompt: string;
  /** Weighted sum of `components`, rounded to three places. */
  score: number;
  components: RecolorComponents;
  /**
   * True when the combination has fewer other members than the design has
   * colors, so neighbors in lightness share an ink.
   */
  merged: boolean;
  /** True when a new ink vanishes into the garment. Flagged plans rank last. */
  flagged: boolean;
  reasons: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Helpers

const round = (value: number, places: number) => Number(value.toFixed(places));
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const percent = (share: number) => `${Math.round(share * 100)}%`;

const RANK_WORDS = ["", "nearest", "second nearest", "third nearest"];

let cachedRules: Accessibility | undefined;
let wadaByIndex: Map<number, DerivedColor> | undefined;

function wadaColor(index: number): DerivedColor {
  wadaByIndex ??= new Map(loadColors().map((c) => [c.index, c]));
  const color = wadaByIndex.get(index);
  if (!color) throw new RangeError(`No Wada color with index ${index}.`);
  return color;
}

const ref = (c: DerivedColor): WadaRef => ({ index: c.index, name: c.name, hex: c.hex as Hex });

function resolveProduct(product: RecolorOptions["product"]): Product {
  if (product === undefined) return loadProduct(loadProductIndex().default);
  return typeof product === "string" ? loadProduct(product) : product;
}

/**
 * The garment's equivalents: the committed ones when the product is indexed,
 * else a live nearest match, as `recommendProductColors` falls back.
 */
function garmentEquivalents(product: Product, color: ProductColor, within: number): RecolorEquivalent[] {
  let stored: { index: number; name: string; distance: number }[] | undefined;
  try {
    stored = equivalentsFor(product, color.slug)?.matches;
  } catch {
    // A product passed in directly may not be in the index.
  }
  const matches =
    stored ??
    nearest(color.hex, { k: 3 }).matches.map((m) => ({ index: m.color.index, name: m.color.name, distance: m.distance }));
  return matches
    .map((m, i) => ({ index: m.index, name: m.name, distance: m.distance, rank: i + 1 }))
    .filter((m) => m.rank === 1 || m.distance <= within);
}

/** Every `k`-element subset of `items`, each in the items' order. */
function subsets<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [head, ...rest] = items as [T, ...T[]];
  return [...subsets(rest, k - 1).map((s) => [head, ...s]), ...subsets(rest, k)];
}

// ---------------------------------------------------------------------------
// Candidates

interface Candidate {
  combination: RecolorCombination;
  /** The members other than the equivalent: the inks available to the design. */
  inks: DerivedColor[];
}

/**
 * Book combinations containing the equivalent, then harmonies generated from
 * it, each with its other members. Cached per Wada index for one call.
 */
function candidatesFor(equivalent: RecolorEquivalent, cache: Map<number, Candidate[]>): Candidate[] {
  const cached = cache.get(equivalent.index);
  if (cached) return cached.map((c) => ({ ...c, combination: { ...c.combination, equivalent } }));

  const { palettes } = combinations(wadaColor(equivalent.index).name, {
    limit: Number.MAX_SAFE_INTEGER,
    // Only this equivalent's own combinations; the others are separate equivalents.
    secondaryWithin: 0,
    // Always generate harmonies, so a garment whose book combinations are all
    // too small still has candidates.
    min: Number.MAX_SAFE_INTEGER,
  });
  const found: Candidate[] = [];
  for (const palette of palettes) {
    if (!palette.colors.some((c) => c.index === equivalent.index)) continue;
    const inks = palette.colors.filter((c) => c.index !== equivalent.index);
    if (inks.length === 0) continue;
    const colors = palette.colors.map(ref);
    found.push({
      inks,
      combination:
        palette.source === "book"
          ? { source: "book", id: palette.combination.id, colors, equivalent }
          : { source: "harmony", harmony: palette.harmony, colors, equivalent },
    });
  }
  cache.set(equivalent.index, found);
  return found;
}

// ---------------------------------------------------------------------------
// Mapping

interface DesignEntry {
  hex: Hex;
  share: number;
  /** Share over the palette's total, so shares sum to 1. */
  weight: number;
  lightness: number;
  element?: string;
}

/**
 * Map design colors onto inks by lightness rank, so hierarchy survives: the
 * darkest design color takes the darkest ink, and so on. With fewer inks than
 * design colors, the lightness-sorted design colors are split into as many
 * contiguous runs as there are inks, and each run shares one ink.
 */
export function mapByLightness<T extends { lightness: number }, U extends { oklab: { l: number } }>(
  design: readonly T[],
  inks: readonly U[],
): Map<T, U> {
  if (inks.length === 0) throw new RangeError("No inks to map onto.");
  const byLight = [...design].sort((a, b) => a.lightness - b.lightness);
  const targets = [...inks].sort((a, b) => a.oklab.l - b.oklab.l);
  const k = byLight.length;
  const m = Math.min(targets.length, k);
  // More inks than design colors is resolved by the caller choosing a subset.
  const used = targets.length > k ? targets.slice(0, k) : targets;
  return new Map(byLight.map((d, j) => [d, used[Math.floor((j * m) / k)]!]));
}

/** Sum of the weighted components, rounded as `score` is. */
export function scoreRecolor(components: RecolorComponents, weights: RecolorWeights = RECOLOR_WEIGHTS): number {
  return round(
    weights.contrast * components.contrast -
      weights.vanish * components.vanish +
      weights.fidelity * components.fidelity,
    3,
  );
}

/** `a`, `a and b`, `a, b, and c`. */
function list(items: readonly string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

// ---------------------------------------------------------------------------
// Sentences

function swapPhrase(entry: RecolorMapping): string {
  const subject = entry.from.element ? `the ${entry.from.element}` : `the ${entry.from.hex} areas`;
  const target = `${entry.to.name} ${entry.to.hex}`;
  // Below a just-noticeable difference the swap is not a change.
  return distance(entry.from.hex, entry.to.hex) < 2 ? `keep ${subject} as ${target}` : `change ${subject} to ${target}`;
}

/**
 * The recolor prompt: a short imperative paragraph naming every swap, from a
 * template, not a model.
 */
export function recolorPrompt(garment: string, mapping: readonly RecolorMapping[]): string {
  const swaps = mapping.map(swapPhrase);
  return (
    `Recolor the artwork for a ${garment} shirt: ${swaps.join("; ")}. ` +
    `Keep the shapes, line work, and transparent areas unchanged.`
  );
}

function combinationPhrase(combination: RecolorCombination): string {
  return combination.source === "book"
    ? `book combination ${combination.id}`
    : `the ${combination.harmony} harmony`;
}

// ---------------------------------------------------------------------------
// recolorPlans

interface Scored {
  plan: RecolorPlan;
  /** Preference tier within a garment: lower wins. */
  tier: number;
  /** Design colors beyond the inks available, 0 unless merged: fewer wins within a tier. */
  shortfall: number;
}

/** Whether `a` is strictly better than `b` within one garment. */
function better(a: Scored, b: Scored): boolean {
  if (a.tier !== b.tier) return a.tier < b.tier;
  if (a.shortfall !== b.shortfall) return a.shortfall < b.shortfall;
  return a.plan.score > b.plan.score;
}

/**
 * For each garment, the best recolor plan: a Wada combination containing one
 * of the garment's equivalents, and the design's colors mapped onto its other
 * members by lightness.
 *
 * Within a garment, plans are preferred in this order, and the highest score
 * wins within the first tier that has any:
 *
 * 1. a book combination with at least as many other members as the design has
 *    colors;
 * 2. a harmony with enough members;
 * 3. a book combination with fewer, where neighbors in lightness share an ink;
 * 4. a harmony with fewer.
 *
 * In tiers 3 and 4, the combination with the most other members wins before
 * score, so as few design colors as possible share an ink.
 *
 * With more members than design colors, every subset of the right size is
 * tried. A plan where any new ink is within the print minimum distance of the
 * garment is flagged, and used only when the garment has no other plan.
 * Garments are ranked unflagged first, then by score.
 *
 * @throws {RangeError} when the design has no colors, or `n` is not a positive integer.
 * @throws {Error} when the product ID is unknown.
 */
export function recolorPlans(design: DesignSummary, options: RecolorOptions = {}): RecolorPlan[] {
  const n = options.n ?? RECOLOR_PLAN_DEFAULTS.n;
  if (!(Number.isInteger(n) && n > 0)) throw new RangeError(`n must be a positive integer, got ${n}`);
  if (design.palette.length === 0) {
    throw new RangeError("The design has no visible colors to recolor.");
  }
  const rules = options.rules ?? (cachedRules ??= loadAccessibility());
  const product = resolveProduct(options.product);
  const availableOnly = options.availableOnly ?? true;
  const within = options.within ?? RECOLOR_PLAN_DEFAULTS.within;
  const target = rules.wcag.body.AA;
  const weights = options.weights ?? RECOLOR_WEIGHTS;

  const totalShare = design.palette.reduce((sum, c) => sum + c.share, 0);
  const entries: DesignEntry[] = design.palette.map((c) => {
    const hex = normalizeHex(c.hex);
    const entry: DesignEntry = {
      hex,
      share: c.share,
      weight: totalShare > 0 ? c.share / totalShare : 1 / design.palette.length,
      lightness: toOklab(hex).l,
    };
    if (c.element) entry.element = c.element;
    return entry;
  });

  const cache = new Map<number, Candidate[]>();
  const best: Scored[] = [];
  for (const color of product.colors) {
    if (!color.hex || (availableOnly && !color.available)) continue;
    let chosen: Scored | undefined;
    for (const equivalent of garmentEquivalents(product, color, within)) {
      for (const candidate of candidatesFor(equivalent, cache)) {
        const merged = candidate.inks.length < entries.length;
        const inkSets = merged ? [candidate.inks] : subsets(candidate.inks, entries.length);
        for (const inks of inkSets) {
          const plan = buildPlan(color, candidate.combination, entries, inks, merged, { rules, target, weights });
          const scored: Scored = {
            plan,
            tier: (plan.flagged ? 4 : 0) + (merged ? 2 : 0) + (candidate.combination.source === "harmony" ? 1 : 0),
            shortfall: Math.max(0, entries.length - inks.length),
          };
          // Strictly better only, so ties keep the nearer equivalent and the
          // earlier combination.
          if (!chosen || better(scored, chosen)) chosen = scored;
        }
      }
    }
    if (chosen) best.push(chosen);
  }

  // Array sort is stable, so equal scores keep product file order.
  return best
    .sort((a, b) => Number(a.plan.flagged) - Number(b.plan.flagged) || b.plan.score - a.plan.score)
    .slice(0, n)
    .map((s) => s.plan);
}

function buildPlan(
  color: ProductColor,
  combination: RecolorCombination,
  entries: readonly DesignEntry[],
  inks: readonly DerivedColor[],
  merged: boolean,
  { rules, target, weights }: { rules: Accessibility; target: number; weights: RecolorWeights },
): RecolorPlan {
  const garment = color.name;
  const assigned = mapByLightness(entries, inks);
  const mapping: RecolorMapping[] = entries.map((e) => {
    const to = assigned.get(e)!;
    const from: RecolorMapping["from"] = { hex: e.hex, share: round(e.share, 4) };
    if (e.element) from.element = e.element;
    return { from, to: ref(to) };
  });

  // The new inks against the garment and against each other, as printed.
  const used = [...new Map(mapping.map((m) => [m.to.index, m.to])).values()];
  const printed = check([{ hex: color.hex, name: garment }, ...used.map((c) => ({ hex: c.hex, name: c.name }))], {
    context: "print",
    rules,
  });
  const vanishing = new Set(
    printed.pairs.filter((p) => p.tooClose && p.background.hex === normalizeHex(color.hex)).map((p) => p.foreground.hex),
  );
  const crowded = printed.pairs.filter(
    (p) => p.tooClose && p.background.hex !== normalizeHex(color.hex) && p.foreground.hex !== normalizeHex(color.hex),
  );

  const ratios = mapping.map((m) => round(contrastRatio(m.to.hex, color.hex), 2));
  const components: RecolorComponents = {
    contrast: round(
      entries.reduce((sum, e, i) => sum + e.weight * clamp01((ratios[i]! - 1) / (target - 1)), 0),
      4,
    ),
    vanish: round(
      entries.reduce((sum, e, i) => sum + (vanishing.has(mapping[i]!.to.hex) ? e.weight : 0), 0),
      4,
    ),
    fidelity: round(
      clamp01(1 - entries.reduce((sum, e, i) => sum + e.weight * distance(e.hex, mapping[i]!.to.hex), 0) / 100),
      4,
    ),
  };

  const { equivalent } = combination;
  const reasons = [
    `Uses ${combinationPhrase(combination)} around Wada's ${equivalent.name}, the ${RANK_WORDS[equivalent.rank] ?? `rank ${equivalent.rank}`} Wada color to ${garment} (distance ${round(equivalent.distance, 1)}).`,
  ];
  const lowest = ratios.reduce((a, b) => Math.min(a, b));
  const lowestInk = mapping[ratios.indexOf(lowest)]!.to;
  reasons.push(
    ratios.every((r) => r >= target)
      ? `Every new ink clears ${target}:1 on ${garment}; ${lowestInk.name} is the lowest at ${lowest}:1.`
      : `${lowestInk.name} is the lowest-contrast new ink on ${garment} at ${lowest}:1, below ${target}:1.`,
  );
  if (merged) {
    const shared = used
      .map((ink) => ({ ink, from: mapping.filter((m) => m.to.index === ink.index).map((m) => m.from.hex) }))
      .filter((s) => s.from.length > 1)
      .map((s) => `${list(s.from)} ${s.from.length === 2 ? "both" : "all"} become ${s.ink.name}`);
    reasons.push(
      `The design has ${entries.length} colors and the combination only ${inks.length} besides ${equivalent.name}, ` +
        `so neighbors in lightness share an ink: ${shared.join("; ")}.`,
    );
  }

  const minimum = rules.print.minimumDistance.value;
  const warnings = mapping
    .filter((m) => vanishing.has(m.to.hex))
    .map(
      (m) =>
        `${m.from.hex}, ${percent(m.from.share)} of the design, becomes ${m.to.name} ${m.to.hex}, ` +
        `within the print minimum of ${minimum} of ${garment}; it will vanish into the shirt.`,
    );
  // Each unordered pair appears twice among the ordered pairs.
  for (const p of crowded.filter((p) => p.foreground.hex < p.background.hex)) {
    warnings.push(
      `${p.foreground.name} and ${p.background.name} are only ${p.distance} apart; they will read as one color on fabric.`,
    );
  }
  if (!printed.cvdSafe) {
    warnings.push(...printed.cvd.flatMap((r) => (r.collapsed.length ? r.reasons : [])));
  }

  return {
    color,
    combination,
    mapping,
    prompt: recolorPrompt(garment, mapping),
    score: scoreRecolor(components, weights),
    components,
    merged,
    flagged: vanishing.size > 0,
    reasons,
    warnings,
  };
}
