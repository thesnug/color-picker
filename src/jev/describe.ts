/**
 * Words to color: resolve a free-text description ("dusty rose", "the brick
 * shirt", "something autumnal for a coffee brand") to a Wada color or a product
 * color. See docs/DESIGN.md, "Jev (TypeSafe System One)".
 *
 * The deterministic name lookup runs first. Only a description it cannot read
 * goes to Jev, as one Choice question whose options are every color in the
 * chosen set plus `none`.
 */

import { distance, normalizeHex, toOklch, type Hex } from "../color/convert.js";
import { colorFamily } from "../color/family.js";
import {
  loadColors,
  loadProduct,
  loadProductIndex,
  type DerivedColor,
  type Product,
  type ProductColor,
} from "../data/index.js";
import { nearest, resolveQuery, type ResolvedQuery } from "../nearest.js";
import { findProductColor } from "../palettes.js";
import { ask, type AskOptions, type ChoiceResponse } from "./index.js";

/** Bump when the question's wording, option descriptions, or meaning changes, to invalidate cached answers. */
export const DESCRIBE_COLOR_VERSION = 1;

/** Number of candidates returned. */
export const DESCRIBE_COLOR_TOP = 3;

/** The option Jev picks when no color in the set fits. */
export const NONE_LABEL = "none";

/**
 * OKLCH lightness cutoffs for the lightness word in each option's description.
 * They split the 157 Wada colors roughly into thirds.
 */
export const LIGHTNESS_WORD = {
  /** Below this, "dark". */
  darkBelow: 0.55,
  /** At or above this, "light". Between the two, "mid". */
  lightFrom: 0.72,
} as const;

export type LightnessWord = "light" | "mid" | "dark";

export type DescribeSet = "wada" | "product";

export interface DescribeToColorOptions extends Partial<Pick<AskOptions, "cache" | "model" | "client" | "signal">> {
  /** Which colors to choose from. Defaults to `"wada"`. */
  set?: DescribeSet;
  /** The product for `set: "product"`, by ID or as loaded. Defaults to the index's default product. */
  product?: string | Product;
}

/** A color from the chosen set: a Wada color, or a product color. */
export type DescribedColor = DerivedColor | ProductColor;

/** How a description was read by the name lookup: as a hex code, a dictionary name, or a product color name. */
export type DescribeResolved = ResolvedQuery | { via: "product"; hex: Hex; name: string };

/** Resolved by the deterministic name lookup; Jev was not asked. */
export interface DescribeByName<C extends DescribedColor = DescribedColor> {
  via: "name";
  text: string;
  set: DescribeSet;
  /** The product ID for `set: "product"`. */
  product?: string;
  /** How the text was read as a color. */
  resolved: DescribeResolved;
  /** Closest colors in the set, by ascending OKLab distance (scaled by 100). */
  matches: { color: C; distance: number }[];
}

/** Resolved by Jev. */
export interface DescribeByJev<C extends DescribedColor = DescribedColor> {
  via: "jev";
  text: string;
  set: DescribeSet;
  product?: string;
  /** The most probable colors, highest first, excluding `none`. */
  matches: { color: C; probability: number }[];
  /** Jev's reported confidence in its top option, which may be `none`. */
  confidence: number;
  /** Probability that no color in the set fits. */
  none: number;
  /** True when `none` was Jev's top option. */
  noneTop: boolean;
  model: string;
  cached: boolean;
}

export type DescribeResult<C extends DescribedColor = DescribedColor> = DescribeByName<C> | DescribeByJev<C>;

/**
 * Resolve a free-text color description to colors in the Wada set or a
 * product's colors.
 *
 * A description that the name lookup reads (a Wada, product, CSS, or xkcd
 * name, or a hex code) never reaches Jev. Anything else is one cached Choice
 * request. Callers decide how to use the spread: the probabilities, the
 * confidence, and the probability of `none` are returned as they came.
 *
 * @throws {JevUnavailableError} when Jev is needed, the answer is not cached,
 *   and the SDK or `TYPESAFE_API_KEY` is missing.
 * @throws {TypeError} when `text` is blank.
 */
export async function describeToColor(
  text: string,
  options: DescribeToColorOptions = {},
): Promise<DescribeResult> {
  const trimmed = text.trim();
  if (!trimmed) throw new TypeError("describeToColor needs a description.");
  const set = options.set ?? "wada";

  if (set === "wada") {
    const colors = loadColors();
    const byName = wadaByName(trimmed, colors);
    if (byName) return { via: "name", text: trimmed, set, ...byName };
    return byJev(trimmed, set, undefined, colors, wadaOption, options);
  }

  const product = resolveProduct(options.product);
  const byName = productByName(trimmed, product);
  if (byName) return { via: "name", text: trimmed, set, product: product.id, ...byName };
  return byJev(trimmed, set, product, product.colors, productOption, options);
}

/** The lightness word for a color, from its OKLCH lightness. */
export function lightnessWord(hex: string): LightnessWord {
  const { l } = toOklch(hex);
  if (l < LIGHTNESS_WORD.darkBelow) return "dark";
  if (l >= LIGHTNESS_WORD.lightFrom) return "light";
  return "mid";
}

