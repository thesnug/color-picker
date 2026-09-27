import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { recommendProductColors, selectBatchColors, repetitionReport, REQUIRED_SIZES, type ArtworkCandidate } from "../src/index.js";
import { comparePrintFiles, fingerprint, visionPreview } from "../src/fingerprint/index.js";

const black = { palette: [{ hex: "#000000", share: 1 }], inkLuminance: 0 };
const white = { palette: [{ hex: "#ffffff", share: 1 }], inkLuminance: 1 };
const sizeEvidence = { checkedAt: "2026-09-27", source: "fixture provider catalog" };
const candidates = (art: typeof black, artworkId: string): ArtworkCandidate[] => recommendProductColors(art, { n: 100 }).filter(p => p.designColors.every(c => c.ratio >= 4.5)).map(recommendation => ({ artworkId, renditionId: `${artworkId}-prepared`, recommendation, legible: true, subjectRecognizable: true, availableSizes: [...REQUIRED_SIZES], sizeEvidence }));
const pool = [...candidates(black, "black"), ...candidates(white, "white")];
const defaultSlug = pool[0]!.recommendation.color.slug;
const design = (id: string) => ({ id, product: "comfort-colors-1717", defaultSlug, candidates: pool });

describe("batch variety", () => {
  it("uses approved ink alternates, eight distinct colors and explicit prepared mappings", () => {
    const result = selectBatchColors([design("Grate Expectations"), design("Herd Chef"), design("typography")]);
    for (const selection of result.selections) {
      expect(selection.picks).toHaveLength(8);
      expect(new Set(selection.picks.map(p => p.recommendation.color.slug)).size).toBe(8);
      expect(selection.picks[0]!.recommendation.color.slug).toBe(defaultSlug);
      expect(selection.picks.every(p => p.renditionId && p.recommendation.designColors.every(c => c.ratio >= 4.5))).toBe(true);
      const slugs = selection.picks.map(p => p.recommendation.color.slug);
      const families = selection.picks.map(p => p.recommendation.color.family);
      expect(slugs).toContain("ivory");
      expect(slugs.some(slug => ["true-navy", "navy"].includes(slug))).toBe(true);
      expect(slugs.some(slug => ["black", "pepper", "graphite"].includes(slug))).toBe(true);
      expect(families.some(family => ["green", "earth"].includes(family))).toBe(true);
      expect(families).toContain("red-pink");
      expect(families).toContain("orange-yellow");
      expect(selection.picks.some(p => ["blue", "purple"].includes(p.recommendation.color.family) && !["true-navy", "navy"].includes(p.recommendation.color.slug))).toBe(true);
    }
    expect(result.repetition.current.distinct).toBeGreaterThan(8);
  });
  it("fails when review or availability cannot supply eight", () => {
    expect(() => selectBatchColors([{ ...design("unsafe"), candidates: pool.map(p => ({ ...p, legible: false })) }])).toThrow(/default/);
    expect(() => selectBatchColors([{ ...design("short"), candidates: pool.slice(0, 4) }])).toThrow(/no visually approved|fewer than eight/);
    expect(() => selectBatchColors([{ ...design("missing size"), candidates: pool.map(p => ({ ...p, availableSizes: p.availableSizes.filter(size => size !== "3XL") })) }])).toThrow(/default/);
  });
  it("excludes a color missing 3XL and reports an unsatisfied group", () => {
    const withoutIvory = pool.map(p => p.recommendation.color.slug === "ivory" ? { ...p, availableSizes: ["S", "M", "L", "XL", "2XL"] } : p);
    const noIvory = selectBatchColors([{ ...design("no ivory"), candidates: withoutIvory }]).selections[0]!;
    expect(noIvory.picks).toHaveLength(8);
    expect(noIvory.picks.some(p => p.recommendation.color.slug === "ivory")).toBe(false);
    expect(noIvory.unfilledGroups).toContain("Ivory");
    const withoutOneNavy = pool.map(p => p.recommendation.color.slug === "true-navy" ? { ...p, availableSizes: ["S", "M", "L", "XL", "2XL"] } : p);
    const result = selectBatchColors([{ ...design("navy fallback"), candidates: withoutOneNavy }]);
    expect(result.selections[0]!.picks.some(p => p.recommendation.color.slug === "true-navy")).toBe(false);
    expect(result.selections[0]!.picks.some(p => p.recommendation.color.slug === "navy")).toBe(true);
    expect(result.selections[0]!.unfilledGroups).toEqual([]);
  });
  it("prefers Crimson to a comparable Red but permits a clearly stronger Red", () => {
    const base = pool.filter(p => p.recommendation.color.family !== "red-pink");
    const red = pool.find(p => p.recommendation.color.slug === "red")!;
    const crimson = pool.find(p => p.recommendation.color.slug === "crimson")!;
    const choose = (redScore: number) => selectBatchColors([{ ...design("red choice"), candidates: [
      ...base,
      { ...red, recommendation: { ...red.recommendation, score: redScore } },
      { ...crimson, recommendation: { ...crimson.recommendation, score: 1 } },
    ] }]).selections[0]!.picks.find(p => p.recommendation.color.family === "red-pink")!.recommendation.color.slug;
    expect(choose(1.04)).toBe("crimson");
    expect(choose(1.2)).toBe("red");
  });
  it("scores the eighth CC1717 artwork slot for recent repetition and pure Red", () => {
    const groups = ["ivory", "true-navy", "black", "moss", "crimson", "banana", "hydrangea"];
    const candidate = (slug: string, score: number) => {
      const original = pool.find(p => p.recommendation.color.slug === slug)!;
      expect(original).toBeDefined();
      return { ...original, recommendation: { ...original.recommendation, score } };
    };
    // Keep the group representatives ahead of competing group members; compare alternates only at slot eight.
    const base = groups.map(slug => candidate(slug, ["black", "crimson", "hydrangea"].includes(slug) ? 1.3 : 1));
    const fresh = candidate("violet", 1);
    const repeated = candidate("pepper", 1.15);
    const recent = Array.from({ length: 5 }, () => ({
      product: "comfort-colors-1717", slug: "pepper", name: repeated.recommendation.color.name, hex: repeated.recommendation.color.hex,
    }));
    const eighth = (alternate: ArtworkCandidate, history = recent) => selectBatchColors([{
      ...design("artwork slot"), defaultSlug: "ivory", candidates: [...base, alternate, fresh],
    }], history).selections[0]!.picks[7]!.recommendation.color.slug;
    expect(eighth(repeated, [])).toBe("pepper");
    expect(eighth(repeated)).toBe("violet");
    expect(eighth(candidate("red", 1.04), [])).toBe("violet");
    expect(eighth(candidate("red", 1.2), [])).toBe("red");
  });
  it("preserves Butter when blue outlines make its yellow fill readable", () => {
    const butter = recommendProductColors({ palette: [{ hex: "#ffe36a", share: 0.4 }, { hex: "#123e85", share: 0.6 }], inkLuminance: 0.3 }, { n: 100 }).find(p => p.color.slug === "butter")!;
    const result = selectBatchColors([{ ...design("Fix with Butter"), defaultSlug: "butter", candidates: [...pool.filter(p => p.recommendation.color.slug !== "butter"), { artworkId: "blue-yellow", renditionId: "butter-approved", recommendation: butter, legible: true, subjectRecognizable: true, availableSizes: [...REQUIRED_SIZES], sizeEvidence }] }]);
    expect(result.selections[0]!.picks[0]!.renditionId).toBe("butter-approved");
  });
  it("reports near shades and separate recent proposal counts", () => {
    const a = { product: "tee", slug: "a", name: "A", hex: "#ffffff" };
    const b = { ...a, slug: "b", name: "B", hex: "#fefefe" };
    const report = repetitionReport([a,b], [a]);
    expect(report.current.similar).toHaveLength(1);
    expect(report.current.colors["tee/a"]).toBe(1);
    expect(report.combined.colors["tee/a"]).toBe(2);
    expect(report.current.lightness.light).toBe(2);
  });
});

