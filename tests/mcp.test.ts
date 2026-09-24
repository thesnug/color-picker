import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createServer, SERVER_NAME } from "../src/mcp/index.js";
import { jevStatus, RESULT_HISTORY, ResultStore } from "../src/mcp/tools.js";

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

  it("reports why a Jev option was skipped without revealing the key", () => {
    const saved = process.env.TYPESAFE_API_KEY;
    try {
      delete process.env.TYPESAFE_API_KEY;
      expect(jevStatus("mood")).toMatchObject({ requested: true, applied: false });
      expect(jevStatus("mood").reason).toMatch(/TYPESAFE_API_KEY is not set/);
      process.env.TYPESAFE_API_KEY = "secret-value";
      expect(jevStatus("vet").reason).toMatch(/not available in this version/);
      expect(jevStatus("vet").reason).not.toContain("secret-value");
    } finally {
      if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
      else process.env.TYPESAFE_API_KEY = saved;
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
      env: { ...env, XDG_CACHE_HOME: join(scratch, "cache") },
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
    expect(fromBytes.mood.reason).toMatch(/TYPESAFE_API_KEY is not set/);

    // Both calls share one cached fingerprint.
    const cached = readdirSync(join(scratch, "cache", "color-picker", "fingerprints"));
    expect(cached.filter((f) => f.startsWith(fromPath.design.hash))).toHaveLength(1);
  });

  it("recolor_plans, writing PNGs and reporting skipped vetting", async () => {
    const outDir = join(scratch, "recolored");
    const reply = (await call("recolor_plans", { designPath: FLAT_MARK, n: 2, outDir, vet: true })).json();
    expect(reply.plans).toHaveLength(2);
    expect(reply.plans[0].prompt).toEqual(expect.any(String));
    expect(reply.plans[0].applied.applicable).toBe(true);
    expect(readdirSync(outDir)).toHaveLength(2);
    expect(reply.vet).toMatchObject({ requested: true, applied: false });
    expectSvg(reply);
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
