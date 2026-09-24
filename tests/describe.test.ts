import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recolorPlans } from "../src/index.js";
import { describePrompt, descriptionCachePath } from "../src/fingerprint/describe.js";
import {
  codexProvider,
  describeDesign,
  descriptionSchema,
  fingerprint,
  type Fingerprint,
  labelPalette,
  OPENROUTER_DEFAULT_MODEL,
  openRouterProvider,
  validateAnswer,
  type VisionProvider,
  VisionUnavailableError,
} from "../src/fingerprint/index.js";

const FLAT_MARK = join(import.meta.dirname, "fixtures", "designs", "flat-mark.png");

let dir: string;
let cache: string;
let print: Fingerprint;
let ring: string;
let disc: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "describe-test-"));
  cache = join(dir, "cache");
  print = await fingerprint(FLAT_MARK, { cache: false });
  ring = print.palette[0]!.hex;
  disc = print.palette[1]!.hex;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

/** A valid answer for the flat mark: a coral ring around a cream disc. */
function answer() {
  return {
    subject: "A coral ring around a cream disc, like a stylized sun.",
    mood: "Warm, calm, minimal flat graphic.",
    elements: [
      { name: "sun ring", color: "coral", hex: ring },
      { name: "sun disc", color: "cream", hex: disc },
    ],
  };
}

/** A provider that answers with `reply` (or throws it), counting calls. */
function stub(name: VisionProvider["name"], reply: unknown | Error): VisionProvider & { calls: number } {
  const provider = {
    name,
    calls: 0,
    async describe() {
      provider.calls++;
      if (reply instanceof Error) throw reply;
      return { answer: reply, model: `${name}-model` };
    },
  };
  return provider;
}

/**
 * A stand-in `codex` executable. It logs its arguments, checks that the image
 * and schema files exist, and writes the answer in `FAKE_CODEX_ANSWER` to the
 * `--output-last-message` path, or exits 1 when `FAKE_CODEX_FAIL` is set.
 */
function fakeCodex(): { command: string; log: string } {
  const command = join(dir, "codex");
  const log = join(dir, "codex-args.json");
  writeFileSync(
    command,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ args, cwd: process.cwd(), schema: JSON.parse(fs.readFileSync(flag("--output-schema"), "utf8")), imageSize: fs.statSync(flag("--image")).size }));
