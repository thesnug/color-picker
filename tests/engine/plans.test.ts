import { describe, expect, it } from "vitest";

import {
  analyzeDesign,
  contrastRatio,
  distance,
  garmentFamily,
  garmentsFromProduct,
  judgeLegibility,
  judgeRecolor,
  legibleInkNeeds,
  measureInkPixels,
  planArtworkOptions,
  planLegibleInkOptions,
  recolorPlans,
  snapSubstitutionPlan,
  substitutePigments,
  toSubstitutionPlan,
  validateSubstitutionPlan,
} from "../../src/engine/index.js";
import { blackLettering, canvas, GARMENTS, garments, measurement, on, twoTone } from "./helpers.js";

describe("legible ink options", () => {
  it("plans one dark-ink option for the pink lettering that reads on the median light garment", () => {
    const plans = planLegibleInkOptions({ measurement: twoTone, garments, families: ["light"] });
    expect(plans).toHaveLength(1);
    const [plan] = plans;
    expect(validateSubstitutionPlan(plan!)).toBe(plan);
    expect(plan).toMatchObject({ key: "legible-dark-ink-v1", label: "Dark ink for light garments" });
    expect(plan!.rationale).toMatch(/^Measured ink legibility \(ink-legibility-v2\): #fb7781 → #[0-9a-f]{6} \(1\.\d:1 → \d\.\d:1\) on /);
    const pink = plan!.replacements.find((r) => r.from === "#fb7781")!;
    expect(pink.tolerance).toBeLessThanOrEqual(35);
    const light = garments
      .filter((g) => garmentFamily(g.hex) === "light")
      .sort((a, b) => contrastRatio(a.hex, "#000000") - contrastRatio(b.hex, "#000000"));
    const median = light[Math.floor((light.length - 1) / 2)]!;
    expect(contrastRatio(pink.to, median.hex)).toBeGreaterThanOrEqual(4.5);
    // The blue already reads on the median light garment and keeps its color.
    expect(plan!.replacements.some((r) => r.from === "#3164de")).toBe(false);
    expect(distance(pink.to, "#3164de")).toBeGreaterThanOrEqual(10);
    const recolored = measurement(
      [
        [pink.to, 0.675],
        ["#3164de", 0.325],
      ],
      [
        [0, "T", 9000],
        [1, "T", 5000],
        [0, 1, 800],
      ],
    );
    const before = garments.filter((g) => judgeLegibility(twoTone, g).pass).length;
    const after = garments.filter((g) => judgeLegibility(recolored, g).pass).length;
    expect(after).toBeGreaterThan(before);
    for (const name of ["Butter", "Chalky Mint", "Ivory", "Citrus"] as const) expect(on(recolored, name).pass, name).toBe(true);
  });

  it("plans one light-ink option for black lettering, leaving inks that already read alone", () => {
    const blackAndWhite = measurement(
      [
        ["#000000", 0.7],
        ["#ffffff", 0.3],
      ],
      [
        [0, "T", 9000],
        [1, 0, 3000],
      ],
    );
    const [plan, ...rest] = planLegibleInkOptions({ measurement: blackAndWhite, garments, families: ["dark"] });
    expect(rest).toEqual([]);
    expect(plan!.key).toBe("legible-light-ink-v1");
    expect(plan!.replacements.map((r) => r.from)).toEqual(["#000000"]);
    // 4.5:1 on the median dark garment (Black) and 3:1 on the lightest (Navy).
    expect(contrastRatio(plan!.replacements[0]!.to, GARMENTS.Black)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(plan!.replacements[0]!.to, GARMENTS.Navy)).toBeGreaterThanOrEqual(3);
    // Both the black and the orange of black lettering with an accent are under 3:1 on dark garments.
    const [accentPlan] = planLegibleInkOptions({ measurement: blackLettering, garments, families: ["dark"] });
    expect(accentPlan!.replacements.map((r) => r.from)).toContain("#000000");
    expect(validateSubstitutionPlan(accentPlan!)).toBe(accentPlan);
  });

  it("drops a plan that would merge two distinct inks", () => {
    // Two pinks 12 apart, differing mostly in lightness, darken to the same pink.
    const twoPinks = measurement(
      [
        ["#f0a0b0", 0.5],
        ["#e07080", 0.5],
      ],
      [
        [0, "T", 10],
        [1, "T", 10],
      ],
    );
    expect(distance("#f0a0b0", "#e07080")).toBeGreaterThanOrEqual(10);
    expect(planLegibleInkOptions({ measurement: twoPinks, garments, families: ["light"] })).toEqual([]);
  });

  it("snaps a planner recolor onto the measured pigment and drops guesses that match none", () => {
    const snapped = snapSubstitutionPlan(
      {
        key: "dark-ink",
        label: "Dark ink",
        rationale: "Planner guess.",
        replacements: [
          { from: "#fa7682", to: "#8d0528", tolerance: 35 },
          { from: "#00ff00", to: "#003300", tolerance: 10 },
        ],
      },
      twoTone,
    );
    expect(snapped?.replacements).toHaveLength(1);
    expect(snapped?.replacements[0]!.from).toBe("#fb7781");
    expect(
      snapSubstitutionPlan(
        {
          key: "none",
          label: "None",
          rationale: "Planner guess.",
          replacements: [{ from: "#00ff00", to: "#003300", tolerance: 10 }],
        },
        twoTone,
      ),
    ).toBeNull();
  });

  it("validates the stored plan shape without a schema library", () => {
    const good = { key: "a-1", label: "A", rationale: "R", replacements: [{ from: "#000000", to: "#ffffff", tolerance: 4 }] };
    expect(validateSubstitutionPlan(good)).toBe(good);
    for (const bad of [
      { ...good, key: "Upper" },
      { ...good, key: "x".repeat(61) },
      { ...good, label: "" },
      { ...good, rationale: "r".repeat(2001) },
      { ...good, replacements: [] },
      { ...good, replacements: Array(7).fill(good.replacements[0]) },
      { ...good, replacements: [{ from: "#000", to: "#ffffff", tolerance: 4 }] },
      { ...good, replacements: [{ from: "#000000", to: "#ffffff", tolerance: 36 }] },
      { ...good, replacements: [{ from: "#000000", to: "#ffffff", tolerance: 1.5 }] },
      { ...good, extra: true },
    ])
      expect(() => validateSubstitutionPlan(bad as typeof good), JSON.stringify(bad).slice(0, 80)).toThrow(TypeError);
  });
});

/** Two-tone lettering as pixels: pink words above a blue accent, apart on transparency. */
const lettering = canvas(240, 100, (x, y) =>
  x % 20 < 12 && y >= 10 && y < 50 ? "#fb7781" : x % 20 < 12 && x < 100 && y >= 60 && y < 90 ? "#3164de" : null,
);
const catalog = garmentsFromProduct();

describe("Wada plans as pigment substitutions", () => {
  const design = analyzeDesign(lettering, "d".repeat(64));

  it("binds each mapped color to its measured ink and keys the plan by its combination", () => {
    const plans = recolorPlans(design.summary, { n: 10 });
    const plan = plans.find((p) => !p.merged)!;
    const substitution = toSubstitutionPlan(plan, design.measurement)!;
    expect(substitution.key).toMatch(/^wada-(b\d+|[a-z-]+)-e\d+-i[\d-]+-v1$/);
    expect(substitution.replacements.map((r) => r.from)).toEqual(
      plan.mapping.filter((m) => m.from.hex !== m.to.hex).map((m) => m.from.hex),
    );
    expect(validateSubstitutionPlan(substitution)).toBe(substitution);
    // Applied to the pixels, every pink and blue pixel takes its new ink.
    const { pixels, changed } = substitutePigments(lettering, substitution);
    expect(changed).toBe(240 * 100 - countTransparent(lettering.data));
    expect(measureInkPixels(pixels, "x").clusters.map((c) => c.hex).sort()).toEqual(
      plan.mapping.map((m) => m.to.hex).sort(),
    );
  });

  it("refuses a plan that merges inks, or a color the design does not have", () => {
    const [plan] = recolorPlans(design.summary, { n: 1 });
    expect(toSubstitutionPlan(plan!, design.measurement)).not.toBeNull();
    expect(toSubstitutionPlan({ ...plan!, merged: true }, design.measurement)).toBeNull();
    const foreign = { ...plan!, mapping: plan!.mapping.map((m) => ({ ...m, from: { ...m.from, hex: "#00ff00" as const } })) };
    expect(toSubstitutionPlan(foreign, design.measurement)).toBeNull();
  });

  it("judges a recolored design on its garment", () => {
    const [plan] = recolorPlans(design.summary, { n: 1 });
    const verdict = judgeRecolor({
      measurement: design.measurement,
      pixels: lettering,
      mapping: plan!.mapping,
      garment: { colorName: plan!.color.name, hex: plan!.color.hex },
    })!;
    expect(verdict).toMatchObject({ protocol: "ink-legibility-v2", colorName: plan!.color.name, bytesChecksum: `${"d".repeat(64)}:recolor` });
    expect(verdict.inks.map((i) => i.hex).sort()).toEqual(plan!.mapping.map((m) => m.to.hex).sort());
  });
});

function countTransparent(data: Uint8Array): number {
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] === 0) n++;
  return n;
}

