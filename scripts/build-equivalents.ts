/**
 * Build each product's Wada equivalents from its product file and the derived
 * Wada colors.
 *
 *   npm run products:equivalents         # write assets/products/<id>.equivalents.json
 *   npm run products:equivalents:check   # exit 1 if a committed file is stale
 *
 * For every color of every product in the index, the file records the product
 * hex, its OKLCH, its family from the product file, and the three nearest Wada
 * colors by `distance()`. Colors with no hex are listed with no matches.
 *
 * The check rebuilds the output and compares it byte for byte, so it fails when
 * the product file, `assets/derived/colors.json`, or this script's output has
 * changed without a rebuild. Output is deterministic: fixed key order, fixed
 * rounding, product file order, ties broken by Wada index, trailing newline.
 *
 * The build prints a summary: the spread of best-match distances, and every
 * color whose best match is farther than {@link POOR_MATCH}, so gaps in the
 * Wada set are visible.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hexToOklch } from "../src/color/convert.js";
import {
  loadColors,
  loadProduct,
  loadProductIndex,
  type DerivedColor,
  type EquivalentMatch,
  type Product,
  type ProductColorEquivalents,
  type ProductEquivalentsFile,
} from "../src/data/index.js";
import { nearest } from "../src/nearest.js";

/** Wada matches stored per product color. */
export const EQUIVALENTS_K = 3;

/** Best-match distances above this are reported as poor coverage. */
export const POOR_MATCH = 10;

/** Upper bounds of the summary's distance buckets; the last bucket is open. */
const BUCKETS = [2, 5, POOR_MATCH] as const;

function round(value: number, places: number): number {
  const f = 10 ** places;
  const r = Math.round(value * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/**
 * The product file schema requires a hex today. The gap fill for unstocked
 * colors (INT-2258) allows `hex: null` when `available` is false, so the
 * builder accepts it now.
 */
type ProductInput = Omit<Product, "colors"> & {
  colors: (Omit<Product["colors"][number], "hex"> & { hex: string | null })[];
};

export function buildEquivalents(
  product: ProductInput,
  wada: readonly DerivedColor[] = loadColors(),
): ProductEquivalentsFile {
  const colors: Record<string, ProductColorEquivalents> = {};
  for (const c of product.colors) {
    if (c.hex === null) {
      colors[c.slug] = { name: c.name, hex: null, oklch: null, family: c.family, matches: [] };
      continue;
    }
    const hex = c.hex.toLowerCase();
    const { l, c: chroma, h } = hexToOklch(hex);
    const { matches } = nearest(hex, { k: EQUIVALENTS_K, colors: wada });
    colors[c.slug] = {
      name: c.name,
      hex,
      oklch: { l: round(l, 5), c: round(chroma, 5), h: round(h, 2) % 360 },
      family: c.family,
      matches: matches.map((m) => ({
        index: m.color.index,
        name: m.color.name,
        distance: round(m.distance, 3),
      })),
    };
  }
  return { product: product.id, colors };
}

export function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Best-match distance statistics and poorly covered colors, as printable lines. */
export function summarize(file: ProductEquivalentsFile): string[] {
  const best = Object.entries(file.colors)
    .filter(([, e]) => e.matches.length > 0)
    .map(([slug, e]) => ({ slug, name: e.name, match: e.matches[0]! }))
    .sort((a, b) => a.match.distance - b.match.distance || a.slug.localeCompare(b.slug, "en"));
  const unmatched = Object.values(file.colors).filter((e) => e.matches.length === 0);

  const lines = [`${file.product}: ${best.length} colors matched, ${unmatched.length} without a hex`];
  if (best.length > 0) lines.push(...distanceLines(best));
  for (const e of unmatched) lines.push(`  no hex: ${e.name}`);
  return lines;
}

function distanceLines(best: { slug: string; name: string; match: EquivalentMatch }[]): string[] {
  const lines: string[] = [];
  const d = best.map((b) => b.match.distance);
  const at = (q: number) => d[Math.min(d.length - 1, Math.floor(q * d.length))]!;
  lines.push(
    `  best-match distance: min ${d[0]}, median ${at(0.5)}, p90 ${at(0.9)}, max ${d[d.length - 1]}`,
  );

  let lower = 0;
  for (const upper of [...BUCKETS, Infinity]) {
    const n = d.filter((x) => x >= lower && x < upper).length;
    const label = upper === Infinity ? `${lower}+` : `${lower} to ${upper}`;
    lines.push(`    ${label.padEnd(8)} ${String(n).padStart(3)} ${"#".repeat(n)}`);
    lower = upper;
  }

  const poor = best.filter((b) => b.match.distance > POOR_MATCH);
  if (poor.length === 0) {
    lines.push(`  every best match is within ${POOR_MATCH}`);
  } else {
    lines.push(`  best match farther than ${POOR_MATCH}:`);
    for (const p of poor.reverse()) {
      lines.push(`    ${p.name} (${p.slug}): ${p.match.name} at ${p.match.distance}`);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const PRODUCTS_DIR = join(here, "..", "assets", "products");

export function outputPath(id: string): string {
  return join(PRODUCTS_DIR, `${id}.equivalents.json`);
}

export function main(argv: readonly string[]): number {
  const check = argv.includes("--check");
  const wada = loadColors();

  let stale = 0;
  for (const { id } of loadProductIndex().products) {
    const built = buildEquivalents(loadProduct(id), wada);
    const path = outputPath(id);
    const next = serialize(built);
    if (check) {
      let current: string | undefined;
      try {
        current = readFileSync(path, "utf8");
      } catch {
        current = undefined;
      }
      if (current !== next) {
        process.stderr.write(`stale: ${path}\n`);
        stale++;
      }
    } else {
      writeFileSync(path, next);
      process.stdout.write(`wrote ${path}\n`);
      process.stdout.write(`${summarize(built).join("\n")}\n`);
    }
  }

  if (check) {
    if (stale > 0) {
      process.stderr.write("Product equivalents are stale. Run: npm run products:equivalents\n");
      return 1;
    }
    process.stdout.write("Product equivalents are up to date.\n");
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
