import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Questions, ScoreQuestion, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { recommendView } from "../src/cli/commands.js";
import { run } from "../src/cli/index.js";
import { fingerprint, type Fingerprint, type VisionProvider } from "../src/fingerprint/index.js";
import {
  combineMood,
  MOOD_LEVELS,
  MOOD_TOP,
  MOOD_WEIGHT,
  moodCandidateId,
  moodQuestions,
  moodState,
  rerankByMood,
  resetJevClient,
  type SystemOneClient,
} from "../src/jev/index.js";
import { palettesForProductColor } from "../src/palettes.js";
import { recommendProductColors } from "../src/recommend.js";
import { renderHtml } from "../src/render/index.js";

const FLAT_MARK = join(import.meta.dirname, "fixtures", "designs", "flat-mark.png");

/**
 * A fake client that answers every Score question: all probability on the
 * level `levels[name]` gives, else on level 1 (neutral).
 */
function fakeClient(levels: Record<string, number> = {}): SystemOneClient & { requests: SystemOneRequest[] } {
  const requests: SystemOneRequest[] = [];
  return {
    requests,
    async systemOne<const Q extends Questions>(request: SystemOneRequest<Q>) {
      requests.push(request);
      const answers = Object.fromEntries(
        Object.entries(request.questions).map(([name, question]) => {
          const criteria = (question as ScoreQuestion).criteria;
          const level = levels[name] ?? 1;
          return [
            name,
            {
              type: "score",
              score: level,
              confidence: 0.8,
              legend: Object.fromEntries(criteria.map((c, i) => [String(i), c])),
              probabilities: Object.fromEntries(criteria.map((_, i) => [String(i), i === level ? 1 : 0])),
            },
          ];
        }),
      );
      return { model: "jev-test", answers, usage: { input_tokens: 10, output_tokens: 3 } } as unknown as SystemOneResult<Q>;
    },
  };
}

/** A vision provider that describes the flat mark: a ring around a disc. */
function fakeVision(print: Fingerprint): VisionProvider & { calls: number } {
  const provider = {
    name: "codex" as const,
    calls: 0,
    async describe() {
      provider.calls++;
      return {
        model: "vision-test",
        answer: {
          subject: "A simple circular badge: a ring around a solid disc.",
          mood: "Calm, graphic, and minimal.",
          elements: [
            { name: "outer ring", color: "deep blue", hex: print.palette[0]!.hex },
            { name: "center disc", color: "warm orange", hex: print.palette[1]!.hex },
          ],
        },
      };
    },
  };
  return provider;
}

let dir: string;
let cache: string;
let print: Fingerprint;
let described: Fingerprint;
const savedKey = process.env.TYPESAFE_API_KEY;
const savedCacheHome = process.env.XDG_CACHE_HOME;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "mood-test-"));
  cache = join(dir, "jev");
  process.env.XDG_CACHE_HOME = join(dir, "xdg");
  delete process.env.TYPESAFE_API_KEY;
  resetJevClient();
  print = await fingerprint(FLAT_MARK, { cache: false });
  described = {
    ...print,
    palette: print.palette.map((c, i) => ({ ...c, element: i === 0 ? "outer ring" : "center disc" })),
    description: {
      subject: "A simple circular badge: a ring around a solid disc.",
      mood: "Calm, graphic, and minimal.",
      elements: [
        { name: "outer ring", color: "deep blue", hex: print.palette[0]!.hex },
        { name: "center disc", color: "warm orange", hex: print.palette[1]!.hex },
      ],
      provider: "codex",
      model: "vision-test",
    },
  };
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (savedKey === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = savedKey;
  if (savedCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = savedCacheHome;
});

const picksFor = (design: Fingerprint, n = 15) => recommendProductColors(design, { n });