describe("planArtworkOptions", () => {
  const design = analyzeDesign(lettering, "d".repeat(64));
  const legibleColors = new Set(catalog.filter((g) => judgeLegibility(design.measurement, g).pass).map((g) => g.colorName));
  const needs = legibleInkNeeds({ garments: catalog, legibleColors, colorCount: 8 });
  const input = { analysis: design, pixels: lettering, garments: catalog, needs, legibleColors };

  it("keeps the legible-ink option and at most three Wada options, each adding legible colors", () => {
    expect(needs).toContain("light");
    const options = planArtworkOptions(input);
    expect(options[0]).toMatchObject({ source: "legible-ink", plan: { key: "legible-dark-ink-v1" } });
    expect(options.filter((o) => o.source === "wada").length).toBeLessThanOrEqual(3);
    for (const option of options) {
      expect(option.plan.key).toMatch(/^[a-z0-9-]{1,60}$/);
      expect(validateSubstitutionPlan(option.plan)).toBe(option.plan);
      expect(option.addsColors.length).toBeGreaterThan(0);
      // What an option adds is what its recolored pixels pass on and the original did not.
      const after = measureInkPixels(substitutePigments(lettering, option.plan).pixels, "x");
      expect(option.addsColors).toEqual(
        catalog.filter((g) => !legibleColors.has(g.colorName) && judgeLegibility(after, g).pass).map((g) => g.colorName),
      );
    }
    expect(new Set(options.map((o) => o.plan.key)).size).toBe(options.length);
  });

  it("is deterministic, so a rerun finds the same Artwork Options by key", () => {
    expect(planArtworkOptions(input)).toEqual(planArtworkOptions(input));
  });

  it("respects maxPalettePlans and plans nothing when no family needs another ink", () => {
    expect(planArtworkOptions({ ...input, maxPalettePlans: 0 }).every((o) => o.source === "legible-ink")).toBe(true);
    expect(planArtworkOptions({ ...input, maxPalettePlans: 1 }).filter((o) => o.source === "wada").length).toBeLessThanOrEqual(1);
    expect(planArtworkOptions({ ...input, needs: [] })).toEqual([]);
  });
});
