/**
 * Build the derived Wada data files from the vendored source.
 *
 *   npm run data:build   # write assets/derived/*.json
 *   npm run data:check   # exit 1 if the committed files are stale
 *
 * `assets/colors.json` is never edited by hand. This script reads it and writes
 * `assets/derived/colors.json` and `assets/derived/combinations.json`. Output is
 * deterministic: fixed key order, fixed rounding, sorted arrays, trailing newline.
 *
 * CHANGES applied to color names. The source name is always kept as an alias.
 * The printed book is the authority: every entry below was checked against it
 * by Jill on 2026-09-24. A name is corrected only where the web edition differs
 * from the book. Where the book itself uses an unusual spelling, the name stays
 * and the modern or Ridgway spelling is added as an alias for lookup.
 *
 *   Typos in the web edition, corrected to the book
 *     Calamine BLue        -> Calamine Blue
 *     Pomegranite Purple   -> Pomegranate Purple
 *     Sulpher Yellow       -> Sulphur Yellow   (alias Sulfur Yellow for US spelling)
 *     Krongbergs Green     -> Kronbergs Green  (no apostrophe in the book)
 *     Artemesia Green      -> Artemisia Green
 *
 *   As printed in the book, kept, with a lookup alias
 *     Cerulian Blue        +Cerulean Blue
 *     Antwarp Blue         +Antwerp Blue
 *     Rosolanc Purple      +Rosolane Purple
 *     Vandar Poel's Blue   +Vanderpoel's Blue
 *     Vistoris Lake        (no alias; its Ridgway source is not established)
 *
 *   Variants (the shared base name is also an alias, and `variant` records the letter)
 *     Eugenia Red | A        -> Eugenia Red A
 *     Eugenia Red | B        -> Eugenia Red B
 *     Grayish Lavender - A   -> Grayish Lavender A
 *     Grayish Lavender - B   -> Grayish Lavender B
 *
 *   Dual names (the second name becomes an alias)
 *     Mars Brown / Tobacco     -> Mars Brown      (alias Tobacco)
 *     Deep Violet / Plumbeous  -> Deep Violet     (alias Plumbeous)
 *
 *   Spelling aliases added for lookup, names unchanged
 *     Ochre Red     +Ocher Red
 *     Olive Ocher   +Olive Ochre
 *     Yellow Ocher  +Yellow Ochre
 *
 *   Observed, not changed
 *     Vandar Poel's Blue (127) belongs to no combination in the source.
 *     Eupatorium Purple (136) and Light Mauve (137) list identical combinations,
 *     which looks like a source transcription error. Kept as vendored.
 *     The source records no order of colors within a combination, so `colors`
 *     is in index order.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { rgbToOklab } from "../src/color/convert.js";
import type {
  Combination,
  CombinationsFile,
  DerivedColor,
  DerivedColorsFile,
  Harmony,
  WadaDataset,
} from "../src/data/index.js";

// Name corrections: source name -> { name, aliases?, variant? }.
const NAME_FIXES: Record<string, { name: string; aliases?: string[]; variant?: string }> = {
  "Calamine BLue": { name: "Calamine Blue" },
  "Pomegranite Purple": { name: "Pomegranate Purple" },
  "Sulpher Yellow": { name: "Sulphur Yellow", aliases: ["Sulfur Yellow"] },
  "Krongbergs Green": { name: "Kronbergs Green" },
  "Artemesia Green": { name: "Artemisia Green" },
  "Cerulian Blue": { name: "Cerulian Blue", aliases: ["Cerulean Blue"] },
  "Antwarp Blue": { name: "Antwarp Blue", aliases: ["Antwerp Blue"] },
  "Rosolanc Purple": { name: "Rosolanc Purple", aliases: ["Rosolane Purple"] },
  "Vandar Poel's Blue": { name: "Vandar Poel's Blue", aliases: ["Vanderpoel's Blue"] },
  "Eugenia Red | A": { name: "Eugenia Red A", aliases: ["Eugenia Red"], variant: "A" },
  "Eugenia Red | B": { name: "Eugenia Red B", aliases: ["Eugenia Red"], variant: "B" },
  "Grayish Lavender - A": { name: "Grayish Lavender A", aliases: ["Grayish Lavender"], variant: "A" },
  "Grayish Lavender - B": { name: "Grayish Lavender B", aliases: ["Grayish Lavender"], variant: "B" },
  "Mars Brown / Tobacco": { name: "Mars Brown", aliases: ["Tobacco"] },
  "Deep Violet / Plumbeous": { name: "Deep Violet", aliases: ["Plumbeous"] },
  "Ochre Red": { name: "Ochre Red", aliases: ["Ocher Red"] },
  "Olive Ocher": { name: "Olive Ocher", aliases: ["Olive Ochre"] },
  "Yellow Ocher": { name: "Yellow Ocher", aliases: ["Yellow Ochre"] },
};

/** Harmony thresholds, in degrees of OKLCH hue unless noted. */
export const HARMONY = {
  /**
   * OKLab chroma at or below which a color counts as neutral. Chosen so White,
   * Black, the four named grays, Slate Color, Deep Slate Olive, Deep Slate Green,
   * Deep Violet (Plumbeous), and Fawn are neutral while Ecru (0.051) is not.
   */
  neutralChroma: 0.045,
  /** Hues closer than this to a cluster's mean join that cluster. */
  cluster: 20,
  /** All chromatic hues within this arc: monochromatic. */
  monochromatic: 20,
  /** All chromatic hues within this arc: analogous. */
  analogous: 90,
  /** Tolerance around 180 for complementary and around 120 for triadic. */
  tolerance: 25,
  /** The two near hues of a split-complementary lie this far apart. */
  splitMin: 30,
  splitMax: 70,
} as const;

