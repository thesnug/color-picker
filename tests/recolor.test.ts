import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { defaultProduct, loadAccessibility } from "../src/data/index.js";
import { applyRecolor, decodeForLegibility, type Fingerprint, fingerprint, recolorPixels } from "../src/fingerprint/index.js";
import { analyzeDesign, inkOnGarment } from "../src/engine/index.js";
import {
  mapByLightness,
  RECOLOR_WEIGHTS,
  type RecolorPlan,
  recolorPlans,
  recolorPrompt,
  scoreRecolor,
  toOklab,
} from "../src/index.js";

const FIXTURES = join(import.meta.dirname, "fixtures", "designs");
const FLAT_MARK = join(FIXTURES, "flat-mark.png");
const PHOTO = join(FIXTURES, "photo-square.png");

let flatMark: Fingerprint;
let navyBadge: Fingerprint;
let photo: Fingerprint;

beforeAll(async () => {
  flatMark = await fingerprint(FLAT_MARK, { cache: false });
  navyBadge = await fingerprint(join(FIXTURES, "navy-badge.png"), { cache: false });
  photo = await fingerprint(PHOTO, { cache: false });
});

const product = defaultProduct();
const everyColor = { n: product.colors.length, availableOnly: false };
const lightness = (hex: string) => toOklab(hex).l;

/** True when sorting the mapping by design lightness also sorts it by ink lightness. */
function preservesLightnessOrder(plan: RecolorPlan): boolean {
  const sorted = [...plan.mapping].sort((a, b) => lightness(a.from.hex) - lightness(b.from.hex));
  return sorted.every((m, i) => i === 0 || lightness(m.to.hex) >= lightness(sorted[i - 1]!.to.hex));
}

