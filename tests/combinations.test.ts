import { describe, expect, it } from "vitest";

import { combinations, COMBINATION_DEFAULTS, type Palette } from "../src/index.js";
import { loadColors, loadCombinations, loadProduct, loadProductIndex } from "../src/data/index.js";
import { equivalentsFor } from "../src/equivalents.js";

const colors = loadColors();
const wadaHexes = new Set(colors.map((c) => c.hex));
const bookIds = (palettes: Palette[]) =>
  palettes.flatMap((p) => (p.source === "book" ? [p.combination.id] : []));

describe("combinations from the book", () => {
  it("returns Hermosa Pink's own combinations first", () => {
    const r = combinations("Hermosa Pink");
    expect(r.anchor?.color.name).toBe("Hermosa Pink");
    expect(r.anchor?.via).toBe("nearest");
    expect(bookIds(r.palettes).slice(0, 3).sort((a, b) => a - b)).toEqual([176, 227, 273]);
    for (const p of r.palettes.slice(0, 3)) {
      expect(p.source).toBe("book");
      if (p.source !== "book") continue;
      expect(p.match.rank).toBe(1);
      expect(p.match.distance).toBe(0);
      expect(p.colors.map((c) => c.index)).toEqual(p.combination.colors);
    }
  });

  it("carries the combination object from the derived data", () => {
    const byId = new Map(loadCombinations().map((c) => [c.id, c]));
    for (const p of combinations("Hermosa Pink").palettes) {
      if (p.source === "book") expect(p.combination).toEqual(byId.get(p.combination.id));
    }
  });

  it("adds second and third matches within the threshold, tagged with their distance", () => {
    // #003e83 is Vandar Poel's Blue, which has no combinations; Violet Blue is 4.5 away.
    const r = combinations("#003e83", { limit: 50 });
    const book = r.palettes.filter((p) => p.source === "book");
    expect(book.length).toBeGreaterThan(0);
    for (const p of book) {
      expect(p.match.color.name).toBe("Violet Blue");
      expect(p.match.rank).toBe(2);
      expect(p.match.distance).toBeCloseTo(4.5, 1);
    }
    expect(bookIds(combinations("#003e83", { secondaryWithin: 4 }).palettes)).toEqual([]);
  });

  it("does not list a combination twice when two matches share it", () => {
    const ids = bookIds(combinations("#ffb3f0", { limit: 100, secondaryWithin: 20 }).palettes);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("harmony fallback", () => {
  it("returns only harmonies for a color with no book combinations", () => {
    // Anchors on Vandar Poel's Blue; the next match is 7 away, past the default threshold.
    const r = combinations("#004578");
    expect(r.anchor?.color.name).toBe("Vandar Poel's Blue");
    expect(r.palettes.length).toBeGreaterThan(0);
    for (const p of r.palettes) {
      expect(p.source).toBe("harmony");
      if (p.source !== "harmony") continue;
      expect(["complementary", "split-complementary", "triadic", "analogous"]).toContain(p.harmony);
      expect(p.colors.map((c) => c.name)).toContain("Vandar Poel's Blue");
      for (const s of p.snaps) expect(s.distance).toBeLessThanOrEqual(8);
    }
  });

  it("skips a harmony when a snap lands past the threshold", () => {
    const all = combinations("#004578").palettes.length;
    const strict = combinations("#004578", { snapWithin: 2 }).palettes.length;
    expect(strict).toBeLessThan(all);
  });

  it("does not repeat a palette when two harmonies snap to the same colors", () => {
    // For Deep Violet, split-complementary and triadic both snap to the same three colors.
    const keys = combinations("#808080", { min: 100 }).palettes.map((p) =>
      p.colors.map((c) => c.index).sort((a, b) => a - b).join(","),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("does not generate harmonies when the book gives enough", () => {
    const r = combinations("Hermosa Pink", { min: 3 });
    expect(r.palettes.every((p) => p.source === "book")).toBe(true);
  });

  it("ranks book results before harmonies", () => {
    const r = combinations("Hermosa Pink", { min: 100, limit: 100 });
    const sources = r.palettes.map((p) => p.source);
    expect(sources).toContain("harmony");
    expect(sources.indexOf("harmony")).toBeGreaterThan(sources.lastIndexOf("book"));
  });
});

describe("every result", () => {
  it("uses only real Wada colors", () => {
    for (const input of ["Hermosa Pink", "#004578", "#808080", "tomato", "#12ab34", "#f0e68c"]) {
      for (const p of combinations(input, { min: 100, limit: 100 }).palettes) {
        expect(p.colors.length).toBeGreaterThan(1);
        for (const c of p.colors) expect(wadaHexes.has(c.hex)).toBe(true);
      }
    }
  });

  it("exposes a numeric score, sorted descending within each source and match", () => {
    const r = combinations("Hermosa Pink", { min: 100, limit: 100 });
    for (const p of r.palettes) {
      expect(p.score).toBeGreaterThanOrEqual(0);
      expect(p.score).toBeLessThanOrEqual(1);
      expect(p.contrast).toBeGreaterThanOrEqual(1);
    }
    const key = (p: Palette) => (p.source === "book" ? `book-${p.match.rank}` : "harmony");
    for (let i = 1; i < r.palettes.length; i++) {
      const [a, b] = [r.palettes[i - 1]!, r.palettes[i]!];
      if (key(a) === key(b)) expect(a.score).toBeGreaterThanOrEqual(b.score);
    }
  });
});

describe("options", () => {
  it("filters by size", () => {
    for (const p of combinations("Hermosa Pink", { size: 3, min: 100 }).palettes) {
      expect(p.colors).toHaveLength(3);
    }
    const sizes = combinations("Hermosa Pink", { size: [2, 4], min: 100, limit: 100 }).palettes.map(
      (p) => p.colors.length,
    );
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.every((n) => n === 2 || n === 4)).toBe(true);
  });

  it("leaves out single-color combinations unless size 1 is asked for", () => {
    const singletons = loadCombinations().filter((c) => c.size === 1);
    const color = colors.find((c) => c.index === singletons[0]!.colors[0])!;
    expect(bookIds(combinations(color.hex, { limit: 100 }).palettes)).not.toContain(singletons[0]!.id);
    expect(bookIds(combinations(color.hex, { size: 1 }).palettes)).toContain(singletons[0]!.id);
  });

  it("drops palettes with other neutral members when includeNeutrals is false", () => {
    const r = combinations("Hermosa Pink", { includeNeutrals: false, min: 100, limit: 100 });
    for (const p of r.palettes) {
      const ref = p.source === "book" ? p.match.color : r.anchor!.color;
      expect(p.colors.filter((c) => c.neutral && c.index !== ref.index)).toEqual([]);
    }
  });

  it("limits the number of palettes", () => {
    expect(combinations("Hermosa Pink", { limit: 2 }).palettes).toHaveLength(2);
  });

  it("rejects invalid options", () => {
    expect(() => combinations("Hermosa Pink", { limit: 0 })).toThrow(RangeError);
    expect(() => combinations("Hermosa Pink", { min: -1 })).toThrow(RangeError);
    expect(() => combinations("Hermosa Pink", { size: 2.5 })).toThrow(RangeError);
  });
});

describe("neutral anchors", () => {
  it("anchors a gray on the nearest neutral when it is within the margin, and records the loser", () => {
    // Deep Violet is within 1.5 times Andover Green's distance from #808080.
    const r = combinations("#808080");
    expect(r.anchor?.via).toBe("nearest-neutral");
    expect(r.anchor?.color.name).toBe("Deep Violet");
    expect(r.anchor?.color.neutral).toBe(true);
    expect(r.anchor?.nearest[0]?.color.name).toBe("Andover Green");
    expect(r.anchor?.rejected?.name).toBe("Andover Green");
    expect(r.anchor?.rejected?.distance).toBe(r.anchor?.nearest[0]?.distance);
    const first = r.palettes[0];
    expect(first?.source).toBe("book");
    if (first?.source === "book") expect(first.match.color.name).toBe("Deep Violet");
  });

  it("keeps the plain nearest for a gray whose nearest neutral is too far", () => {
    // Comfort Colors Grey: Warm Gray is 9.5 away, 1.6 times Light Brown Drab's 5.9.
    const r = combinations("#909090");
    expect(r.anchor?.via).toBe("nearest");
    expect(r.anchor?.color.name).toBe("Light Brown Drab");
    expect(r.anchor?.rejected?.name).toBe("Warm Gray");
    expect(r.anchor!.rejected!.distance).toBeGreaterThan(1.5 * r.anchor!.distance);
  });

  it("uses the plain nearest match for a muted hue, without considering the rule", () => {
    // Comfort Colors Navy, chroma 0.0195: once anchored on Deep Violet.
    const r = combinations("#52525e");
    expect(r.anchor?.via).toBe("nearest");
    expect(r.anchor?.color.name).toBe("Purple Drab");
    expect(r.anchor?.rejected).toBeUndefined();
  });

  it("uses the plain nearest match for a chromatic input", () => {
    const r = combinations("#004578");
    expect(r.anchor?.via).toBe("nearest");
    expect(r.anchor?.nearest[0]?.color.index).toBe(r.anchor?.color.index);
    expect(r.anchor?.rejected).toBeUndefined();
  });

  it("omits the rejected candidate when both are the same color", () => {
    const r = combinations("#000000");
    expect(r.anchor?.color.name).toBe("Black");
    expect(r.anchor?.rejected).toBeUndefined();
  });

  it("exposes the chroma cutoff and the margin", () => {
    expect(COMBINATION_DEFAULTS.neutralChroma).toBe(0.015);
    expect(COMBINATION_DEFAULTS.neutralMargin).toBe(1.5);
    expect(combinations("#808080", { neutralChroma: -1 }).anchor?.color.name).toBe("Andover Green");
    expect(combinations("#808080", { neutralMargin: 1 }).anchor?.color.name).toBe("Andover Green");
    expect(combinations("#909090", { neutralMargin: 2 }).anchor?.color.name).toBe("Warm Gray");
  });
});

describe("a given anchor", () => {
  it("builds palettes around the given index or slug and reports via anchor", () => {
    const byIndex = combinations("#808080", { anchor: 2 });
    const hermosa = colors.find((c) => c.index === 2)!;
    expect(byIndex.anchor?.via).toBe("anchor");
    expect(byIndex.anchor?.color.index).toBe(2);
    expect(byIndex.anchor?.rejected).toBeUndefined();
    expect(byIndex.anchor?.distance).toBeGreaterThan(0);
    expect(byIndex.resolved?.via).toBe("hex");
    const first = byIndex.palettes[0];
    if (first?.source === "book") expect(first.match.color.index).toBe(2);
    expect(combinations("#808080", { anchor: hermosa.slug }).anchor?.color.index).toBe(2);
  });

  it("skips the neutral rule even for a gray input", () => {
    const r = combinations("#808080", { anchor: "andover-green" });
    expect(r.anchor?.color.name).toBe("Andover Green");
    expect(r.anchor?.via).toBe("anchor");
  });

  it("rejects an anchor that names no Wada color", () => {
    expect(() => combinations("#808080", { anchor: 0 })).toThrow(RangeError);
    expect(() => combinations("#808080", { anchor: "not-a-color" })).toThrow(RangeError);
  });
});

describe("the default product", () => {
  it("anchors every color on its stored equivalent unless the neutral rule applied", () => {
    const product = loadProduct(loadProductIndex().default);
    const applied: string[] = [];
    for (const color of product.colors) {
      if (!color.hex) continue;
      const stored = equivalentsFor(product, color.slug)!.matches[0]!;
      const { anchor } = combinations(color.hex);
      if (anchor?.via === "nearest-neutral") {
        applied.push(`${color.name}: ${anchor.color.name} ${anchor.distance.toFixed(1)} over ${stored.name} ${stored.distance.toFixed(1)}`);
        continue;
      }
      expect(anchor?.color.index, color.name).toBe(stored.index);
    }
    console.log(`Neutral anchor rule applied to: ${applied.join("; ") || "none"}`);
    // Pepper is near-black; Deep Violet is 0.1 farther than its plain nearest.
    expect(applied.map((a) => a.split(":")[0])).toEqual(["Pepper"]);
  });
});

describe("unresolved input", () => {
  it("returns no palettes and a reason for an unknown name", () => {
    const r = combinations("not a color at all");
    expect(r.palettes).toEqual([]);
    expect(r.anchor).toBeUndefined();
    expect(r.reason).toMatch(/Unknown color name/);
  });

  it("gives a reason when filters leave nothing", () => {
    const r = combinations("#004578", { size: 4 });
    expect(r.palettes).toEqual([]);
    expect(r.reason).toBeTruthy();
  });
});