describe("rerankByMood", () => {
  it("sends one request: the description and palette as state, one Score question per shortlisted candidate", async () => {
    const client = fakeClient();
    const picks = picksFor(described);
    await rerankByMood(picks, described, { client, cache });

    expect(client.requests).toHaveLength(1);
    const [request] = client.requests;
    expect(request!.state).toEqual(moodState(described));
    expect(request!.state).toMatchObject({
      design: { subject: described.description!.subject, mood: described.description!.mood },
      palette: [{ hex: print.palette[0]!.hex, paints: "outer ring" }, { paints: "center disc" }],
    });

    const names = Object.keys(request!.questions);
    expect(names).toEqual(picks.slice(0, MOOD_TOP).map((p) => `garment:${p.color.slug}`));
    const question = request!.questions[names[0]!] as ScoreQuestion;
    expect(question.type).toBe("score");
    expect(question.criteria).toHaveLength(MOOD_LEVELS.length);
    expect(question.instructions).toMatchObject({
      question: "How well does this garment color suit the design's subject and mood?",
      garment: { name: picks[0]!.color.name, hex: picks[0]!.color.hex, family: picks[0]!.color.family },
    });
  });

  it("normalizes each score, combines it with the shortlist order by the weight, and ranks in code", async () => {
    const picks = picksFor(described, MOOD_TOP);
    const last = picks.at(-1)!;
    const first = picks[0]!;
    // The last pick elevates the design, the first clashes, the rest are neutral.
    const client = fakeClient({ [moodCandidateId(last)]: 3, [moodCandidateId(first)]: 0 });
    const result = await rerankByMood(picks, described, { client, cache });

    expect(result).toMatchObject({ applied: true, weight: MOOD_WEIGHT, model: "jev-test", cached: false });
    expect(result.note).toBeUndefined();
    const byId = new Map(result.candidates.map((c) => [moodCandidateId(c), c]));

    const lastRanked = byId.get(moodCandidateId(last))!;
    expect(lastRanked).toMatchObject({ moodScore: 1, confidence: 0.8, moodLevel: "elevates", deterministicScore: 0 });
    expect(lastRanked.combinedScore).toBeCloseTo(MOOD_WEIGHT, 3);

    const firstRanked = byId.get(moodCandidateId(first))!;
    expect(firstRanked).toMatchObject({ moodScore: 0, moodLevel: "clashes", deterministicScore: 1 });
    expect(firstRanked.combinedScore).toBeCloseTo(1 - MOOD_WEIGHT, 3);

    const neutral = byId.get(moodCandidateId(picks[1]!))!;
    expect(neutral.moodScore).toBeCloseTo(1 / 3, 3);
    expect(neutral.combinedScore).toBeCloseTo((1 - MOOD_WEIGHT) * neutral.deterministicScore! + MOOD_WEIGHT / 3, 3);

    // Sorted by combined score, highest first, and the deterministic fields survive.
    const combined = result.candidates.map((c) => c.combinedScore!);
    expect(combined).toEqual([...combined].sort((a, b) => b - a));
    expect(result.candidates[0]!.score).toBeTypeOf("number");
    expect(result.candidates[0]!.reasons.length).toBeGreaterThan(0);

    // Weight 1 ranks by mood alone, without calling Jev again.
    const moodOnly = combineMood(result.candidates, 1);
    expect(moodCandidateId(moodOnly[0]!)).toBe(moodCandidateId(last));
    expect(moodCandidateId(moodOnly.at(-1)!)).toBe(moodCandidateId(first));
    // Weight 0 restores the shortlist order.
    expect(combineMood(result.candidates, 0).map(moodCandidateId)).toEqual(picks.map(moodCandidateId));
    expect(client.requests).toHaveLength(1);
  });

  it("re-ranks only the top candidates and keeps the rest after them, in order", async () => {
    const picks = picksFor(described, 15);
    const client = fakeClient({ [moodCandidateId(picks[2]!)]: 3 });
    const result = await rerankByMood(picks, described, { client, cache, top: 5 });

    expect(Object.keys(client.requests[0]!.questions)).toHaveLength(5);
    expect(result.candidates.slice(0, 5).map(moodCandidateId).sort()).toEqual(picks.slice(0, 5).map(moodCandidateId).sort());
    expect(result.candidates.slice(5).map(moodCandidateId)).toEqual(picks.slice(5).map(moodCandidateId));
    expect(result.candidates[5]).toMatchObject({ moodScore: null, deterministicScore: null, combinedScore: null });
  });

  it("caches the answers by the design and candidate set, whatever their order", async () => {
    const picks = picksFor(described, MOOD_TOP);
    const client = fakeClient();
    await rerankByMood(picks, described, { client, cache });
    const again = await rerankByMood([...picks].reverse(), described, { client, cache });
    expect(again.cached).toBe(true);
    expect(client.requests).toHaveLength(1);

    // A different shortlist or design misses.
    await rerankByMood(picks.slice(1), described, { client, cache });
    const otherDesign = { ...described, description: { ...described.description!, mood: "Loud and playful." } };
    await rerankByMood(picks, otherDesign, { client, cache });
    expect(client.requests).toHaveLength(3);
  });

  it("returns the deterministic order with a note when Jev is unavailable", async () => {
    const picks = picksFor(described, 12);
    const result = await rerankByMood(picks, described, { cache });
    expect(result.applied).toBe(false);
    expect(result.note).toMatch(/TYPESAFE_API_KEY/);
    expect(result.note).toMatch(/deterministic/);
    expect(result.candidates.map(moodCandidateId)).toEqual(picks.map(moodCandidateId));
    expect(result.candidates[0]).toMatchObject({ moodScore: null, confidence: null, moodLevel: null });
    expect(result.candidates[0]!.combinedScore).toBe(1);
  });

  it("does not ask Jev without a vision description", async () => {
    const client = fakeClient();
    const picks = picksFor(print, 5);
    const result = await rerankByMood(picks, print, { client, cache });
    expect(client.requests).toHaveLength(0);
    expect(result.applied).toBe(false);
    expect(result.note).toMatch(/vision description/);
    expect(result.candidates.map(moodCandidateId)).toEqual(picks.map(moodCandidateId));
  });

  it("asks about palettes for a garment, naming the garment and the inks", async () => {
    const { palettes } = palettesForProductColor("Black", { limit: 12 });
    expect(palettes.length).toBeGreaterThan(MOOD_TOP);
    const client = fakeClient({ [moodCandidateId(palettes[1]!)]: 3 });
    const result = await rerankByMood(palettes, described, { client, cache });

    const names = Object.keys(client.requests[0]!.questions);
    expect(names).toHaveLength(MOOD_TOP);
    expect(names.every((n) => n.startsWith("palette:black:"))).toBe(true);
    const question = client.requests[0]!.questions[names[0]!] as ScoreQuestion;
    expect(question.instructions).toMatchObject({
      garment: { name: "Black" },
      inks: palettes[0]!.colors.slice(1).map((c) => ({ name: c.name, hex: c.hex })),
    });
    expect(moodCandidateId(result.candidates[0]!)).toBe(moodCandidateId(palettes[1]!));
    expect(result.candidates[0]).toMatchObject({ moodLevel: "elevates", source: palettes[1]!.source });
  });

  it("rejects a bad top or weight, and duplicate candidates", async () => {
    const picks = picksFor(described, 3);
    await expect(rerankByMood(picks, described, { top: 0 })).rejects.toThrow(RangeError);
    await expect(rerankByMood(picks, described, { weight: 1.5 })).rejects.toThrow(RangeError);
    expect(() => combineMood([], -0.1)).toThrow(RangeError);
    expect(() => moodQuestions([picks[0]!, picks[0]!])).toThrow(/share the question name/);
  });
});

