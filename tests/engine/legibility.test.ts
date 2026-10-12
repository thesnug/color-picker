import { describe, expect, it } from "vitest";

import {
  contrastRatio,
  distance,
  garmentFamily,
  inkOnGarment,
  judgeLegibility,
  LEGIBILITY_PROTOCOL,
  LEGIBILITY_RULES,
  legibleInkNeeds,
  measureInkPixels,
} from "../../src/engine/index.js";
import {
  blackLettering,
  canvas,
  creamInLinework,
  garments,
  GARMENTS,
  LIGHT_PASTELS,
  measurement,
  on,
  OUTLINED_ILLUSTRATION_INKS as INKS,
  outlinedIllustrationPixels,
  pinkInBlueOutline,
  twoTone,
} from "./helpers.js";

describe(`ink legibility judgment (${LEGIBILITY_PROTOCOL})`, () => {
  it("keeps POD's v2 rules and protocol name", () => {
    expect(LEGIBILITY_PROTOCOL).toBe("ink-legibility-v2");
    expect(LEGIBILITY_RULES).toEqual({
      analysisMaxDimension: 1024,
      alphaThreshold: 0.5,
      paletteColors: 12,
      mergeDistance: 5,
      minimumContrast: 3,
      vanishDistance: 10,
      framedEdgeShare: 0.6,
      maximumLostShare: 0.2,
      minimumLegibleShare: 0.2,
      minimumPaletteCoverage: 0.85,
      maximumUnmatchedShare: 0.2,
      darkInkGarmentLuminance: 0.3,
      synthesizedContrast: 4.5,
      recolorMinimumShare: 0.02,
      recolorMaximumTolerance: 35,
    });
  });

  it("matches color-picker contrast and distance", () => {
    expect(contrastRatio("#fb7781", "#a7dcd4")).toBeCloseTo(1.7165, 3);
    expect(distance("#fb7781", "#a7dcd4")).toBeCloseTo(25.17, 1);
    const pink = on(twoTone, "Chalky Mint").inks[0];
    expect(pink).toMatchObject({ hex: "#fb7781", ratio: 1.72, distance: 25.2, legible: false });
    expect(inkOnGarment("#fb7781", 1, "#a7dcd4")).toEqual({ ratio: 1.72, distance: 25.2, vanishes: false, legible: false });
  });

  it("refuses two-tone pink and blue lettering on every pastel and on Navy, and passes it on Black and True Navy", () => {
    for (const name of LIGHT_PASTELS) expect(on(twoTone, name).pass, name).toBe(false);
    expect(on(twoTone, "Chalky Mint").reason).toBe(
      "#fb7781 (68% of the ink) is 1.72:1 on Chalky Mint, under 3:1, and isn't framed by legible ink.",
    );
    expect(on(twoTone, "Chalky Mint").lostShare).toBe(0.675);
    expect(on(twoTone, "Orchid").lostShare).toBe(1);
    expect(on(twoTone, "Black")).toMatchObject({ pass: true, lostShare: 0 });
    expect(on(twoTone, "True Navy")).toMatchObject({ pass: true, lostShare: 0 });
    // The pink reads on Navy, but the blue third of the ink is under 2:1 there.
    expect(on(twoTone, "Navy")).toMatchObject({ pass: false, lostShare: 0.325 });
    expect(on(twoTone, "Navy").reason).toMatch(
      /^#3164de \(33% of the ink\) is 1\.\d\d:1 on Navy, under 3:1, and isn't framed by legible ink\.$/,
    );
  });

  it("refuses a whole word lost on a color the rest of the lettering reads on", () => {
    // One word of pink (60% of the ink) and one of blue (40%), apart on transparency.
    const twoWords = measureInkPixels(
      canvas(240, 100, (x, y) =>
        x % 20 < 10 && y >= 10 && y < 40 ? "#fb7781" : x % 20 < 10 && x < 160 && y >= 60 && y < 90 ? "#3164de" : null,
      ),
      "a".repeat(64),
    );
    expect(twoWords.clusters.map((c) => [c.hex, c.share])).toEqual([
      ["#fb7781", 0.6],
      ["#3164de", 0.4],
    ]);
    const navy = on(twoWords, "Navy");
    expect(navy.inks.find((ink) => ink.hex === "#fb7781")).toMatchObject({ legible: true });
    expect(navy).toMatchObject({ pass: false, lostShare: 0.4 });
    expect(on(twoWords, "Black").pass).toBe(true);
  });

  it("keeps faint lettering framed by a legible outline, but not when the outline is faint too", () => {
    expect(on(pinkInBlueOutline, "Butter")).toMatchObject({ pass: true, lostShare: 0, framedShare: 0.675 });
    expect(on(pinkInBlueOutline, "Butter").inks[0]!.framing).toBeGreaterThanOrEqual(0.9);
    expect(on(pinkInBlueOutline, "Orchid")).toMatchObject({ pass: false, lostShare: 1 });
  });

  it("passes black lettering on light garments and refuses it on Black and the navies", () => {
    for (const name of ["Chalky Mint", "Butter", "Ivory"] as const)
      expect(on(blackLettering, name)).toMatchObject({ pass: true, lostShare: 0 });
    // The orange accent is lost on Orchid, but it is only 15% of the ink.
    expect(on(blackLettering, "Orchid")).toMatchObject({ pass: true, lostShare: 0.149 });
    expect(on(blackLettering, "Black")).toMatchObject({ pass: false });
    expect(on(blackLettering, "Black").lostShare).toBeGreaterThanOrEqual(0.851);
    expect(on(blackLettering, "True Navy").pass).toBe(false);
    expect(on(blackLettering, "Navy").pass).toBe(false);
  });

  it("passes a cream fill inside dark linework on light garments, where the cream vanishes", () => {
    const butter = on(creamInLinework, "Butter");
    expect(butter.pass).toBe(true);
    const cream = butter.inks.find((ink) => ink.hex === "#ebd2ab")!;
    expect(cream).toMatchObject({ vanishes: true, legible: false, lost: false });
    expect(cream.ratio).toBeLessThan(1.2);
    for (const name of [
      "Chalky Mint",
      "Orchid",
      "Lagoon Blue",
      "Blossom",
      "Neon Lemon",
      "Citrus",
      "White",
      "Ivory",
      "Bay",
    ] as const)
      expect(on(creamInLinework, name).pass, name).toBe(true);
    // On Black the cream reads, but the linework's outer edges are on bare garment.
    expect(on(creamInLinework, "Black").pass).toBe(false);
  });

  it("gives gradient art no framing exception", () => {
    const gradient = { ...pinkInBlueOutline, approximate: true };
    expect(on(gradient, "Butter")).toMatchObject({ pass: false, lostShare: 0.675 });
  });

  it("counts exactly 3.00:1 as legible and 2.99:1 as faint, and fails at exactly a fifth of the ink lost", () => {
    const black = measurement([["#000000", 1]], [[0, "T", 10]]);
    expect(judgeLegibility(black, { colorName: "At", hex: "#405f5a" }).inks[0]).toMatchObject({ ratio: 3, legible: true });
    expect(judgeLegibility(black, { colorName: "Under", hex: "#3e5f5a" }).inks[0]).toMatchObject({
      ratio: 2.99,
      legible: false,
    });
    const apart = (lost: number) =>
      measurement(
        [
          ["#000000", 1 - lost],
          ["#fff7e7", lost],
        ],
        [
          [0, "T", 10],
          [1, "T", 10],
        ],
      );
    expect(on(apart(0.2), "Ivory")).toMatchObject({ lostShare: 0.2, pass: false });
    expect(on(apart(0.1999), "Ivory")).toMatchObject({ lostShare: 0.1999, pass: true });
  });

  it("refuses a pair when less than a fifth of the ink reads, even with nothing lost", () => {
    // A thin dark outline (5%) around a pale fill (95%): the fill keeps its shape on Ivory,
    // but almost nothing of the artwork's own color reads there.
    const outlinedPanel = (outline: number) =>
      measurement(
        [
          ["#fff7e7", 1 - outline],
          ["#000000", outline],
        ],
        [
          [0, 1, 4000],
          [1, "T", 4200],
        ],
      );
    expect(on(outlinedPanel(0.05), "Ivory")).toMatchObject({
      pass: false,
      legibleShare: 0.05,
      framedShare: 0.95,
      lostShare: 0,
      reason: "Only 5% of the ink reads at 3:1 or better on Ivory; legible ink must carry at least 20%.",
    });
    expect(on(outlinedPanel(0.2), "Ivory")).toMatchObject({ pass: true, lostShare: 0 });
  });

  it("blends partly transparent ink into the garment before measuring contrast", () => {
    const solid = measurement([["#000000", 1]], [[0, "T", 10]]);
    const faded = measurement([["#000000", 1]], [[0, "T", 10]], { alpha: 0.6 });
    expect(on(faded, "Ivory").inks[0]!.ratio).toBeLessThan(on(solid, "Ivory").inks[0]!.ratio);
    expect(on(faded, "Ivory").inks[0]!.ratio).toBeLessThan(3);
  });

  it("refuses a file with no visible ink", () => {
    const empty = measurement([], []);
    expect(on(empty, "Ivory")).toMatchObject({ pass: false, reason: "No visible ink to read on Ivory." });
  });

  it("names the garment and the measured file in every verdict", () => {
    const verdict = judgeLegibility(twoTone, { colorName: "Navy", hex: "#3B4153" });
    expect(verdict).toMatchObject({
      protocol: "ink-legibility-v2",
      colorName: "Navy",
      garmentHex: "#3b4153",
      bytesChecksum: "f".repeat(64),
    });
  });
});

