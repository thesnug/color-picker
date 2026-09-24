/**
 * Refresh assets/products/comfort-colors-1717.json from Printify.
 *
 *   PRINTIFY_API_TOKEN=... npm run products:import -- [--color-study <path>] [--touch] [--dry-run]
 *
 * Why Printify directly, not POD: see docs/DESIGN.md, "Hex provenance for Comfort
 * Colors 1717".
 *
 * Which colors exist comes from the blueprint's catalog variants for our print
 * provider, out-of-stock variants included: a color that is only temporarily out
 * of stock is still stocked. The catalog carries names but no hex, so swatches are
 * read from the color option of existing shop products on the same blueprint, the
 * way POD's `refreshPrintifyProduct` (services/template-variant-refresh.ts) does,
 * checking one shop after another until every color has a swatch.
 *
 * Merge rules, per color, keyed by slug:
 *   - `source: reviewed` keeps its hex, source, and date. When Printify now says
 *     something else, both values are logged so the drift is visible.
 *   - Otherwise the Printify hex wins and gets `source: printify`. `sourceDate`
 *     changes only when the hex or source changes, or on `--touch`, so a rerun
 *     against unchanged upstream data writes no diff.
 *   - A color in the file but not in Printify is set to `available: false` with the
 *     reason logged. It is never deleted.
 *   - A Printify color with no swatch in any shop is logged and left as it is.
 *   - `family` is always recomputed from the hex with `colorFamily`.
 *   - With `--color-study`, colors found in the maker-method-picker's
 *     `app/prototype/color-study/colors.json` (matched by name) get its `url` and
 *     `sha256` as `image` and its `colorAssetVersionId` as `pod`. That file's hex
 *     values are not used. The file is read in place, never vendored.
 *
 * The token is read from the environment only and never logged.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { colorFamily, normalizeHex } from "../src/color/index.js";
import type { ProductColor } from "../src/data/index.js";

/** Comfort Colors 1717 in the Printify catalog. */
export const BLUEPRINT_ID = 706;
/**
 * Printify Choice. The print provider on POD's Comfort Colors 1717 template;
 * POD's scripts/ops-int1560-build-blank-templates.ts records the decision (INT-1548).
 */
export const PRINT_PROVIDER_ID = 99;

const API = "https://api.printify.com/v1";
const USER_AGENT = "thesnug-color-picker-import";
/** Printify rejects product-list pages above 50. */
const PRODUCT_PAGE_SIZE = 50;
const MAX_RETRIES = 3;

/**
 * Lookup aliases added to Printify's color names. Vendor names stay as Printify
 * spells them; UK spellings are flagged here with the US form as an alias.
 */
export const ALIASES: Record<string, string[]> = {
  grey: ["Gray"],
};

const here = dirname(fileURLToPath(import.meta.url));
export const PRODUCT_FILE = join(here, "..", "assets", "products", "comfort-colors-1717.json");

// ---------------------------------------------------------------------------
// Printify shapes (only the fields read here)

export interface PrintifyVariant {
  id: number;
  options: Record<string, string | undefined>;
}

export interface PrintifyShopProduct {
  blueprint_id?: number;
  options: { type: string; values: { title: string; colors?: string[] }[] }[];
}

/** One color as Printify reports it: the catalog name and the shop swatch, if any. */
export interface UpstreamColor {
  name: string;
  hex?: string;
}

/** One entry of the maker-method-picker's color study. */
export interface ColorStudyEntry {
  name: string;
  url?: string;
  sha256?: string;
  colorAssetVersionId?: string;
}

