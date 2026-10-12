import { describe, expect, it } from "vitest";

import {
  analyzeDesign,
  garmentsFromProduct,
  rankArtworkGarmentPairs,
  substitutePigments,
  planLegibleInkOptions,
} from "../../src/engine/index.js";
import { canvas, garments as testGarments } from "./helpers.js";

const lettering = canvas(240, 100, (x, y) =>
  x % 20 < 12 && y >= 10 && y < 50 ? "#fb7781" : x % 20 < 12 && x < 100 && y >= 60 && y < 90 ? "#3164de" : null,
);
const original = analyzeDesign(lettering, "a".repeat(64));
const [darkInk] = planLegibleInkOptions({ measurement: original.measurement, garments: testGarments, families: ["light"] });
const darkened = analyzeDesign(substitutePigments(lettering, darkInk!).pixels, "b".repeat(64));
const catalog = garmentsFromProduct();
const artworks = [
  { artworkId: "original", analysis: original, original: true },
  { artworkId: "dark-ink", analysis: darkened },
];

describe("rankArtworkGarmentPairs", () => {
  it("lists only legible pairs, each color's best artwork first, then the alternates", () => {
    const pairs = rankArtworkGarmentPairs({ artworks, garments: catalog, colorCount: 8 });
    expect(pairs.length).toBeGreaterThan(8);
    expect(pairs.every((p) => p.legibility.pass)).toBe(true);
    const colors = new Set(pairs.map((p) => p.colorName));
    const firsts = pairs.slice(0, colors.size);
    expect(new Set(firsts.map((p) => p.colorName)).size).toBe(colors.size);
    expect(firsts.slice(0, 8).every((p, i) => p.reason.startsWith(`Pick ${i + 1} of 8: `))).toBe(true);
    expect(firsts.slice(8).every((p) => /^Fallback \d+: /.test(p.reason))).toBe(true);
    for (const p of pairs.slice(colors.size)) expect(p.reason).toMatch(new RegExp(`^Alternate artwork for ${p.colorName}: `));
    expect(pairs.every((p) => p.reason.length <= 2000)).toBe(true);
    // The darkened ink opens the light garments the original fails on.
    expect(firsts.some((p) => p.artworkId === "dark-ink")).toBe(true);
    expect(firsts.some((p) => p.artworkId === "original")).toBe(true);
  });

  it("prefers the original among artworks that tie on score and lost ink", () => {
    const twins = [
      { artworkId: "copy", analysis: original },
      { artworkId: "original", analysis: original, original: true },
    ];
    const pairs = rankArtworkGarmentPairs({ artworks: twins, garments: catalog, colorCount: 2 });
    const black = pairs.filter((p) => p.colorName === "Black");
    expect(black.map((p) => p.artworkId)).toEqual(["original", "copy"]);
  });

  it("pushes a near shade of a chosen color later, and puts the preferred color first", () => {
    // Black lettering scores the same on all three light garments; the twin is Bay's hex.
    const black = analyzeDesign(canvas(200, 100, (x, y) => (y > 20 && y < 80 && x % 20 < 12 ? "#000000" : null)), "c".repeat(64));
    const garments = [
      { colorName: "Bay", hex: "#aeb5ac", slug: "bay" },
      { colorName: "Bay Twin", hex: "#aeb5ac", slug: "bay-twin" },
      { colorName: "Butter", hex: "#f5e1a4", slug: "butter" },
    ];
    const pairs = rankArtworkGarmentPairs({ artworks: [{ artworkId: "a", analysis: black }], garments, colorCount: 3 });
    expect(pairs.map((p) => p.colorName)).toEqual(["Bay", "Butter", "Bay Twin"]);
    expect(pairs[2]!.reason).toMatch(/Variety penalty for 1 near shade/);
    const preferred = rankArtworkGarmentPairs({
      artworks: [{ artworkId: "a", analysis: black }],
      garments,
      colorCount: 3,
      preferred: "Bay Twin",
    });
    expect(preferred.map((p) => p.colorName)).toEqual(["Bay Twin", "Butter", "Bay"]);
    expect(preferred[0]!.reason).toMatch(/^Pick 1 of 3 \(the preferred color\): /);
    // Recent use counts as already chosen.
    const recent = rankArtworkGarmentPairs({
      artworks: [{ artworkId: "a", analysis: black }],
      garments,
      colorCount: 3,
      product: "comfort-colors-1717",
      recent: [{ product: "comfort-colors-1717", slug: "bay", name: "Bay", hex: "#aeb5ac" }],
    });
    expect(recent[0]!.colorName).toBe("Butter");
  });

  it("rejects a bad color count", () => {
    expect(() => rankArtworkGarmentPairs({ artworks, garments: catalog, colorCount: 0 })).toThrow(RangeError);
  });
});
