import { describe, expect, it } from "vitest";

import {
  buildDerived,
  classifyHarmony,
  hueArc,
  serialize,
  srgbToOklab,
} from "../scripts/build-data.js";
import { loadColors, loadCombinations, loadWadaDataset } from "../src/data/index.js";

const source = loadWadaDataset();
const colors = loadColors();
const combinations = loadCombinations();

describe("derived colors", () => {
  it("keeps every source color, by index", () => {
    expect(colors).toHaveLength(157);
    expect(colors.map((c) => c.index)).toEqual(source.colors.map((c) => c.index));
  });

  it("has unique names and slugs", () => {
    const names = colors.map((c) => c.name);
    const slugs = colors.map((c) => c.slug);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("corrects the known typos and keeps the source name as an alias", () => {
    const expected: Record<string, string> = {
      "Calamine BLue": "Calamine Blue",
      "Pomegranite Purple": "Pomegranate Purple",
      "Cerulian Blue": "Cerulean Blue",
      "Antwarp Blue": "Antwerp Blue",
      "Sulpher Yellow": "Sulphur Yellow",
      "Krongbergs Green": "Kronberg's Green",
    };
    for (const [sourceName, name] of Object.entries(expected)) {
      const color = colors.find((c) => c.sourceName === sourceName);
      expect(color, sourceName).toBeDefined();
      expect(color!.name).toBe(name);
      expect(color!.aliases).toContain(sourceName);
    }
  });

  it("gives variants a clean name, the base name as an alias, and a variant letter", () => {
    const a = colors.find((c) => c.sourceName === "Eugenia Red | A")!;
    const b = colors.find((c) => c.sourceName === "Grayish Lavender - B")!;
    expect(a).toMatchObject({ name: "Eugenia Red A", slug: "eugenia-red-a", variant: "A" });
    expect(a.aliases).toEqual(["Eugenia Red", "Eugenia Red | A"]);
    expect(b).toMatchObject({ name: "Grayish Lavender B", variant: "B" });
    expect(b.aliases).toContain("Grayish Lavender");
  });

  it("never renames a color that has no correction", () => {
    for (const c of colors) {
      if (c.name === c.sourceName) expect(c.aliases).not.toContain(c.sourceName);
    }
  });

  it("carries the source values and precomputed OKLab and OKLCH", () => {
    const white = colors.find((c) => c.name === "White")!;
    const black = colors.find((c) => c.name === "Black")!;
    expect(white).toMatchObject({
      hex: "#ffffff",
      rgb: [255, 255, 255],
      cmyk: [0, 0, 0, 0],
      oklab: { l: 1, a: 0, b: 0 },
      oklch: { l: 1, c: 0, h: 0 },
      neutral: true,
    });
    expect(black.oklab.l).toBe(0);
    for (const c of colors) {
      expect(c.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(c.oklab.l).toBeGreaterThanOrEqual(0);
      expect(c.oklab.l).toBeLessThanOrEqual(1);
      expect(c.oklch.h).toBeGreaterThanOrEqual(0);
      expect(c.oklch.h).toBeLessThan(360);
      expect(c.oklch.c).toBeCloseTo(Math.hypot(c.oklab.a, c.oklab.b), 4);
    }
  });

  it("matches published OKLab reference values", () => {
    // Reference values from the OKLab specification for sRGB primaries.
    const [l, a, b] = srgbToOklab([255, 0, 0]);
    expect(l).toBeCloseTo(0.62796, 4);
    expect(a).toBeCloseTo(0.22486, 4);
    expect(b).toBeCloseTo(0.12585, 4);
    const [gl, ga, gb] = srgbToOklab([0, 255, 0]);
    expect(gl).toBeCloseTo(0.86644, 4);
    expect(ga).toBeCloseTo(-0.23389, 4);
    expect(gb).toBeCloseTo(0.1795, 4);
  });

  it("marks the named grays, white, and black as neutral", () => {
    const neutrals = colors.filter((c) => c.neutral).map((c) => c.name);
    for (const name of ["White", "Black", "Neutral Gray", "Mineral Gray", "Warm Gray", "Slate Color"]) {
      expect(neutrals).toContain(name);
    }
    expect(neutrals).not.toContain("Ecru");
  });
});

describe("derived combinations", () => {
  it("has one object per combination ID, 1 through 348, in order", () => {
    expect(combinations).toHaveLength(348);
    expect(combinations.map((c) => c.id)).toEqual(
      Array.from({ length: 348 }, (_, i) => i + 1),
    );
  });

  it("keeps the ten singletons flagged size 1", () => {
    expect(combinations.filter((c) => c.size === 1)).toHaveLength(10);
    const sizes = new Map<number, number>();
    for (const c of combinations) sizes.set(c.size, (sizes.get(c.size) ?? 0) + 1);
    expect(Object.fromEntries(sizes)).toEqual({ 1: 10, 2: 124, 3: 112, 4: 99, 5: 3 });
  });

  it("agrees with the source membership in both directions", () => {
    const byIndex = new Map(colors.map((c) => [c.index, c]));
    for (const combo of combinations) {
      expect(combo.size).toBe(combo.colors.length);
      expect(combo.colors).toEqual([...combo.colors].sort((a, b) => a - b));
      for (const index of combo.colors) {
        expect(byIndex.get(index)!.combinations).toContain(combo.id);
      }
    }
    for (const color of colors) {
      for (const id of color.combinations) {
        expect(combinations[id - 1]!.colors).toContain(color.index);
      }
    }
  });

  it("computes lightness, spread, and neutrals from its members", () => {
    const byIndex = new Map(colors.map((c) => [c.index, c]));
    for (const combo of combinations) {
      const members = combo.colors.map((i) => byIndex.get(i)!);
      const mean = members.reduce((s, c) => s + c.oklab.l, 0) / members.length;
      expect(combo.averageLightness).toBeCloseTo(mean, 4);
      expect(combo.hasNeutral).toBe(members.some((c) => c.neutral));
      expect(combo.hueSpread).toBeGreaterThanOrEqual(0);
      expect(combo.hueSpread).toBeLessThan(360);
      if (combo.size === 1) expect(combo.harmony).toBe("monochromatic");
    }
  });
});

describe("harmony classification", () => {
  it("labels textbook hue geometries", () => {
    expect(classifyHarmony([])).toBe("monochromatic");
    expect(classifyHarmony([40])).toBe("monochromatic");
    expect(classifyHarmony([40, 52])).toBe("monochromatic");
    expect(classifyHarmony([40, 220])).toBe("complementary");
    expect(classifyHarmony([40, 90])).toBe("analogous");
    expect(classifyHarmony([40, 160, 280])).toBe("triadic");
    expect(classifyHarmony([40, 200, 240])).toBe("split-complementary");
    expect(classifyHarmony([10, 40, 70, 95])).toBe("analogous");
    expect(classifyHarmony([0, 60, 180, 240])).toBe("other");
  });

  it("measures the smallest arc across the 0/360 seam", () => {
    expect(hueArc([350, 10])).toBe(20);
    expect(hueArc([10, 350, 180])).toBe(190);
    expect(hueArc([5])).toBe(0);
  });
});

describe("build script", () => {
  it("is deterministic and matches the committed files", () => {
    const first = buildDerived(source);
    const second = buildDerived(source);
    expect(serialize(first.colors)).toBe(serialize(second.colors));
    expect(first.colors.colors).toEqual(colors);
    expect(first.combinations.combinations).toEqual(combinations);
  });
});
