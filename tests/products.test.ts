import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultProduct, loadProduct, loadProductIndex } from "../src/data/index.js";
import { PRODUCTS_DIR, validateProducts } from "../scripts/validate-products.js";

const color = {
  name: "Pepper",
  slug: "pepper",
  hex: "#4f4b48",
  aliases: [],
  family: "neutral",
  available: true,
  source: "printify",
  sourceDate: "2026-09-24",
};

describe("product loaders", () => {
  it("names Comfort Colors 1717 as the default", () => {
    expect(loadProductIndex().default).toBe("comfort-colors-1717");
    expect(defaultProduct()).toMatchObject({ id: "comfort-colors-1717", brand: "Comfort Colors", model: "1717" });
  });

  it("drops the $schema pointer from loaded files", () => {
    expect(defaultProduct()).not.toHaveProperty("$schema");
    expect(loadProductIndex()).not.toHaveProperty("$schema");
  });

  it("carries the 2026 chart-only colors as unstocked, with their chart", () => {
    const bySlug = new Map(defaultProduct().colors.map((c) => [c.slug, c]));
    for (const [slug, hex] of [
      ["dusk", "#735b6a"],
      ["emerald", "#00685e"],
      ["neon-cantaloupe", "#ffbba4"],
      ["rose-quartz", "#e2acd7"],
    ]) {
      expect(bySlug.get(slug!), slug).toMatchObject({
        hex,
        available: false,
        source: expect.stringMatching(/^retail-chart:/),
        sourceUrl: expect.stringMatching(/^https:\/\//),
      });
    }
  });

  it("rejects IDs that are not in the index", () => {
    expect(() => loadProduct("gildan-5000")).toThrow(/Unknown product "gildan-5000"/);
    expect(() => loadProduct("../index")).toThrow(/Unknown product/);
  });
});

describe("validateProducts", () => {
  let dir: string;
  const file = () => join(dir, "comfort-colors-1717.json");
  const product = () => JSON.parse(readFileSync(file(), "utf8"));
  const write = (value: unknown) => writeFileSync(file(), JSON.stringify(value));

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "products-"));
    cpSync(PRODUCTS_DIR, dir, { recursive: true });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("accepts the committed files", () => {
    expect(validateProducts()).toEqual([]);
  });

  it("accepts a product with colors, an image, and a pod pointer", () => {
    write({
      ...product(),
      printAreas: [{ position: "front", width: 12, height: 16 }],
      colors: [
        {
          ...color,
          image: { url: "https://example.com/pepper.jpg", sha256: "a".repeat(64) },
          pod: { colorAssetVersionId: "cav_123" },
        },
        {
          ...color,
          name: "Emerald",
          slug: "emerald",
          hex: null,
          available: false,
          source: "retail-chart:comfort-colors-2026",
          sourceUrl: "https://example.com/chart",
          sourceNote: "No chart publishes a hex.",
        },
        { ...color, name: "Ivory", slug: "ivory", hex: "#efe8d8", source: "reviewed" },
      ],
    });
    expect(validateProducts(dir)).toEqual([]);
  });

  it("fails on a schema violation", () => {
    write({ ...product(), colors: [{ ...color, hex: "#4F4B48" }] });
    expect(validateProducts(dir)).toEqual([expect.stringMatching(/\/colors\/0\/hex must match pattern/)]);
  });

  it("fails on an unknown source", () => {
    write({ ...product(), colors: [{ ...color, source: "guess" }] });
    expect(validateProducts(dir).join("\n")).toMatch(/\/colors\/0\/source/);
  });

  it("fails on duplicate slugs", () => {
    write({ ...product(), colors: [color, { ...color, name: "Pepper 2" }] });
    expect(validateProducts(dir)).toEqual([expect.stringMatching(/duplicate color slug "pepper"/)]);
  });

  it("fails on a reviewed color without a date", () => {
    const { sourceDate: _date, ...undated } = color;
    write({ ...product(), colors: [{ ...undated, source: "reviewed" }] });
    expect(validateProducts(dir)).toContainEqual(expect.stringMatching(/\/colors\/0 is reviewed but has no sourceDate/));
  });

  it("fails on a null hex for a color that is available", () => {
    write({ ...product(), colors: [{ ...color, hex: null }] });
    expect(validateProducts(dir)).toContainEqual(
      expect.stringMatching(/\/colors\/0 has no hex, so it must be available: false/),
    );
  });

  it("fails on a retail chart color without its sourceUrl", () => {
    write({ ...product(), colors: [{ ...color, available: false, source: "retail-chart:getcustom-store" }] });
    expect(validateProducts(dir).join("\n")).toMatch(/\/colors\/0 must have required property 'sourceUrl'/);
  });

  it("fails when the id does not match the file name", () => {
    write({ ...product(), id: "comfort-colors-1718" });
    expect(validateProducts(dir)).toEqual([expect.stringMatching(/does not match the file name/)]);
  });

  it("fails on an unlisted product file and ignores equivalents files", () => {
    writeFileSync(join(dir, "gildan-5000.json"), JSON.stringify({ ...product(), id: "gildan-5000" }));
    writeFileSync(join(dir, "comfort-colors-1717.equivalents.json"), "{}");
    expect(validateProducts(dir)).toEqual(["gildan-5000.json: not listed in index.json"]);
  });

  it("fails when the default is not a listed product", () => {
    const index = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"));
    writeFileSync(join(dir, "index.json"), JSON.stringify({ ...index, default: "gildan-5000" }));
    expect(validateProducts(dir)).toEqual([expect.stringMatching(/default "gildan-5000" is not a listed product/)]);
  });
});
