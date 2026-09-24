import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { defaultProduct, type Product } from "../src/data/index.js";
import { type Fingerprint, fingerprint } from "../src/fingerprint/index.js";
import {
  allowsDarkInk,
  type DesignSummary,
  RECOMMEND_WEIGHTS,
  recommendProductColors,
  scoreComponents,
} from "../src/index.js";

const FIXTURES = join(import.meta.dirname, "fixtures", "designs");

let flatMark: Fingerprint;
let navyBadge: Fingerprint;

beforeAll(async () => {
  flatMark = await fingerprint(join(FIXTURES, "flat-mark.png"), { cache: false });
  navyBadge = await fingerprint(join(FIXTURES, "navy-badge.png"), { cache: false });
});

const product = defaultProduct();
const everyColor = { n: product.colors.length, availableOnly: false };

describe("recommendProductColors", () => {
  it("ranks dark garments first for the flat light-ink mark", () => {
    const picks = recommendProductColors(flatMark);
    expect(picks).toHaveLength(5);
    for (const pick of picks) expect(allowsDarkInk(pick.color.hex)).toBe(false);
    expect(picks.map((p) => p.color.slug)).toContain("black");
  });

  it("puts light garments last for the flat light-ink mark", () => {
    const all = recommendProductColors(flatMark, everyColor);
    const bottom = all.slice(-10);
    for (const pick of bottom) expect(allowsDarkInk(pick.color.hex)).toBe(true);
  });

  it("warns that a near-Navy design color vanishes on Navy", () => {
    const navy = recommendProductColors(navyBadge, everyColor).find((p) => p.color.slug === "navy")!;
    expect(navy.components.vanish).toBeGreaterThan(0.3);
    expect(navy.warnings).toHaveLength(1);
    expect(navy.warnings[0]).toMatch(/^#4f5060 .*only 0\.\d from Navy.*vanish/);
    expect(navy.designColors.find((c) => c.hex === "#4f5060")?.vanishes).toBe(true);
  });

  it("gives no vanish warning where no design color is close", () => {
    const black = recommendProductColors(navyBadge, everyColor).find((p) => p.color.slug === "black")!;
    expect(black.warnings).toEqual([]);
    expect(black.components.vanish).toBe(0);
  });

  it("returns the score as the weighted sum of its exposed components", () => {
    for (const pick of recommendProductColors(navyBadge, everyColor)) {
      expect(pick.score).toBe(scoreComponents(pick.components));
      for (const value of Object.values(pick.components)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("re-ranks with other weights, and the weights reach the score", () => {
    const contrastOnly = { contrast: 1, vanish: 0, inkFit: 0, bookPairing: 0 };
    const picks = recommendProductColors(flatMark, { ...everyColor, weights: contrastOnly });
    for (const pick of picks) expect(pick.score).toBe(scoreComponents(pick.components, contrastOnly));
    const scores = picks.map((p) => p.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("keeps the default weights frozen", () => {
    expect(Object.isFrozen(RECOMMEND_WEIGHTS)).toBe(true);
  });

  it("writes plain-language reasons naming the garment and the closest color", () => {
    const [top] = recommendProductColors(flatMark, { n: 1 });
    expect(top!.reasons[0]).toMatch(/^Both design colors clear 4\.5:1 on .+; #e8836b \(near [A-Za-z ]+\) is the closest at \d+(\.\d+)?:1\.$/);
    expect(top!.reasons[1]).toMatch(/light overall .* dark garment .* white underbase/);
  });

  it("scores ink fit by the dark-ink cutoff", () => {
    const dark: DesignSummary = { palette: [{ hex: "#1c1b32", share: 1 }], inkLuminance: 0.02 };
    const all = recommendProductColors(dark, everyColor);
    for (const pick of all) expect(pick.components.inkFit).toBe(allowsDarkInk(pick.color.hex) ? 1 : 0);
    expect(allowsDarkInk(all[0]!.color.hex)).toBe(true);
  });

  it("adds the book pairing bonus only with a shared combination", () => {
    for (const pick of recommendProductColors(flatMark, everyColor)) {
      expect(pick.components.bookPairing).toBe(pick.sharedCombination === undefined ? 0 : 1);
    }
    expect(recommendProductColors(flatMark, everyColor).some((p) => p.sharedCombination !== undefined)).toBe(true);
  });

  it("names a single design color in the singular", () => {
    const one: DesignSummary = { palette: [{ hex: "#ffffff", share: 1 }], inkLuminance: 1 };
    const [top] = recommendProductColors(one, { n: 1 });
    expect(top!.reasons[0]).toMatch(/^The design's one color, #ffffff \(near .+\), clears 4\.5:1 on /);
  });

  it("skips unstocked colors unless asked", () => {
    const withUnstocked: Product = {
      ...product,
      colors: [...product.colors, { ...product.colors[0]!, slug: "ghost", name: "Ghost", available: false }],
    };
    const n = withUnstocked.colors.length;
    expect(recommendProductColors(flatMark, { product: withUnstocked, n }).some((p) => p.color.slug === "ghost")).toBe(false);
    expect(
      recommendProductColors(flatMark, { product: withUnstocked, n, availableOnly: false }).some(
        (p) => p.color.slug === "ghost",
      ),
    ).toBe(true);
  });

  it("uses the default product and reads a product by ID", () => {
    const byDefault = recommendProductColors(flatMark);
    const byId = recommendProductColors(flatMark, { product: product.id });
    expect(byId).toEqual(byDefault);
  });

  it("rejects an empty design, a bad n, and an unknown product", () => {
    expect(() => recommendProductColors({ palette: [], inkLuminance: 0 })).toThrow(RangeError);
    expect(() => recommendProductColors(flatMark, { n: 0 })).toThrow(RangeError);
    expect(() => recommendProductColors(flatMark, { product: "no-such-shirt" })).toThrow(/Unknown product/);
  });
});
