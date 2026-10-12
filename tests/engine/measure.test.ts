import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  analyzeDesign,
  judgeLegibility,
  legibilitySampling,
  measureInkPixels,
  SUMMARY_MAXIMUM_COLORS,
  SUMMARY_MINIMUM_SHARE,
} from "../../src/engine/index.js";
import { analyzeDesignFile, decodeForLegibility } from "../../src/fingerprint/index.js";
import { canvas, GARMENTS, on, paint } from "./helpers.js";

type Shape = { x: number; y: number; w: number; h: number; fill: string; opacity?: number };
/** A transparent print file of crisp rectangles, painted in order. */
async function png(width: number, height: number, shapes: Shape[], defs = "") {
  const rects = shapes
    .map(
      (s) =>
        `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" fill="${s.fill}"${
          s.opacity === undefined ? "" : ` fill-opacity="${s.opacity}"`
        } shape-rendering="crispEdges"/>`,
    )
    .join("");
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${defs}${rects}</svg>`))
    .png()
    .toBuffer();
}
const outlined = (x: number, y: number, w: number, h: number, thickness: number, line: string, fill: string): Shape[] => [
  { x, y, w, h, fill: line },
  { x: x + thickness, y: y + thickness, w: w - 2 * thickness, h: h - 2 * thickness, fill },
];
const measure = async (bytes: Uint8Array, contentBounds?: { x: number; y: number; w: number; h: number }) =>
  measureInkPixels(await decodeForLegibility(bytes, contentBounds ? { contentBounds } : {}), "e".repeat(64));
const shareOf = (m: ReturnType<typeof measureInkPixels>, hex: string) => m.clusters.find((c) => c.hex === hex)?.share ?? 0;

describe("measuring pixels", () => {
  it("measures shares, median alpha and edges from pixels, with transparency last", () => {
    // 4×1: two pink, one blue, one transparent pixel.
    const data = new Uint8Array([...[251, 119, 129, 255], ...[251, 119, 129, 255], ...[49, 100, 222, 255], ...[0, 0, 0, 0]]);
    const m = measureInkPixels({ data, width: 4, height: 1 }, "a".repeat(64));
    expect(m.clusters.map((c) => [c.hex, c.share, c.alpha])).toEqual([
      ["#fb7781", 0.6667, 1],
      ["#3164de", 0.3333, 1],
    ]);
    expect(m.edges).toEqual([
      [0, 1, 0],
      [1, 0, 1],
      [0, 1, 0],
    ]);
    expect(m.enclosedEdges).toEqual([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);
    expect(m.approximate).toBe(false);
    expect(m).toMatchObject({ protocol: "ink-legibility-v2", bytesChecksum: "a".repeat(64), sampledWidth: 4, sampledHeight: 1 });
  });

  it("records marks one ink alone surrounds, but not marks open to the garment", () => {
    const m = measureInkPixels(
      paint([".......", ".ppppp.", ".pbppp.", ".pppbp.", ".ppppp.", "......."], { p: "#fb7781", b: "#3164de" }),
      "a".repeat(64),
    );
    expect(m.clusters.map((c) => c.hex)).toEqual(["#fb7781", "#3164de"]);
    // Both blue specks touch only pink, and each shares four edges with it.
    expect(m.edges[0]![1]).toBe(8);
    expect(m.enclosedEdges).toEqual([
      [0, 8, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);
    // A speck at the lettering's edge touches the garment, so it is not inside the shape.
    const open = measureInkPixels(paint([".......", ".ppppb.", ".ppppp.", "......."], { p: "#fb7781", b: "#3164de" }), "a".repeat(64));
    expect(open.enclosedEdges[0]![1]).toBe(0);
  });

  it("measures nothing in a fully transparent file", () => {
    const m = measureInkPixels({ data: new Uint8Array(16), width: 2, height: 2 }, "a".repeat(64));
    expect(m).toMatchObject({ clusters: [], coverage: 0, unmatchedShare: 0, approximate: false, edges: [[0]] });
  });

  it("summarizes a design for ranking: inks with at least 2% of the ink, at most eight", () => {
    // Ten flat inks; the last two cover under 2%.
    const inks = ["#000000", "#ffffff", "#ff0000", "#00a000", "#0000ff", "#ffff00", "#ff00ff", "#00c0c0", "#804000", "#808080"];
    const widths = [30, 25, 20, 20, 18, 16, 14, 12, 2, 2];
    const columns = widths.flatMap((w, i) => Array<number>(w).fill(i));
    const design = analyzeDesign(canvas(columns.length, 20, (x) => inks[columns[x]!]!), "a".repeat(64));
    const { clusters } = design.measurement;
    expect(clusters.length).toBeGreaterThan(SUMMARY_MAXIMUM_COLORS);
    expect(clusters.some((c) => c.share < SUMMARY_MINIMUM_SHARE)).toBe(true);
    expect(design.summary.palette).toEqual(
      clusters
        .filter((c) => c.share >= SUMMARY_MINIMUM_SHARE)
        .slice(0, SUMMARY_MAXIMUM_COLORS)
        .map((c) => ({ hex: c.hex, share: c.share })),
    );
    expect(design.summary.palette).toHaveLength(SUMMARY_MAXIMUM_COLORS);
    expect(design.summary.inkLuminance).toBeGreaterThan(0);
  });
});

describe("the legibility decode contract", () => {
  it("crops to the content bounds plus 1%, then fits inside 1024 px by nearest neighbor", () => {
    expect(legibilitySampling({ width: 4500, height: 4500, oriented: false })).toEqual({
      resize: { width: 1024, height: 1024, fit: "inside", withoutEnlargement: true, kernel: "nearest" },
    });
    expect(
      legibilitySampling({ width: 4500, height: 4500, oriented: false, contentBounds: { x: 0.25, y: 0.3, w: 0.5, h: 0.2 } })
        .extract,
    ).toEqual({ left: 1080, top: 1305, width: 2340, height: 990 });
    // Bounds measured on an oriented image do not apply to the stored pixels.
    expect(
      legibilitySampling({ width: 4500, height: 4500, oriented: true, contentBounds: { x: 0.25, y: 0.3, w: 0.5, h: 0.2 } })
        .extract,
    ).toBeUndefined();
    // Bounds that cover the canvas crop nothing.
    expect(legibilitySampling({ width: 100, height: 100, oriented: false, contentBounds: { x: 0, y: 0, w: 1, h: 1 } }).extract).toBeUndefined();
  });

  it("fails two-tone lettering on pastels and Navy and passes it on Black and True Navy", async () => {
    const pink = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 20 + i * 50, y: 20, w: 30, h: 120, fill: "#fb7781" }));
    const blue = [0, 1].map((i) => ({ x: 340 + i * 60, y: 20, w: 40, h: 130, fill: "#3164de" }));
    const m = await measure(await png(480, 180, [...pink, ...blue]));
    expect(Math.abs(shareOf(m, "#fb7781") - 0.675)).toBeLessThanOrEqual(0.02);
    expect(Math.abs(shareOf(m, "#3164de") - 0.325)).toBeLessThanOrEqual(0.02);
    for (const name of ["Chalky Mint", "Butter", "Orchid", "Lagoon Blue", "Blossom", "Citrus", "Ivory"] as const)
      expect(on(m, name).pass, name).toBe(false);
    for (const name of ["Black", "True Navy"] as const) expect(on(m, name).pass, name).toBe(true);
    expect(on(m, "Navy")).toMatchObject({ pass: false });
    expect(on(m, "Navy").lostShare).toBeCloseTo(0.325, 1);
    // Lettering on transparency has almost none of its edges on other ink.
    expect(on(m, "Butter").inks.find((ink) => ink.hex === "#fb7781")!.framing).toBeLessThanOrEqual(0.2);
  });

  it("keeps a 10 px outline of a 4500 px print file and crops to its content bounds", async () => {
    // A pale panel in a 10 px black outline, holding a block of black lettering.
    const bytes = await png(4500, 4500, [
      ...outlined(1200, 1400, 2000, 1500, 10, "#000000", "#fff7e7"),
      { x: 1500, y: 1800, w: 1400, h: 700, fill: "#000000" },
    ]);
    const m = await measure(bytes);
    expect(m.sampledWidth).toBe(1024);
    expect(shareOf(m, "#000000")).toBeGreaterThan(0);
    const ivory = on(m, "Ivory");
    expect(ivory.pass).toBe(true);
    expect(ivory.inks.find((ink) => ink.hex === "#fff7e7")!.framing).toBeGreaterThanOrEqual(0.9);
    const cropped = await measure(bytes, { x: 1200 / 4500, y: 1400 / 4500, w: 2000 / 4500, h: 1500 / 4500 });
    // Cropping to the content samples it more finely than the whole canvas.
    expect(cropped.sampledWidth).toBeLessThanOrEqual(1024);
    expect(cropped.sampledWidth).toBeGreaterThan(cropped.sampledHeight);
    expect(shareOf(cropped, "#000000")).toBeGreaterThan(0);
    expect(on(cropped, "Ivory").pass).toBe(true);
  });

  it("lays partly transparent ink over the garment before measuring it", async () => {
    const solid = await measure(await png(100, 100, [{ x: 10, y: 10, w: 80, h: 80, fill: "#000000" }]));
    const faded = await measure(await png(100, 100, [{ x: 10, y: 10, w: 80, h: 80, fill: "#000000", opacity: 0.55 }]));
    expect(faded.clusters[0]!.alpha).toBeCloseTo(0.55, 1);
    expect(on(faded, "Ivory").inks[0]!.ratio).toBeLessThan(on(solid, "Ivory").inks[0]!.ratio);
  });

  it("marks gradient art approximate and gives it no framing exception", async () => {
    const defs =
      '<defs><linearGradient id="h" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#ff0000"/><stop offset="0.17" stop-color="#ffff00"/><stop offset="0.33" stop-color="#00ff00"/><stop offset="0.5" stop-color="#00ffff"/><stop offset="0.67" stop-color="#0000ff"/><stop offset="0.83" stop-color="#ff00ff"/><stop offset="1" stop-color="#ff0000"/></linearGradient><linearGradient id="v" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="1"/><stop offset="0.5" stop-color="#808080" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="1"/></linearGradient></defs>';
    const bytes = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">${defs}<rect width="512" height="512" fill="url(#h)"/><rect width="512" height="512" fill="url(#v)"/></svg>`,
      ),
    )
      .png()
      .toBuffer();
    const m = await measure(bytes);
    expect(m.approximate).toBe(true);
    expect(m.unmatchedShare).toBeGreaterThan(0.2);
    for (const name of Object.keys(GARMENTS) as Array<keyof typeof GARMENTS>)
      for (const ink of on(m, name).inks) if (!ink.legible) expect(ink.lost).toBe(true);
  });

  it("measures a design file by its bytes' SHA-256", async () => {
    const bytes = await png(50, 50, [{ x: 5, y: 5, w: 40, h: 40, fill: "#301a10" }]);
    const { hash, analysis, pixels } = await analyzeDesignFile(bytes);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(analysis.measurement.bytesChecksum).toBe(hash);
    expect(pixels).toMatchObject({ width: 50, height: 50 });
    expect(judgeLegibility(analysis.measurement, { colorName: "Ivory", hex: GARMENTS.Ivory }).pass).toBe(true);
  });
});