describe("recolorPlans", () => {
  it("returns one plan per garment with the requested shape", () => {
    const plans = recolorPlans(flatMark);
    expect(plans).toHaveLength(5);
    expect(new Set(plans.map((p) => p.color.slug)).size).toBe(5);
    for (const plan of plans) {
      expect(Object.keys(plan)).toEqual(
        expect.arrayContaining(["color", "combination", "mapping", "prompt", "score", "reasons"]),
      );
      expect(plan.mapping.map((m) => m.from.hex)).toEqual(flatMark.palette.map((c) => c.hex));
      expect(plan.reasons.length).toBeGreaterThan(0);
    }
  });

  it("maps the flat design onto the combination preserving lightness order", () => {
    for (const plan of recolorPlans(flatMark, everyColor)) {
      expect(preservesLightnessOrder(plan)).toBe(true);
      // Two design colors take two distinct inks unless the plan had to merge.
      expect(new Set(plan.mapping.map((m) => m.to.index)).size).toBe(plan.merged ? 1 : 2);
    }
    for (const plan of recolorPlans(flatMark)) expect(plan.merged).toBe(false);
  });

  it("prefers merging to a vanishing ink", () => {
    // Ivory's equivalent is Wada's White, which has no combination whose other
    // members all clear the print minimum on an ivory shirt, and a neutral has no
    // harmonies. (The reviewed White garment, #e7e7ea, now resolves elsewhere.)
    const ivory = recolorPlans(flatMark, everyColor).find((p) => p.color.slug === "ivory")!;
    expect(ivory.flagged).toBe(false);
    expect(ivory.merged).toBe(true);
    expect(ivory.reasons.at(-1)).toMatch(/#e8836b and #f3e9d2 both become /);
  });

  it("maps only onto the combination's members other than the garment's equivalent", () => {
    for (const plan of recolorPlans(navyBadge, everyColor)) {
      const { colors, equivalent } = plan.combination;
      expect(colors.map((c) => c.index)).toContain(equivalent.index);
      for (const m of plan.mapping) {
        expect(m.to.index).not.toBe(equivalent.index);
        expect(colors.map((c) => c.index)).toContain(m.to.index);
      }
    }
  });

  it("prefers book combinations to harmonies", () => {
    const plans = recolorPlans(flatMark, everyColor);
    expect(plans.every((p) => p.combination.source === "book")).toBe(true);
  });

  it("merges neighbors in lightness when the combination has fewer inks than the design has colors", () => {
    const plans = recolorPlans(photo, everyColor);
    expect(photo.palette).toHaveLength(5);
    // No combination in the book has six members, so every plan merges.
    for (const plan of plans) {
      expect(plan.merged).toBe(true);
      expect(preservesLightnessOrder(plan)).toBe(true);
      expect(plan.reasons.some((r) => r.includes("neighbors in lightness share an ink"))).toBe(true);
    }
    // The widest combinations win, so at least three inks survive where the book allows.
    const black = plans.find((p) => p.color.slug === "black")!;
    expect(new Set(black.mapping.map((m) => m.to.index)).size).toBeGreaterThanOrEqual(3);
  });

  it("names every swap in the prompt", () => {
    for (const plan of recolorPlans(navyBadge)) {
      expect(plan.prompt).toMatch(new RegExp(`^Recolor the artwork for a ${plan.color.name} shirt: `));
      for (const m of plan.mapping) {
        expect(plan.prompt).toContain(`the ${m.from.hex} areas to ${m.to.name} ${m.to.hex}`);
      }
    }
  });

  it("names design elements in the prompt when the design carries them", () => {
    const design = {
      ...flatMark,
      palette: [
        { ...flatMark.palette[0]!, element: "strawberry body" },
        { ...flatMark.palette[1]!, element: "leaves" },
      ],
    };
    const [plan] = recolorPlans(design, { n: 1 });
    expect(plan!.mapping[0]!.from.element).toBe("strawberry body");
    expect(plan!.prompt).toContain(`change the strawberry body to ${plan!.mapping[0]!.to.name}`);
    expect(plan!.prompt).toMatch(/the leaves/);
  });

  it("keeps a color the ink matches rather than asking to change it", () => {
    const prompt = recolorPrompt("Black", [
      { from: { hex: "#ffffff", share: 1 }, to: { index: 1, name: "White", hex: "#fefefe" } },
    ]);
    expect(prompt).toBe(
      "Recolor the artwork for a Black shirt: keep the #ffffff areas as White #fefefe. " +
        "Keep the shapes, line work, and transparent areas unchanged.",
    );
  });

  it("flags plans whose new ink vanishes into the garment and ranks them last", () => {
    // A print minimum so large every ink vanishes on every garment.
    const rules = loadAccessibility();
    const strict = {
      ...rules,
      print: { ...rules.print, minimumDistance: { ...rules.print.minimumDistance, value: 1000 } },
    };
    const plans = recolorPlans(flatMark, { n: 3, rules: strict });
    expect(plans).toHaveLength(3);
    for (const plan of plans) {
      expect(plan.flagged).toBe(true);
      expect(plan.components.vanish).toBe(1);
      expect(plan.warnings.filter((w) => w.includes("will vanish into the shirt"))).toHaveLength(2);
    }

    const normal = recolorPlans(navyBadge, everyColor);
    const firstFlagged = normal.findIndex((p) => p.flagged);
    if (firstFlagged >= 0) expect(normal.slice(firstFlagged).every((p) => p.flagged)).toBe(true);
    for (const plan of normal) {
      const unreadable = plan.mapping.some((m) => !inkOnGarment(m.to.hex, 1, plan.color.hex).legible);
      expect(plan.flagged).toBe(plan.components.vanish > 0 || unreadable);
    }
  });

  it("flags a new ink under 3:1 on the garment even when it clears the print minimum distance", () => {
    const plans = recolorPlans(flatMark, everyColor);
    const spruce = plans.find((p) => p.color.slug === "blue-spruce")!;
    const ink = spruce.mapping.find((m) => m.to.hex === "#c3a55c")!;
    const on = inkOnGarment(ink.to.hex, 1, spruce.color.hex);
    expect(on.ratio).toBeLessThan(3);
    expect(on.distance).toBeGreaterThanOrEqual(10);
    expect(spruce.components.vanish).toBe(0);
    expect(spruce.flagged).toBe(true);
    expect(spruce.warnings).toContain(
      `#e8836b, 51% of the design, becomes Isabella Color #c3a55c, only ${on.ratio}:1 on Blue Spruce, under 3:1; it will not read on the shirt.`,
    );
    // Flagged plans rank after every unflagged one.
    expect(plans.indexOf(spruce)).toBeGreaterThan(plans.map((p) => p.flagged).lastIndexOf(false));
  });

  it("returns the score as the weighted sum of its exposed components, highest first", () => {
    const plans = recolorPlans(flatMark, everyColor);
    for (const plan of plans) {
      expect(plan.score).toBe(scoreRecolor(plan.components, RECOLOR_WEIGHTS));
      for (const value of Object.values(plan.components)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
    const unflagged = plans.filter((p) => !p.flagged).map((p) => p.score);
    expect(unflagged).toEqual([...unflagged].sort((a, b) => b - a));
  });

  it("skips unstocked colors unless asked", () => {
    const unstocked = new Set(product.colors.filter((c) => !c.available).map((c) => c.slug));
    for (const plan of recolorPlans(flatMark, { n: product.colors.length })) {
      expect(unstocked.has(plan.color.slug)).toBe(false);
    }
  });

  it("includes chart-only colors with hex but skips colors without hex when unstocked are requested", () => {
    const plans = recolorPlans(flatMark, everyColor);
    const chartOnly = product.colors.filter((c) => !c.available && c.hex !== null).map((c) => c.slug);
    expect(plans.map((p) => p.color.slug)).toEqual(expect.arrayContaining(chartOnly));
    expect(plans.every((p) => p.color.hex !== null)).toBe(true);
    expect(plans).toHaveLength(product.colors.filter((c) => c.hex !== null).length);
  });

  it("rejects an empty design and a bad n", () => {
    expect(() => recolorPlans({ palette: [], inkLuminance: 0.5 })).toThrow(RangeError);
    expect(() => recolorPlans(flatMark, { n: 0 })).toThrow(/n must be a positive integer/);
  });
});

describe("mapByLightness", () => {
  const ink = (l: number) => ({ oklab: { l } });
  const design = (l: number) => ({ lightness: l });

  it("maps the darkest design color to the darkest ink", () => {
    const d = [design(0.9), design(0.2), design(0.5)];
    const inks = [ink(0.6), ink(0.1), ink(0.95)];
    const map = mapByLightness(d, inks);
    expect(map.get(d[1]!)).toBe(inks[1]);
    expect(map.get(d[2]!)).toBe(inks[0]);
    expect(map.get(d[0]!)).toBe(inks[2]);
  });

  it("splits design colors into contiguous lightness runs when inks are fewer", () => {
    const d = [0.1, 0.2, 0.3, 0.4, 0.5].map(design);
    const inks = [ink(0.8), ink(0.3)];
    const map = mapByLightness(d, inks);
    expect(d.map((x) => map.get(x)!.oklab.l)).toEqual([0.3, 0.3, 0.3, 0.8, 0.8]);
  });
});

describe("recolorPixels", () => {
  const mapping = [
    { from: { hex: "#ff0000" }, to: { hex: "#0000ff" } },
    { from: { hex: "#ffffff" }, to: { hex: "#000000" } },
  ];

  it("replaces each pixel with its nearest swap, keeping alpha", () => {
    const data = new Uint8Array([255, 0, 0, 255, 250, 250, 250, 128, 9, 9, 9, 0]);
    const { pixels, unmatched } = recolorPixels({ data, width: 3, height: 1 }, mapping);
    expect([...pixels.data]).toEqual([0, 0, 255, 255, 0, 0, 0, 128, 0, 0, 0, 0]);
    expect(unmatched).toBe(0);
  });

  it("counts pixels beyond the tolerance as unmatched, weighted by alpha", () => {
    const data = new Uint8Array([255, 0, 0, 255, 0, 160, 0, 255]);
    expect(recolorPixels({ data, width: 2, height: 1 }, mapping).unmatched).toBe(0.5);
  });

  it("rejects an empty mapping", () => {
    expect(() => recolorPixels({ data: new Uint8Array(4), width: 1, height: 1 }, [])).toThrow(RangeError);
  });
});

describe("applyRecolor", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "recolor-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the flat design by pigment substitution, keeping alpha and antialiased edges", async () => {
    const [plan] = recolorPlans(flatMark, { n: 1 });
    const out = join(dir, "out.png");
    const result = await applyRecolor(FLAT_MARK, plan!.mapping, { out });
    expect(result).toMatchObject({ applicable: true, out, width: 256, height: 256 });
    if (!result.applicable) return;
    expect(result.replacements.map((r) => [r.from, r.to])).toEqual(plan!.mapping.map((m) => [m.from.hex, m.to.hex]));
    expect(result.unmatched).toBeLessThan(0.05);

    const before = await sharp(FLAT_MARK).ensureAlpha().raw().toBuffer();
    const after = await sharp(out).ensureAlpha().raw().toBuffer();
    const hex = (d: Buffer, i: number) =>
      `#${[d[i]!, d[i + 1]!, d[i + 2]!].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    const counts = new Map<string, number>();
    for (let i = 0; i < after.length; i += 4) {
      expect(after[i + 3]).toBe(before[i + 3]);
      if (after[i + 3] === 0) continue;
      // Each pigment's exact pixels take exactly its new ink.
      const was = hex(before, i);
      const swap = plan!.mapping.find((m) => m.from.hex === was);
      if (swap) expect(hex(after, i)).toBe(swap.to.hex);
      counts.set(hex(after, i), (counts.get(hex(after, i)) ?? 0) + 1);
    }
    // The new inks fill the design; the old ones survive only in edge blends no pigment reaches.
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([h]) => h);
    expect(new Set(top)).toEqual(new Set(plan!.mapping.map((m) => m.to.hex)));
  });

  it("declines photographic art, whose main colors cover too little of the ink, and writes nothing", async () => {
    const [plan] = recolorPlans(photo, { n: 1 });
    const out = join(dir, "photo.png");
    const result = await applyRecolor(PHOTO, plan!.mapping, { out });
    expect(result.applicable).toBe(false);
    if (!result.applicable) expect(result.reason).toMatch(/cover only 50% of the design's ink.*use the prompt instead/);
    expect(existsSync(out)).toBe(false);
  });

  it("declines a mapping that leaves an ink out", async () => {
    const [plan] = recolorPlans(flatMark, { n: 1 });
    const out = join(dir, "partial.png");
    // Map only the coral ring; the cream disc would keep its ink.
    const coralOnly = plan!.mapping.filter((m) => m.from.hex === "#e8836b");
    const result = await applyRecolor(FLAT_MARK, coralOnly, { out });
    expect(result.applicable).toBe(false);
    if (!result.applicable) expect(result.reason).toMatch(/cover only 51% of the design's ink/);
    expect(existsSync(out)).toBe(false);
  });

  it("recolors distressed art with near-transparent residue over half its canvas, as it prints", async () => {
    // Pink and blue lettering, a third of its pixels shifted up to 14 per channel, worn and
    // half-transparent pixels, and alpha 1 to 6 residue of any color on half the canvas.
    const DISTRESSED = join(import.meta.dirname, "fixtures", "engine", "distressed-lettering.png");
    const [plan] = recolorPlans(analyzeDesign(await decodeForLegibility(readFileSync(DISTRESSED)), "x").summary, { n: 1 });
    const out = join(dir, "distressed.png");
    const result = await applyRecolor(DISTRESSED, plan!.mapping, { out });
    expect(result).toMatchObject({ applicable: true, out });
    if (!result.applicable) return;
    // Counted pixel by pixel, the residue alone is over a third of the visible pixels.
    const before = await sharp(DISTRESSED).ensureAlpha().raw().toBuffer();
    let visible = 0;
    let residue = 0;
    for (let i = 3; i < before.length; i += 4) {
      if (before[i] === 0) continue;
      visible++;
      if (before[i]! <= 6) residue++;
    }
    expect(residue / visible).toBeGreaterThan(0.35);
    expect(result.unmatched).toBeLessThan(0.05);
    // Every opaque pixel of a mapped ink took its new ink: no speckles of the old one remain.
    const after = await sharp(out).ensureAlpha().raw().toBuffer();
    for (let i = 0; i < after.length; i += 4) {
      if (before[i + 3]! <= 127) continue;
      expect([after[i], after[i + 1], after[i + 2]], `pixel ${i / 4}`).not.toEqual([before[i], before[i + 1], before[i + 2]]);
    }
  });

  it("declines a mapping color the design does not contain", async () => {
    const result = await applyRecolor(FLAT_MARK, [{ from: { hex: "#00ff00" }, to: { hex: "#000000" } }], {
      out: join(dir, "none.png"),
    });
    expect(result.applicable).toBe(false);
    if (!result.applicable) expect(result.reason).toMatch(/matches none of the design's measured inks/);
  });
});