describe("recommend with mood", () => {
  it("describes the design, re-ranks the top picks, and shows the mood level as a badge", async () => {
    const vision = fakeVision(print);
    const picks = picksFor(print, MOOD_TOP);
    // The second pick elevates the design; the rest are neutral, so it moves to the top.
    const client = fakeClient({ [moodCandidateId(picks[1]!)]: 3 });
    const view = await recommendView({ file: FLAT_MARK, n: 3, mood: { client, providers: [vision], cache } });
    const json = view.json as { picks: { color: { slug: string }; moodLevel: string }[]; mood: object; design: Fingerprint };

    expect(vision.calls).toBe(1);
    expect(json.design.description?.subject).toMatch(/badge/);
    expect(json.mood).toMatchObject({ requested: true, applied: true, weight: MOOD_WEIGHT, model: "jev-test" });
    expect(json.picks).toHaveLength(3);
    expect(json.picks[0]).toMatchObject({ color: { slug: picks[1]!.color.slug }, moodLevel: "elevates" });

    expect(view.text(false)).toContain("Mood: re-ranked by Jev");
    expect(view.text(false)).toContain("mood elevates (1)");
    expect(renderHtml(view.sections)).toContain('<span class="badge">Mood: elevates</span>');
  });

  it("keeps the deterministic picks and says why when Jev is unavailable, without a vision call", async () => {
    const vision = fakeVision(print);
    const plain = await recommendView({ file: FLAT_MARK, n: 3 });
    const view = await recommendView({ file: FLAT_MARK, n: 3, mood: { providers: [vision], cache } });
    const json = view.json as { picks: { color: { slug: string }; moodScore: null }[]; mood: { reason: string } };

    expect(vision.calls).toBe(0);
    expect(json.mood).toMatchObject({ requested: true, applied: false });
    expect(json.mood.reason).toMatch(/TYPESAFE_API_KEY/);
    const plainSlugs = (plain.json as { picks: { color: { slug: string } }[] }).picks.map((p) => p.color.slug);
    expect(json.picks.map((p) => p.color.slug)).toEqual(plainSlugs);
    expect(json.picks[0]!.moodScore).toBeNull();
    expect(view.text(false)).toContain("Mood: not applied.");
    expect(renderHtml(view.sections)).not.toContain('class="badge"');
  });

  it("reports a failed Jev request instead of failing the command", async () => {
    const client: SystemOneClient = {
      systemOne: async () => {
        throw new Error("rate limited");
      },
    };
    const view = await recommendView({ file: FLAT_MARK, n: 2, mood: { client, providers: [fakeVision(print)], cache } });
    expect((view.json as { mood: object }).mood).toMatchObject({
      applied: false,
      reason: expect.stringMatching(/Mood re-ranking failed: rate limited/),
    });
  });
});

