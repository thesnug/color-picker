import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { NoulQuestion, Questions, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { recolorView } from "../src/cli/commands.js";
import { fingerprint, type VisionProvider } from "../src/fingerprint/index.js";
import {
  PLAUSIBILITY_THRESHOLD,
  resetJevClient,
  swapQuestion,
  type SystemOneClient,
  vetQuestions,
  vetRecolorPlans,
  vettedRecolorPlans,
} from "../src/jev/index.js";
import { type RecolorPlan, recolorPlans } from "../src/index.js";

const FLAT_MARK = join(import.meta.dirname, "fixtures", "designs", "flat-mark.png");

/** A strawberry on a cream ground, as a described fingerprint. */
const strawberry = {
  palette: [
    { hex: "#c8102e", share: 0.45, element: "strawberry body" },
    { hex: "#f3ead3", share: 0.35, element: "background" },
    { hex: "#2f7d32", share: 0.15, element: "leaves" },
    { hex: "#1c1c1c", share: 0.05 },
  ],
  inkLuminance: 0.3,
  description: {
    subject: "a ripe strawberry with two leaves",
    mood: "bright, cheerful, flat illustration",
    elements: [
      { name: "strawberry body", color: "deep red", hex: "#c8102e" },
      { name: "background", color: "cream", hex: "#f3ead3" },
      { name: "leaves", color: "leaf green", hex: "#2f7d32" },
    ],
  },
};

/**
 * A fake client answering each Noul with `judge(instructions)`, recording
 * every request.
 */
function fakeClient(judge: (instructions: string) => number): SystemOneClient & { requests: SystemOneRequest[] } {
  const requests: SystemOneRequest[] = [];
  return {
    requests,
    async systemOne<const Q extends Questions>(request: SystemOneRequest<Q>) {
      requests.push(request);
      const answers = Object.fromEntries(
        Object.entries(request.questions).map(([name, q]) => [
          name,
          { type: "noul", noul: judge(String((q as NoulQuestion).instructions)) },
        ]),
      );
      return { model: "jev-test", answers, usage: { input_tokens: 10, output_tokens: 3 } } as unknown as SystemOneResult<Q>;
    },
  };
}

/** Rejects any change to the strawberry's body; accepts everything else. */
const rejectsBody = fakeClient((q) => (q.includes("strawberry body") ? 0.08 : 0.9));

let cache: string;
const savedKey = process.env.TYPESAFE_API_KEY;
const savedCacheHome = process.env.XDG_CACHE_HOME;
beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), "vet-test-"));
  // Fingerprints and descriptions made by recolorView stay out of the real cache.
  process.env.XDG_CACHE_HOME = join(cache, "xdg");
  delete process.env.TYPESAFE_API_KEY;
  resetJevClient();
  rejectsBody.requests.length = 0;
});
afterEach(() => {
  rmSync(cache, { recursive: true, force: true });
  if (savedCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = savedCacheHome;
  if (savedKey === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = savedKey;
});

const bodyIndex = (plan: { mapping: RecolorPlan["mapping"] }) =>
  plan.mapping.findIndex((m) => m.from.element === "strawberry body");

describe("vetRecolorPlans", () => {
  it("rejects a fruit's body swap and accepts its background swap", async () => {
    const [plan] = recolorPlans(strawberry, { n: 1 });
    const { plans, vetted, model } = await vetRecolorPlans([plan!], strawberry, { cache, client: rejectsBody });
    const vettedPlan = plans[0]!;
    expect(vetted).toBe(1);
    expect(model).toBe("jev-test");

    const body = vettedPlan.mapping.find((m) => m.from.element === "strawberry body")!;
    const background = vettedPlan.mapping.find((m) => m.from.element === "background")!;
    expect(body.plausibility).toBe(0.08);
    expect(background.plausibility).toBe(0.9);
    expect(vettedPlan.plausibility).toBe(0.08);
    expect(vettedPlan.implausible).toBe(true);
    expect(vettedPlan.reasons.at(-1)).toMatch(/^Implausible: the strawberry body as .+ \(plausibility 0\.08, below 0\.8\)\.$/);
    // The deterministic reasons are kept ahead of the judgment.
    expect(vettedPlan.reasons.slice(0, plan!.reasons.length)).toEqual(plan!.reasons);
  });

  it("passes a plan whose every swap is plausible", async () => {
    const [plan] = recolorPlans(strawberry, { n: 1 });
    const client = fakeClient(() => 0.85);
    const { plans } = await vetRecolorPlans([plan!], strawberry, { cache, client });
    expect(plans[0]!.plausibility).toBe(0.85);
    expect(plans[0]!.implausible).toBe(false);
    expect(plans[0]!.reasons).toEqual(plan!.reasons);
  });

  it("sends one request per plan, with the description as state and one Noul per swap", async () => {
    const plans = recolorPlans(strawberry, { n: 2 });
    await vetRecolorPlans(plans, strawberry, { cache, client: rejectsBody });
    expect(rejectsBody.requests).toHaveLength(2);
    const request = rejectsBody.requests[0]!;
    expect(request.state).toEqual({
      subject: strawberry.description.subject,
      mood: strawberry.description.mood,
      elements: strawberry.description.elements.map(({ name, color }) => ({ name, color })),
    });
    const questions = Object.values(request.questions) as NoulQuestion[];
    expect(questions.every((q) => q.type === "noul")).toBe(true);
    expect(questions).toHaveLength(plans[0]!.mapping.length);
  });

  it("answers from the cache the second time", async () => {
    const plans = recolorPlans(strawberry, { n: 1 });
    await vetRecolorPlans(plans, strawberry, { cache, client: rejectsBody });
    const again = await vetRecolorPlans(plans, strawberry, { cache, client: rejectsBody });
    expect(rejectsBody.requests).toHaveLength(1);
    expect(again.plans[0]!.plausibility).toBe(0.08);
  });

  it("passes every plan with a note when Jev is unavailable", async () => {
    const plans = recolorPlans(strawberry, { n: 2 });
    const result = await vetRecolorPlans(plans, strawberry, { cache });
    expect(result.vetted).toBe(0);
    expect(result.skipped?.reason).toBe("api-key-missing");
    expect(result.skipped?.note).toMatch(/TYPESAFE_API_KEY/);
    expect(result.plans.every((p) => p.plausibility === null && !p.implausible)).toBe(true);
    expect(result.plans[0]!.mapping.every((m) => m.plausibility === null)).toBe(true);
  });

  it("passes every plan with a note when the design has no description", async () => {
    const plans = recolorPlans(strawberry, { n: 1 });
    const result = await vetRecolorPlans(plans, {}, { cache, client: rejectsBody });
    expect(rejectsBody.requests).toHaveLength(0);
    expect(result.skipped?.reason).toBe("no-description");
    expect(result.plans[0]!.plausibility).toBeNull();
  });

  it("honors a threshold override", async () => {
    const plans = recolorPlans(strawberry, { n: 1 });
    const result = await vetRecolorPlans(plans, strawberry, { cache, client: rejectsBody, threshold: 0.05 });
    expect(result.plans[0]!.implausible).toBe(false);
    expect(PLAUSIBILITY_THRESHOLD).toBe(0.8);
  });
});

describe("vetQuestions", () => {
  const mapping = recolorPlans(strawberry, { n: 1 })[0]!.mapping;

  it("words a named element's swap with its color in words and the target's family and lightness", () => {
    const body = mapping[bodyIndex({ mapping })]!;
    expect(swapQuestion(body, strawberry.description)).toMatch(
      new RegExp(
        `^If the strawberry body changes from deep red to ${body.to.name} \\((neutral|earth|red-pink|orange-yellow|green|blue|purple|neon), (light|mid|dark)\\), ` +
          "does the design still read as the same subject with a natural or intentionally stylized color\\?$",
      ),
    );
  });

  it("asks about the design as a whole for a swap without a named element", () => {
    const unlabeled = mapping.find((m) => !m.from.element)!;
    expect(swapQuestion(unlabeled, strawberry.description)).toMatch(
      /^If the dark neutral areas \(5% of the design\) change to .+, does the design as a whole still read as the same subject/,
    );
  });

  it("skips a swap that is not a change", () => {
    const kept = { from: { hex: "#c8102e" as const, share: 0.5, element: "strawberry body" }, to: { index: 1, name: "Same", hex: "#c8102e" as const } };
    expect(vetQuestions([kept], strawberry.description)).toEqual({});
  });
});

describe("vettedRecolorPlans", () => {
  // Rejects the body's ink in the top-ranked plan, wherever it appears.
  const ranked = recolorPlans(strawberry, { n: Number.MAX_SAFE_INTEGER });
  const rejected = ranked[0]!.mapping[bodyIndex(ranked[0]!)]!.to.name;
  const rejectsTopInk = () => fakeClient((q) => (q.includes("strawberry body") && q.includes(` to ${rejected} (`) ? 0.1 : 0.9));

  it("drops implausible plans and fills their places from the next garments", async () => {
    const client = rejectsTopInk();
    const result = await vettedRecolorPlans(strawberry, { n: 2, cache, client });
    expect(result.plans).toHaveLength(2);
    expect(result.plans.every((p) => !p.implausible)).toBe(true);
    expect(result.dropped.map((p) => p.color.slug)).toContain(ranked[0]!.color.slug);
    expect(result.plans.map((p) => p.color.slug)).not.toContain(ranked[0]!.color.slug);
    // Kept plans stay in rank order.
    const order = ranked.map((p) => p.color.slug);
    const kept = result.plans.map((p) => order.indexOf(p.color.slug));
    expect(kept).toEqual([...kept].sort((a, b) => a - b));
  });

  it("keeps implausible plans, marked, with includeImplausible", async () => {
    const result = await vettedRecolorPlans(strawberry, { n: 2, cache, client: rejectsTopInk(), includeImplausible: true });
    expect(result.plans.map((p) => p.color.slug)).toEqual(ranked.slice(0, 2).map((p) => p.color.slug));
    expect(result.plans[0]!.implausible).toBe(true);
    expect(result.dropped).toEqual([]);
  });

  it("returns the deterministic top n when Jev is unavailable", async () => {
    const result = await vettedRecolorPlans(strawberry, { n: 3, cache });
    expect(result.plans.map((p) => p.color.slug)).toEqual(ranked.slice(0, 3).map((p) => p.color.slug));
    expect(result.skipped?.reason).toBe("api-key-missing");
  });

  it("rejects a bad n", async () => {
    await expect(vettedRecolorPlans(strawberry, { n: 0 })).rejects.toThrow(RangeError);
  });
});

describe("recolorView with vet", () => {
  /** A vision provider that names every palette color of the flat mark. */
  async function fakeVision(): Promise<VisionProvider> {
    const { palette } = await fingerprint(FLAT_MARK, { cache: false });
    return {
      name: "codex",
      async describe() {
        return {
          model: "vision-test",
          answer: {
            subject: "a strawberry badge",
            mood: "playful",
            elements: palette.map((c, i) => ({ name: i === 0 ? "strawberry body" : `shape ${i}`, color: "a color", hex: c.hex })),
          },
        };
      },
    };
  }

  it("describes the design, vets each plan, and reports the result", async () => {
    const view = await recolorView({
      file: FLAT_MARK,
      n: 2,
      vet: { providers: [await fakeVision()], client: rejectsBody, cache },
    });
    const json = view.json as { design: { description?: unknown }; plans: { plausibility: number | null }[]; vet: any };
    expect(json.design.description).toMatchObject({ subject: "a strawberry badge" });
    expect(json.vet).toMatchObject({ requested: true, applied: true, model: "jev-test" });
    // Every plan changes the strawberry body, so every plan is dropped.
    expect(json.plans).toEqual([]);
    expect(json.vet.dropped.length).toBeGreaterThan(0);
    expect(json.vet.dropped[0].reasons[0]).toMatch(/^Implausible: the strawberry body/);
    expect(view.text(false)).toContain("Every plan was implausible; pass --include-implausible to see them.");
  });

  it("marks plausibility in the text with includeImplausible", async () => {
    const view = await recolorView({
      file: FLAT_MARK,
      n: 1,
      includeImplausible: true,
      vet: { providers: [await fakeVision()], client: rejectsBody, cache },
    });
    const text = view.text(false);
    expect(text).toMatch(/ · implausible \(0\.08\)/);
    expect(text).toMatch(/plausibility 0\.08/);
  });

  it("skips vetting with a note when no vision provider works", async () => {
    const failing: VisionProvider = {
      name: "codex",
      async describe() {
        throw new Error("not signed in");
      },
    };
    const view = await recolorView({
      file: FLAT_MARK,
      n: 2,
      vet: { providers: [failing], client: rejectsBody, cache },
    });
    const json = view.json as { plans: unknown[]; vet: any };
    expect(json.plans).toHaveLength(2);
    expect(json.vet).toMatchObject({ requested: true, applied: false, vetted: 0 });
    expect(json.vet.reason).toMatch(/^Swaps were not vetted: No vision provider could describe the design/);
    expect(rejectsBody.requests).toHaveLength(0);
  });

  it("falls back to the deterministic plans when the request fails", async () => {
    const broken: SystemOneClient = {
      async systemOne() {
        throw new Error("503 from TypeSafe");
      },
    };
    const view = await recolorView({ file: FLAT_MARK, n: 2, vet: { providers: [await fakeVision()], client: broken, cache } });
    const json = view.json as { plans: unknown[]; vet: any };
    expect(json.plans).toHaveLength(2);
    expect(json.vet).toMatchObject({ applied: false, vetted: 0 });
    expect(json.vet.reason).toBe("Swaps were not vetted: the request failed: 503 from TypeSafe");
  });

  it("spends no vision call when Jev cannot be called", async () => {
    let calls = 0;
    const counting: VisionProvider = {
      name: "codex",
      async describe() {
        calls += 1;
        throw new Error("should not be called");
      },
    };
    const view = await recolorView({ file: FLAT_MARK, n: 2, vet: { providers: [counting], cache } });
    const json = view.json as { plans: unknown[]; vet: any };
    expect(calls).toBe(0);
    expect(json.plans).toHaveLength(2);
    expect(json.vet.reason).toMatch(/^Swaps were not vetted: .*TYPESAFE_API_KEY/);
  });
});