describe("framing on a faint ink's own boundary", () => {
  it("frames faint lettering only by what it borders, never by faint ink elsewhere in the artwork", () => {
    // Top: cream cells in dark linework. Below: pale yellow letter bars inside a pale orange
    // outline, touching neither the linework nor the garment.
    const m = measureInkPixels(
      canvas(400, 400, (x, y) => {
        if (y < 120) return x % 20 < 2 || y % 20 < 2 ? "#301a10" : "#ebd2ab";
        const row = (y - 160) % 40;
        if (y < 160 || y >= 360 || row >= 24 || x < 40 || x >= 360) return null;
        return row < 2 || row >= 22 || x < 42 || x >= 358 ? "#f2b880" : "#f3e28a";
      }),
      "a".repeat(64),
    );
    expect(m.clusters.map((c) => c.hex).sort()).toEqual(["#301a10", "#ebd2ab", "#f2b880", "#f3e28a"].sort());
    for (const name of ["Butter", "Ivory", "White"] as const) {
      const verdict = on(m, name);
      const ink = (hex: string) => verdict.inks.find((v) => v.hex === hex)!;
      expect(ink("#ebd2ab"), name).toMatchObject({ legible: false, lost: false });
      expect(ink("#ebd2ab").framing).toBeGreaterThan(0.9);
      // The lettering's only neighbor is its faint outline, and the outline's is the garment.
      expect(ink("#f3e28a"), name).toMatchObject({ legible: false, framing: 0, lost: true });
      expect(ink("#f2b880"), name).toMatchObject({ legible: false, framing: 0, lost: true });
      expect(verdict.pass, name).toBe(false);
      // Five 320×24 letter bars beside a 400×120 illustration.
      expect(verdict.lostShare).toBeCloseTo(38400 / 86400, 3);
    }
  });

  it("loses a faint fill inside a faint outline, however many legible marks it holds", () => {
    // A white badge in a pale yellow ring, with two black eyes and a mouth inside the white:
    // a light-ink design for dark garments.
    const m = measureInkPixels(
      canvas(300, 300, (x, y) => {
        const r = Math.hypot(x - 150, y - 150);
        if (r >= 140) return null;
        if (r >= 126) return "#fde68a";
        const eye = Math.hypot(x - 110, y - 130) < 8 || Math.hypot(x - 190, y - 130) < 8;
        if (eye || (x >= 120 && x < 180 && y >= 185 && y < 192)) return "#111111";
        return "#ffffff";
      }),
      "b".repeat(64),
    );
    const white = m.clusters.findIndex((c) => c.hex === "#ffffff");
    const black = m.clusters.findIndex((c) => c.hex === "#111111");
    expect(m.enclosedEdges[white]![black]).toBe(m.edges[white]![black]);
    for (const name of ["White", "Ivory", "Butter"] as const) {
      const verdict = on(m, name);
      expect(verdict.inks[white], name).toMatchObject({ legible: false, framing: 0, lost: true });
      expect(verdict.pass, name).toBe(false);
      expect(verdict.lostShare).toBeGreaterThan(0.95);
    }
    // On a dark garment the white and the ring read, and the black marks are inside them.
    expect(on(m, "Black")).toMatchObject({ pass: true, lostShare: 0 });
  });

  it("inherits framing across faint inks: a faint fill reads as far as its outline does", () => {
    // A pale fill (60%) inside a pale outline (25%) inside dark linework (15%) that meets the
    // garment: the outline is drawn by the linework, so the fill keeps its shape too.
    const nested = measurement(
      [
        ["#f3e28a", 0.6],
        ["#f2b880", 0.25],
        ["#301a10", 0.15],
      ],
      [
        [0, 1, 3000],
        [1, 2, 3200],
        [2, "T", 3600],
      ],
    );
    const butter = on(nested, "Butter");
    expect(butter.inks.map((ink) => [ink.hex, ink.framing, ink.lost])).toEqual([
      ["#f3e28a", 1, false],
      ["#f2b880", 1, false],
      ["#301a10", null, false],
    ]);
    // Without the linework the outline meets the garment, and both faint inks are lost.
    const bare = measurement(
      [
        ["#f3e28a", 0.7],
        ["#f2b880", 0.3],
      ],
      [
        [0, 1, 3000],
        [1, "T", 3200],
      ],
    );
    expect(on(bare, "Butter")).toMatchObject({ pass: false, lostShare: 1 });
  });

  it("never counts texture marks inside faint lettering as its frame", () => {
    // Pink letter bars with 2×2 blue speckles inside the strokes (a riso or grunge texture).
    const speckled = (every: number) =>
      measureInkPixels(
        canvas(320, 200, (x, y) => {
          if (x % 40 >= 28 || y < 20 || y >= 180) return null;
          const inside = x % 40 >= 2 && x % 40 < 26 && y >= 22 && y < 178;
          return every && inside && x % every < 2 && y % every < 2 ? "#3164de" : "#fb7781";
        }),
        "c".repeat(64),
      );
    const plain = speckled(0);
    const textured = speckled(5);
    const blue = textured.clusters.findIndex((c) => c.hex === "#3164de");
    expect(textured.clusters[blue]!.share).toBeGreaterThan(0.1);
    for (const name of ["Ivory", "White", "Butter", "Chalky Mint", "Citrus"] as const) {
      expect(on(plain, name).pass, name).toBe(false);
      const verdict = on(textured, name);
      const pink = verdict.inks.find((ink) => ink.hex === "#fb7781")!;
      expect(pink, name).toMatchObject({ legible: false, framing: 0, lost: true });
      expect(verdict.pass, name).toBe(false);
    }
  });

  it("passes an outlined multi-color illustration on light and dark garments with only framed fills under 3:1", () => {
    const outlined = measureInkPixels(outlinedIllustrationPixels(), "a".repeat(64));
    // Butter: the cream body and letter borders vanish (about 1:1) inside the brown linework.
    const butter = on(outlined, "Butter");
    expect(butter).toMatchObject({ pass: true, lostShare: 0 });
    expect(butter.inks.find((ink) => ink.hex === INKS.cream)).toMatchObject({ legible: false, lost: false });
    expect(butter.inks.find((ink) => ink.hex === INKS.cream)!.ratio).toBeLessThan(1.2);
    expect(butter.inks.find((ink) => ink.hex === INKS.red)).toMatchObject({ ratio: 4.01, legible: true });
    for (const name of ["Chalky Mint", "Orchid"] as const) expect(on(outlined, name)).toMatchObject({ pass: true, lostShare: 0 });
    // Black: the green apron and navy letters are framed by the cream; only the brown
    // linework (under a fifth of the ink) is lost.
    for (const name of ["Black", "True Navy"] as const) {
      const dark = on(outlined, name);
      expect(dark.pass, name).toBe(true);
      expect(dark.inks.find((ink) => ink.hex === INKS.green)).toMatchObject({ lost: false });
      expect(dark.inks.find((ink) => ink.hex === INKS.navy)).toMatchObject({ lost: false });
      expect(dark.inks.find((ink) => ink.hex === INKS.brown)).toMatchObject({ legible: false });
      expect(dark.lostShare).toBeLessThan(0.2);
    }
  });
});

describe("garment families and ink needs", () => {
  it("sorts garments into light and dark families at luminance 0.3", () => {
    expect(garmentFamily(GARMENTS.Butter)).toBe("light");
    expect(garmentFamily(GARMENTS.Violet)).toBe("light");
    expect(garmentFamily(GARMENTS.Navy)).toBe("dark");
    expect(garmentFamily(GARMENTS.Black)).toBe("dark");
  });

  it("asks for an ink option for a family the supplied inks read on less than half of", () => {
    const legibleColors = new Set(garments.filter((g) => judgeLegibility(twoTone, g).pass).map((g) => g.colorName));
    // Black and True Navy read the pink and blue; no light garment does, nor Navy.
    expect([...legibleColors].sort()).toEqual(["Black", "True Navy"]);
    expect(legibleInkNeeds({ garments, legibleColors, colorCount: 2 })).toEqual(["light"]);
    // Short of the requested colors, the dark family's unread Navy asks for an ink too.
    expect(legibleInkNeeds({ garments, legibleColors, colorCount: 8 })).toEqual(["light", "dark"]);
    const all = new Set(garments.map((g) => g.colorName));
    expect(legibleInkNeeds({ garments, legibleColors: all, colorCount: 8 })).toEqual([]);
  });
});