function round(value: number, places: number): number {
  const f = 10 ** places;
  const r = Math.round(value * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Circular mean of hues in degrees, in [0, 360). */
function meanHue(hues: readonly number[]): number {
  let x = 0;
  let y = 0;
  for (const h of hues) {
    x += Math.cos((h * Math.PI) / 180);
    y += Math.sin((h * Math.PI) / 180);
  }
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Greedy clustering: each hue joins the first cluster whose mean is within reach. */
function clusterHues(hues: readonly number[]): number[] {
  const clusters: number[][] = [];
  for (const h of [...hues].sort((a, b) => a - b)) {
    const hit = clusters.find((c) => hueDistance(meanHue(c), h) <= HARMONY.cluster);
    if (hit) hit.push(h);
    else clusters.push([h]);
  }
  return clusters.map(meanHue).sort((a, b) => a - b);
}

/** Smallest arc containing every hue, in degrees. 0 for fewer than two hues. */
export function hueArc(hues: readonly number[]): number {
  if (hues.length < 2) return 0;
  const sorted = [...hues].sort((a, b) => a - b);
  let largestGap = 0;
  for (let i = 0; i < sorted.length; i++) {
    const next = i + 1 < sorted.length ? sorted[i + 1]! : sorted[0]! + 360;
    largestGap = Math.max(largestGap, next - sorted[i]!);
  }
  return 360 - largestGap;
}

function near(value: number, target: number): boolean {
  return Math.abs(value - target) <= HARMONY.tolerance;
}

/** Label a combination from the OKLCH hues of its chromatic members. */
export function classifyHarmony(chromaticHues: readonly number[]): Harmony {
  const arc = hueArc(chromaticHues);
  if (arc <= HARMONY.monochromatic) return "monochromatic";

  const hues = clusterHues(chromaticHues);
  const n = hues.length;

  if (n === 1) return "monochromatic";

  if (n === 2) {
    const d = hueDistance(hues[0]!, hues[1]!);
    if (near(d, 180)) return "complementary";
    if (arc <= HARMONY.analogous) return "analogous";
    return "other";
  }

  if (n === 3) {
    const [a, b, c] = hues as [number, number, number];
    const gaps = [b - a, c - b, a + 360 - c];
    if (gaps.every((g) => near(g, 120))) return "triadic";
    // Split-complementary: two hues close together, the third opposite their midpoint.
    for (let i = 0; i < 3; i++) {
      const pair = [hues[i]!, hues[(i + 1) % 3]!] as const;
      const third = hues[(i + 2) % 3]!;
      const pairGap = hueDistance(pair[0], pair[1]);
      if (
        pairGap >= HARMONY.splitMin &&
        pairGap <= HARMONY.splitMax &&
        near(hueDistance(meanHue(pair), third), 180)
      ) {
        return "split-complementary";
      }
    }
    if (arc <= HARMONY.analogous) return "analogous";
    return "other";
  }

  if (arc <= HARMONY.analogous) return "analogous";
  return "other";
}

// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replaceAll("'", "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildDerived(source: WadaDataset): {
  colors: DerivedColorsFile;
  combinations: CombinationsFile;
} {
  const colors: DerivedColor[] = source.colors.map((c) => {
    const fix = NAME_FIXES[c.name];
    const name = fix?.name ?? c.name;
    const aliasSet = new Set<string>(fix?.aliases ?? []);
    if (c.name !== name) aliasSet.add(c.name);
    const aliases = [...aliasSet].sort((a, b) => a.localeCompare(b, "en"));

    // Chroma and hue come from the rounded a and b so the stored OKLCH agrees
    // with the stored OKLab, and so neutrals get an exact zero instead of noise.
    const { l: L, a: rawA, b: rawB } = rgbToOklab(c.rgb_array);
    const a = round(rawA, 5);
    const b = round(rawB, 5);
    const chroma = Math.hypot(a, b);
    const hue = chroma === 0 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;

    const color: DerivedColor = {
      index: c.index,
      name,
      slug: slugify(name),
      aliases,
      sourceName: c.name,
      sourceSlug: c.slug,
      hex: c.hex.toLowerCase(),
      rgb: [...c.rgb_array],
      cmyk: [...c.cmyk_array],
      oklab: { l: round(L, 5), a, b },
      oklch: { l: round(L, 5), c: round(chroma, 5), h: round(hue, 2) % 360 },
      neutral: chroma <= HARMONY.neutralChroma,
      combinations: [...c.combinations].sort((x, y) => x - y),
    };
    if (fix?.variant !== undefined) color.variant = fix.variant;
    return color;
  });

  const byIndex = new Map(colors.map((c) => [c.index, c]));
  const members = new Map<number, number[]>();
  for (const c of colors) {
    for (const id of c.combinations) {
      const list = members.get(id) ?? [];
      list.push(c.index);
      members.set(id, list);
    }
  }

  const combinations: Combination[] = [...members.keys()]
    .sort((a, b) => a - b)
    .map((id) => {
      const indexes = members.get(id)!.sort((a, b) => a - b);
      const cs = indexes.map((i) => byIndex.get(i)!);
      const chromaticHues = cs.filter((c) => !c.neutral).map((c) => c.oklch.h);
      return {
        id,
        colors: indexes,
        size: indexes.length,
        harmony: classifyHarmony(chromaticHues),
        averageLightness: round(cs.reduce((sum, c) => sum + c.oklab.l, 0) / cs.length, 5),
        hueSpread: round(hueArc(chromaticHues), 2),
        hasNeutral: cs.some((c) => c.neutral),
      };
    });

  return {
    colors: { colors },
    combinations: { combinations },
  };
}

// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(here, "..", "assets");
const SOURCE = join(ASSETS, "colors.json");
const OUT_DIR = join(ASSETS, "derived");
const OUTPUTS = {
  colors: join(OUT_DIR, "colors.json"),
  combinations: join(OUT_DIR, "combinations.json"),
} as const;

export function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function main(argv: readonly string[]): number {
  const check = argv.includes("--check");
  const source = JSON.parse(readFileSync(SOURCE, "utf8")) as WadaDataset;
  const derived = buildDerived(source);

  let stale = 0;
  for (const key of ["colors", "combinations"] as const) {
    const path = OUTPUTS[key];
    const next = serialize(derived[key]);
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
      mkdirSync(OUT_DIR, { recursive: true });
      writeFileSync(path, next);
      process.stdout.write(`wrote ${path}\n`);
    }
  }

  if (check) {
    if (stale > 0) {
      process.stderr.write("Derived data is stale. Run: npm run data:build\n");
      return 1;
    }
    process.stdout.write("Derived data is up to date.\n");
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
