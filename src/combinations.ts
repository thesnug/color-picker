/**
 * Combinations for a color: the book's combinations for the nearest Wada
 * matches, then generated harmonies snapped to Wada colors when the book gives
 * too few. Pure math, no model. See docs/DESIGN.md, "Pipelines".
 */

import { contrastRatio } from "./color/contrast.js";
import { toHex, toOklch, type ColorInput, type Oklch } from "./color/convert.js";
import { analogous, complementary, hueArc, splitComplementary, triadic } from "./color/harmony.js";
import {
  loadColors,
  loadCombinations,
  type Combination,
  type DerivedColor,
} from "./data/index.js";
import { nearest, type NearestMatch, type ResolvedQuery } from "./nearest.js";

/** Defaults for `combinations`. */
export const COMBINATION_DEFAULTS = {
  /** Generate harmonies when the book gives fewer palettes than this. */
  min: 6,
  /** Maximum palettes returned. */
  limit: 12,
  /** Second and third matches within this distance contribute their combinations. */
  secondaryWithin: 6,
  /** A harmony is skipped when any generated color snaps farther than this. */
  snapWithin: 8,
  /**
   * OKLab chroma at or below which the input counts as gray and the
   * neutral-anchor rule is considered. The same cutoff as the neutral color
   * family. Among Comfort Colors 1717 it catches Black, White, Grey, Granite,
   * Graphite, and Pepper; Navy (0.0195) is the first color above it.
   */
  neutralChroma: 0.015,
  /**
   * The nearest Wada neutral replaces the plain nearest match only when it is
   * no farther than this multiple of the plain distance.
   */
  neutralMargin: 1.5,
} as const;

export type GeneratedHarmony = "complementary" | "split-complementary" | "triadic" | "analogous";

const GENERATORS: [GeneratedHarmony, (input: ColorInput) => Oklch[]][] = [
  ["complementary", complementary],
  ["split-complementary", (c) => splitComplementary(c)],
  ["triadic", triadic],
  ["analogous", (c) => analogous(c)],
];

export interface CombinationsOptions {
  /**
   * Only palettes with this many colors. Defaults to every size from 2 up;
   * the book's ten single-color combinations appear only when 1 is asked for.
   */
  size?: number | readonly number[];
  /**
   * When false, drop palettes with a neutral member other than the matched
   * color itself. Default true.
   */
  includeNeutrals?: boolean;
  /** Maximum palettes returned. Default 12. */
  limit?: number;
  /** Generate harmonies when the book gives fewer palettes than this. Default 6. */
  min?: number;
  /** Distance within which the second and third matches contribute. Default 6. */
  secondaryWithin?: number;
  /** Skip a harmony when any of its colors snaps farther than this. Default 8. */
  snapWithin?: number;
  /**
   * OKLab chroma at or below which the input counts as gray and may anchor on
   * the nearest neutral Wada color. Default 0.015.
   */
  neutralChroma?: number;
  /**
   * A gray input anchors on the nearest neutral Wada color only when it is no
   * farther than this multiple of the plain nearest distance. Default 1.5.
   */
  neutralMargin?: number;
  /**
   * Build palettes around this Wada color, given by index or slug, instead of
   * resolving an anchor from the input. For callers that already know the
   * color, such as a garment's stored equivalent. The input still resolves,
   * for `resolved`, the anchor distance, and the second and third matches.
   */
  anchor?: number | string;
}

export interface CombinationAnchor {
  /** The Wada color palettes are built around. */
  color: DerivedColor;
  /** Distance from the input to the anchor. */
  distance: number;
  /**
   * `nearest` for the plain nearest match; `nearest-neutral` when the input is
   * gray and the nearest neutral Wada color is close enough to win; `anchor`
   * when the caller passed the anchor.
   */
  via: "nearest" | "nearest-neutral" | "anchor";
  /** The plain nearest matches by pure distance, reported alongside. */
  nearest: NearestMatch[];
  /**
   * When the input was gray and the neutral-anchor rule was considered, the
   * candidate that lost: the nearest neutral when `via` is `nearest`, the
   * plain nearest when `via` is `nearest-neutral`. Absent when the rule was
   * not considered or both candidates are the same color.
   */
  rejected?: { name: string; index: number; distance: number };
}

interface PaletteBase {
  /** Palette members. Every one is a Wada color. */
  colors: DerivedColor[];
  /**
   * Ranking score from 0 to 1, weighting contrast three to one over hue
   * spread. Exposed so callers can re-rank.
   */
  score: number;
  /** Mean WCAG contrast ratio of the other members against the matched color. */
  contrast: number;
  /** Smallest hue arc containing every chromatic member, in degrees. */
  hueSpread: number;
}