describe("transparent production and vision", () => {
  const lineArt = async () => sharp(Buffer.from([0,0,0,0, 0,0,0,255]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
  it("shows black line art against white without changing alpha-aware ink analysis", async () => {
    const bytes = await lineArt();
    const print = await fingerprint(bytes, { cache: false });
    const preview = await visionPreview(bytes, print);
    const { data } = await sharp(preview.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0,4)]).toEqual([255,255,255,255]);
    expect([...data.subarray(4,8)]).toEqual([0,0,0,255]);
    expect(print.inkLuminance).toBe(0);
    expect(print.hasTransparency).toBe(true);
  });
  it("rejects preserve on opaque source when the approved rendition is transparent", async () => {
    const approved = await lineArt();
    const opaqueSource = await sharp(approved).flatten({ background: "#ffffff" }).png().toBuffer();
    expect((await comparePrintFiles(approved, opaqueSource)).matches).toBe(false);
    const reencoded = await sharp(approved).png({ compressionLevel: 0 }).toBuffer();
    expect((await comparePrintFiles(approved, reencoded)).matches).toBe(true);
  });
  it("shows white typography against a dark preview backdrop", async () => {
    const bytes = await sharp(Buffer.from([0,0,0,0, 255,255,255,255]), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
    const preview = await visionPreview(bytes, await fingerprint(bytes, { cache: false }));
    const data = await sharp(preview.bytes).ensureAlpha().raw().toBuffer();
    expect([...data.subarray(0,4)]).toEqual([36,36,36,255]);
  });
});
