/**
 * Record what the MCP tools answer for each synthetic print file in
 * tests/fixtures/engine/, as `<fixture>.expected.json` beside it:
 *
 * - `measurement`: the ink measurement (`check_print_legibility`).
 * - `verdicts`: the ink-legibility-v2 verdict on every stocked garment color.
 * - `ranking`: `recommend_product_colors` over every stocked color, in order.
 * - `pairs`: `rankArtworkGarmentPairs` for the file as the only artwork.
 * - `artworkOptions`: `artwork_options` for the manifest's color count.
 * - `substitutedSha256`: for each option, the SHA-256 of the RGBA pixels of the
 *   full-size file after `substitutePigments`, as POD's recolor writes them.
 *
 * POD vendors these files with the engine and its drift test requires its
 * own entry points to give exactly these answers, so chat and POD cannot
 * drift apart unseen. Any change to a recorded output must come with an
 * `ENGINE_VERSION` bump: re-recording a changed output under the version the
 * file already names is refused.
 *
 *   npm run engine:fixtures         # re-record, after bumping ENGINE_VERSION
 *   npm run engine:fixtures:check   # exit 1 if any recorded output differs
 */

import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import sharp from "sharp";

import {
  type ArtworkOption,
  ENGINE_VERSION,
  type InkMeasurement,
  LEGIBILITY_PROTOCOL,
  type LegibilityVerdict,
  rankArtworkGarmentPairs,
  garmentsFromProduct,
  substitutePigments,
} from "../src/engine/index.js";
import { analyzeDesignFile } from "../src/fingerprint/index.js";
import { ResultStore, toolDefinitions } from "../src/mcp/tools.js";
import type { FixtureManifest } from "./make-engine-fixtures.js";

const here = dirname(fileURLToPath(import.meta.url));
export const ENGINE_FIXTURES = join(here, "..", "tests", "fixtures", "engine");

/** One fixture's recorded outputs. */
export interface ExpectedOutputs {
  engineVersion: string;
  protocol: typeof LEGIBILITY_PROTOCOL;
  fixture: string;
  bytesSha256: string;
  product: string;
  contentBounds: FixtureManifest["fixtures"][number]["contentBounds"];
  measurement: InkMeasurement;
  verdicts: LegibilityVerdict[];
  ranking: { colorName: string; pass: boolean; score: number; lostShare: number }[];
  pairs: { artworkId: string; colorName: string; score: number; pass: boolean; lostShare: number; reason: string }[];
  artworkOptions: { colorCount: number; legibleColors: string[]; needs: string[]; options: ArtworkOption[] };
  substitutedSha256: Record<string, string>;
}

/** JSON with the arrays of objects one entry per line, so a change reads as a diff. */
export function serializeExpected(value: ExpectedOutputs): string {
  const lines = Object.entries(value).map(([key, v]) => {
    if (Array.isArray(v) && v.length && typeof v[0] === "object") {
      return `  ${JSON.stringify(key)}: [\n${v.map((item) => `    ${JSON.stringify(item)}`).join(",\n")}\n  ]`;
    }
    if (key === "artworkOptions") {
      const a = v as ExpectedOutputs["artworkOptions"];
      const options = a.options.length ? `[\n${a.options.map((o) => `      ${JSON.stringify(o)}`).join(",\n")}\n    ]` : "[]";
      return (
        `  "artworkOptions": {\n    "colorCount": ${a.colorCount},\n    "legibleColors": ${JSON.stringify(a.legibleColors)},\n` +
        `    "needs": ${JSON.stringify(a.needs)},\n    "options": ${options}\n  }`
      );
    }
    return `  ${JSON.stringify(key)}: ${JSON.stringify(v)}`;
  });
  return `{\n${lines.join(",\n")}\n}\n`;
}