export interface BookPalette extends PaletteBase {
  source: "book";
  combination: Combination;
  /** The nearest match this combination was found through. Rank 1 is the anchor. */
  match: NearestMatch & { rank: number };
}

export interface HarmonySnap {
  /** The generated color before snapping. */
  target: string;
  color: DerivedColor;
  distance: number;
}

export interface HarmonyPalette extends PaletteBase {
  source: "harmony";
  harmony: GeneratedHarmony;
  /** Each generated color and the Wada color it snapped to, in palette order. */
  snaps: HarmonySnap[];
}

export type Palette = BookPalette | HarmonyPalette;

export interface CombinationsResult {
  /** How the input was read. Absent when it could not be resolved. */
  resolved?: ResolvedQuery;
  anchor?: CombinationAnchor;
  /**
   * Book palettes first, ordered by match rank then score; then harmonies by
   * score.
   */
  palettes: Palette[];
  /** Why `palettes` is empty. Absent when there are palettes. */
  reason?: string;
}

/**
 * Ranked palettes for a hex code, a color name, or any other color input.
 * Unknown names return no palettes and a `reason`; they never throw.
 *
 * @throws {RangeError} for a non-integer or out-of-range `size`, `limit`, or
 * `min`, or an `anchor` that names no Wada color.
 */
export function combinations(
  input: ColorInput,
  options: CombinationsOptions = {},
): CombinationsResult {
  const {
    includeNeutrals = true,
    limit = COMBINATION_DEFAULTS.limit,
    min = COMBINATION_DEFAULTS.min,
    secondaryWithin = COMBINATION_DEFAULTS.secondaryWithin,
    snapWithin = COMBINATION_DEFAULTS.snapWithin,
    neutralChroma = COMBINATION_DEFAULTS.neutralChroma,
    neutralMargin = COMBINATION_DEFAULTS.neutralMargin,
  } = options;
  if (!(Number.isInteger(limit) && limit > 0)) {
    throw new RangeError(`limit must be a positive integer, got ${limit}`);
  }
  if (!(Number.isInteger(min) && min >= 0)) {
    throw new RangeError(`min must be zero or a positive integer, got ${min}`);
  }
  const sizes = options.size === undefined ? undefined : [options.size].flat();
  for (const s of sizes ?? []) {
    if (!(Number.isInteger(s) && s > 0)) {
      throw new RangeError(`size must be a positive integer, got ${s}`);
    }
  }
  const sizeOk = (n: number) => (sizes ? sizes.includes(n) : n >= 2);
  const given = options.anchor === undefined ? undefined : findWadaColor(options.anchor);
  if (options.anchor !== undefined && !given) {
    throw new RangeError(`anchor must be a Wada index or slug, got ${JSON.stringify(options.anchor)}`);
  }

  const plain = nearest(input);
  const { resolved } = plain;
  if (!resolved || plain.matches.length === 0) {
    return { ...(resolved && { resolved }), palettes: [], reason: plain.reason ?? "No match." };
  }

  const anchor = given
    ? givenAnchor(given, resolved.hex, plain.matches)
    : resolveAnchor(resolved.hex, plain.matches, neutralChroma, neutralMargin);
  const anchorMatch: NearestMatch = { color: anchor.color, distance: anchor.distance };

  const keep = (colors: DerivedColor[], ref: DerivedColor) =>
    sizeOk(colors.length) &&
    (includeNeutrals || colors.every((c) => !c.neutral || c.index === ref.index));

  // Book palettes: the anchor's combinations, then those of up to two more
  // matches within reach.
  const matches = [
    anchorMatch,
    ...plain.matches
      .filter((m) => m.color.index !== anchorMatch.color.index && m.distance <= secondaryWithin)
      .slice(0, 2),
  ];
  const seen = new Set<number>();
  const book: BookPalette[] = [];
  matches.forEach((m, i) => {
    const found: BookPalette[] = [];
    for (const id of m.color.combinations) {
      if (seen.has(id)) continue;
      seen.add(id);
      const combination = combinationsById().get(id)!;
      const members = combination.colors.map((index) => colorsByIndex().get(index)!);
      if (!keep(members, m.color)) continue;
      found.push({
        source: "book",
        combination,
        match: { ...m, rank: i + 1 },
        ...measure(members, m.color),
      });
    }
    book.push(...found.sort(byScore));
  });

  // Harmonies only when the book gives too few.
  const harmonies: HarmonyPalette[] = [];
  if (book.length < min) {
    // Skip a harmony that repeats a book combination or an earlier harmony.
    const listed = new Set(bookSetKeys());
    for (const [harmony, generate] of GENERATORS) {
      const snaps = generate(anchor.color.hex).map((lch) => {
        const target = toHex(lch);
        const { color, distance } = nearest(target, { k: 1 }).matches[0]!;
        return { target, color, distance };
      });
      const members = snaps.map((s) => s.color);
      const distinct = new Set(members.map((c) => c.index));
      if (snaps.some((s) => s.distance > snapWithin)) continue;
      if (distinct.size !== members.length) continue;
      if (listed.has(setKey(members))) continue;
      listed.add(setKey(members));
      if (!keep(members, anchor.color)) continue;
      harmonies.push({ source: "harmony", harmony, snaps, ...measure(members, anchor.color) });
    }
    harmonies.sort(byScore);
  }

  const palettes = [...book, ...harmonies].slice(0, limit);
  if (palettes.length === 0) {
    return {
      resolved,
      anchor,
      palettes,
      reason: `No palettes for ${anchor.color.name} match the given options.`,
    };
  }
  return { resolved, anchor, palettes };
}

