import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fingerprint } from "../src/fingerprint/index.js";
import { descriptionCachePath, describePrompt, writeDescriptionCache } from "../src/fingerprint/describe.js";
import { createServer, SERVER_NAME } from "../src/mcp/index.js";
import { RESULT_HISTORY, ResultStore, toolDefinitions } from "../src/mcp/tools.js";

const ROOT = join(import.meta.dirname, "..");
const FLAT_MARK = join(import.meta.dirname, "fixtures", "designs", "flat-mark.png");

const TOOLS = [
  "nearest_colors",
  "combinations",
  "palettes_for_product_color",
  "recommend_product_colors",
  "recolor_plans",
  "theme",
  "check_accessibility",
  "list_products",
  "render_card",
];

describe("mcp", () => {
  it("builds a server in process", async () => {
    const server = await createServer();
    expect(SERVER_NAME).toBe("color-picker");
    await server.close();
  });

  it("keeps the last results for render_card", () => {
    const store = new ResultStore(2);
    const view = { title: "t", json: {}, text: () => "", sections: [] };
    const first = store.add(view);
    store.add(view);
    const third = store.add(view);
    expect(store.get(first)).toBeUndefined();
    expect(store.get(third)).toBe(view);
    expect(RESULT_HISTORY).toBeGreaterThan(2);
  });

  it("writes each card to a file with its garment photos inlined", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-cards-"));
    const savedCacheHome = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = join(dir, "cache");
    try {
      const tools = toolDefinitions(new ResultStore(), {
        cardDir: dir,
        embedImages: async (markup) => ({
          markup: markup.replace(/<image href="https:[^"]+"/g, '<image href="data:embedded"'),
          notEmbedded: [],
        }),
      });
      const call = async (name: string, args: Record<string, unknown>) =>
        JSON.parse((await tools.find((t) => t.name === name)!.handler(args)).content[0]!.text) as Record<string, any>;

      const reply = await call("recommend_product_colors", { designPath: FLAT_MARK, n: 2 });
      expect(reply.svg).toContain('<image href="https:');
      expect(reply.cardWarnings).toBeUndefined();
      const card = readFileSync(reply.cardFile, "utf8");
      expect(card.match(/<image href="data:embedded"/g)).toHaveLength(2);
      expect(card).not.toContain("https:");

      const svgAgain = await call("render_card", { resultId: reply.resultId });
      const html = await call("render_card", { resultId: reply.resultId, format: "html" });
      expect(html.cardFile).toMatch(/\.html$/);
      expect(readFileSync(html.cardFile, "utf8")).toContain('<image href="data:embedded"');
      expect(new Set([reply.cardFile, svgAgain.cardFile, html.cardFile]).size).toBe(3);
      expect([reply.cardFile, svgAgain.cardFile, html.cardFile].every((f) => existsSync(f))).toBe(true);
    } finally {
      if (savedCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = savedCacheHome;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("warns in the reply when a card's photos keep their URLs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp-cards-"));
    try {
      const tools = toolDefinitions(new ResultStore(), {
        cardDir: dir,
        embedImages: async (markup) => ({ markup, notEmbedded: [{ url: "https://x.test/a.png", reason: "sharp is not installed" }] }),
      });
      const handler = tools.find((t) => t.name === "palettes_for_product_color")!.handler;
      const reply = JSON.parse((await handler({ name: "Pepper", limit: 1 })).content[0]!.text) as Record<string, any>;
      expect(reply.cardWarnings).toEqual([expect.stringMatching(/^1 garment photo could not be embedded \(sharp is not installed\)/)]);
      expect(readFileSync(reply.cardFile, "utf8")).toContain('<image href="https:');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("names every tool in the skill", () => {
    const skill = readFileSync(join(ROOT, "skills", "color-picker", "SKILL.md"), "utf8");
    for (const name of toolDefinitions().map((tool) => tool.name)) {
      expect(skill, name).toContain(`\`${name}\``);
    }
  });
});

describe("mcp over stdio", () => {
  let client: Client;
  let scratch: string;

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), "mcp-test-"));
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== "TYPESAFE_API_KEY",
      ),
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", join(ROOT, "src", "mcp", "main.ts")],
      cwd: ROOT,
      // Fingerprints are cached; keep them out of the real cache directory.
      // Card files go to scratch, with photo URLs kept rather than fetched.
      env: {
        ...env,
        XDG_CACHE_HOME: join(scratch, "cache"),
        COLOR_PICKER_CARD_DIR: scratch,
        COLOR_PICKER_EMBED_IMAGES: "0",
      },
      stderr: "pipe",
    });
    client = new Client({ name: "color-picker-test", version: "0.0.0" });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    await client?.close();
    rmSync(scratch, { recursive: true, force: true });
  });

  /** Call a tool and parse its JSON reply. */
  async function call(name: string, args: Record<string, unknown> = {}) {
    const result = (await client.callTool({ name, arguments: args })) as {
      content: { type: string; text: string }[];
      isError?: boolean;
    };
    const text = result.content[0]!.text;
    return { isError: result.isError ?? false, text, json: () => JSON.parse(text) as Record<string, any> };
  }

  function expectSvg(reply: Record<string, any>) {
    expect(reply.svg).toMatch(/^<svg /);
    expect(reply.resultId).toMatch(/^r\d+$/);
    expect(reply.cardFile.startsWith(scratch)).toBe(true);
    expect(readFileSync(reply.cardFile, "utf8")).toBe(reply.svg);
  }

  it("lists every tool with a JSON schema and a description", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOLS].sort());
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.description!.length).toBeGreaterThan(120);
      expect(tool.description).toMatch(/Use this/);
    }
  });

  it("nearest_colors", async () => {
    const reply = (await call("nearest_colors", { query: "#b8b8a0", k: 2 })).json();
    expect(reply.matches).toHaveLength(2);
    expect(reply.resolved.via).toBe("hex");
    expectSvg(reply);
  });

  it("combinations", async () => {
    const reply = (await call("combinations", { query: "hermosa pink", limit: 3 })).json();
    expect(reply.palettes.length).toBeGreaterThan(0);
    expect(reply.palettes.length).toBeLessThanOrEqual(3);
    expectSvg(reply);
  });

  it("palettes_for_product_color", async () => {
    const reply = (await call("palettes_for_product_color", { name: "Pepper", limit: 2 })).json();
    expect(reply.color.name).toBe("Pepper");
    expect(reply.palettes.length).toBeGreaterThan(0);
    expectSvg(reply);
  });

  it("recommend_product_colors from a path, then the same design as base64", async () => {
    const fromPath = (await call("recommend_product_colors", { designPath: FLAT_MARK, n: 3 })).json();
    expect(fromPath.picks).toHaveLength(3);
    expect(fromPath.mood).toBeUndefined();
    expectSvg(fromPath);

    const base64 = `data:image/png;base64,${readFileSync(FLAT_MARK).toString("base64")}`;
    const fromBytes = (await call("recommend_product_colors", { designBase64: base64, n: 3, mood: true })).json();
    expect(fromBytes.design.hash).toBe(fromPath.design.hash);
    expect(fromBytes.picks.map((p: any) => p.color.slug)).toEqual(fromPath.picks.map((p: any) => p.color.slug));
    expect(fromBytes.mood).toMatchObject({ requested: true, applied: false });
    expect(fromBytes.mood.reason).toMatch(/TYPESAFE_API_KEY/);

    // Both calls share one cached fingerprint.
    const cached = readdirSync(join(scratch, "cache", "color-picker", "fingerprints"));
    expect(cached.filter((f) => f.startsWith(fromPath.design.hash))).toHaveLength(1);
  });

  it("recolor_plans, writing PNGs and reporting skipped vetting", async () => {
    // A cached description, so vetting reaches Jev without running a vision provider.
    const print = await fingerprint(FLAT_MARK, { cache: false });
    const prompt = describePrompt(print.palette);
    const dir = join(scratch, "cache", "color-picker", "fingerprints");
    await writeDescriptionCache(dir, descriptionCachePath(dir, print.hash, prompt), prompt, {
      subject: "a mark",
      mood: "plain",
      elements: print.palette.map((c, i) => ({ name: `shape ${i}`, color: "a color", hex: c.hex })),
      provider: "codex",
      model: "vision-test",
    });

    const outDir = join(scratch, "recolored");
    const reply = (await call("recolor_plans", { designPath: FLAT_MARK, n: 2, outDir, vet: true })).json();
    expect(reply.plans).toHaveLength(2);
    expect(reply.plans[0].prompt).toEqual(expect.any(String));
    expect(reply.plans[0].applied.applicable).toBe(true);
    expect(readdirSync(outDir)).toHaveLength(2);
    expect(reply.design.description.subject).toBe("a mark");
    expect(reply.vet).toMatchObject({ requested: true, applied: false, vetted: 0, dropped: [] });
    expect(reply.vet.reason).toMatch(/TYPESAFE_API_KEY/);
    expect(reply.plans[0].plausibility).toBeNull();
    expectSvg(reply);
  });

  it("recolor_plans refuses includeImplausible without vet", async () => {
    const result = await call("recolor_plans", { designPath: FLAT_MARK, includeImplausible: true });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("includeImplausible applies only with vet");
  });

  it("theme, with CSS, Tailwind, and tokens", async () => {
    const reply = (await call("theme", { query: "hermosa pink", mode: "dark" })).json();
    expect(reply.theme.mode).toBe("dark");
    expect(reply.css).toMatch(/--color-background/);
    expect(reply.tailwind).toEqual(expect.any(String));
    expect(reply.tokens).toEqual(expect.any(Object));
    expectSvg(reply);
  });

  it("check_accessibility by colors and by combination", async () => {
    const byColors = (await call("check_accessibility", { colors: ["#000000", "white"], context: "web-text" })).json();
    expect(byColors.passes).toBe(true);
    expect(byColors.colors[1].name).toMatch(/^white$/i);
    expectSvg(byColors);

    const byId = (await call("check_accessibility", { combinationId: 42, context: "print" })).json();
    expect(byId.context).toBe("print");
    expect(byId.colors.length).toBeGreaterThanOrEqual(2);
  });

  it("list_products, then one product's colors", async () => {
    const index = (await call("list_products")).json();
    expect(index.default).toBe("comfort-colors-1717");
    expect(index.svg).toBeUndefined();

    const product = (await call("list_products", { product: "comfort-colors-1717" })).json();
    expect(product.colors.length).toBeGreaterThan(60);
    expect(product.colors[0]).toEqual(
      expect.objectContaining({ name: expect.any(String), hex: expect.any(String), available: expect.any(Boolean) }),
    );
    expectSvg(product);
  });

  it("render_card renders an earlier result as HTML, and colors as SVG", async () => {
    const theme = (await call("theme", { query: "42" })).json();
    const html = (await call("render_card", { resultId: theme.resultId, format: "html" })).json();
    expect(html.format).toBe("html");
    expect(html.html).toMatch(/^<!doctype html>/);
    expect(html.html).toContain("Sample UI");

    const svg = (await call("render_card", { colors: ["hermosa pink", "#1f2a44"], title: "Pair" })).json();
    expect(svg.svg).toMatch(/^<svg /);
    expect(svg.svg).toContain("Pair");
  });

  it("returns input problems as tool errors", async () => {
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ["nearest_colors", { query: "#12" }, /malformed hex/],
      ["palettes_for_product_color", { name: "Chartreuse Dream" }, /Colors: /],
      ["recommend_product_colors", {}, /designPath or designBase64/],
      ["recommend_product_colors", { designPath: join(scratch, "missing.png") }, /no such design file/],
      ["recommend_product_colors", { designBase64: "not base64!" }, /not valid base64/],
      ["check_accessibility", { combinationId: 9999 }, /unknown combination/],
      ["list_products", { product: "gildan-5000" }, /.+/],
      ["render_card", { resultId: "r9999" }, /no result/],
      ["render_card", { colors: ["not a color at all"] }, /unknown color/],
    ];
    for (const [name, args, message] of cases) {
      const reply = await call(name, args);
      expect(reply.isError, `${name} ${JSON.stringify(args)}`).toBe(true);
      expect(reply.text).toMatch(message);
    }
  });
});
