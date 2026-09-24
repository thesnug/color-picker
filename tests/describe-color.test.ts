import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChoiceQuestion, Questions, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scoreDescribeColor } from "../scripts/score-describe-color.js";
import { defaultProduct, loadColors } from "../src/data/index.js";
import {
  DESCRIBE_COLOR_TOP,
  describeQuestion,
  describeToColor,
  JevUnavailableError,
  lightnessWord,
  NONE_LABEL,
  resetJevClient,
  type SystemOneClient,
} from "../src/jev/index.js";
import { resolveQuery } from "../src/nearest.js";
import { findProductColor } from "../src/palettes.js";

/** A fake client that answers the color question with the given probabilities. */
function fakeClient(probabilities: Record<string, number>): SystemOneClient & { requests: SystemOneRequest[] } {
  const requests: SystemOneRequest[] = [];
  return {
    requests,
    async systemOne<const Q extends Questions>(request: SystemOneRequest<Q>) {
      requests.push(request);
      const labels = Object.keys((request.questions.color as ChoiceQuestion).criteria);
      const full = Object.fromEntries(labels.map((label) => [label, probabilities[label] ?? 0]));
      const choice = Object.entries(full).sort(([, a], [, b]) => b - a)[0]![0];
      return {
        model: "jev-test",
        answers: { color: { type: "choice", choice, confidence: 0.6, probabilities: full } },
        usage: { input_tokens: 10, output_tokens: 3 },
      } as unknown as SystemOneResult<Q>;
    },
  };
}