// ---------------------------------------------------------------------------
// Anchor

function givenAnchor(color: DerivedColor, hex: string, plain: NearestMatch[]): CombinationAnchor {
  const match = nearest(hex, { k: 1, colors: [color] }).matches[0]!;
  return { color, distance: match.distance, via: "anchor", nearest: plain };
}

/**
 * The plain nearest match, unless the input is gray and the nearest Wada
 * neutral is within `margin` times the plain distance. Muted hues such as
 * Navy or Moss stay on their plain nearest match, and a gray whose nearest
 * neutral is far (the web edition's neutrals are tinted) does too.
 */
function resolveAnchor(
  hex: string,
  plain: NearestMatch[],
  neutralChroma: number,
  margin: number,
): CombinationAnchor {
  const closest = plain[0]!;
  const base = { nearest: plain };
  if (toOklch(hex).c > neutralChroma) {
    return { ...base, color: closest.color, distance: closest.distance, via: "nearest" };
  }
  const neutral = nearest(hex, { k: 1, colors: wadaNeutrals() }).matches[0]!;
  const same = neutral.color.index === closest.color.index;
  const wins = !same && neutral.distance <= margin * closest.distance;
  const [chosen, other] = wins ? [neutral, closest] : [closest, neutral];
  return {
    ...base,
    color: chosen.color,
    distance: chosen.distance,
    via: wins ? "nearest-neutral" : "nearest",
    ...(!same && {
      rejected: { name: other.color.name, index: other.color.index, distance: other.distance },
    }),
  };
}

function findWadaColor(ref: number | string): DerivedColor | undefined {
  if (typeof ref === "number") return colorsByIndex().get(ref);
  const slug = ref.trim().toLowerCase();
  return [...colorsByIndex().values()].find((c) => c.slug === slug);
}

// ---------------------------------------------------------------------------
// Scoring

const LOG_MAX_CONTRAST = Math.log(21);

function measure(members: DerivedColor[], ref: DerivedColor) {
  const others = members.filter((c) => c.index !== ref.index);
  const contrast = others.length
    ? others.reduce((sum, c) => sum + contrastRatio(c.hex, ref.hex), 0) / others.length
    : 1;
  const hueSpread = hueArc(members.filter((c) => !c.neutral).map((c) => c.oklch.h));
  // WCAG ratios run from 1 to 21; a log scale keeps low ratios distinguishable.
  const contrastPart = Math.log(contrast) / LOG_MAX_CONTRAST;
  const spreadPart = Math.min(hueSpread, 180) / 180;
  return {
    colors: members,
    score: round(0.75 * contrastPart + 0.25 * spreadPart),
    contrast: round(contrast),
    hueSpread: round(hueSpread),
  };
}

function byScore(a: { score: number }, b: { score: number }): number {
  return b.score - a.score;
}

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

// ---------------------------------------------------------------------------
// Cached lookups. The assets are read once, on first use.

let colorsCache: Map<number, DerivedColor> | undefined;
let combinationsCache: Map<number, Combination> | undefined;

function colorsByIndex(): Map<number, DerivedColor> {
  return (colorsCache ??= new Map(loadColors().map((c) => [c.index, c])));
}

function combinationsById(): Map<number, Combination> {
  return (combinationsCache ??= new Map(loadCombinations().map((c) => [c.id, c])));
}

/** The Wada colors flagged neutral in the derived data (chroma at or below 0.045). */
function wadaNeutrals(): DerivedColor[] {
  return [...colorsByIndex().values()].filter((c) => c.neutral);
}

function setKey(members: DerivedColor[]): string {
  return members
    .map((c) => c.index)
    .sort((a, b) => a - b)
    .join(",");
}

function bookSetKeys(): string[] {
  return [...combinationsById().values()].map((c) => c.colors.join(","));
}
