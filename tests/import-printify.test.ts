import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ProductColor } from "../src/data/index.js";
import {
  BLUEPRINT_ID,
  fetchUpstream,
  mergeColors,
  PRINT_PROVIDER_ID,
  shopSwatches,
  variantColorNames,
  type PrintifyShopProduct,
} from "../scripts/import-printify.js";
import { PRODUCTS_DIR, validateProducts } from "../scripts/validate-products.js";

const TODAY = "2026-09-24";
const LATER = "2026-10-01";

const upstream = [
  { name: "Pepper", hex: "#4F4B48" },
  { name: "Grey", hex: "#A6A6A6" },
  { name: "Sage", hex: "#848D7B" },
];

const study = [
  {
    name: "Pepper",
    hex: "#000000",
    url: "https://example.com/pepper.png",
    sha256: "b".repeat(64),
    colorAssetVersionId: "cav-pepper",
  },
];

function color(overrides: Partial<ProductColor>): ProductColor {
  return {
    name: "Pepper",
    slug: "pepper",
    hex: "#4f4b48",
    aliases: [],
    family: "neutral",
    available: true,
    source: "printify",
    sourceDate: "2026-09-01",
    ...overrides,
  };
}

describe("mergeColors", () => {
  it("adds new colors with provenance, a family, and lowercase hex, sorted by slug", () => {
    const { colors, log } = mergeColors([], upstream, { today: TODAY });
    expect(log).toEqual([]);
    expect(colors.map((c) => c.slug)).toEqual(["grey", "pepper", "sage"]);
    expect(colors[1]).toEqual({
      name: "Pepper",
      slug: "pepper",
      hex: "#4f4b48",
      aliases: [],
      family: "neutral",
      available: true,
      source: "printify",
      sourceDate: TODAY,
    });
    expect(colors[2]!.family).toBe("green");
  });

  it("adds Gray as an alias for Printify's UK spelling Grey", () => {
    const { colors } = mergeColors([], upstream, { today: TODAY });
    expect(colors.find((c) => c.slug === "grey")!.aliases).toEqual(["Gray"]);
  });

  it("keeps a reviewed hex and logs what Printify says now", () => {
    const reviewed = color({ hex: "#4a4644", source: "reviewed", sourceDate: "2026-09-20" });
    const { colors, log } = mergeColors([reviewed], upstream, { today: TODAY });
    expect(colors.find((c) => c.slug === "pepper")).toMatchObject({
      hex: "#4a4644",
      source: "reviewed",
      sourceDate: "2026-09-20",
    });
    expect(log).toEqual(["Pepper: reviewed #4a4644 kept; Printify now says #4f4b48"]);
  });

  it("marks colors Printify no longer lists unavailable, logs it, and keeps them", () => {
    const gone = color({ name: "Emerald", slug: "emerald", hex: "#2f6b4f", family: "green" });
    const { colors, log } = mergeColors([gone], upstream, { today: TODAY });
    expect(colors.find((c) => c.slug === "emerald")).toMatchObject({ available: false, hex: "#2f6b4f" });
    expect(log).toEqual([
      `Emerald: not in the Printify catalog for provider ${PRINT_PROVIDER_ID}; set available: false`,
    ]);
    // A second run does not log the same removal again.
    expect(mergeColors(mergeColors([gone], upstream, { today: TODAY }).colors, upstream, { today: TODAY }).log).toEqual([]);
  });

  it("replaces a gap-filled retail chart color once Printify stocks it", () => {
    const chart = color({ available: false, source: "retail-chart:comfort-colors-2026", hex: "#505050" });
    const { colors } = mergeColors([chart], upstream, { today: TODAY });
    expect(colors.find((c) => c.slug === "pepper")).toMatchObject({
      hex: "#4f4b48",
      available: true,
      source: "printify",
      sourceDate: TODAY,
    });
  });

  it("is idempotent, and --touch changes only sourceDate", () => {
    const first = mergeColors([], upstream, { today: TODAY, colorStudy: study }).colors;
    const again = mergeColors(first, upstream, { today: LATER, colorStudy: study }).colors;
    expect(again).toEqual(first);

    const touched = mergeColors(first, upstream, { today: LATER, touch: true, colorStudy: study }).colors;
    expect(touched.map((c) => c.sourceDate)).toEqual(first.map(() => LATER));
    expect(touched.map(({ sourceDate: _, ...rest }) => rest)).toEqual(first.map(({ sourceDate: _, ...rest }) => rest));
  });

  it("dates a changed hex with the run date", () => {
    const first = mergeColors([], upstream, { today: TODAY }).colors;
    const changed = upstream.map((c) => (c.name === "Sage" ? { ...c, hex: "#80897a" } : c));
    const { colors } = mergeColors(first, changed, { today: LATER });
    expect(colors.find((c) => c.slug === "sage")).toMatchObject({ hex: "#80897a", sourceDate: LATER });
    expect(colors.find((c) => c.slug === "pepper")!.sourceDate).toBe(TODAY);
  });

  it("copies the image and pod pointer from the color study, never its hex", () => {
    const { colors } = mergeColors([], upstream, { today: TODAY, colorStudy: study });
    expect(colors.find((c) => c.slug === "pepper")).toMatchObject({
      hex: "#4f4b48",
      image: { url: "https://example.com/pepper.png", sha256: "b".repeat(64) },
      pod: { colorAssetVersionId: "cav-pepper" },
    });
    expect(colors.find((c) => c.slug === "sage")).not.toHaveProperty("image");
  });

  it("keeps an existing image when no color study is passed", () => {
    const withImage = mergeColors([], upstream, { today: TODAY, colorStudy: study }).colors;
    const { colors } = mergeColors(withImage, upstream, { today: TODAY });
    expect(colors.find((c) => c.slug === "pepper")!.image).toEqual(withImage.find((c) => c.slug === "pepper")!.image);
  });

  it("skips a new color with no swatch and logs it", () => {
    const { colors, log } = mergeColors([], [...upstream, { name: "Hemp" }], { today: TODAY });
    expect(colors.map((c) => c.slug)).not.toContain("hemp");
    expect(log).toEqual(["Hemp: in the Printify catalog but no shop product has a swatch for it; not added"]);
  });

  it("writes output that passes products:check", () => {
    const dir = mkdtempSync(join(tmpdir(), "import-"));
    try {
      cpSync(PRODUCTS_DIR, dir, { recursive: true });
      const file = join(dir, "comfort-colors-1717.json");
      const product = JSON.parse(readFileSync(file, "utf8"));
      const { colors } = mergeColors([], upstream, { today: TODAY, colorStudy: study });
      writeFileSync(file, JSON.stringify({ ...product, colors }));
      expect(validateProducts(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Printify parsing", () => {
  it("lists each variant color once, in first-seen order", () => {
    const variants = [
      { id: 1, options: { color: "Pepper", size: "S" } },
      { id: 2, options: { color: "Pepper", size: "M" } },
      { id: 3, options: { Color: "Sage", size: "S" } },
      { id: 4, options: { size: "S" } },
    ];
    expect(variantColorNames(variants)).toEqual(["Pepper", "Sage"]);
  });

  it("reads swatches only from products on the blueprint", () => {
    const products: PrintifyShopProduct[] = [
      {
        blueprint_id: BLUEPRINT_ID,
        options: [
          { type: "size", values: [{ title: "S" }] },
          { type: "color", values: [{ title: "Pepper", colors: ["#4F4B48"] }, { title: "Sage" }] },
        ],
      },
      { blueprint_id: 5, options: [{ type: "color", values: [{ title: "Pepper", colors: ["#000000"] }] }] },
    ];
    expect([...shopSwatches(products, BLUEPRINT_ID)]).toEqual([["pepper", "#4F4B48"]]);
  });
});

describe("fetchUpstream", () => {
  function fakePrintify(routes: Record<string, unknown>) {
    const calls: string[] = [];
    const impl = (async (url: string | URL | Request) => {
      const path = String(url).replace("https://api.printify.com/v1", "");
      calls.push(path);
      if (!(path in routes)) return new Response("not found", { status: 404 });
      return Response.json(routes[path]);
    }) as typeof fetch;
    return { impl, calls };
  }

  const catalog = `/catalog/blueprints/${BLUEPRINT_ID}/print_providers/${PRINT_PROVIDER_ID}/variants.json?show-out-of-stock=1`;
  const product = (title: string, hex: string): PrintifyShopProduct => ({
    blueprint_id: BLUEPRINT_ID,
    options: [{ type: "color", values: [{ title, colors: [hex] }] }],
  });

  it("pages through shops until every color has a swatch", async () => {
    const { impl, calls } = fakePrintify({
      [catalog]: { variants: [{ id: 1, options: { color: "Pepper" } }, { id: 2, options: { color: "Sage" } }] },
      "/shops.json": [{ id: 10 }, { id: 20 }, { id: 30 }],
      "/shops/10/products.json?page=1&limit=50": { current_page: 1, last_page: 2, data: [product("Pepper", "#4f4b48")] },
      "/shops/10/products.json?page=2&limit=50": { current_page: 2, last_page: 2, data: [] },
      "/shops/20/products.json?page=1&limit=50": { current_page: 1, last_page: 1, data: [product("Sage", "#848d7b")] },
    });
    expect(await fetchUpstream("token", impl)).toEqual([
      { name: "Pepper", hex: "#4f4b48" },
      { name: "Sage", hex: "#848d7b" },
    ]);
    expect(calls).not.toContain("/shops/30/products.json?page=1&limit=50");
  });

  it("sends the token as a bearer header", async () => {
    let auth: string | null = null;
    const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
      auth = new Headers(init?.headers).get("authorization");
      return Response.json({ variants: [] });
    }) as typeof fetch;
    await expect(fetchUpstream("secret", impl)).rejects.toThrow(/no colors/);
    expect(auth).toBe("Bearer secret");
  });

  it("fails loudly on an API error without echoing the token", async () => {
    const { impl } = fakePrintify({});
    const error = await fetchUpstream("secret", impl).catch((e: Error) => e);
    expect(String(error)).toMatch(/404/);
    expect(String(error)).not.toContain("secret");
  });
});
