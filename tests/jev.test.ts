import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Questions, SystemOneRequest, SystemOneResult } from "@typesafe-ai/sdk";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  ask,
  cacheKey,
  COMMITTED_CACHE_DIR,
  jevAvailability,
  JevUnavailableError,
  resetJevClient,
  type SystemOneClient,
} from "../src/jev/index.js";

const QUESTIONS = {
  mood: {
    type: "choice",
    instructions: "Which mood fits this design?",
    criteria: { playful: "Bright, casual", calm: "Muted, quiet", bold: null },
  },
  legible: { type: "noul", instructions: "Does the ink read clearly on the shirt?" },
  fit: { type: "score", instructions: "How well does the shirt suit the design?", criteria: ["Poorly", "Fairly", "Well"] },
} as const;

const STATE = { design: "A coral sun over cream waves", shirt: { name: "Moss", hex: "#7a7d5e" } };

/** A fake client answering every question, counting requests. */
function fakeClient(): SystemOneClient & { requests: SystemOneRequest[] } {
  const requests: SystemOneRequest[] = [];
  return {
    requests,
    async systemOne<const Q extends Questions>(request: SystemOneRequest<Q>) {
      requests.push(request);
      const answers: Record<string, unknown> = {};
      for (const [name, question] of Object.entries(request.questions)) {
        if (question.type === "noul") answers[name] = { type: "noul", noul: 0.82 };
        if (question.type === "choice") {
          const labels = Object.keys(question.criteria);
          answers[name] = {
            type: "choice",
            choice: labels[0],
            confidence: 0.7,
            probabilities: Object.fromEntries(labels.map((label, i) => [label, i === 0 ? 0.7 : 0.3 / (labels.length - 1)])),
          };
        }
        if (question.type === "score") answers[name] = { type: "score", score: 1.6, confidence: 0.6, legend: {}, probabilities: {} };
      }
      return {
        model: "jev-test",
        answers,
        usage: { input_tokens: 10, output_tokens: 3 },
      } as unknown as SystemOneResult<Q>;
    },
  };
}