let cache: string;
const savedKey = process.env.TYPESAFE_API_KEY;
beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), "describe-color-test-"));
  delete process.env.TYPESAFE_API_KEY;
  resetJevClient();
});
afterEach(() => {
  rmSync(cache, { recursive: true, force: true });
  if (savedKey === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = savedKey;
});

describe("describeToColor", () => {
  it("resolves a known name without asking Jev", async () => {
    const client = fakeClient({});
    const result = await describeToColor("Brick Red", { cache, client });
    expect(result.via).toBe("name");
    expect(result.matches[0]!.color.name).toBe("Brick Red");
    expect(client.requests).toHaveLength(0);
  });

  it("resolves a hex code and a CSS name without asking Jev", async () => {
    const client = fakeClient({});
    expect((await describeToColor("#ffffff", { cache, client })).via).toBe("name");
    expect((await describeToColor("rebeccapurple", { cache, client })).via).toBe("name");
    expect(client.requests).toHaveLength(0);
  });

  it("resolves a product color name to that color without asking Jev", async () => {
    const client = fakeClient({});
    const result = await describeToColor("blue jean", { set: "product", cache, client });
    expect(result.via).toBe("name");
    expect(result.product).toBe("comfort-colors-1717");
    expect(result.matches[0]).toMatchObject({ color: { name: "Blue Jean" }, distance: 0 });
    if (result.via === "name") expect(result.resolved).toMatchObject({ via: "product", name: "Blue Jean" });
  });

  it("asks one Choice question over the Wada set when the name lookup misses", async () => {
    const client = fakeClient({ "Burnt Sienna": 0.5, "Etruscan Red": 0.2, "English Red": 0.15, [NONE_LABEL]: 0.1 });
    const result = await describeToColor("old terracotta flowerpot", { cache, client });

    expect(client.requests).toHaveLength(1);
    const [request] = client.requests;
    expect(request!.state).toBe("old terracotta flowerpot");
    const criteria = (request!.questions.color as ChoiceQuestion).criteria;
    expect(Object.keys(criteria)).toHaveLength(loadColors().length + 1);

    expect(result).toMatchObject({ via: "jev", set: "wada", confidence: 0.6, none: 0.1, noneTop: false, cached: false });
    if (result.via !== "jev") throw new Error("expected a Jev result");
    expect(result.matches.map((m) => [m.color.name, m.probability])).toEqual([
      ["Burnt Sienna", 0.5],
      ["Etruscan Red", 0.2],
      ["English Red", 0.15],
    ]);
    expect(result.matches[0]!.color).toMatchObject({ index: expect.any(Number), hex: expect.any(String) });
  });

  it("keeps none out of the matches and reports when it was the top answer", async () => {
    const client = fakeClient({ [NONE_LABEL]: 0.8, White: 0.1, Black: 0.05, Red: 0.03, Blue: 0.02 });
    const result = await describeToColor("quarterly revenue forecast", { cache, client });
    if (result.via !== "jev") throw new Error("expected a Jev result");
    expect(result.noneTop).toBe(true);
    expect(result.none).toBe(0.8);
    expect(result.matches).toHaveLength(DESCRIBE_COLOR_TOP);
    expect(result.matches.map((m) => m.color.name)).not.toContain(NONE_LABEL);
  });

  it("scores none in second place as top-3 but not top-1", async () => {
    const client = fakeClient({ White: 0.6, [NONE_LABEL]: 0.3, Black: 0.08, Red: 0.02 });
    const result = await describeToColor("quarterly revenue forecast", { cache, client });
    if (result.via !== "jev") throw new Error("expected a Jev result");
    expect(result.noneTop).toBe(false);
    expect(scoreDescribeColor(result, [NONE_LABEL])).toEqual({ top1: false, top3: true });
  });

  it("scores none in first place as top-1 and top-3", async () => {
    const client = fakeClient({ [NONE_LABEL]: 0.8, White: 0.1, Black: 0.05 });
    const result = await describeToColor("quarterly revenue forecast", { cache, client });
    if (result.via !== "jev") throw new Error("expected a Jev result");
    expect(scoreDescribeColor(result, [NONE_LABEL])).toEqual({ top1: true, top3: true });
  });

  it("chooses among the product's colors, including unstocked ones", async () => {
    const client = fakeClient({ Brick: 0.7, Terracotta: 0.2, Chili: 0.05 });
    const result = await describeToColor("the brick shirt", { set: "product", cache, client });
    if (result.via !== "jev") throw new Error("expected a Jev result");
    expect(result.product).toBe("comfort-colors-1717");
    expect(result.matches[0]!.color).toMatchObject({ name: "Brick", slug: "brick" });

    const criteria = (client.requests[0]!.questions.color as ChoiceQuestion).criteria;
    expect(Object.keys(criteria)).toHaveLength(defaultProduct().colors.length + 1);
    expect(criteria.Emerald).toMatchObject({ stocked: false });
  });

  it("caches the answer, so a repeat needs no client or key", async () => {
    const client = fakeClient({ "Deep Indigo": 0.6 });
    await describeToColor("deep midnight sea", { cache, client });
    const again = await describeToColor("deep midnight sea", { cache });
    expect(again).toMatchObject({ via: "jev", cached: true });
    expect(client.requests).toHaveLength(1);
  });

  it("throws JevUnavailableError on a miss without a key", async () => {
    await expect(describeToColor("deep midnight sea", { cache })).rejects.toBeInstanceOf(JevUnavailableError);
  });

  it("rejects a blank description", async () => {
    await expect(describeToColor("   ")).rejects.toBeInstanceOf(TypeError);
  });
});

describe("describeQuestion", () => {
  it("describes each Wada color by hex, family, and lightness word", () => {
    const { color } = describeQuestion("wada");
    expect(Object.keys(color.criteria).length).toBeLessThanOrEqual(255);
    expect(color.criteria.White).toEqual({ hex: "#ffffff", family: "neutral", lightness: "light" });
    expect(color.criteria.Black).toMatchObject({ family: "neutral", lightness: "dark" });
    expect(color.instructions).toContain("Sanzo Wada");
  });

  it("names the product and fits under the option limit", () => {
    const { color } = describeQuestion("product");
    expect(Object.keys(color.criteria).length).toBeLessThanOrEqual(255);
    expect(color.instructions).toContain(defaultProduct().name);
  });
});

describe("lightnessWord", () => {
  it("splits light, mid, and dark", () => {
    expect(lightnessWord("#ffffff")).toBe("light");
    expect(lightnessWord("#808080")).toBe("mid");
    expect(lightnessWord("#000000")).toBe("dark");
  });
});

describe("the labeled phrases fixture", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/jev/describe-color.json", import.meta.url), "utf8")) as {
    phrases: { text: string; set: "wada" | "product"; expected: string[] }[];
  };

  it("holds about 30 phrases", () => {
    expect(fixture.phrases.length).toBeGreaterThanOrEqual(30);
  });

  it("only holds phrases the name lookup misses, so each one measures Jev", () => {
    const product = defaultProduct();
    const hits = fixture.phrases.filter(
      (p) => resolveQuery(p.text) !== undefined || (p.set === "product" && findProductColor(product, p.text)),
    );
    expect(hits.map((p) => p.text)).toEqual([]);
  });

  it("only expects colors that exist in the phrase's set", () => {
    const wada = new Set(loadColors().map((c) => c.name));
    const product = new Set(defaultProduct().colors.map((c) => c.name));
    const unknown = fixture.phrases.flatMap((p) =>
      p.expected.filter((name) => name !== NONE_LABEL && !(p.set === "wada" ? wada : product).has(name)),
    );
    expect(unknown).toEqual([]);
  });
});
