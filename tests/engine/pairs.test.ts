import { describe, expect, it } from "vitest";

import {
  analyzeDesign,
  garmentsFromProduct,
  judgeLegibility,
  legibleInkNeeds,
  planArtworkOptions,
  rankArtworkGarmentPairs,
  substitutePigments,
  planLegibleInkOptions,
  type PairArtwork,
} from "../../src/engine/index.js";
import { canvas, garments as testGarments } from "./helpers.js";

const lettering = canvas(240, 100, (x, y) =>
  x % 20 < 12 && y >= 10 && y < 50 ? "#fb7781" : x % 20 < 12 && x < 100 && y >= 60 && y < 90 ? "#3164de" : null,
);
const original = analyzeDesign(lettering, "a".repeat(64));
const [darkInk] = planLegibleInkOptions({ measurement: original.measurement, garments: testGarments, families: ["light"] });
const darkened = analyzeDesign(substitutePigments(lettering, darkInk!).pixels, "b".repeat(64));
const catalog = garmentsFromProduct();
const artworks: PairArtwork[] = [
  { artworkId: "original", analysis: original, source: "original" },
  { artworkId: "dark-ink", analysis: darkened, source: "legible-ink" },
];

describe("rankArtworkGarmentPairs", () => {
  it("lists only legible pairs, each color's lead artwork first, then the alternates", () => {
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
    expect(firsts.some((p) => p.artworkId === "dark-ink" && p.source === "legible-ink")).toBe(true);
    expect(firsts.some((p) => p.artworkId === "original" && p.source === "original")).toBe(true);
  });

  it("prefers the original among artworks that tie on score and lost ink", () => {
    const twins: PairArtwork[] = [
      { artworkId: "copy", analysis: original, source: "legible-ink" },
      { artworkId: "original", analysis: original, source: "original" },
    ];
    const pairs = rankArtworkGarmentPairs({ artworks: twins, garments: catalog, colorCount: 2 });
    const black = pairs.filter((p) => p.colorName === "Black");
    expect(black.map((p) => p.artworkId)).toEqual(["original", "copy"]);
  });

  it("pushes a near shade of a chosen color later, and puts the preferred color first", () => {
    // Black lettering scores the same on all three light garments; the twin is Bay's hex.
    const black = analyzeDesign(canvas(200, 100, (x, y) => (y > 20 && y < 80 && x % 20 < 12 ? "#000000" : null)), "c".repeat(64));
    const only: PairArtwork[] = [{ artworkId: "a", analysis: black, source: "original" }];
    const garments = [
      { colorName: "Bay", hex: "#aeb5ac", slug: "bay" },
      { colorName: "Bay Twin", hex: "#aeb5ac", slug: "bay-twin" },
      { colorName: "Butter", hex: "#f5e1a4", slug: "butter" },
    ];
    const pairs = rankArtworkGarmentPairs({ artworks: only, garments, colorCount: 3 });
    expect(pairs.map((p) => p.colorName)).toEqual(["Bay", "Butter", "Bay Twin"]);
    expect(pairs[2]!.reason).toMatch(/Variety penalty for 1 near shade/);
    const preferred = rankArtworkGarmentPairs({ artworks: only, garments, colorCount: 3, preferred: "Bay Twin" });
    expect(preferred.map((p) => p.colorName)).toEqual(["Bay Twin", "Butter", "Bay"]);
    expect(preferred[0]!.reason).toMatch(/^Pick 1 of 3 \(the preferred color\): /);
    // Recent use counts as already chosen.
    const recent = rankArtworkGarmentPairs({
      artworks: only,
      garments,
      colorCount: 3,
      product: "comfort-colors-1717",
      recent: [{ product: "comfort-colors-1717", slug: "bay", name: "Bay", hex: "#aeb5ac" }],
    });
    expect(recent[0]!.colorName).toBe("Butter");
  });

  it("rejects a bad color count or an unknown source", () => {
    expect(() => rankArtworkGarmentPairs({ artworks, garments: catalog, colorCount: 0 })).toThrow(RangeError);
    expect(() =>
      rankArtworkGarmentPairs({
        artworks: [{ artworkId: "x", analysis: original, source: "repaint" as never }],
        garments: catalog,
        colorCount: 2,
      }),
    ).toThrow(TypeError);
  });
});

