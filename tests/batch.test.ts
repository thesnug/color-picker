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
      expect(selection.unfilledGroups).toEqual([]);
    }
    expect(result.repetition.current.distinct).toBeGreaterThan(8);
  });
  it("fails when review or availability cannot supply eight", () => {
    expect(() => selectBatchColors([{ ...design("unsafe"), candidates: pool.map(p => ({ ...p, legible: false })) }])).toThrow(/default/);
    expect(() => selectBatchColors([{ ...design("short"), candidates: pool.slice(0, 4) }])).toThrow(/no visually approved|fewer than eight/);
    expect(() => selectBatchColors([{ ...design("missing size"), candidates: pool.map(p => ({ ...p, availableSizes: p.availableSizes.filter(size => size !== "3XL") })) }])).toThrow(/default/);
  });
  it("uses only caller-supplied groups and excludes colors missing 3XL", () => {
    const withoutIvory = pool.map(p => p.recommendation.color.slug === "ivory" ? { ...p, availableSizes: ["S", "M", "L", "XL", "2XL"] } : p);
    const desiredGroups = [{ name: "light neutral", slugs: ["ivory"] }, { name: "dark blue", slugs: ["true-navy", "navy"] }];
    const noIvory = selectBatchColors([{ ...design("no ivory"), candidates: withoutIvory, desiredGroups }]).selections[0]!;
    expect(noIvory.picks).toHaveLength(8);
    expect(noIvory.picks.some(p => p.recommendation.color.slug === "ivory")).toBe(false);
    expect(noIvory.unfilledGroups).toContain("light neutral");
    expect(selectBatchColors([{ ...design("no policy"), candidates: withoutIvory }]).selections[0]!.unfilledGroups).toEqual([]);
    const withoutOneNavy = pool.map(p => p.recommendation.color.slug === "true-navy" ? { ...p, availableSizes: ["S", "M", "L", "XL", "2XL"] } : p);
    const result = selectBatchColors([{ ...design("navy fallback"), candidates: withoutOneNavy, desiredGroups }]);
    expect(result.selections[0]!.picks.some(p => p.recommendation.color.slug === "true-navy")).toBe(false);
    expect(result.selections[0]!.picks.some(p => p.recommendation.color.slug === "navy")).toBe(true);
    expect(result.selections[0]!.unfilledGroups).toEqual([]);
  });
  it("has no built-in penalty for a named color", () => {
    const base = pool.filter(p => p.recommendation.color.family !== "red-pink");
    const red = pool.find(p => p.recommendation.color.slug === "red")!;
    const crimson = pool.find(p => p.recommendation.color.slug === "crimson")!;
    const choose = (redScore: number) => selectBatchColors([{ ...design("red choice"), desiredGroups: [{ name: "warm", families: ["red-pink"] }], candidates: [
      ...base,
      { ...red, recommendation: { ...red.recommendation, score: redScore } },
      { ...crimson, recommendation: { ...crimson.recommendation, score: 1 } },
    ] }]).selections[0]!.picks.find(p => p.recommendation.color.family === "red-pink")!.recommendation.color.slug;
    expect(choose(1.04)).toBe("red");
    expect(choose(0.96)).toBe("crimson");
  });
  it("scores the eighth artwork slot for recent repetition", () => {
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
      ...design("artwork slot"), defaultSlug: "ivory", desiredGroups: groups.slice(1).map(slug => ({ name: slug, slugs: [slug] })), candidates: [...base, alternate, fresh],
    }], history).selections[0]!.picks[7]!.recommendation.color.slug;
    expect(eighth(repeated, [])).toBe("pepper");
    expect(eighth(repeated)).toBe("violet");
    expect(eighth(candidate("red", 1.2), [])).toBe("red");
  });
  it("matches project family groups with slug exceptions and validates group definitions", () => {
    const result = selectBatchColors([{ ...design("project groups"), desiredGroups: [
      { name: "warm", families: ["red-pink", "orange-yellow"] },
      { name: "blue beyond default", families: ["blue", "purple"], excludeSlugs: [defaultSlug] },
    ] }]).selections[0]!;
    expect(result.unfilledGroups).toEqual([]);
    expect(result.picks.some(p => ["red-pink", "orange-yellow"].includes(p.recommendation.color.family))).toBe(true);
    expect(result.picks.some(p => ["blue", "purple"].includes(p.recommendation.color.family) && p.recommendation.color.slug !== defaultSlug)).toBe(true);
    expect(() => selectBatchColors([{ ...design("invalid"), desiredGroups: [{ name: "empty" }] }])).toThrow(/desired groups/);
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