export function readManifest(): FixtureManifest {
  return JSON.parse(readFileSync(join(ENGINE_FIXTURES, "manifest.json"), "utf8")) as FixtureManifest;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Every fixture's outputs as the MCP tools give them now. */
export async function recordAll(): Promise<ExpectedOutputs[]> {
  const manifest = readManifest();
  const cardDir = mkdtempSync(join(tmpdir(), "engine-fixtures-"));
  try {
    const tools = toolDefinitions(new ResultStore(), {
      cardDir,
      // Cards are not recorded; never fetch garment photos.
      embedImages: async (markup) => ({ markup, notEmbedded: [] }),
    });
    const call = async (name: string, args: Record<string, unknown>) => {
      const reply = await tools.find((t) => t.name === name)!.handler(args);
      if (reply.isError) throw new Error(`${name}: ${reply.content[0]!.text}`);
      return JSON.parse(reply.content[0]!.text) as Record<string, unknown>;
    };

    const results: ExpectedOutputs[] = [];
    for (const fixture of manifest.fixtures) {
      const designPath = join(ENGINE_FIXTURES, fixture.file);
      const bytes = readFileSync(designPath);
      const bounds = fixture.contentBounds ? { contentBounds: fixture.contentBounds } : {};
      const common = { designPath, product: manifest.product, ...bounds };

      const legibility = await call("check_print_legibility", common);
      const recommended = await call("recommend_product_colors", { ...common, n: 100 });
      const options = await call("artwork_options", { ...common, colorCount: manifest.colorCount });

      // Pairs have no tool of their own; the study calls the engine directly.
      const { analysis } = await analyzeDesignFile(bytes, { contentBounds: fixture.contentBounds });
      const pairs = rankArtworkGarmentPairs({
        artworks: [{ artworkId: "original", analysis, original: true }],
        garments: garmentsFromProduct(manifest.product),
        colorCount: manifest.colorCount,
        product: manifest.product,
      });

      // The full-size file as POD's recolor decodes it: no resize, sRGB, alpha.
      const { data, info } = await sharp(bytes).toColorspace("srgb").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const full = { data: new Uint8Array(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
      const artworkOptions = options as unknown as ExpectedOutputs["artworkOptions"];
      const substitutedSha256 = Object.fromEntries(
        artworkOptions.options.map((o) => [o.plan.key, sha256(substitutePigments(full, o.plan).pixels.data)]),
      );

      type Pick = { garment: { colorName: string }; score: number; legibility: LegibilityVerdict };
      results.push({
        engineVersion: ENGINE_VERSION,
        protocol: LEGIBILITY_PROTOCOL,
        fixture: fixture.file,
        bytesSha256: sha256(bytes),
        product: manifest.product,
        contentBounds: fixture.contentBounds,
        measurement: legibility.measurement as InkMeasurement,
        verdicts: legibility.verdicts as LegibilityVerdict[],
        ranking: (recommended.picks as Pick[]).map((p) => ({
          colorName: p.garment.colorName,
          pass: p.legibility.pass,
          score: p.score,
          lostShare: p.legibility.lostShare,
        })),
        pairs: pairs.map((p) => ({
          artworkId: p.artworkId,
          colorName: p.colorName,
          score: p.score,
          pass: p.legibility.pass,
          lostShare: p.legibility.lostShare,
          reason: p.reason,
        })),
        artworkOptions: {
          colorCount: artworkOptions.colorCount,
          legibleColors: artworkOptions.legibleColors,
          needs: artworkOptions.needs,
          options: artworkOptions.options,
        },
        substitutedSha256,
      });
    }
    return results;
  } finally {
    rmSync(cardDir, { recursive: true, force: true });
  }
}

/** The fixtures whose recorded outputs differ from what the tools give now. */
export async function staleFixtures(): Promise<{ file: string; recordedVersion: string | undefined }[]> {
  const stale: { file: string; recordedVersion: string | undefined }[] = [];
  for (const result of await recordAll()) {
    const path = join(ENGINE_FIXTURES, result.fixture.replace(/\.png$/, ".expected.json"));
    let current: string | undefined;
    try {
      current = readFileSync(path, "utf8");
    } catch {
      current = undefined;
    }
    if (current !== serializeExpected(result)) {
      const recordedVersion = current ? (JSON.parse(current) as ExpectedOutputs).engineVersion : undefined;
      stale.push({ file: result.fixture, recordedVersion });
    }
  }
  return stale;
}

export async function main(argv: readonly string[]): Promise<number> {
  const check = argv.includes("--check");
  const results = await recordAll();
  let stale = 0;
  let refused = 0;
  for (const result of results) {
    const path = join(ENGINE_FIXTURES, result.fixture.replace(/\.png$/, ".expected.json"));
    const next = serializeExpected(result);
    let current: string | undefined;
    try {
      current = readFileSync(path, "utf8");
    } catch {
      current = undefined;
    }
    if (current === next) continue;
    stale++;
    if (check) {
      process.stderr.write(`stale: ${path}\n`);
      continue;
    }
    const recorded = current === undefined ? undefined : (JSON.parse(current) as ExpectedOutputs).engineVersion;
    if (recorded === ENGINE_VERSION) {
      process.stderr.write(
        `refused: ${path} changes under engine ${ENGINE_VERSION}, the version it was recorded with. ` +
          "Bump ENGINE_VERSION in src/engine/rules.ts for any change to the engine's outputs, then re-record.\n",
      );
      refused++;
      continue;
    }
    writeFileSync(path, next);
    process.stdout.write(`wrote ${path}\n`);
  }
  if (check && stale) {
    process.stderr.write("Engine fixtures are stale. If the change is intended, bump ENGINE_VERSION and run: npm run engine:fixtures\n");
    return 1;
  }
  if (refused) return 1;
  if (check) process.stdout.write(`Engine fixtures match engine ${ENGINE_VERSION}.\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