let cache: string;
const savedKey = process.env.TYPESAFE_API_KEY;
beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), "jev-test-"));
  delete process.env.TYPESAFE_API_KEY;
  resetJevClient();
});
afterEach(() => {
  rmSync(cache, { recursive: true, force: true });
  if (savedKey === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = savedKey;
  vi.doUnmock("@typesafe-ai/sdk");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("ask", () => {
  it("sends every question in one request and returns typed answers", async () => {
    const client = fakeClient();
    const result = await ask(STATE, QUESTIONS, { version: 1, cache, client });

    expect(client.requests).toHaveLength(1);
    expect(Object.keys(client.requests[0]!.questions)).toEqual(["mood", "legible", "fit"]);
    expect(client.requests[0]!.state).toEqual(STATE);
    expect(result.cached).toBe(false);
    expect(result.model).toBe("jev-test");
    expect(result.answers.mood.choice).toBe("playful");
    expect(result.answers.legible.noul).toBe(0.82);
    expect(result.answers.fit.score).toBe(1.6);

    expectTypeOf(result.answers.mood.choice).toEqualTypeOf<"playful" | "calm" | "bold">();
    expectTypeOf(result.answers.legible.noul).toEqualTypeOf<number>();
    expectTypeOf(result.answers.fit.score).toEqualTypeOf<number>();
  });

  it("answers a repeat call from the cache without a request", async () => {
    const client = fakeClient();
    const first = await ask(STATE, QUESTIONS, { version: 1, cache, client });
    const second = await ask(STATE, QUESTIONS, { version: 1, cache, client });

    expect(client.requests).toHaveLength(1);
    expect(second.cached).toBe(true);
    expect(second.key).toBe(first.key);
    expect(second.answers).toEqual(first.answers);
    expect(second.model).toBe("jev-test");
    expect(readdirSync(cache)).toEqual([`${first.key}.json`]);
  });

  it("lets concurrent misses write the same cache key without temporary-file collisions", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1234567890);
    const client = fakeClient();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => ask(STATE, QUESTIONS, { version: 1, cache, client })),
    );

    expect(client.requests).toHaveLength(20);
    expect(results.every((result) => !result.cached && result.key === results[0]!.key)).toBe(true);
    expect(results.every((result) => JSON.stringify(result.answers) === JSON.stringify(results[0]!.answers))).toBe(true);
    expect(readdirSync(cache)).toEqual([`${results[0]!.key}.json`]);
    const cached = await ask(STATE, QUESTIONS, { version: 1, cache, client });
    expect(cached.cached).toBe(true);
    expect(cached.answers).toEqual(results[0]!.answers);
    expect(client.requests).toHaveLength(20);
  });

  it("hits the cache however the state's keys are ordered", async () => {
    const client = fakeClient();
    await ask(STATE, QUESTIONS, { version: 1, cache, client });
    const reordered = { shirt: { hex: "#7a7d5e", name: "Moss" }, design: STATE.design };
    const again = await ask(reordered, QUESTIONS, { version: 1, cache, client });

    expect(again.cached).toBe(true);
    expect(client.requests).toHaveLength(1);
  });

  it("misses when the version, a question, the state, or the model changes", async () => {
    const client = fakeClient();
    await ask(STATE, QUESTIONS, { version: 1, cache, client });

    await ask(STATE, QUESTIONS, { version: 2, cache, client });
    await ask(STATE, { ...QUESTIONS, legible: { type: "noul", instructions: "Is the ink legible?" } }, { version: 1, cache, client });
    await ask({ ...STATE, shirt: { name: "Sage", hex: "#a0a58d" } }, QUESTIONS, { version: 1, cache, client });
    await ask(STATE, QUESTIONS, { version: 1, cache, client, model: "jev-other" });

    expect(client.requests).toHaveLength(5);
    expect(client.requests[4]!.model).toBe("jev-other");
    expect(readdirSync(cache)).toHaveLength(5);
  });

  it("ignores a cached answer from another version even under the same file name", async () => {
    const client = fakeClient();
    const { key } = await ask(STATE, QUESTIONS, { version: 1, cache, client });
    const path = join(cache, `${key}.json`);
    const entry = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, JSON.stringify({ ...entry, version: 0 }));

    const again = await ask(STATE, QUESTIONS, { version: 1, cache, client });
    expect(again.cached).toBe(false);
    expect(client.requests).toHaveLength(2);
  });

  it("asks again when the cache file is unreadable or missing an answer", async () => {
    const client = fakeClient();
    const { key } = await ask(STATE, QUESTIONS, { version: 1, cache, client });
    const path = join(cache, `${key}.json`);

    writeFileSync(path, "{ not json");
    expect((await ask(STATE, QUESTIONS, { version: 1, cache, client })).cached).toBe(false);

    const entry = JSON.parse(readFileSync(path, "utf8"));
    delete entry.answers.fit;
    writeFileSync(path, JSON.stringify(entry));
    expect((await ask(STATE, QUESTIONS, { version: 1, cache, client })).cached).toBe(false);

    expect(client.requests).toHaveLength(3);
  });

  it("skips the cache with cache: false", async () => {
    const client = fakeClient();
    await ask(STATE, QUESTIONS, { version: 1, cache: false, client });
    const second = await ask(STATE, QUESTIONS, { version: 1, cache: false, client });

    expect(second.cached).toBe(false);
    expect(client.requests).toHaveLength(2);
  });

  it("writes the version, model, and answers to the cache file", async () => {
    const { key } = await ask(STATE, QUESTIONS, { version: "mood-2", cache, client: fakeClient() });
    const entry = JSON.parse(await readFile(join(cache, `${key}.json`), "utf8"));

    expect(entry).toMatchObject({ format: 1, version: "mood-2", model: "jev-test" });
    expect(Object.keys(entry.answers)).toEqual(["mood", "legible", "fit"]);
    expect(Date.parse(entry.answeredAt)).not.toBeNaN();
  });

  it("rejects an empty question set", async () => {
    await expect(ask(STATE, {}, { version: 1, cache, client: fakeClient() })).rejects.toThrow(TypeError);
  });
});

