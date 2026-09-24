import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildEquivalents,
  EQUIVALENTS_K,
  outputPath,
  POOR_MATCH,
  serialize,
  summarize,
} from "../scripts/build-equivalents.js";
import { defaultProduct, loadColors, loadProductEquivalents, type Product } from "../src/data/index.js";
import { equivalentsFor } from "../src/equivalents.js";
import { nearest } from "../src/nearest.js";

const product = defaultProduct();
const committed = loadProductEquivalents(product.id);

describe("committed equivalents", () => {
  it("are up to date with the product file and the derived Wada data", () => {
    expect(readFileSync(outputPath(product.id), "utf8")).toBe(serialize(buildEquivalents(product)));
  });

  it("list every product color, in product file order", () => {
    expect(committed.product).toBe(product.id);
    expect(Object.keys(committed.colors)).toEqual(product.colors.map((c) => c.slug));
  });

  it("store the top three Wada matches, nearest first, with the product's family", () => {
    for (const c of product.colors) {
      const e = committed.colors[c.slug]!;
      expect(e.family).toBe(c.family);
      expect(e.hex).toBe(c.hex);
      expect(e.matches).toHaveLength(EQUIVALENTS_K);
      const d = e.matches.map((m) => m.distance);
      expect(d).toEqual([...d].sort((a, b) => a - b));
    }
  });

  it("agree with a live nearest match", () => {
    const e = committed.colors["blue-spruce"]!;
    const live = nearest(e.hex!, { k: EQUIVALENTS_K }).matches;
    expect(e.matches.map((m) => m.index)).toEqual(live.map((m) => m.color.index));
    expect(e.matches[0]!.distance).toBeCloseTo(live[0]!.distance, 3);
  });
});

describe("buildEquivalents", () => {
  const wada = loadColors();
  const base = product.colors[0]!;

  it("lists a color with no hex with an empty match list", () => {
    const input = {
      ...product,
      colors: [{ ...base, slug: "emerald", name: "Emerald", hex: null, available: false }],
    };
    expect(buildEquivalents(input, wada).colors["emerald"]).toEqual({
      name: "Emerald",
      hex: null,
      oklch: null,
      family: base.family,
      matches: [],
    });
  });

  it("is deterministic", () => {
    expect(serialize(buildEquivalents(product, wada))).toBe(serialize(buildEquivalents(product, wada)));
  });
});

describe("summarize", () => {
  it("reports colors whose best match is poor, and colors without a hex", () => {
    const far: Product = {
      ...product,
      colors: [{ ...product.colors[0]!, slug: "far", name: "Far", hex: "#ffffff" }],
    };
    // Only Wada Black to match against, so white is 100 away.
    const file = buildEquivalents(far, loadColors().filter((c) => c.name === "Black"));
    expect(file.colors["far"]!.matches[0]!.distance).toBeGreaterThan(POOR_MATCH);
    const lines = summarize(file).join("\n");
    expect(lines).toContain(`best match farther than ${POOR_MATCH}:`);
    expect(lines).toContain("Far (far)");

    const none = buildEquivalents({
      ...product,
      colors: [{ ...product.colors[0]!, name: "Missing", hex: null }],
    });
    expect(summarize(none).join("\n")).toContain("no hex: Missing");
  });
});

describe("equivalentsFor", () => {
  it("reads the committed file by product ID or product", () => {
    expect(equivalentsFor(product.id, "blue-spruce")).toEqual(committed.colors["blue-spruce"]);
    expect(equivalentsFor(product, "blue-spruce")).toEqual(committed.colors["blue-spruce"]);
  });

  it("returns undefined for an unknown slug and throws for an unknown product", () => {
    expect(equivalentsFor(product.id, "no-such-color")).toBeUndefined();
    expect(equivalentsFor(product.id, "constructor")).toBeUndefined();
    expect(() => equivalentsFor("no-such-product", "blue-spruce")).toThrow(/Unknown product/);
  });
});
