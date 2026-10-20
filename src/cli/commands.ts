/**
 * The CLI commands. Each builds a `View`: the same result as JSON, terminal
 * text, and SVG sections, so every command supports every output flag.
 */

import { mkdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import { combinations, type Palette } from "../combinations.js";
import { contrastRatio } from "../color/contrast.js";
import { distance, isHex, normalizeHex } from "../color/convert.js";
import {
  hasHex,
  loadColors,
  loadCombinations,
  loadProduct,
  loadProductIndex,
  type Product,
  type ProductColorWithHex,
} from "../data/index.js";
import {
  type ArtworkGarmentPair,
  type ArtworkOption,
  type ArtworkSource,
  type ContentBounds,
  type DesignColor,
  ENGINE_VERSION,
  garmentsFromProduct,
  type GarmentInput,
  type GarmentUse,
  judgeLegibility,
  judgeRecolor,
  LEGIBILITY_PROTOCOL,
  LEGIBILITY_RULES,
  legibleInkNeeds,
  type LegibilityVerdict,
  planArtworkOptions,
  rankArtworkGarmentPairs,
  type RankedGarment,
  rankGarments,
  substitutePigments,
  toSubstitutionPlan,
} from "../engine/index.js";
import {
  type AnalyzedDesignFile,
  analyzeDesignFile,
  type AppliedRecolor,
  applyRecolor,
  defaultVisionProviders,
  type DesignDescription,
  describeDesign,
  fingerprint,
  type Fingerprint,
  labelPalette,
  sharpDecoder,
  type VisionProvider,
  VisionUnavailableError,
  writePng,
} from "../fingerprint/index.js";
import {
  jevAvailability,
  JevUnavailableError,
  type MoodCandidate,
  type MoodFields,
  type MoodRerank,
  MOOD_TOP,
  MOOD_WEIGHT,
  rerankByMood,
  type SystemOneClient,
  type VetOptions,
  type VettedPlan,
  vettedRecolorPlans,
} from "../jev/index.js";
import { nearest, type ResolvedQuery } from "../nearest.js";
import { findProductColor, palettesForProductColor, type ProductPalette } from "../palettes.js";
import { type RecolorPlan, recolorPlans } from "../recolor.js";
import {
  type HtmlSection,
  renderAnsi,
  renderCombination,
  renderProductCard,
  renderSwatchGrid,
  renderThemePreview,
  type Swatch,
} from "../render/index.js";
import { fmt } from "../render/shared.js";
import {
  describeRole,
  namedRamp,
  theme,
  THEME_ROLES,
  type ThemeMode,
  type ThemeResult,
  toCssVariables,
  toDesignTokens,
  toTailwindTheme,
} from "../theme.js";

/** A command's output in every format the CLI can write. */
export interface View {
  /** Page and SVG title. */
  title: string;
  /** Machine-readable result for `--json`. */
  json: unknown;
  /** Terminal output. `color` is false when escape codes should be left out. */
  text: (color: boolean) => string;
  /** Sections for `--html`; those with SVG also go in `--svg`. */
  sections: HtmlSection[];
}

/**
 * What every result that suggests garment colors says about stock. The
 * catalog holds none, and these results take no live availability, so some
 * suggested colors may be sold out or discontinued at the print provider.
 */
export const STOCK_NOT_CHECKED = {
  checked: false,
  note:
    "Provider stock was not checked: these colors come from the garment catalog, which holds no stock, so some " +
    "may be sold out or discontinued. For POD Products, use POD's tools, which check live stock.",
} as const;

/** The `--html` section that carries `STOCK_NOT_CHECKED`, ahead of the cards. */
const STOCK_SECTION: HtmlSection = { title: "Provider stock not checked", caption: STOCK_NOT_CHECKED.note };

const STOCK_LINE = `Stock: ${STOCK_NOT_CHECKED.note}`;

/** Input the user can fix: an unknown name, a malformed hex, an unknown ID. */
export class InputError extends Error {}

export interface NearestArgs {
  query: string;
  k: number;
}

export function nearestView({ query, k }: NearestArgs): View {
  const result = nearest(query, { k });
  const resolved = requireResolved(query, result.resolved, result.reason);
  const title = `Nearest Wada colors to ${describeQuery(query, resolved)}`;
  const swatches = result.matches.map(
    (m): Swatch => ({ ...m.color, note: `No. ${m.color.index} · distance ${fmt(m.distance)}` }),
  );
  return {
    title,
    json: result,
    text: (color) => `${title}\n\n${renderAnsi(swatches, { color })}`,
    sections: [{ svg: renderSwatchGrid(swatches, { title }) }],
  };
}

export interface CombosArgs {
  query: string;
  size?: number;
  limit: number;
}

export function combosView({ query, size, limit }: CombosArgs): View {
  const result = combinations(query, { limit, ...(size !== undefined && { size }) });
  const resolved = requireResolved(query, result.resolved, result.reason);
  const title = `Combinations for ${describeQuery(query, resolved)}`;
  const anchor = result.anchor!;
  const anchorNotes = [
    ...(anchor.via === "nearest-neutral" ? ["nearest neutral"] : []),
    `distance ${fmt(anchor.distance)}`,
    ...(anchor.rejected
      ? [`over ${anchor.rejected.name} at ${fmt(anchor.rejected.distance)}`]
      : []),
  ];
  const anchorLine = `Anchor: ${anchor.color.name} ${anchor.color.hex} (${anchorNotes.join(", ")})`;

  if (result.palettes.length === 0) {
    return {
      title,
      json: result,
      text: () => `${title}\n${anchorLine}\n\n${result.reason ?? "No palettes."}\n`,
      sections: [],
    };
  }

  const blocks = result.palettes.map((p) => ({
    heading: `${paletteTitle(p)} · ${paletteDetail(p)}`,
    palette: p,
  }));
  return {
    title,
    json: result,
    text: (color) =>
      [
        `${title}\n${anchorLine}\n`,
        ...blocks.map(
          ({ heading, palette }) => `${heading}\n${renderAnsi(paletteSwatches(palette), { color })}`,
        ),
      ].join("\n"),
    // The SVG title stays short so it fits over a two-color strip; the detail
    // goes in the HTML caption.
    sections: result.palettes.map((palette) => ({
      svg: renderCombination(
        {
          ...(palette.source === "book" && { id: palette.combination.id }),
          colors: paletteSwatches(palette),
        },
        { title: paletteTitle(palette), contrast: true },
      ),
      caption: paletteDetail(palette),
    })),
  };
}

export function showView(ids: readonly number[]): View {
  const byId = new Map(loadCombinations().map((c) => [c.id, c]));
  const byIndex = new Map(loadColors().map((c) => [c.index, c]));
  const found = ids.map((id) => {
    const combination = byId.get(id);
    if (!combination) {
      throw new InputError(`unknown combination ${id}; the book's IDs run from 1 to ${byId.size}`);
    }
    return { combination, colors: combination.colors.map((i) => byIndex.get(i)!) };
  });

  const title = found.length === 1 ? `Combination ${ids[0]}` : `Combinations ${ids.join(", ")}`;
  const heading = (c: (typeof found)[number]["combination"]) =>
    `Combination ${c.id} · ${c.harmony}`;
  return {
    title,
    json: { combinations: found },
    text: (color) =>
      found
        .map((f) => `${heading(f.combination)}\n${renderAnsi(f.colors, { color })}`)
        .join("\n"),
    sections: found.map((f) => ({
      svg: renderCombination({ id: f.combination.id, colors: f.colors }, { contrast: true }),
      caption: f.combination.harmony,
    })),
  };
}

export interface PalettesArgs {
  /** A product color name, slug, or alias. */
  name: string;
  limit: number;
  size?: number;
  product?: string;
  /** The design to judge palettes against, for `mood`. */
  design?: DesignArgs;
  /** Re-rank the palettes by how well each suits the design's mood, with Jev. Needs `design`. */
  mood?: boolean | MoodSetup;
}

/** Palettes for a garment color: the garment first, then the ink colors printed on it. */
export async function palettesView({
  name,
  limit,
  size,
  product: productId,
  design: designArgs,
  mood,
}: PalettesArgs): Promise<View> {
  let product: Product;
  try {
    product = loadProduct(productId ?? loadProductIndex().default);
  } catch (error) {
    throw new InputError((error as Error).message);
  }
  const setup = moodSetup(mood);
  if (setup && !designArgs) throw new InputError("mood re-ranking of palettes needs a design file");

  const found = palettesForProductColor(name, {
    product,
    limit: setup ? Math.max(limit, MOOD_TOP) : limit,
    ...(size !== undefined && { size }),
  });
  const color = found.color;
  if (!color) {
    const names = product.colors.map((c) => c.name).join(", ");
    throw new InputError(`${found.reason} Colors: ${names}.`);
  }

  let palettes: (ProductPalette & Partial<MoodFields>)[] = found.palettes.slice(0, limit);
  let moodStatus: MoodStatus | undefined;
  let design: Fingerprint | undefined;
  if (setup && designArgs) {
    design = await fingerprintDesign(designArgs.file, designArgs.bytes);
    const ranked = await moodRerank(found.palettes, design, designArgs.bytes ?? designArgs.file, setup);
    design = ranked.design;
    palettes = ranked.rerank.candidates.slice(0, limit);
    moodStatus = statusOf(ranked.rerank);
  }
  const result = { ...found, palettes };

  const title = `Palettes for ${color.name} ${color.hex ?? "(no hex)"} · ${product.brand} ${product.model}`;
  const lines = [
    `Wada equivalents: ${result.equivalents.map((e) => `${e.name} (distance ${fmt(e.distance)})`).join(", ") || "none"}`,
    STOCK_LINE,
    ...(moodStatus && designArgs ? [moodLine(moodStatus, designArgs.file)] : []),
  ];
  const heading = (p: ProductPalette & Partial<MoodFields>) =>
    `${productPaletteTitle(p)} · via ${p.equivalent.name} · contrast ${fmt(p.contrast)} (lowest ${fmt(p.minContrast)})${moodSuffix(p)}`;
  const inkSwatches = (p: ProductPalette): Swatch[] =>
    p.colors.slice(1).map((c) => ({ hex: c.hex, name: `${c.name} · ${fmt(contrastOn(p, c.hex))}:1` }));
  const json = { ...result, stock: STOCK_NOT_CHECKED, ...(design && { design }), ...(moodStatus && { mood: moodStatus }) };

  if (result.palettes.length === 0 || !hasHex(color)) {
    return {
      title,
      json,
      text: () => `${title}\n${lines.join("\n")}\n\n${result.reason ?? "No palettes."}\n`,
      sections: [STOCK_SECTION],
    };
  }
  return {
    title,
    json,
    text: (useColor) =>
      [
        `${title}\n${lines.join("\n")}\n`,
        ...result.palettes.map((p) => `${heading(p)}\n${renderAnsi(p.colors, { color: useColor })}`),
      ].join("\n"),
    // One card per palette: the garment, with its photo when the product has
    // one, and the ink colors beside it.
    sections: [STOCK_SECTION, ...result.palettes.map((p) => ({
      title: productPaletteTitle(p),
      ...moodBadge(p),
      svg: renderProductCard(color, { designColors: inkSwatches(p) }),
      caption: `via ${p.equivalent.name} · contrast ${fmt(p.contrast)}, lowest ${fmt(p.minContrast)}`,
    }))],
  };
}

function productPaletteTitle(p: ProductPalette): string {
  if (p.source === "book") return `Combination ${p.combination.id}`;
  return `${p.harmony[0]!.toUpperCase()}${p.harmony.slice(1)} harmony`;
}

function contrastOn(p: ProductPalette, hex: string): number {
  return contrastRatio(hex, p.colors[0].hex);
}

/** Default `-n` for `recommend`. */
export const DEFAULT_RECOMMEND_N = 5;

export interface RecommendArgs extends DesignArgs {
  n: number;
  product?: string;
  /** Re-rank the picks by how well each garment suits the design's mood, with Jev. */
  mood?: boolean | MoodSetup;
  /** Only these product colors, by name, slug, or alias. Default every catalog color. */
  colors?: readonly string[];
  /** The print's visible content, for the measurement. */
  contentBounds?: ContentBounds | null;
}

/** A recommendation: the engine's ranked garment, with its catalog color for cards and batches. */
export type RecommendPick = RankedGarment & { color: ProductColorWithHex };

/** The engine version and legibility protocol every engine-backed result carries. */
export const ENGINE_INFO = { version: ENGINE_VERSION, protocol: LEGIBILITY_PROTOCOL } as const;

const NO_MOOD: MoodFields = { moodScore: null, confidence: null, moodLevel: null, deterministicScore: null, combinedScore: null };

/**
 * Garment colors ranked by the engine (`rankGarments`): those the design
 * passes the ink legibility verdict on first, then by score. With `mood`,
 * Jev re-ranks the leading legible picks; illegible ones stay after them.
 */
export async function recommendView({
  file,
  bytes,
  n,
  product: productId,
  mood,
  colors,
  contentBounds,
}: RecommendArgs): Promise<View> {
  const product = productFor(productId);
  const garments = productGarments(product, colors);
  const design = await analyzeForView(file, bytes, contentBounds);
  if (design.analysis.summary.palette.length === 0) {
    throw new InputError(`${file} has no visible ink to recommend a garment for`);
  }
  const setup = moodSetup(mood);

  const bySlug = new Map(product.colors.filter(hasHex).map((c) => [c.slug, c]));
  const ranked: RecommendPick[] = rankGarments(design.analysis, garments, { product: product.id }).map((r) => ({
    color: bySlug.get(r.garment.slug)!,
    ...r,
  }));
  let picks: (RecommendPick & Partial<MoodFields>)[] = ranked;
  let moodStatus: MoodStatus | undefined;
  let description: Fingerprint["description"];
  if (setup) {
    const legible = ranked.filter((p) => p.legibility.pass);
    const illegible = ranked.filter((p) => !p.legibility.pass).map((p) => ({ ...p, ...NO_MOOD }));
    if (legible.length === 0) {
      picks = illegible;
      moodStatus = {
        requested: true,
        applied: false,
        weight: MOOD_WEIGHT,
        reason: "The ink reads on none of these garment colors, so there is nothing to re-rank by mood.",
      };
    } else {
      const reranked = await moodRerank(legible, await fingerprintDesign(file, bytes), bytes ?? file, setup);
      description = reranked.design.description;
      picks = [...reranked.rerank.candidates, ...illegible];
      moodStatus = statusOf(reranked.rerank);
    }
  }
  picks = picks.slice(0, n);

  const { summary } = design.analysis;
  const title = `${product.brand} ${product.model} colors for ${file}`;
  const chips: Swatch[] = summary.palette.map((entry, i) => ({
    hex: entry.hex,
    name: `${Math.round(entry.share * 100)}% · near ${picks[0]?.designColors[i]?.wada.name ?? entry.hex}`,
  }));
  const heading = (i: number) =>
    `${i + 1}. ${picks[i]!.color.name} · score ${fmt(picks[i]!.score, 3)} · ${picks[i]!.legibility.pass ? "legible" : "illegible"}${moodSuffix(picks[i]!)}`;

  const legibleCount = ranked.filter((p) => p.legibility.pass).length;
  const designLine = `Design: ${chips.map((c) => `${c.hex} ${c.name}`).join(", ")}; ink luminance ${fmt(summary.inkLuminance)}`;
  const legibilityLine = `Legibility (${LEGIBILITY_PROTOCOL}, engine ${ENGINE_VERSION}): the ink reads on ${legibleCount} of ${ranked.length} garment colors.`;
  const header = [designLine, legibilityLine, ...(moodStatus ? [moodLine(moodStatus, file)] : []), STOCK_LINE].join("\n");
  return {
    title,
    json: {
      engine: ENGINE_INFO,
      product: { id: product.id, name: product.name },
      design: { ...designJson(design), ...(description && { description }) },
      measurement: design.analysis.measurement,
      picks,
      stock: STOCK_NOT_CHECKED,
      ...(moodStatus && { mood: moodStatus }),
    },
    text: (color) =>
      [
        `${title}\n${header}\n`,
        ...picks.map((pick, i) =>
          [
            heading(i),
            renderAnsi([pick.color], { color }).trimEnd(),
            ...pick.reasons.map((r) => `  ${r}`),
            ...pick.warnings.map((w) => `  Warning: ${w}`),
          ].join("\n") + "\n",
        ),
      ].join("\n"),
    sections: [
      STOCK_SECTION,
      ...picks.map((pick, i) => ({
        title: heading(i),
        ...moodBadge(pick),
        svg: renderProductCard(pick.color, { designColors: chips }),
        caption: [...pick.reasons, ...pick.warnings.map((w) => `Warning: ${w}`)].join(" "),
      })),
    ],
  };
}

/** Default `-n` for `recolor`. */
export const DEFAULT_RECOLOR_N = 5;

export interface RecolorArgs extends DesignArgs {
  n: number;
  product?: string;
  /** Directory to write each recolored PNG to. */
  apply?: string;
  /** Describe the design and check each swap's plausibility with Jev. */
  vet?: boolean | VetSetup;
  /** With `vet`, keep implausible plans, marked, instead of dropping them. */
  includeImplausible?: boolean;
  /** The print's visible content, for the legibility measurement. */
  contentBounds?: ContentBounds | null;
}

/**
 * Recolor plans per garment (`recolorPlans` on the engine's measured summary,
 * the inks `artwork_options` and POD plan from), each with its pigment
 * substitution on the measured inks (`toSubstitutionPlan`; null for a plan
 * that merges inks) and how the recolored design reads on its garment
 * (`judgeRecolor`). With `vet`, the vision description of the fingerprint
 * names the measured inks it matches (`measuredRecolorDesign`).
 */
export async function recolorView({
  file,
  bytes,
  n,
  product: productId,
  apply,
  vet,
  includeImplausible,
  contentBounds,
}: RecolorArgs): Promise<View> {
  const product = productFor(productId);
  const measured = await analyzeForView(file, bytes, contentBounds);
  if (measured.analysis.summary.palette.length === 0) {
    throw new InputError(`${file} has no visible ink to recolor`);
  }
  let design: RecolorDesign = { ...designJson(measured) };

  let plans: (RecolorPlan | VettedPlan)[];
  let vetStatus: VetStatus | undefined;
  if (vet) {
    const setup = vet === true ? {} : vet;
    const vetted = await vetPlans(
      await fingerprintDesign(file, bytes),
      design,
      bytes ?? file,
      { product, n, includeImplausible: includeImplausible ?? false },
      setup,
    );
    design = vetted.design;
    plans = vetted.plans;
    vetStatus = vetted.status;
  } else {
    plans = recolorPlans(design, { product, n });
  }
  const { measurement } = measured.analysis;
  const evidence = plans.map((plan) => ({
    substitution: toSubstitutionPlan(plan, measurement),
    legibility: judgeRecolor({
      measurement,
      pixels: measured.pixels,
      mapping: plan.mapping,
      garment: { colorName: plan.color.name, hex: plan.color.hex },
    }),
  }));
  const applied: (AppliedRecolor | undefined)[] = [];
  if (apply !== undefined) {
    await mkdir(apply, { recursive: true });
    const stem = basename(file, extname(file));
    for (const plan of plans) {
      const out = join(apply, `${stem}-${plan.color.slug}.png`);
      applied.push(
        await applyRecolor(measured.bytes, plan.mapping, { out, ...(contentBounds && { contentBounds }) }),
      );
    }
  }

  const title = `${product.brand} ${product.model} colors for ${file}, recolored`;
  const legibilityNote = (i: number) => {
    const verdict = evidence[i]!.legibility;
    return verdict === null ? " · legibility unknown" : verdict.pass ? " · legible" : " · illegible";
  };
  const heading = (i: number) => {
    const plan = plans[i]!;
    const via = plan.combination.source === "book" ? `combination ${plan.combination.id}` : `${plan.combination.harmony} harmony`;
    return `${i + 1}. ${plan.color.name} · ${via} · score ${fmt(plan.score, 3)}${plan.flagged ? " · flagged" : ""}${legibilityNote(i)}${plausibilityNote(plan)}`;
  };
  const vetLines = vetStatus
    ? [
        ...(vetStatus.reason ? [vetStatus.reason] : []),
        ...vetStatus.dropped.map((d) => `Dropped ${d.garment}: ${d.reasons.join(" ")}`),
        ...(plans.length === 0 ? ["Every plan was implausible; pass --include-implausible to see them."] : []),
      ]
    : [];
  const appliedLine = (result: AppliedRecolor | undefined) =>
    result === undefined ? [] : [result.applicable ? `Wrote ${result.out}` : `Not applied: ${result.reason}`];

  return {
    title,
    json: {
      engine: ENGINE_INFO,
      product: { id: product.id, name: product.name },
      design,
      measurement,
      plans: plans.map((plan, i) => ({ ...plan, ...evidence[i]!, ...(applied[i] && { applied: applied[i] }) })),
      stock: STOCK_NOT_CHECKED,
      ...(vetStatus && { vet: vetStatus }),
    },
    text: (color) =>
      [
        `${title}\n${STOCK_LINE}\n`,
        ...(vetLines.length ? [`${vetLines.join("\n")}\n`] : []),
        ...plans.map((plan, i) =>
          [
            heading(i),
            renderAnsi([plan.color], { color }).trimEnd(),
            ...plan.mapping.map(
              (m) =>
                `  ${m.from.hex} (${Math.round(m.from.share * 100)}%) -> ${m.to.name} ${m.to.hex}` +
                ("plausibility" in m && m.plausibility !== null ? ` · plausibility ${fmt(m.plausibility, 2)}` : ""),
            ),
            `  Prompt: ${plan.prompt}`,
            ...plan.reasons.map((r) => `  ${r}`),
            ...legibilityLines(evidence[i]!.legibility).map((line) => `  ${line}`),
            ...plan.warnings.map((w) => `  Warning: ${w}`),
            ...appliedLine(applied[i]).map((line) => `  ${line}`),
          ].join("\n") + "\n",
        ),
      ].join("\n"),
    // Each garment card with the design's colors before and after.
    sections: [STOCK_SECTION, ...plans.map((plan, i) => ({
      title: heading(i),
      svg: renderProductCard(plan.color, {
        recolor: plan.mapping.map((m) => ({
          from: { hex: m.from.hex, name: m.from.element ?? `${Math.round(m.from.share * 100)}%` },
          to: { hex: m.to.hex, name: m.to.name },
        })),
      }),
      caption: [
        plan.prompt,
        ...plan.reasons,
        ...legibilityLines(evidence[i]!.legibility),
        ...plan.warnings.map((w) => `Warning: ${w}`),
        ...appliedLine(applied[i]),
      ].join(" "),
    }))],
  };
}

function legibilityLines(verdict: LegibilityVerdict | null): string[] {
  if (verdict === null) return ["Recolored legibility: the mapping cannot be substituted exactly in the measured inks."];
  return [`Recolored legibility: ${verdict.reason}`];
}

// ---------------------------------------------------------------------------
// Print legibility

export interface LegibilityArgs extends DesignArgs {
  product?: string;
  /** Product colors by name, slug, or alias. Default every catalog color. */
  colors?: readonly string[];
  /** Garment colors given directly, judged after `colors`. */
  garments?: readonly GarmentInput[];
  contentBounds?: ContentBounds | null;
}

/** The `ink-legibility-v2` verdict of a print file on each garment color (`judgeLegibility`). */
export async function legibilityView({
  file,
  bytes,
  product: productId,
  colors,
  garments: given,
  contentBounds,
}: LegibilityArgs): Promise<View> {
  const product = productFor(productId);
  const garments = [
    ...(colors !== undefined || given === undefined ? productGarments(product, colors) : []),
    ...(given ?? []).map((g) => ({ ...g, hex: normalizeHex(g.hex) })),
  ];
  const design = await analyzeForView(file, bytes, contentBounds);
  const { measurement } = design.analysis;
  const verdicts = garments.map((g) => judgeLegibility(measurement, { colorName: g.colorName, hex: g.hex }));
  const passing = verdicts.filter((v) => v.pass).length;

  const title = `Ink legibility of ${file} on ${product.brand} ${product.model}`;
  const summary =
    `${LEGIBILITY_PROTOCOL}, engine ${ENGINE_VERSION}: the ink reads on ${passing} of ${verdicts.length} garment colors` +
    (measurement.approximate ? "; the art is gradient or photographic, so no ink counts as framed." : ".");
  const inkLine = `Inks: ${measurement.clusters.map((c) => `${c.hex} ${Math.round(c.share * 100)}%`).join(", ") || "none"}`;
  return {
    title,
    json: {
      engine: ENGINE_INFO,
      product: { id: product.id, name: product.name },
      design: designJson(design),
      measurement,
      verdicts,
      stock: STOCK_NOT_CHECKED,
    },
    text: () =>
      [
        `${title}\n${summary}\n${inkLine}\n${STOCK_LINE}\n`,
        ...verdicts.map((v) => `${v.pass ? "Legible:" : "Illegible:"} ${v.colorName} ${v.garmentHex}\n  ${v.reason}`),
        "",
      ].join("\n"),
    sections: [
      STOCK_SECTION,
      {
        svg: renderSwatchGrid(
          verdicts.map((v): Swatch => ({
            hex: v.garmentHex,
            name: v.colorName,
            note: v.pass ? `legible · ${Math.round(v.lostShare * 100)}% lost` : `illegible · ${Math.round(v.lostShare * 100)}% lost`,
          })),
          { title, columns: 8 },
        ),
        caption: `${summary} ${inkLine}.`,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Artwork options

export interface ArtworkOptionsArgs extends DesignArgs {
  product?: string;
  /** Product colors by name, slug, or alias. Default every catalog color. */
  colors?: readonly string[];
  /** How many garment colors the assortment wants, for `legibleInkNeeds`. Default 8. */
  colorCount?: number;
  /** At most this many Wada options. Default 3. */
  maxPalettePlans?: number;
  contentBounds?: ContentBounds | null;
  /** Directory to write each option's recolored PNG to, at full size. */
  apply?: string;
}

export const DEFAULT_COLOR_COUNT = 8;

/**
 * Artwork Options for the garment families the design does not read on
 * (`planArtworkOptions`): pigment substitutions, each screened on the
 * measured pixels, with the garment colors it adds.
 */
export async function artworkOptionsView({
  file,
  bytes,
  product: productId,
  colors,
  colorCount = DEFAULT_COLOR_COUNT,
  maxPalettePlans,
  contentBounds,
  apply,
}: ArtworkOptionsArgs): Promise<View> {
  const product = productFor(productId);
  const garments = productGarments(product, colors);
  const design = await analyzeForView(file, bytes, contentBounds);
  const { measurement } = design.analysis;
  const legibleColors = garments
    .filter((g) => judgeLegibility(measurement, { colorName: g.colorName, hex: g.hex }).pass)
    .map((g) => g.colorName);
  const legible = new Set(legibleColors);
  const needs = legibleInkNeeds({ garments, legibleColors: legible, colorCount });
  const options = planArtworkOptions({
    analysis: design.analysis,
    pixels: design.pixels,
    garments,
    needs,
    legibleColors: legible,
    product: product.id,
    ...(maxPalettePlans !== undefined && { maxPalettePlans }),
  });

  const written: { key: string; out: string; changed: number }[] = [];
  if (apply !== undefined && options.length) {
    await mkdir(apply, { recursive: true });
    const stem = basename(file, extname(file));
    const full = await sharpDecoder(design.bytes, { maxDimension: Infinity });
    for (const option of options) {
      const { pixels, changed } = substitutePigments(full.pixels, option.plan);
      const out = join(apply, `${stem}-${option.plan.key}.png`);
      await writePng(pixels, out);
      written.push({ key: option.plan.key, out, changed });
    }
  }

  const title = `Artwork options for ${file} on ${product.brand} ${product.model}`;
  const status =
    needs.length === 0
      ? `The ink reads on ${legibleColors.length} of ${garments.length} garment colors; no family needs another ink.`
      : `The ink reads on ${legibleColors.length} of ${garments.length} garment colors; ${needs.join(" and ")} garments need another ink.`;
  const byName = new Map(product.colors.filter(hasHex).map((c) => [c.name, c]));
  const optionLines = (option: ArtworkOption) => [
    `${option.plan.label} (${option.plan.key}, ${option.source})`,
    ...option.plan.replacements.map((r) => `  ${r.from} -> ${r.to} (tolerance ${r.tolerance})`),
    `  Adds ${option.addsColors.length}: ${option.addsColors.join(", ")}`,
    `  ${option.plan.rationale}`,
    ...written.filter((w) => w.key === option.plan.key).map((w) => `  Wrote ${w.out}`),
  ];
  return {
    title,
    json: {
      engine: ENGINE_INFO,
      product: { id: product.id, name: product.name },
      design: designJson(design),
      measurement,
      colorCount,
      legibleColors,
      needs,
      options,
      stock: STOCK_NOT_CHECKED,
      ...(apply !== undefined && { applied: written }),
    },
    text: () =>
      [`${title}\n${status}\n${STOCK_LINE}\n`, ...options.map((o) => optionLines(o).join("\n") + "\n"), options.length ? "" : "No options.\n"].join(
        "\n",
      ),
    sections: [STOCK_SECTION, ...options.map((option) => ({
      title: `${option.plan.label} · adds ${option.addsColors.length}`,
      svg: renderProductCard(byName.get(option.addsColors[0]!) ?? { hex: "#ffffff", name: option.addsColors[0]! }, {
        recolor: option.plan.replacements.map((r) => ({ from: { hex: r.from, name: r.from }, to: { hex: r.to, name: r.to } })),
      }),
      caption: `${option.plan.rationale} Adds ${option.addsColors.join(", ")}.`,
    }))],
  };
}

// ---------------------------------------------------------------------------
// Exploration order

/** One artwork `pairsView` ranks: a print file and where it came from. */
export interface PairArtworkArgs {
  /** The ID the pairs name this artwork by. */
  artworkId: string;
  file: string;
  bytes?: Uint8Array;
  source: ArtworkSource;
  contentBounds?: ContentBounds | null;
}

export interface PairsArgs {
  /** The approved original and any Artwork Options, each as its own print file. */
  artworks: readonly PairArtworkArgs[];
  product?: string;
  /** Product colors by name, slug, or alias. Default every catalog color. */
  colors?: readonly string[];
  /** How many garment colors the assortment wants. Default 8. */
  colorCount?: number;
  /** A product color, by name, slug, or alias, to place first when any artwork reads on it. */
  preferred?: string;
  /** Recent garment use, for the variety penalty. */
  recent?: readonly GarmentUse[];
}

/**
 * The order POD's Creative color study inspects artwork and garment pairs in
 * (`rankArtworkGarmentPairs`): only pairs the verdict passes; each color led
 * by the artwork that departs least from the approved art; colors a
 * hue-keeping artwork leads before colors only a Wada repaint reads on; and
 * within each, chosen greedily by score less the variety penalty.
 */
export async function pairsView({
  artworks,
  product: productId,
  colors,
  colorCount = DEFAULT_COLOR_COUNT,
  preferred,
  recent,
}: PairsArgs): Promise<View> {
  if (artworks.length === 0) throw new InputError("pairs needs at least one artwork");
  const ids = artworks.map((a) => a.artworkId);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate !== undefined) throw new InputError(`two artworks share the ID ${JSON.stringify(duplicate)}`);
  if (!(Number.isInteger(colorCount) && colorCount > 0)) throw new InputError(`colorCount must be a positive integer, got ${colorCount}`);
  const product = productFor(productId);
  const garments = productGarments(product, colors);
  let preferredName: string | undefined;
  if (preferred !== undefined) {
    const found = findProductColor(product, preferred);
    if (!found) throw new InputError(`unknown color ${JSON.stringify(preferred)} for ${product.id}`);
    preferredName = found.name;
  }
  const analyzed: { artwork: PairArtworkArgs; design: AnalyzedDesignFile }[] = [];
  for (const artwork of artworks) {
    analyzed.push({ artwork, design: await analyzeForView(artwork.file, artwork.bytes, artwork.contentBounds) });
  }
  const pairs: ArtworkGarmentPair[] = rankArtworkGarmentPairs({
    artworks: analyzed.map(({ artwork, design }) => ({
      artworkId: artwork.artworkId,
      analysis: design.analysis,
      source: artwork.source,
    })),
    garments,
    colorCount,
    product: product.id,
    ...(preferredName !== undefined && { preferred: preferredName }),
    ...(recent !== undefined && { recent }),
  });

  const hexOf = new Map(garments.map((g) => [g.colorName, g.hex]));
  const leads = pairs.filter((p, i) => pairs.findIndex((q) => q.colorName === p.colorName) === i);
  const title = `Exploration order for ${artworks[0]!.file} on ${product.brand} ${product.model}`;
  const status =
    `${leads.length} of ${garments.length} garment colors read with at least one of ${artworks.length} ` +
    `artwork${artworks.length === 1 ? "" : "s"}; ${pairs.length} legible pairs (${LEGIBILITY_PROTOCOL}, engine ${ENGINE_VERSION}).`;
  return {
    title,
    json: {
      engine: ENGINE_INFO,
      product: { id: product.id, name: product.name },
      colorCount,
      artworks: analyzed.map(({ artwork, design }) => ({
        artworkId: artwork.artworkId,
        source: artwork.source,
        design: designJson(design),
      })),
      pairs,
      stock: STOCK_NOT_CHECKED,
    },
    text: () =>
      [
        `${title}\n${status}\n${STOCK_LINE}\n`,
        ...pairs.map((p, i) => `${i + 1}. ${p.colorName} · ${p.artworkId} (${p.source}) · score ${fmt(p.score, 3)}\n  ${p.reason}`),
        "",
      ].join("\n"),
    sections: [
      STOCK_SECTION,
      {
        svg: renderSwatchGrid(
          leads.map((p): Swatch => ({ hex: hexOf.get(p.colorName)!, name: p.colorName, note: `${p.artworkId} (${p.source})` })),
          { title, columns: 8 },
        ),
        caption: status,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Engine helpers

function productFor(productId: string | undefined): Product {
  try {
    return loadProduct(productId ?? loadProductIndex().default);
  } catch (error) {
    throw new InputError((error as Error).message);
  }
}

/** A product's catalog garment colors, or the named ones in the order given. */
function productGarments(product: Product, colors: readonly string[] | undefined): GarmentInput[] {
  const all = garmentsFromProduct(product.id);
  if (colors === undefined) return all;
  return colors.map((name) => {
    const found = findProductColor(product, name);
    const garment = found && all.find((g) => g.slug === found.slug);
    if (!garment) {
      const names = product.colors.filter(hasHex).map((c) => c.name).join(", ");
      throw new InputError(`unknown color ${JSON.stringify(name)} for ${product.id}. Colors: ${names}.`);
    }
    return garment;
  });
}

/** Read a design from its bytes or path and measure it for the engine. */
async function analyzeForView(
  file: string,
  bytes: Uint8Array | undefined,
  contentBounds: ContentBounds | null | undefined,
): Promise<AnalyzedDesignFile & { bytes: Uint8Array }> {
  let data: Uint8Array;
  try {
    data = bytes ?? (await readFile(file));
  } catch (error) {
    const { code, message } = error as NodeJS.ErrnoException;
    throw new InputError(code === "ENOENT" ? `no such design file ${JSON.stringify(file)}` : `cannot read ${file}: ${message}`);
  }
  try {
    return { ...(await analyzeDesignFile(data, { contentBounds: contentBounds ?? null })), bytes: data };
  } catch (error) {
    // An unsupported format, a corrupt file, or a missing `sharp`, as `fingerprintDesign` reports them.
    throw new InputError(`cannot read ${file}: ${(error as Error).message}`);
  }
}

/** The measured design as a result carries it. */
function designJson(design: AnalyzedDesignFile) {
  const { measurement, summary } = design.analysis;
  return {
    hash: design.hash,
    palette: summary.palette,
    inkLuminance: summary.inkLuminance,
    approximate: measurement.approximate,
  };
}

export type ThemeFormat = "css" | "tailwind" | "tokens";

export interface ThemeArgs {
  /** A hex code, a color name, or a book combination ID. */
  query: string;
  mode: ThemeMode;
  format?: ThemeFormat;
}

/** How many ranked palettes `theme` tries for a color before giving up. */
export const THEME_PALETTE_SEARCH = 24;

/**
 * A web theme from a book combination by ID, or from the highest-ranked
 * palette for a color that yields a legible theme in the mode.
 */
export function themeView({ query, mode, format }: ThemeArgs): View {
  const { title, colors, chosen, result } = /^\d+$/.test(query.trim())
    ? themeForCombination(Number(query.trim()), mode)
    : themeForColor(query, mode);
  if (!result.ok) throw new InputError(`${title}: ${result.reasons.join(" ")}`);
  // Contrast is symmetric, so a combination legible in one mode is legible in both.
  const other = theme(colors, { mode: mode === "light" ? "dark" : "light" });
  const [light, dark] = mode === "light" ? [result, other] : [other, result];
  const roleSwatches = THEME_ROLES.map((role): Swatch => ({
    hex: result.colors[role].hex,
    name: role,
    note: result.colors[role].name ?? result.colors[role].derived ?? "",
  }));
  const ramps = result.source.map((c) => namedRamp(c));

  return {
    title,
    json: { combination: chosen, theme: result },
    text: (color) => {
      if (format === "css") return toCssVariables(result);
      if (format === "tailwind") return toTailwindTheme(result);
      if (format === "tokens") return `${JSON.stringify(toDesignTokens(result), null, 2)}\n`;
      const pairings = result.pairings.map(
        (p) =>
          `  ${p.foreground} on ${p.background}: ${p.wcag.ratio}:1 WCAG ${p.wcag.level}, APCA Lc ${p.apca.lc} (${p.apca.level})`,
      );
      return [
        `${title} · ${result.mode} mode`,
        chosen.detail,
        "",
        renderAnsi(roleSwatches, { color }).trimEnd(),
        "",
        ...THEME_ROLES.filter((r) => result.colors[r].derived).map((r) => `  ${describeRole(r, result.colors[r])}`),
        "",
        "Pairings:",
        ...pairings,
        "",
        ...result.reasons.map((r) => `  ${r}`),
        "",
      ].join("\n");
    },
    sections: [
      { title: "Sample UI", html: renderThemePreview([light, dark]), caption: chosen.detail },
      { svg: renderSwatchGrid(roleSwatches, { title: `Roles, ${result.mode} mode` }) },
      ...ramps.map((r) => ({
        svg: renderSwatchGrid(
          r.steps.map((s): Swatch => ({ hex: s.hex, name: s.name, ...(s.name === r.anchor && { note: "input" }) })),
          { title: `${r.color.name ?? r.color.hex} ramp`, columns: 11, tileWidth: 72, tileHeight: 72 },
        ),
      })),
    ],
  };
}

interface ThemeSource {
  title: string;
  colors: Swatch[];
  chosen: { id?: number; detail: string };
  result: ThemeResult;
}

function themeForCombination(id: number, mode: ThemeMode): ThemeSource {
  const combination = loadCombinations().find((c) => c.id === id);
  if (!combination) {
    throw new InputError(`unknown combination ${id}; the book's IDs run from 1 to ${loadCombinations().length}`);
  }
  const byIndex = new Map(loadColors().map((c) => [c.index, c]));
  const colors = combination.colors.map((i): Swatch => {
    const c = byIndex.get(i)!;
    return { hex: c.hex, name: c.name };
  });
  return {
    title: `Theme from combination ${id}`,
    colors,
    chosen: { id, detail: `Combination ${id} · ${colors.map((c) => c.name).join(", ")}` },
    result: theme({ colors: combination.colors }, { mode }),
  };
}

function themeForColor(query: string, mode: ThemeMode): ThemeSource {
  const found = combinations(query, { limit: THEME_PALETTE_SEARCH });
  const resolved = requireResolved(query, found.resolved, found.reason);
  const title = `Theme for ${describeQuery(query, resolved)}`;
  for (const palette of found.palettes) {
    const colors = paletteSwatches(palette).map((c): Swatch => ({ hex: c.hex, ...(c.name && { name: c.name }) }));
    const result = theme(colors, { mode });
    if (result.ok) {
      const id = palette.source === "book" ? palette.combination.id : undefined;
      return {
        title,
        colors,
        chosen: {
          ...(id !== undefined && { id }),
          detail: `${paletteTitle(palette)} · ${colors.map((c) => c.name ?? c.hex).join(", ")}`,
        },
        result,
      };
    }
  }
  return {
    title,
    colors: [],
    chosen: { detail: "" },
    result: {
      ok: false,
      mode,
      reasons: [
        `None of the top ${found.palettes.length} palettes has a pair of colors with WCAG AA contrast for body text.`,
      ],
    },
  };
}

// ---------------------------------------------------------------------------

/** A design file for a command that reads one. */
export interface DesignArgs {
  /** The design file's path, or its label when `bytes` are given. */
  file: string;
  /** The design file's contents, read instead of `file` when given. */
  bytes?: Uint8Array;
}

/** Replaces the vision providers, Jev client, or Jev answer cache for a mood re-rank, as tests do. */
export interface MoodSetup {
  providers?: readonly VisionProvider[];
  client?: SystemOneClient;
  /** Jev answer cache directory, or `false` to skip it. Defaults to the `ask` default. */
  cache?: string | false;
}

/** How a view reports a requested mood re-rank. */
export interface MoodStatus {
  requested: true;
  applied: boolean;
  /** The weight the combined score used. */
  weight: number;
  /** Why the order is the deterministic one. Absent when Jev's scores were applied. */
  reason?: string;
  model?: string;
  cached?: boolean;
}

function moodSetup(mood: boolean | MoodSetup | undefined): MoodSetup | undefined {
  if (mood === true) return {};
  return mood || undefined;
}

/**
 * Describe the design when it has no description yet, then re-rank the
 * candidates by mood. Never throws for want of Jev or a vision provider, or
 * for a failed request: the candidates keep their deterministic order and the
 * status says why. When Jev cannot be called, only a cached description is
 * read, so no vision call is spent on a re-rank that cannot happen.
 */
async function moodRerank<C extends MoodCandidate>(
  candidates: readonly C[],
  design: Fingerprint,
  input: string | Uint8Array,
  setup: MoodSetup,
): Promise<{ design: Fingerprint; rerank: MoodRerank<C> }> {
  const jev = setup.client ? { available: true as const } : await jevAvailability();
  const deterministic = async (reason: string) => {
    const rerank = await rerankByMood(candidates, { palette: design.palette });
    return { ...rerank, note: `${reason} The order is the deterministic one.` };
  };

  let described = design;
  if (!design.description) {
    try {
      described = await describeDesign(design, input, {
        providers: jev.available ? (setup.providers ?? defaultVisionProviders()) : [],
      });
    } catch (error) {
      if (!(error instanceof VisionUnavailableError)) throw error;
      const reason = jev.available ? error.message.replace(/\n+/g, " ") : new JevUnavailableError(jev.reason).message;
      return { design, rerank: await deterministic(reason) };
    }
  }

  try {
    const rerank = await rerankByMood(candidates, described, {
      ...(setup.client && { client: setup.client }),
      ...(setup.cache !== undefined && { cache: setup.cache }),
    });
    return { design: described, rerank };
  } catch (error) {
    return { design: described, rerank: await deterministic(`Mood re-ranking failed: ${(error as Error).message}.`) };
  }
}

function statusOf(rerank: MoodRerank<unknown>): MoodStatus {
  return {
    requested: true,
    applied: rerank.applied,
    weight: rerank.weight,
    ...(rerank.note !== undefined && { reason: rerank.note }),
    ...(rerank.model !== undefined && { model: rerank.model }),
    ...(rerank.cached !== undefined && { cached: rerank.cached }),
  };
}

function moodLine(status: MoodStatus, file: string): string {
  return status.applied
    ? `Mood: re-ranked by Jev for ${file}, mood weight ${status.weight}${status.cached ? " (cached)" : ""}`
    : `Mood: not applied. ${status.reason}`;
}

/**
 * The mood judgment and the combined score that ranked the candidate. The
 * deterministic score stays in the heading as `score`, so the text matches the
 * JSON field for field and the order is explained by `combined`.
 */
function moodSuffix(candidate: Partial<MoodFields>): string {
  if (!candidate.moodLevel) return "";
  return ` · mood ${candidate.moodLevel} (${fmt(candidate.moodScore!, 2)}) · combined ${fmt(candidate.combinedScore!, 3)}`;
}

function moodBadge(candidate: Partial<MoodFields>): { badge?: string } {
  return candidate.moodLevel ? { badge: `Mood: ${candidate.moodLevel}` } : {};
}

/** Replaces the vision providers, Jev client, Jev answer cache, or threshold for swap vetting, as tests do. */
export interface VetSetup extends MoodSetup {
  threshold?: number;
}

/** What swap vetting did, in the `vet` field of `recolor`'s JSON. */
export interface VetStatus {
  requested: true;
  /** True when at least one plan was judged by Jev. */
  applied: boolean;
  /** Plans judged. */
  vetted: number;
  /** Implausible plans left out, as garment and the reasons naming the swap. */
  dropped: { garment: string; plausibility: number; reasons: string[] }[];
  /** Why some or all plans went unvetted. */
  reason?: string;
  model?: string;
}

/**
 * Describe the design when it has no description yet, then plan and vet.
 * Never throws for want of Jev or a vision provider, or for a failed request:
 * the plans are the deterministic ones and the status says why. When Jev
 * cannot be called, only a cached description is read, so no vision call is
 * spent on vetting that cannot happen; cached Jev answers still apply.
 */
async function vetPlans(
  print: Fingerprint,
  measured: RecolorDesign,
  input: string | Uint8Array,
  options: { product: Product; n: number; includeImplausible: boolean },
  setup: VetSetup,
): Promise<{ design: RecolorDesign; plans: (RecolorPlan | VettedPlan)[]; status: VetStatus }> {
  const jev = setup.client ? { available: true as const } : await jevAvailability();
  const deterministic = (design: RecolorDesign, reason: string) => ({
    design,
    plans: recolorPlans(design, { product: options.product, n: options.n }),
    status: { requested: true as const, applied: false, vetted: 0, dropped: [], reason: `Swaps were not vetted: ${reason}` },
  });

  let described = print;
  if (!print.description) {
    try {
      described = await describeDesign(print, input, {
        providers: jev.available ? (setup.providers ?? defaultVisionProviders()) : [],
      });
    } catch (error) {
      if (!(error instanceof VisionUnavailableError)) throw error;
      const reason = jev.available ? error.message.replace(/\n+/g, " ") : new JevUnavailableError(jev.reason).message;
      return deterministic(measured, reason);
    }
  }
  const design = measuredRecolorDesign(measured, described.description!);

  const vetOptions: VetOptions = {};
  if (setup.client) vetOptions.client = setup.client;
  if (setup.cache !== undefined) vetOptions.cache = setup.cache;
  if (setup.threshold !== undefined) vetOptions.threshold = setup.threshold;
  let result;
  try {
    result = await vettedRecolorPlans(design, { ...vetOptions, ...options });
  } catch (error) {
    return deterministic(design, `the request failed: ${(error as Error).message}`);
  }
  const status: VetStatus = {
    requested: true,
    applied: result.vetted > 0,
    vetted: result.vetted,
    dropped: result.dropped.map((p) => ({
      garment: p.color.name,
      plausibility: p.plausibility!,
      reasons: p.reasons.filter((r) => r.startsWith("Implausible:")),
    })),
  };
  if (result.skipped) status.reason = result.skipped.note;
  if (result.model) status.model = result.model;
  return { design, plans: result.plans, status };
}

/** The measured design a recolor plans from: `designJson`, with the vision description once described. */
export type RecolorDesign = ReturnType<typeof designJson> & {
  palette: readonly DesignColor[];
  description?: DesignDescription;
};

/**
 * Bind a fingerprint's vision description to the engine's measured inks:
 * each described element moves to the measured ink nearest its fingerprint
 * color when that ink is within the print minimum distance (10), and each
 * measured ink is labeled with the elements it paints. An element whose color
 * no measured ink is near keeps its fingerprint hex and labels nothing.
 */
export function measuredRecolorDesign(measured: RecolorDesign, description: DesignDescription): RecolorDesign {
  const elements = description.elements.map((element) => {
    const nearestInk = measured.palette
      .map((c) => ({ hex: normalizeHex(c.hex), d: distance(element.hex, c.hex) }))
      .sort((a, b) => a.d - b.d)[0];
    return nearestInk && nearestInk.d < LEGIBILITY_RULES.vanishDistance ? { ...element, hex: nearestInk.hex } : element;
  });
  const bound = { ...description, elements };
  return { ...measured, palette: labelPalette(measured.palette, bound), description: bound };
}

/** ` · plausibility 0.83` or ` · implausible (0.12)` for a vetted plan; empty otherwise. */
function plausibilityNote(plan: RecolorPlan | VettedPlan): string {
  if (!("plausibility" in plan) || plan.plausibility === null) return "";
  return plan.implausible
    ? ` · implausible (${fmt(plan.plausibility, 2)})`
    : ` · plausibility ${fmt(plan.plausibility, 2)}`;
}

/** Fingerprint a design from its bytes when given, else from the file at `file`. */
async function fingerprintDesign(file: string, bytes: Uint8Array | undefined) {
  try {
    return await fingerprint(bytes ?? file);
  } catch (error) {
    const { code, message } = error as NodeJS.ErrnoException;
    throw new InputError(
      code === "ENOENT" ? `no such design file ${JSON.stringify(file)}` : `cannot read ${file}: ${message}`,
    );
  }
}

function requireResolved(
  query: string,
  resolved: ResolvedQuery | undefined,
  reason: string | undefined,
): ResolvedQuery {
  if (resolved) return resolved;
  if (looksLikeHex(query)) {
    throw new InputError(
      `malformed hex ${JSON.stringify(query)}; use #rgb or #rrggbb`,
    );
  }
  throw new InputError(reason ?? `unknown color ${JSON.stringify(query)}`);
}

/** A query meant as hex: a leading `#`, or only hex digits with at least one digit 0-9. */
function looksLikeHex(query: string): boolean {
  const q = query.trim();
  if (isHex(q)) return false;
  return q.startsWith("#") || (/^[0-9a-f]+$/i.test(q) && /\d/.test(q));
}

function describeQuery(query: string, resolved: ResolvedQuery): string {
  if (resolved.via === "hex" || resolved.via === "color") return resolved.hex;
  const source = resolved.via === "wada" ? "Wada" : resolved.via === "css" ? "CSS" : "xkcd";
  return `${resolved.name ?? query} (${source} ${resolved.hex})`;
}

function paletteTitle(p: Palette): string {
  if (p.source === "book") return `Combination ${p.combination.id}`;
  return `${p.harmony[0]!.toUpperCase()}${p.harmony.slice(1)} harmony`;
}

function paletteDetail(p: Palette): string {
  const origin = p.source === "book" ? `via ${p.match.color.name}` : "generated";
  return `${origin} · score ${fmt(p.score)} · contrast ${fmt(p.contrast)}`;
}

function paletteSwatches(p: Palette): Swatch[] {
  if (p.source === "book") return p.colors;
  return p.snaps.map(
    (s): Swatch => ({ ...s.color, note: `from ${s.target}, distance ${fmt(s.distance)}` }),
  );
}