// ---------------------------------------------------------------------------
// Pure parts

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replaceAll("'", "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Distinct color names from blueprint variants, in first-seen order. */
export function variantColorNames(variants: PrintifyVariant[]): string[] {
  const names = new Map<string, string>();
  for (const variant of variants) {
    const name = (variant.options.color ?? variant.options.Color ?? "").trim();
    if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
  }
  return [...names.values()];
}

/**
 * Color name (lowercase) to hex from the color option of shop products on one
 * blueprint. Mirrors POD's `extractColorNameHex` and `collectBlueprintColorHex`.
 */
export function shopSwatches(products: PrintifyShopProduct[], blueprintId: number): Map<string, string> {
  const swatches = new Map<string, string>();
  for (const product of products) {
    if (product.blueprint_id !== blueprintId) continue;
    const option = product.options.find((o) => o.type === "color");
    for (const value of option?.values ?? []) {
      const hex = value.colors?.[0];
      if (hex) swatches.set(value.title.trim().toLowerCase(), hex);
    }
  }
  return swatches;
}

export interface MergeOptions {
  /** Run date, `YYYY-MM-DD`. */
  today: string;
  /** Set `sourceDate` to today on every Printify-sourced color even when unchanged. */
  touch?: boolean;
  /** The maker-method-picker color study, when a path was given. */
  colorStudy?: ColorStudyEntry[];
}

export interface MergeResult {
  colors: ProductColor[];
  /** Human-readable notes: drift on reviewed colors, removals, missing swatches. */
  log: string[];
}

/** Merge upstream Printify colors into a product's existing colors. See the file header for the rules. */
export function mergeColors(
  existing: ProductColor[],
  upstream: UpstreamColor[],
  options: MergeOptions,
): MergeResult {
  const log: string[] = [];
  const bySlug = new Map(existing.map((c) => [c.slug, c]));
  const study = new Map((options.colorStudy ?? []).map((e) => [e.name.trim().toLowerCase(), e]));
  const seen = new Set<string>();
  const result: ProductColor[] = [];

  for (const { name, hex: rawHex } of upstream) {
    const slug = slugify(name);
    seen.add(slug);
    const current = bySlug.get(slug);
    const hex = rawHex === undefined ? undefined : normalizeHex(rawHex);

    let next: ProductColor;
    if (current?.source === "reviewed") {
      if (hex !== undefined && hex !== current.hex) {
        log.push(`${name}: reviewed ${current.hex} kept; Printify now says ${hex}`);
      }
      next = { ...current, available: true };
    } else if (hex === undefined) {
      log.push(`${name}: in the Printify catalog but no shop product has a swatch for it; ${current ? "left as it is" : "not added"}`);
      if (!current) continue;
      next = current;
    } else {
      const changed = !current || current.hex !== hex || current.source !== "printify";
      next = {
        name,
        slug,
        hex,
        aliases: current?.aliases ?? [],
        family: "",
        available: true,
        source: "printify",
        sourceDate: changed || options.touch || !current ? options.today : current.sourceDate,
      };
      if (current?.image) next.image = current.image;
      if (current?.pod) next.pod = current.pod;
    }

    next = withAliases(next, ALIASES[name.toLowerCase()] ?? []);
    next = withStudy(next, study.get(name.toLowerCase()));
    result.push(finish(next));
  }

  for (const color of existing) {
    if (seen.has(color.slug)) continue;
    if (color.available) {
      log.push(`${color.name}: not in the Printify catalog for provider ${PRINT_PROVIDER_ID}; set available: false`);
    }
    result.push(finish(withStudy({ ...color, available: false }, study.get(color.name.toLowerCase()))));
  }

  result.sort((a, b) => a.slug.localeCompare(b.slug));
  return { colors: result, log };
}

function withAliases(color: ProductColor, extra: string[]): ProductColor {
  const aliases = [...color.aliases];
  for (const alias of extra) if (!aliases.includes(alias)) aliases.push(alias);
  return { ...color, aliases };
}

function withStudy(color: ProductColor, entry: ColorStudyEntry | undefined): ProductColor {
  if (!entry) return color;
  const next = { ...color };
  if (entry.url && entry.sha256) next.image = { url: entry.url, sha256: entry.sha256 };
  if (entry.colorAssetVersionId) next.pod = { colorAssetVersionId: entry.colorAssetVersionId };
  return next;
}

/** Recompute the family and fix the key order so output is stable. */
function finish(color: ProductColor): ProductColor {
  const out: ProductColor = {
    name: color.name,
    slug: color.slug,
    hex: color.hex,
    aliases: color.aliases,
    family: colorFamily(color.hex, color.name),
    available: color.available,
    source: color.source,
    sourceDate: color.sourceDate,
  };
  if (color.image) out.image = { url: color.image.url, sha256: color.image.sha256 };
  if (color.pod) out.pod = { colorAssetVersionId: color.pod.colorAssetVersionId };
  return out;
}

// ---------------------------------------------------------------------------
// Printify API

type Fetch = typeof fetch;

async function printifyGet<T>(path: string, token: string, fetchImpl: Fetch): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT },
    });
    if (response.status === 429 && attempt < MAX_RETRIES) {
      const seconds = Number(response.headers.get("retry-after"));
      await new Promise((r) => setTimeout(r, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 2000));
      continue;
    }
    if (!response.ok) {
      throw new Error(`Printify GET ${path} failed: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as T;
  }
}

/** Fetch every color Printify stocks for the blueprint and provider, with shop swatches where found. */
export async function fetchUpstream(token: string, fetchImpl: Fetch = fetch): Promise<UpstreamColor[]> {
  const { variants } = await printifyGet<{ variants: PrintifyVariant[] }>(
    `/catalog/blueprints/${BLUEPRINT_ID}/print_providers/${PRINT_PROVIDER_ID}/variants.json?show-out-of-stock=1`,
    token,
    fetchImpl,
  );
  const names = variantColorNames(variants);
  if (names.length === 0) throw new Error(`Printify returned no colors for blueprint ${BLUEPRINT_ID}`);

  const swatches = new Map<string, string>();
  const shops = await printifyGet<{ id: number }[]>("/shops.json", token, fetchImpl);
  for (const shop of shops) {
    const products: PrintifyShopProduct[] = [];
    for (let page = 1; ; page++) {
      const res = await printifyGet<{ current_page: number; last_page: number; data: PrintifyShopProduct[] }>(
        `/shops/${shop.id}/products.json?page=${page}&limit=${PRODUCT_PAGE_SIZE}`,
        token,
        fetchImpl,
      );
      products.push(...res.data);
      if (res.current_page >= res.last_page) break;
    }
    for (const [name, hex] of shopSwatches(products, BLUEPRINT_ID)) swatches.set(name, hex);
    if (names.every((n) => swatches.has(n.toLowerCase()))) break;
  }

  return names.map((name) => {
    const hex = swatches.get(name.toLowerCase());
    return hex === undefined ? { name } : { name, hex };
  });
}

// ---------------------------------------------------------------------------
// CLI

interface Args {
  colorStudy?: string;
  touch: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { touch: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--touch") args.touch = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--color-study") {
      const path = argv[++i];
      if (!path) throw new Error("--color-study needs a path");
      args.colorStudy = path;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

export async function main(argv: string[]): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 2;
  }
  const token = process.env.PRINTIFY_API_TOKEN;
  if (!token) {
    process.stderr.write("PRINTIFY_API_TOKEN is not set.\n");
    return 1;
  }

  const product = JSON.parse(readFileSync(PRODUCT_FILE, "utf8")) as { colors: ProductColor[] };
  const colorStudy = args.colorStudy
    ? (JSON.parse(readFileSync(args.colorStudy, "utf8")) as ColorStudyEntry[])
    : undefined;
  const upstream = await fetchUpstream(token);
  const today = new Date().toISOString().slice(0, 10);
  const { colors, log } = mergeColors(product.colors, upstream, {
    today,
    touch: args.touch,
    ...(colorStudy ? { colorStudy } : {}),
  });

  for (const line of log) process.stdout.write(`${line}\n`);
  const available = colors.filter((c) => c.available).length;
  process.stdout.write(`${upstream.length} colors from Printify; ${colors.length} in the file, ${available} available.\n`);

  if (args.dryRun) return 0;
  writeFileSync(PRODUCT_FILE, `${JSON.stringify({ ...product, colors }, null, 2)}\n`);
  process.stdout.write(`Wrote ${PRODUCT_FILE}. Run npm run products:check.\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => (process.exitCode = code),
    (error: unknown) => {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exitCode = 1;
    },
  );
}