describe("rankArtworkGarmentPairs with the engine's own Artwork Options, on every Comfort Colors 1717 color", () => {
  // The incident pattern at print size: six pink strokes and two blue accents, apart.
  const incident = canvas(480, 180, (x, y) => {
    for (let i = 0; i < 6; i++) if (x >= 20 + i * 50 && x < 50 + i * 50 && y >= 20 && y < 140) return "#fb7781";
    for (let i = 0; i < 2; i++) if (x >= 340 + i * 60 && x < 380 + i * 60 && y >= 20 && y < 150) return "#3164de";
    return null;
  });
  const analysis = analyzeDesign(incident, "d".repeat(64));
  const legibleColors = new Set(catalog.filter((g) => judgeLegibility(analysis.measurement, g).pass).map((g) => g.colorName));
  const needs = legibleInkNeeds({ garments: catalog, legibleColors, colorCount: 8 });
  const options = planArtworkOptions({ analysis, pixels: incident, garments: catalog, needs, legibleColors });
  const all: PairArtwork[] = [
    { artworkId: "original", analysis, source: "original" },
    ...options.map((o) => ({
      artworkId: o.plan.key,
      analysis: analyzeDesign(substitutePigments(incident, o.plan).pixels, "e".repeat(64)),
      source: o.source,
    })),
  ];
  const pairs = rankArtworkGarmentPairs({ artworks: all, garments: catalog, colorCount: 8 });
  const colors = [...new Set(pairs.map((p) => p.colorName))];
  const leads = pairs.slice(0, colors.length);
  const lead = (colorName: string) => leads.find((p) => p.colorName === colorName)!;
  const reads = (artworkId: string, colorName: string) =>
    pairs.some((p) => p.artworkId === artworkId && p.colorName === colorName);

  it("plans a hue-keeping option and Wada repaints that score higher than the original", () => {
    expect([...legibleColors].sort()).toEqual(["Black", "True Navy"]);
    expect(options.map((o) => o.source)).toEqual(["legible-ink", "wada", "wada"]);
    const black = pairs.filter((p) => p.colorName === "Black");
    const wada = black.find((p) => p.source === "wada")!;
    expect(wada.score).toBeGreaterThan(black.find((p) => p.source === "original")!.score);
  });

  it("keeps the original on every color it reads on, however well a repaint scores there, and explores those first", () => {
    for (const colorName of legibleColors) {
      expect(lead(colorName)).toMatchObject({ artworkId: "original", source: "original" });
      expect(lead(colorName).reason).toMatch(/with the original artwork original, score /);
    }
    expect(leads.slice(0, legibleColors.size).map((p) => p.colorName).sort()).toEqual([...legibleColors].sort());
  });

  it("leads with the hue-keeping option wherever it reads and the original does not, before any repaint", () => {
    const keepsHue = options.find((o) => o.source === "legible-ink")!.plan.key;
    const opened = colors.filter((c) => !legibleColors.has(c) && reads(keepsHue, c));
    expect(opened.length).toBeGreaterThan(8);
    for (const colorName of opened) {
      expect(lead(colorName).artworkId, colorName).toBe(keepsHue);
      expect(lead(colorName).reason).toMatch(/which keeps the design's hues, since the original does not read on it/);
    }
    expect(leads.slice(legibleColors.size, legibleColors.size + opened.length).every((p) => p.artworkId === keepsHue)).toBe(true);
  });

  it("lets a Wada repaint lead only where no hue-keeping artwork reads, after every color one does", () => {
    const hueKeeping = all.filter((a) => a.source !== "wada").map((a) => a.artworkId);
    const wadaLeads = leads.filter((p) => p.source === "wada");
    expect(wadaLeads.length).toBeGreaterThan(0);
    for (const p of wadaLeads) {
      expect(hueKeeping.some((id) => reads(id, p.colorName)), p.colorName).toBe(false);
      expect(p.reason).toMatch(/a Wada repaint, since no artwork keeping the design's hues reads on it/);
    }
    const firstWada = leads.findIndex((p) => p.source === "wada");
    expect(leads.slice(firstWada).every((p) => p.source === "wada")).toBe(true);
    // The assortment's picks all keep the design's hues.
    expect(leads.slice(0, 9).every((p) => p.source !== "wada")).toBe(true);
    // Repaints still follow as alternates on the colors the original and the hue-keeping option lead.
    expect(pairs.some((p) => p.colorName === "Black" && p.source === "wada" && p.reason.startsWith("Alternate artwork for Black: "))).toBe(true);
  });
});