describe("--mood on the CLI", () => {
  function capture() {
    const out: string[] = [];
    const err: string[] = [];
    return {
      io: { stdout: (t: string) => void out.push(t), stderr: (t: string) => void err.push(t), writeFile: () => {} },
      out: () => out.join(""),
      err: () => err.join(""),
    };
  }

  it("recommend --mood without Jev prints the deterministic picks and the reason", async () => {
    const c = capture();
    expect(await run(["recommend", FLAT_MARK, "-n", "2", "--mood", "--json"], c.io)).toBe(0);
    const json = JSON.parse(c.out());
    expect(json.picks).toHaveLength(2);
    expect(json.mood).toMatchObject({ requested: true, applied: false, reason: expect.stringMatching(/TYPESAFE_API_KEY/) });
  });

  it("palettes --mood --design without Jev keeps the palette order", async () => {
    const plain = capture();
    await run(["palettes", "Pepper", "--limit", "3", "--json"], plain.io);
    const c = capture();
    expect(await run(["palettes", "Pepper", "--limit", "3", "--mood", "--design", FLAT_MARK, "--json"], c.io)).toBe(0);
    const json = JSON.parse(c.out());
    expect(json.mood).toMatchObject({ requested: true, applied: false });
    expect(json.design.hash).toBe(print.hash);
    expect(json.palettes.map(moodCandidateId)).toEqual(JSON.parse(plain.out()).palettes.map(moodCandidateId));
  });

  it.each([
    [["palettes", "Pepper", "--mood"], "palettes --mood needs --design <file>"],
    [["palettes", "Pepper", "--design", FLAT_MARK], "--design applies only with --mood"],
    [["recommend", FLAT_MARK, "--design", FLAT_MARK], "--design applies only to palettes"],
    [["combos", "red", "--mood"], "--mood applies only to recommend and palettes"],
  ])("%j is a usage error", async (argv, message) => {
    const c = capture();
    expect(await run(argv, c.io)).toBe(2);
    expect(c.err()).toContain(message);
  });
});
