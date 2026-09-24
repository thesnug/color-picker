/**
 * The CLI commands. Each builds a `View`: the same result as JSON, terminal
 * text, and SVG sections, so every command supports every output flag.
 */

import { combinations, type Palette } from "../combinations.js";
import { isHex } from "../color/convert.js";
import { loadColors, loadCombinations, loadProduct, loadProductIndex, type Product } from "../data/index.js";
import { fingerprint } from "../fingerprint/index.js";
import { nearest, type ResolvedQuery } from "../nearest.js";
import { recommendProductColors } from "../recommend.js";
import {
  renderAnsi,
  renderCombination,
  renderProductCard,
  renderSwatchGrid,
  type Swatch,
} from "../render/index.js";
import { fmt } from "../render/shared.js";

/** A command's output in every format the CLI can write. */
export interface View {
  /** Page and SVG title. */
  title: string;
  /** Machine-readable result for `--json`. */
  json: unknown;
  /** Terminal output. `color` is false when escape codes should be left out. */
  text: (color: boolean) => string;
  /** SVG sections for `--svg` and `--html`. */
  sections: { title?: string; svg: string; caption?: string }[];
}

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
  const anchorLine =
    `Anchor: ${anchor.color.name} ${anchor.color.hex} ` +
    `(${anchor.via === "nearest-neutral" ? "nearest neutral, " : ""}distance ${fmt(anchor.distance)})`;

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

/** Default `-n` for `recommend`. */
export const DEFAULT_RECOMMEND_N = 5;

export interface RecommendArgs {
  file: string;
  n: number;
  product?: string;
}

export async function recommendView({ file, n, product: productId }: RecommendArgs): Promise<View> {
  let product: Product;
  try {
    product = loadProduct(productId ?? loadProductIndex().default);
  } catch (error) {
    throw new InputError((error as Error).message);
  }

  let design;
  try {
    design = await fingerprint(file);
  } catch (error) {
    const { code, message } = error as NodeJS.ErrnoException;
    throw new InputError(
      code === "ENOENT" ? `no such design file ${JSON.stringify(file)}` : `cannot read ${file}: ${message}`,
    );
  }

  const picks = recommendProductColors(design, { product, n });
  const title = `${product.brand} ${product.model} colors for ${file}`;
  const chips: Swatch[] = design.palette.map((entry, i) => ({
    hex: entry.hex,
    name: `${Math.round(entry.share * 100)}% · near ${picks[0]?.designColors[i]?.wada.name ?? entry.hex}`,
  }));
  const heading = (i: number) => `${i + 1}. ${picks[i]!.color.name} · score ${fmt(picks[i]!.score, 3)}`;

  const designLine = `Design: ${chips.map((c) => `${c.hex} ${c.name}`).join(", ")}; ink luminance ${fmt(design.inkLuminance)}`;
  return {
    title,
    json: { product: { id: product.id, name: product.name }, design, picks },
    text: (color) =>
      [
        `${title}\n${designLine}\n`,
        ...picks.map((pick, i) =>
          [
            heading(i),
            renderAnsi([pick.color], { color }).trimEnd(),
            ...pick.reasons.map((r) => `  ${r}`),
            ...pick.warnings.map((w) => `  Warning: ${w}`),
          ].join("\n") + "\n",
        ),
      ].join("\n"),
    sections: picks.map((pick, i) => ({
      title: heading(i),
      svg: renderProductCard(pick.color, { designColors: chips }),
      caption: [...pick.reasons, ...pick.warnings.map((w) => `Warning: ${w}`)].join(" "),
    })),
  };
}

// ---------------------------------------------------------------------------

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