if (process.env.FAKE_CODEX_FAIL) { console.error("Not logged in. Run codex login."); process.exit(1); }
fs.writeFileSync(flag("--output-last-message"), process.env.FAKE_CODEX_ANSWER);
`,
  );
  chmodSync(command, 0o755);
  return { command, log };
}

describe("describeDesign", () => {
  it("adds the description and labels the palette colors with their elements", async () => {
    const result = await describeDesign(print, FLAT_MARK, { cache, providers: [stub("codex", answer())] });
    expect(result.description).toMatchObject({
      subject: "A coral ring around a cream disc, like a stylized sun.",
      mood: "Warm, calm, minimal flat graphic.",
      provider: "codex",
      model: "codex-model",
    });
    expect(result.description!.elements).toHaveLength(2);
    expect(result.palette.map((c) => c.element)).toEqual(["sun ring", "sun disc"]);
    // The input fingerprint is not changed.
    expect(print.description).toBeUndefined();
    expect(print.palette[0]).not.toHaveProperty("element");
  });

  it("caches by file hash in the cache directory, so a repeat call asks no provider", async () => {
    const first = stub("codex", answer());
    await describeDesign(print, FLAT_MARK, { cache, providers: [first] });
    const files = readdirSync(cache);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(new RegExp(`^${print.hash}\\.description\\.[0-9a-f]{12}\\.json$`));

    const second = stub("codex", new Error("should not be called"));
    const again = await describeDesign(print, FLAT_MARK, { cache, providers: [second] });
    expect(second.calls).toBe(0);
    expect(again.palette.map((c) => c.element)).toEqual(["sun ring", "sun disc"]);
  });

  it("checks the supplied file before using a cached description", async () => {
    const provider = stub("codex", answer());
    await describeDesign(print, FLAT_MARK, { cache, providers: [provider] });
    const other = join(dir, "other.png");
    writeFileSync(other, Buffer.from("different image"));

    await expect(describeDesign(print, other, { cache, providers: [provider] })).rejects.toThrow(/does not match the fingerprint/);
    await expect(describeDesign(print, join(dir, "missing.png"), { cache, providers: [provider] })).rejects.toThrow();
    expect(provider.calls).toBe(1);
  });

  it("uses rounded palette shares in the cache key and requests a new description when they change", async () => {
    const changed = {
      ...print,
      palette: print.palette.map((color, i) => ({ ...color, share: i === 0 ? color.share - 0.1 : color.share + 0.1 })),
    };
    const firstPrompt = describePrompt(print.palette);
    const secondPrompt = describePrompt(changed.palette);
    expect(secondPrompt).not.toBe(firstPrompt);
    expect(descriptionCachePath(cache, print.hash, firstPrompt)).not.toBe(descriptionCachePath(cache, print.hash, secondPrompt));

    const provider = stub("codex", answer());
    await describeDesign(print, FLAT_MARK, { cache, providers: [provider] });
    await describeDesign(changed, FLAT_MARK, { cache, providers: [provider] });
    expect(provider.calls).toBe(2);
    expect(readdirSync(cache)).toHaveLength(2);
  });

  it("ignores a cache entry whose stored prompt disagrees with its key", async () => {
    const provider = stub("codex", answer());
    await describeDesign(print, FLAT_MARK, { cache, providers: [provider] });
    const path = join(cache, readdirSync(cache)[0]!);
    const entry = JSON.parse(readFileSync(path, "utf8"));
    entry.prompt = "different prompt";
    writeFileSync(path, JSON.stringify(entry));
    await describeDesign(print, FLAT_MARK, { cache, providers: [provider] });
    expect(provider.calls).toBe(2);
  });

  it("uses the fingerprint cache directory by default", async () => {
    vi.stubEnv("XDG_CACHE_HOME", join(dir, "xdg"));
    await describeDesign(print, FLAT_MARK, { providers: [stub("codex", answer())] });
    expect(readdirSync(join(dir, "xdg", "color-picker", "fingerprints"))).toHaveLength(1);
  });

  it("falls back to the next provider when one fails, and records which answered", async () => {
    const codex = stub("codex", new Error("`codex` is not installed or not on PATH."));
    const openrouter = stub("openrouter", answer());
    const result = await describeDesign(print, FLAT_MARK, { cache: false, providers: [codex, openrouter] });
    expect(codex.calls).toBe(1);
    expect(openrouter.calls).toBe(1);
    expect(result.description).toMatchObject({ provider: "openrouter", model: "openrouter-model" });
  });

  it("falls back when a provider's answer does not match the schema", async () => {
    const codex = stub("codex", { subject: "A sun" });
    const openrouter = stub("openrouter", answer());
    const result = await describeDesign(print, FLAT_MARK, { cache: false, providers: [codex, openrouter] });
    expect(result.description!.provider).toBe("openrouter");
  });

  it("names every failure and both ways to enable a provider when all fail", async () => {
    const error = await describeDesign(print, FLAT_MARK, {
      cache: false,
      providers: [stub("codex", new Error("Not logged in")), stub("openrouter", new Error("`OPENROUTER_API_KEY` is not set."))],
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VisionUnavailableError);
    const message = (error as Error).message;
    expect(message).toContain("codex: Not logged in");
    expect(message).toContain("openrouter: `OPENROUTER_API_KEY` is not set.");
    expect(message).toContain("codex login");
    expect(message).toContain("OPENROUTER_API_KEY");
  });

  it("refuses a file that does not match the fingerprint", async () => {
    await expect(
      describeDesign({ ...print, hash: "0".repeat(64) }, FLAT_MARK, { cache: false, providers: [stub("codex", answer())] }),
    ).rejects.toThrow(/does not match the fingerprint/);
  });

  it("feeds element names into recolor plans and prompts", async () => {
    const described = await describeDesign(print, FLAT_MARK, { cache: false, providers: [stub("codex", answer())] });
    const [plan] = recolorPlans(described, { n: 1 });
    expect(plan!.mapping.map((m) => m.from.element).sort()).toEqual(["sun disc", "sun ring"]);
    expect(plan!.prompt).toContain("sun ring");
  });
});

describe("validateAnswer", () => {
  const palette = [{ hex: "#e8836b" }, { hex: "#f3e9d2" }];

  it("trims lines and lowercases hex", () => {
    const result = validateAnswer(
      { subject: "  A sun\n over waves ", mood: "Warm", elements: [{ name: " sun ", color: "coral", hex: "#E8836B" }] },
      palette,
    );
    expect(result).toEqual({ subject: "A sun over waves", mood: "Warm", elements: [{ name: "sun", color: "coral", hex: "#e8836b" }] });
  });

  it("snaps a hex outside the palette to the nearest palette color", () => {
    const { elements } = validateAnswer(
      { subject: "A sun", mood: "Warm", elements: [{ name: "sun", color: "coral", hex: "#e0806a" }] },
      palette,
    );
    expect(elements[0]!.hex).toBe("#e8836b");
  });

  it.each([
    [null, "expected an object"],
    [{ subject: "", mood: "Warm", elements: [] }, "`subject`"],
    [{ subject: "A sun", mood: "Warm", elements: {} }, "`elements`"],
    [{ subject: "A sun", mood: "Warm", elements: [{ name: "sun", color: "coral", hex: "coral" }] }, "elements[0].hex"],
  ])("rejects %j", (bad, what) => {
    expect(() => validateAnswer(bad, palette)).toThrow(what);
  });
});

describe("labelPalette", () => {
  it("joins several elements painted by one color, once each", () => {
    const labeled = labelPalette([{ hex: "#e8836b" }, { hex: "#f3e9d2" }], {
      elements: [
        { name: "strawberry body", color: "red", hex: "#e8836b" },
        { name: "title text", color: "red", hex: "#e8836b" },
        { name: "title text", color: "red", hex: "#e8836b" },
      ],
    });
    expect(labeled).toEqual([{ hex: "#e8836b", element: "strawberry body and title text" }, { hex: "#f3e9d2" }]);
  });
});

describe("descriptionSchema", () => {
  it("is strict: every property required, no extras, hex limited to the palette", () => {
    const schema = descriptionSchema([{ hex: "#E8836B" }, { hex: "#f3e9d2" }]) as {
      required: string[];
      additionalProperties: boolean;
      properties: { elements: { items: { required: string[]; properties: { hex: { enum: string[] } } } } };
    };
    expect(schema.required).toEqual(["subject", "mood", "elements"]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.elements.items.required).toEqual(["name", "color", "hex"]);
    expect(schema.properties.elements.items.properties.hex.enum).toEqual(["#e8836b", "#f3e9d2"]);
  });
});

describe("codexProvider", () => {
  it("runs codex exec non-interactively with the image, schema, and output file", async () => {
    const { command, log } = fakeCodex();
    vi.stubEnv("FAKE_CODEX_ANSWER", JSON.stringify(answer()));
    const result = await describeDesign(print, FLAT_MARK, { cache: false, providers: [codexProvider({ command })] });
    expect(result.description).toMatchObject({ provider: "codex", model: "gpt-6-sol" });

    const call = JSON.parse(readFileSync(log, "utf8")) as { args: string[]; cwd: string; schema: object; imageSize: number };
    expect(call.args[0]).toBe("exec");
    for (const flag of ["--ephemeral", "--ignore-user-config", "--skip-git-repo-check"]) expect(call.args).toContain(flag);
    expect(call.args[call.args.indexOf("--sandbox") + 1]).toBe("read-only");
    expect(call.args[call.args.indexOf("--model") + 1]).toBe("gpt-6-sol");
    expect(call.args[call.args.indexOf("--image") + 1]).toMatch(/design\.png$/);
    expect(call.args.at(-1)).toContain(ring);
    expect(call.imageSize).toBe(readFileSync(FLAT_MARK).length);
    expect(call.schema).toEqual(descriptionSchema(print.palette));
    // Runs in its own scratch directory, which is removed afterward.
    expect(call.cwd).toContain("color-picker-describe-");
    expect(() => readdirSync(call.cwd)).toThrow();
  });

  it("reports a failed run with the end of its stderr", async () => {
    const { command } = fakeCodex();
    vi.stubEnv("FAKE_CODEX_FAIL", "1");
    await expect(
      codexProvider({ command }).describe({ image: { bytes: new Uint8Array(), mediaType: "image/png" }, prompt: "p", schema: {} }),
    ).rejects.toThrow(/failed: Not logged in/);
  });

  it("reports a missing executable", async () => {
    await expect(
      codexProvider({ command: join(dir, "no-such-codex") }).describe({
        image: { bytes: new Uint8Array(), mediaType: "image/png" },
        prompt: "p",
        schema: {},
      }),
    ).rejects.toThrow(/not installed or not on PATH/);
  });
});

describe("openRouterProvider", () => {
  function fakeFetch(body: unknown, status = 200) {
    return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
    );
  }

  it("sends the image as a data URL with a strict JSON schema", async () => {
    const fetch = fakeFetch({ model: "openai/gpt-6-sol-20260922", choices: [{ message: { content: JSON.stringify(answer()) } }] });
    const provider = openRouterProvider({ apiKey: "test-key", fetch });
    const result = await describeDesign(print, FLAT_MARK, { cache: false, providers: [provider] });
    expect(result.description).toMatchObject({ provider: "openrouter", model: "openai/gpt-6-sol-20260922" });

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer test-key");
    const request = JSON.parse(init!.body as string);
    expect(request.model).toBe(OPENROUTER_DEFAULT_MODEL);
    expect(request.messages[0].content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
    expect(request.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
  });

  it("reads the key and model from the environment", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "env-key");
    vi.stubEnv("OPENROUTER_MODEL", "google/gemini-3.8-flash");
    const fetch = fakeFetch({ choices: [{ message: { content: "```json\n" + JSON.stringify(answer()) + "\n```" } }] });
    const result = await describeDesign(print, FLAT_MARK, { cache: false, providers: [openRouterProvider({ fetch })] });
    const init = fetch.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer env-key");
    expect(JSON.parse(init.body as string).model).toBe("google/gemini-3.8-flash");
    expect(result.description!.model).toBe("google/gemini-3.8-flash");
  });

  it("fails without a key and without calling the API", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const fetch = fakeFetch({});
    await expect(
      openRouterProvider({ fetch }).describe({ image: { bytes: new Uint8Array(), mediaType: "image/png" }, prompt: "p", schema: {} }),
    ).rejects.toThrow("`OPENROUTER_API_KEY` is not set.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports an HTTP error with its status", async () => {
    const provider = openRouterProvider({ apiKey: "k", fetch: fakeFetch('{"error":"no credits"}', 402) });
    await expect(
      provider.describe({ image: { bytes: new Uint8Array(), mediaType: "image/png" }, prompt: "p", schema: {} }),
    ).rejects.toThrow(/OpenRouter returned 402/);
  });
});
