import { describe, expect, it } from "vitest";

import { contrastRatio, findProductColor, palettesForProductColor } from "../src/index.js";
import { defaultProduct, type Product } from "../src/data/index.js";
import { equivalentsFor } from "../src/equivalents.js";

const product = defaultProduct();

describe("findProductColor", () => {
  it.each([
    ["Blue Spruce", "blue-spruce"],
    ["blue spruce", "blue-spruce"],
    ["BLUE SPRUCE", "blue-spruce"],
    ["blue-spruce", "blue-spruce"],
    ["  Blue_Spruce ", "blue-spruce"],
    ["Grey", "grey"],
    ["gray", "grey"],
  ])("resolves %j to %s", (query, slug) => {
    expect(findProductColor(product, query)?.slug).toBe(slug);
  });

  it("returns undefined for unknown and empty names", () => {
    expect(findProductColor(product, "Emerald")).toBeUndefined();
    expect(findProductColor(product, "  ")).toBeUndefined();
  });
});

describe("palettesForProductColor", () => {
  it("resolves an alias to the product color", () => {
    const r = palettesForProductColor("Gray");
    expect(r.product.id).toBe("comfort-colors-1717");
    expect(r.color?.name).toBe("Grey");
    expect(r.palettes.length).toBeGreaterThan(0);
  });

  it("puts the garment first, marked as the anchor, then the Wada ink colors", () => {
    const r = palettesForProductColor("Blue Spruce", { limit: 50 });
    expect(r.palettes.length).toBeGreaterThan(0);
    for (const p of r.palettes) {
      const [garment, ...ink] = p.colors;
      expect(garment).toMatchObject({ anchor: true, name: "Blue Spruce", slug: "blue-spruce", hex: "#536758" });
      expect(garment.image?.url).toMatch(/^https:/);
      expect(ink.length).toBeGreaterThan(0);
      for (const c of ink) {
        expect(c.anchor).toBe(false);
        // The garment replaces the equivalent it was found through.
        expect(c.index).not.toBe(p.equivalent.index);
      }
    }
  });

  it("reads only the stored equivalents within reach, nearest always included", () => {
    const stored = equivalentsFor(product, "blue-spruce")!.matches;
    const r = palettesForProductColor("Blue Spruce");
    expect(r.equivalents[0]).toMatchObject({ ...stored[0], rank: 1 });
    for (const e of r.equivalents.slice(1)) expect(e.distance).toBeLessThanOrEqual(6);

    const wide = palettesForProductColor("Blue Spruce", { within: 100, limit: 100 });
    expect(wide.equivalents.map((e) => e.index)).toEqual(stored.map((m) => m.index));
    expect(new Set(wide.palettes.map((p) => p.equivalent.index)).size).toBeGreaterThan(1);
  });

  it("ranks by contrast against the garment hex, book palettes before harmonies", () => {
    const r = palettesForProductColor("Blue Spruce", { within: 100, limit: 100 });
    const firstHarmony = r.palettes.findIndex((p) => p.source === "harmony");
    const book = firstHarmony === -1 ? r.palettes : r.palettes.slice(0, firstHarmony);
    expect(r.palettes.slice(book.length).every((p) => p.source === "harmony")).toBe(true);
    for (const group of [book, r.palettes.slice(book.length)]) {
      const contrasts = group.map((p) => p.contrast);
      expect(contrasts).toEqual([...contrasts].sort((a, b) => b - a));
    }
    for (const p of r.palettes) {
      const ratios = p.colors.slice(1).map((c) => contrastRatio(c.hex, "#536758"));
      const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      expect(p.contrast).toBeCloseTo(mean, 3);
      expect(p.minContrast).toBeCloseTo(Math.min(...ratios), 3);
    }
  });

  it("merges without repeating a book combination", () => {
    const r = palettesForProductColor("Blue Spruce", { within: 100, limit: 100 });
    const ids = r.palettes.flatMap((p) => (p.source === "book" ? [p.combination.id] : []));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("honors size and limit, counting the garment in size", () => {
    const r = palettesForProductColor("Blue Spruce", { size: 3, limit: 2 });
    expect(r.palettes).toHaveLength(2);
    for (const p of r.palettes) expect(p.colors).toHaveLength(3);
  });

  it("works for unstocked colors and says so", () => {
    const unstocked: Product = {
      ...product,
      colors: product.colors.map((c) => (c.slug === "blue-spruce" ? { ...c, available: false } : c)),
    };
    const r = palettesForProductColor("Blue Spruce", { product: unstocked });
    expect(r.available).toBe(false);
    expect(r.palettes.length).toBeGreaterThan(0);
    expect(r.palettes[0]!.colors[0].available).toBe(false);
    expect(palettesForProductColor("Blue Spruce").available).toBe(true);
  });

  it("returns a reason instead of throwing for an unknown color", () => {
    const r = palettesForProductColor("Emerald");
    expect(r.color).toBeUndefined();
    expect(r.palettes).toEqual([]);
    expect(r.reason).toContain('no color named "Emerald"');
  });

  it("throws for an unknown product or a bad limit", () => {
    expect(() => palettesForProductColor("Blue Spruce", { product: "no-such-shirt" })).toThrow(/Unknown product/);
    expect(() => palettesForProductColor("Blue Spruce", { limit: 0 })).toThrow(RangeError);
  });
});