describe("cacheKey", () => {
  it("is stable, and ignores key order but not rubric order", () => {
    const key = cacheKey(STATE, QUESTIONS, { version: 1 });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(cacheKey({ shirt: STATE.shirt, design: STATE.design }, QUESTIONS, { version: 1 })).toBe(key);

    const reversed = { ...QUESTIONS, fit: { ...QUESTIONS.fit, criteria: ["Well", "Fairly", "Poorly"] } } as const;
    expect(cacheKey(STATE, reversed, { version: 1 })).not.toBe(key);
    expect(cacheKey(STATE, QUESTIONS, { version: "1" })).not.toBe(key);
  });
});

describe("the committed cache directory", () => {
  it("points at assets/cache in this package", () => {
    expect(COMMITTED_CACHE_DIR.replaceAll("\\", "/")).toMatch(/\/assets\/cache\/$/);
  });
});

describe("without the SDK or a key", () => {
  it("names the missing key on a cache miss", async () => {
    const error = await ask(STATE, QUESTIONS, { version: 1, cache }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(JevUnavailableError);
    expect((error as JevUnavailableError).reason).toBe("api-key-missing");
    expect((error as Error).message).toContain("TYPESAFE_API_KEY");
    expect(await jevAvailability()).toEqual({ available: false, reason: "api-key-missing" });
  });

  it("treats a whitespace key as missing", async () => {
    process.env.TYPESAFE_API_KEY = "   ";
    expect(await jevAvailability()).toEqual({ available: false, reason: "api-key-missing" });
  });

  it("still answers from the cache", async () => {
    await ask(STATE, QUESTIONS, { version: 1, cache, client: fakeClient() });
    const cached = await ask(STATE, QUESTIONS, { version: 1, cache });
    expect(cached.cached).toBe(true);
  });

  it("names the missing SDK on a cache miss", async () => {
    process.env.TYPESAFE_API_KEY = "ts-test-key";
    vi.doMock("@typesafe-ai/sdk", () => {
      throw new Error("Cannot find package '@typesafe-ai/sdk'");
    });
    vi.resetModules();
    const jev = await import("../src/jev/index.js");

    const error = await jev.ask(STATE, QUESTIONS, { version: 1, cache }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(jev.JevUnavailableError);
    expect((error as JevUnavailableError).reason).toBe("sdk-missing");
    expect((error as Error).message).toContain("npm install @typesafe-ai/sdk");
    expect(await jev.jevAvailability()).toEqual({ available: false, reason: "sdk-missing" });
  });

  it("keeps the SDK out of every other entry point", async () => {
    const src = join(import.meta.dirname, "..", "src");
    const files = (await readdir(src, { recursive: true })).filter(
      (file) => file.endsWith(".ts") && !file.replaceAll("\\", "/").startsWith("jev/"),
    );
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      expect(await readFile(join(src, file), "utf8"), file).not.toContain("@typesafe-ai/sdk");
    }
  });
});

describe("the SDK client", () => {
  const SECRET = "ts-secret-do-not-log-4f9c";

  async function withMockSdk() {
    const constructed: unknown[][] = [];
    const client = fakeClient();
    vi.doMock("@typesafe-ai/sdk", () => ({
      TypeSafeClient: class {
        constructor(...args: unknown[]) {
          constructed.push(args);
        }
        systemOne = client.systemOne;
      },
    }));
    vi.resetModules();
    const jev = await import("../src/jev/index.js");
    return { jev, constructed, client };
  }

  it("is built once, from the environment, and reused", async () => {
    process.env.TYPESAFE_API_KEY = SECRET;
    const { jev, constructed, client } = await withMockSdk();

    await jev.ask(STATE, QUESTIONS, { version: 1, cache: false });
    await jev.ask(STATE, QUESTIONS, { version: 2, cache: false });

    expect(constructed).toEqual([[]]);
    expect(client.requests).toHaveLength(2);
    expect(await jev.jevAvailability()).toEqual({ available: true });
  });

  it("never writes the key to the console or the cache", async () => {
    process.env.TYPESAFE_API_KEY = SECRET;
    const { jev } = await withMockSdk();
    const logged: unknown[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => void logged.push(...args));
    }

    const { key } = await jev.ask(STATE, QUESTIONS, { version: 1, cache });

    expect(JSON.stringify(logged)).not.toContain(SECRET);
    expect(readFileSync(join(cache, `${key}.json`), "utf8")).not.toContain(SECRET);
  });
});
