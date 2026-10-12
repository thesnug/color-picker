import { describe, expect, it } from "vitest";

import {
  analyzeDesign,
  extractPalette,
  garmentsFromProduct,
  inkLuminance,
  rankGarments,
  recommendProductColors,
  scoreComponents,
} from "../../src/engine/index.js";
import { canvas } from "./helpers.js";

const catalog = garmentsFromProduct();

// The three designs that showed the v0.5.0 recommendation and the v2 verdict disagreeing.
const pinkBlue = canvas(200, 100, (x, y) => {
  if (y < 20 || y > 80) return null;
  if (x % 20 < 12 && x < 130) return "#fb7781";
  if (x >= 140 && x < 190 && x % 10 < 6) return "#3164de";
  return null;
});
const outlinedFill = canvas(200, 200, (x, y) => {
  const r = Math.hypot(x - 100, y - 100);
  return r < 70 ? "#ebd2ab" : r < 82 ? "#301a10" : null;
});
const bareFill = canvas(200, 200, (x, y) => (Math.hypot(x - 100, y - 100) < 80 ? "#ebd2ab" : null));

const place = (ranked: { garment: { colorName: string } }[], name: string) => ranked.findIndex((r) => r.garment.colorName === name);
/** The v0.5.0 ranking: a five-color fingerprint palette and the recommendation score alone. */
const before = (pixels: typeof pinkBlue) =>
  recommendProductColors({ palette: extractPalette(pixels), inkLuminance: inkLuminance(pixels) }, { n: 100 }).map((p) => ({
    garment: { colorName: p.color.name },
  }));

describe("rankGarments", () => {
  it("ranks two-tone pink and blue lettering on Black and True Navy above the pastels it fails on", () => {
    const ranked = rankGarments(analyzeDesign(pinkBlue, "a".repeat(64)), catalog);
    for (const pastel of ["Ivory", "White", "Butter", "Blossom"]) {
      expect(place(ranked, "Black")).toBeLessThan(place(ranked, pastel));
      expect(place(ranked, "True Navy")).toBeLessThan(place(ranked, pastel));
      expect(ranked[place(ranked, pastel)]!.legibility.pass, pastel).toBe(false);
    }
    // The score alone put Ivory first.
    expect(place(before(pinkBlue), "Ivory")).toBe(0);
  });

  it("ranks light garments above Navy for a cream fill inside a dark outline", () => {
    const ranked = rankGarments(analyzeDesign(outlinedFill, "a".repeat(64)), catalog);
    for (const light of ["Ivory", "White", "Butter", "Blossom", "Bay"]) {
      expect(place(ranked, light), light).toBeLessThan(place(ranked, "Navy"));
      expect(ranked[place(ranked, light)]!.legibility.pass, light).toBe(true);
    }
    expect(ranked[place(ranked, "Navy")]!.legibility.pass).toBe(false);
    // The score alone put Navy second and the light garments near the bottom.
    expect(place(before(outlinedFill), "Navy")).toBe(1);
  });

  it("gives a framed fill no vanish penalty, and a bare one the full share", () => {
    const framed = rankGarments(analyzeDesign(outlinedFill, "a".repeat(64)), catalog).find((r) => r.garment.colorName === "Butter")!;
    expect(framed.designColors.find((c) => c.hex === "#ebd2ab")).toMatchObject({ vanishes: true });
    expect(framed.legibility.inks.find((i) => i.hex === "#ebd2ab")).toMatchObject({ lost: false });
    expect(framed).toMatchObject({ vanishBasis: "lost-ink", warnings: [] });
    expect(framed.components.vanish).toBe(0);

    const bare = rankGarments(analyzeDesign(bareFill, "b".repeat(64)), catalog).find((r) => r.garment.colorName === "Ivory")!;
    expect(bare.components.vanish).toBe(1);
    expect(bare.legibility.pass).toBe(false);
    expect(bare.warnings).toEqual([
      expect.stringMatching(/^#ebd2ab, 100% of the ink, is 1\.\d\d:1 on Ivory, under 3:1, and no legible ink frames it/),
    ]);
  });

  it("orders legible garments first, then by score, then by input order", () => {
    const ranked = rankGarments(analyzeDesign(pinkBlue, "a".repeat(64)), catalog);
    const firstFailing = ranked.findIndex((r) => !r.legibility.pass);
    expect(ranked.slice(firstFailing).every((r) => !r.legibility.pass)).toBe(true);
    for (const group of [ranked.slice(0, firstFailing), ranked.slice(firstFailing)]) {
      const scores = group.map((r) => r.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    }
    for (const r of ranked) {
      expect(r.score).toBe(scoreComponents(r.components));
      expect(r.reasons[0]).toBe(r.legibility.reason);
    }
  });

  it("takes garments with their own hexes, and returns n", () => {
    const analysis = analyzeDesign(pinkBlue, "a".repeat(64));
    const ranked = rankGarments(analysis, [
      { colorName: "Provider Navy", hex: "#52525E" },
      { colorName: "Reviewed Navy", hex: "#3b4153", slug: "navy" },
      { colorName: "Black", hex: "#1f1d1e" },
    ]);
    expect(ranked.map((r) => r.garment)).toEqual([
      { colorName: "Black", hex: "#1f1d1e", slug: "black" },
      expect.objectContaining({ colorName: expect.stringMatching(/Navy$/) }),
      expect.objectContaining({ colorName: expect.stringMatching(/Navy$/) }),
    ]);
    expect(ranked.find((r) => r.garment.colorName === "Provider Navy")!.garment.slug).toBe("provider-navy");
    expect(rankGarments(analysis, catalog, { n: 3 })).toHaveLength(3);
    expect(() => rankGarments(analysis, catalog, { n: 0 })).toThrow(RangeError);
    expect(() => rankGarments(analyzeDesign({ data: new Uint8Array(4), width: 1, height: 1 }, "e"), catalog)).toThrow(RangeError);
  });
});
