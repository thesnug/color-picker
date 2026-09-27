import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { recommendProductColors, selectBatchColors, repetitionReport, type ArtworkCandidate } from "../src/index.js";
import { comparePrintFiles, fingerprint, visionPreview } from "../src/fingerprint/index.js";

const black = { palette: [{ hex: "#000000", share: 1 }], inkLuminance: 0 };
const white = { palette: [{ hex: "#ffffff", share: 1 }], inkLuminance: 1 };
const candidates = (art: typeof black, artworkId: string): ArtworkCandidate[] => recommendProductColors(art, { n: 100 }).filter(p => p.designColors.every(c => c.ratio >= 4.5)).map(recommendation => ({ artworkId, renditionId: `${artworkId}-prepared`, recommendation, legible: true, subjectRecognizable: true }));
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
    }
    expect(result.repetition.current.distinct).toBeGreaterThan(8);
  });
  it("fails when review or availability cannot supply eight", () => {
    expect(() => selectBatchColors([{ ...design("unsafe"), candidates: pool.map(p => ({ ...p, legible: false })) }])).toThrow(/default/);
    expect(() => selectBatchColors([{ ...design("short"), candidates: pool.slice(0, 4) }])).toThrow(/fewer than eight/);
  });
  it("preserves Butter when blue outlines make its yellow fill readable", () => {
    const butter = recommendProductColors({ palette: [{ hex: "#ffe36a", share: 0.4 }, { hex: "#123e85", share: 0.6 }], inkLuminance: 0.3 }, { n: 100 }).find(p => p.color.slug === "butter")!;
    const result = selectBatchColors([{ ...design("Fix with Butter"), defaultSlug: "butter", candidates: [...pool.filter(p => p.recommendation.color.slug !== "butter"), { artworkId: "blue-yellow", renditionId: "butter-approved", recommendation: butter, legible: true, subjectRecognizable: true }] }]);
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