/**
 * The Choice question for a set: one option per color, labeled by name and
 * described by hex, family, and lightness word, plus `none`. Exported so the
 * question can be inspected and audited.
 */
export function describeQuestion(set: DescribeSet, product?: string | Product) {
  if (set === "wada") return buildQuestion(set, undefined, loadColors(), wadaOption);
  const resolved = resolveProduct(product);
  return buildQuestion(set, resolved, resolved.colors, productOption);
}

// ---------------------------------------------------------------------------

type OptionDescription = Record<string, string | boolean>;

function wadaOption(color: DescribedColor): OptionDescription {
  const hex = color.hex as string;
  return { hex, family: colorFamily(hex, color.name), lightness: lightnessWord(hex) };
}

function productOption(color: DescribedColor): OptionDescription {
  const c = color as ProductColor;
  const description: OptionDescription = { family: c.family };
  if (c.hex) {
    description.hex = c.hex;
    description.lightness = lightnessWord(c.hex);
  }
  if (!c.available) description.stocked = false;
  return description;
}

function buildQuestion<C extends DescribedColor>(
  set: DescribeSet,
  product: Product | undefined,
  colors: readonly C[],
  describe: (color: C) => OptionDescription,
) {
  const criteria: Record<string, OptionDescription | string> = {};
  for (const color of colors) {
    if (color.name === NONE_LABEL || criteria[color.name]) {
      throw new Error(`Color name ${JSON.stringify(color.name)} cannot be a unique Choice label.`);
    }
    criteria[color.name] = describe(color);
  }
  criteria[NONE_LABEL] = "The text does not describe a color.";

  const scope =
    set === "wada"
      ? "the colors of Sanzo Wada's A Dictionary of Color Combinations"
      : `the garment colors of the ${product?.name ?? "product"}`;
  return {
    color: {
      type: "choice",
      instructions:
        `The state is a person's description of a color. Which one of ${scope} does it most likely mean? ` +
        "Descriptions may be poetic, name an object or material, name a garment, or describe a mood or season; " +
        "choose the closest color, and choose none only when the text does not describe a color at all.",
      criteria,
    },
  } as const;
}

async function byJev<C extends DescribedColor>(
  text: string,
  set: DescribeSet,
  product: Product | undefined,
  colors: readonly C[],
  describe: (color: C) => OptionDescription,
  options: DescribeToColorOptions,
): Promise<DescribeByJev<C>> {
  const questions = buildQuestion(set, product, colors, describe);
  const askOptions: AskOptions = { version: DESCRIBE_COLOR_VERSION };
  if (options.cache !== undefined) askOptions.cache = options.cache;
  if (options.model !== undefined) askOptions.model = options.model;
  if (options.client !== undefined) askOptions.client = options.client;
  if (options.signal !== undefined) askOptions.signal = options.signal;

  const { answers, model, cached } = await ask(text, questions, askOptions);
  const answer = answers.color as ChoiceResponse;
  const byName = new Map(colors.map((c) => [c.name, c]));
  const matches = Object.entries(answer.probabilities)
    .filter(([label]) => label !== NONE_LABEL && byName.has(label))
    .sort(([a, pa], [b, pb]) => pb - pa || a.localeCompare(b))
    .slice(0, DESCRIBE_COLOR_TOP)
    .map(([label, probability]) => ({ color: byName.get(label) as C, probability }));

  const result: DescribeByJev<C> = {
    via: "jev",
    text,
    set,
    matches,
    confidence: answer.confidence,
    none: answer.probabilities[NONE_LABEL] ?? 0,
    noneTop: answer.choice === NONE_LABEL,
    model,
    cached,
  };
  if (product) result.product = product.id;
  return result;
}

function wadaByName(
  text: string,
  colors: DerivedColor[],
): Pick<DescribeByName<DerivedColor>, "resolved" | "matches"> | undefined {
  const resolved = resolveQuery(text);
  if (!resolved) return undefined;
  const { matches } = nearest(resolved.hex, { k: DESCRIBE_COLOR_TOP, colors });
  return { resolved, matches };
}

function productByName(
  text: string,
  product: Product,
): Pick<DescribeByName<ProductColor>, "resolved" | "matches"> | undefined {
  const exact = findProductColor(product, text);
  const resolved: DescribeResolved | undefined = exact?.hex
    ? { via: "product", hex: normalizeHex(exact.hex), name: exact.name }
    : resolveQuery(text);
  if (!resolved) return undefined;
  return { resolved, matches: productNearest(resolved.hex, product) };
}

/** The product's colors closest to `hex`. Colors without a hex are reachable only through Jev. */
function productNearest(hex: string, product: Product): { color: ProductColor; distance: number }[] {
  return product.colors
    .flatMap((color) => (color.hex === null ? [] : [{ color, distance: distance(hex, color.hex) }]))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, DESCRIBE_COLOR_TOP);
}

function resolveProduct(product: DescribeToColorOptions["product"]): Product {
  if (product === undefined) return loadProduct(loadProductIndex().default);
  return typeof product === "string" ? loadProduct(product) : product;
}
