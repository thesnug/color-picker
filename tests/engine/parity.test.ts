/**
 * Chat equals library: for every recorded fixture, each MCP tool's answer is
 * exactly what direct engine calls give on the same pixels, so the skill and
 * POD (which calls the engine) cannot disagree.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ENGINE_FIXTURES, readManifest } from "../../scripts/record-engine-fixtures.js";
import {
  analyzeDesign,
  ENGINE_VERSION,
  garmentsFromProduct,
  judgeLegibility,
  judgeRecolor,
  LEGIBILITY_PROTOCOL,
  legibleInkNeeds,
  planArtworkOptions,
  rankGarments,
  recolorPlans,
  toSubstitutionPlan,
} from "../../src/engine/index.js";
import { decodeForLegibility, fingerprint } from "../../src/fingerprint/index.js";
import { ResultStore, type ToolDefinition, toolDefinitions } from "../../src/mcp/tools.js";

const manifest = readManifest();
/** A value as it crosses the MCP boundary. */
const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

let scratch: string;
let tools: ToolDefinition[];
let savedCacheHome: string | undefined;
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "engine-parity-"));
  savedCacheHome = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = join(scratch, "cache");
  tools = toolDefinitions(new ResultStore(), { cardDir: scratch, embedImages: async (markup) => ({ markup, notEmbedded: [] }) });
});
afterAll(() => {
  if (savedCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = savedCacheHome;
  rmSync(scratch, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown>) {
  const reply = await tools.find((t) => t.name === name)!.handler(args);
  expect(reply.isError, reply.content[0]!.text).toBeFalsy();
  return JSON.parse(reply.content[0]!.text) as Record<string, any>;
}

describe.each(manifest.fixtures)("MCP tools equal the engine for $file", (fixture) => {
  const designPath = join(ENGINE_FIXTURES, fixture.file);
  const bounds = fixture.contentBounds ? { contentBounds: fixture.contentBounds } : {};
  const args = { designPath, product: manifest.product, ...bounds };
  const engine = async () => {
    const bytes = readFileSync(designPath);
    const pixels = await decodeForLegibility(bytes, { contentBounds: fixture.contentBounds });
    const hash = (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex");
    return { pixels, analysis: analyzeDesign(pixels, hash), garments: garmentsFromProduct(manifest.product) };
  };

  it("check_print_legibility", async () => {
    const reply = await call("check_print_legibility", args);
    const { analysis, garments } = await engine();
    expect(reply.engine).toEqual({ version: ENGINE_VERSION, protocol: LEGIBILITY_PROTOCOL });
    expect(reply.measurement).toEqual(wire(analysis.measurement));
    expect(reply.verdicts).toEqual(wire(garments.map((g) => judgeLegibility(analysis.measurement, g))));
  });

  it("recommend_product_colors", async () => {
    const reply = await call("recommend_product_colors", { ...args, n: 100 });
    const { analysis, garments } = await engine();
    const ranked = rankGarments(analysis, garments, { product: manifest.product });
    expect(reply.picks.map(({ color, ...rest }: { color: unknown }) => rest)).toEqual(wire(ranked));
    expect(reply.picks.map((p: any) => p.color.slug)).toEqual(ranked.map((r) => r.garment.slug));
  });

  it("artwork_options", async () => {
    const reply = await call("artwork_options", { ...args, colorCount: manifest.colorCount });
    const { analysis, pixels, garments } = await engine();
    const legibleColors = new Set(garments.filter((g) => judgeLegibility(analysis.measurement, g).pass).map((g) => g.colorName));
    const needs = legibleInkNeeds({ garments, legibleColors, colorCount: manifest.colorCount });
    expect(reply.legibleColors).toEqual([...legibleColors]);
    expect(reply.needs).toEqual(needs);
    expect(reply.options).toEqual(
      wire(planArtworkOptions({ analysis, pixels, garments, needs, legibleColors, product: manifest.product })),
    );
  });

  it("recolor_plans", async () => {
    const reply = await call("recolor_plans", { ...args, n: 5 });
    const { analysis, pixels } = await engine();
    const plans = recolorPlans(await fingerprint(designPath, { cache: false }), { product: manifest.product, n: 5 });
    expect(reply.plans.map((p: any) => p.color.slug)).toEqual(plans.map((p) => p.color.slug));
    reply.plans.forEach((plan: any, i: number) => {
      expect(plan.substitution).toEqual(wire(toSubstitutionPlan(plans[i]!, analysis.measurement)));
      expect(plan.legibility).toEqual(
        wire(
          judgeRecolor({
            measurement: analysis.measurement,
            pixels,
            mapping: plans[i]!.mapping,
            garment: { colorName: plans[i]!.color.name, hex: plans[i]!.color.hex },
          }),
        ),
      );
    });
  });
});
