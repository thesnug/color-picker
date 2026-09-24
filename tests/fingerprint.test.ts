import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { distance, toOklch } from "../src/index.js";
import {
  type Decoder,
  extractPalette,
  fingerprint,
  inkLuminance,
  INK_LUMINANCE_EMPTY,
  PALETTE_DEFAULTS,
  sharpDecoder,
} from "../src/fingerprint/index.js";

const FIXTURES = join(import.meta.dirname, "fixtures", "designs");
const FLAT_MARK = join(FIXTURES, "flat-mark.png");
const PHOTO = join(FIXTURES, "photo-square.png");

/** The two colors `scripts/make-design-fixtures.ts` draws the flat mark with. */
const CREAM = "#f3e9d2";
const CORAL = "#e8836b";

let cache: string;
beforeEach(() => {
  cache = mkdtempSync(join(tmpdir(), "fingerprint-test-"));
});
afterEach(() => {
  rmSync(cache, { recursive: true, force: true });
});

/** The sharp decoder, counting how often it runs. */
function countingDecoder(): Decoder & { calls: number } {
  const decode = (async (bytes, options) => {
    decode.calls++;
    return sharpDecoder(bytes, options);
  }) as Decoder & { calls: number };
  decode.calls = 0;
  return decode;
}

/**
 * maker-method-picker's `measureInk`, transcribed with its own luminance
 * formula (WCAG's 0.03928 threshold) and alpha cutoff, as an independent check.
 */
function pickerInk(data: Uint8Array): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  let total = 0;
  let weight = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]! / 255;
    if (alpha <= 0.04) continue;
    total += (0.2126 * lin(data[i]!) + 0.7152 * lin(data[i + 1]!) + 0.0722 * lin(data[i + 2]!)) * alpha;
    weight += alpha;
  }
  return weight ? total / weight : 0.5;
}

describe("fingerprint of the flat two-color mark", () => {
  it("hashes the file bytes and reports size and transparency", async () => {
    const result = await fingerprint(FLAT_MARK, { cache: false });
    const expected = createHash("sha256").update(readFileSync(FLAT_MARK)).digest("hex");
    expect(result.hash).toBe(expected);
    expect(result).toMatchObject({ width: 256, height: 256, hasTransparency: true });
    expect(result.description).toBeUndefined();
  });

  it("finds exactly the two drawn colors despite antialiased edges", async () => {
    const { palette } = await fingerprint(FLAT_MARK, { cache: false });
    expect(palette).toHaveLength(2);
    const [ring, disc] = palette;
    expect(distance(ring!.hex, CORAL)).toBeLessThan(1);
    expect(distance(disc!.hex, CREAM)).toBeLessThan(1);
    // Ring area 100² − 70² against disc area 70²: 51% and 49%.
    expect(ring!.share).toBeCloseTo(0.51, 2);
    expect(disc!.share).toBeCloseTo(0.49, 2);
  });

  it("reports OKLab for the hex it reports", async () => {
    const { palette } = await fingerprint(FLAT_MARK, { cache: false });
    for (const entry of palette) expect(distance(entry.oklab, entry.hex)).toBeLessThan(0.01);
  });

  it("keeps edge blends as entries when blend folding cannot apply", async () => {
    // With merging switched off, antialiasing shows up as extra small clusters.
    const { palette } = await fingerprint(FLAT_MARK, { cache: false, mergeDistance: 0 });
    expect(palette.length).toBeGreaterThan(2);
  });
});

describe("fingerprint of the photographic square", () => {
  it("returns five colors, largest first, covering part of the image", async () => {
    const result = await fingerprint(PHOTO, { cache: false });
    expect(result.hasTransparency).toBe(false);
    expect(result.palette).toHaveLength(5);
    const shares = result.palette.map((p) => p.share);
    expect(shares).toEqual([...shares].sort((a, b) => b - a));
    const sum = shares.reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(0.5);
    expect(sum).toBeLessThanOrEqual(1);
  });

  it("finds the sky blue and a hill green", async () => {
    const { palette } = await fingerprint(PHOTO, { cache: false });
    const hues = palette.map((p) => toOklch(p.hex)).filter((c) => c.c > 0.04).map((c) => c.h);
    expect(hues.some((h) => h > 230 && h < 275)).toBe(true);
    expect(hues.some((h) => h > 120 && h < 150)).toBe(true);
  });

  it("keeps palette colors apart by at least the merge distance", async () => {
    const { palette } = await fingerprint(PHOTO, { cache: false });
    for (const [i, p] of palette.entries()) {
      for (const q of palette.slice(i + 1)) {
        expect(distance(p.oklab, q.oklab)).toBeGreaterThanOrEqual(PALETTE_DEFAULTS.mergeDistance);
      }
    }
  });
});

describe("ink luminance", () => {
  it("matches the picker's measureInk on both fixtures", async () => {
    for (const file of [FLAT_MARK, PHOTO]) {
      const { data } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const result = await fingerprint(file, { cache: false });
      expect(result.inkLuminance).toBeCloseTo(pickerInk(data), 3);
    }
  });

  it("reads the flat mark as light ink", async () => {
    const { inkLuminance: ink } = await fingerprint(FLAT_MARK, { cache: false });
    expect(ink).toBeGreaterThan(0.5);
  });

  it("falls back to 0.5 for an image with nothing visible", () => {
    const pixels = { data: new Uint8Array(4 * 16), width: 4, height: 4 };
    expect(inkLuminance(pixels)).toBe(INK_LUMINANCE_EMPTY);
    expect(extractPalette(pixels)).toEqual([]);
  });
});

describe("formats", () => {
  it("reads lossless WebP to the same colors as the PNG", async () => {
    const png = await fingerprint(FLAT_MARK, { cache: false });
    const webp = await sharp(FLAT_MARK).webp({ lossless: true }).toBuffer();
    const fromWebp = await fingerprint(webp, { cache: false });
    expect(fromWebp.palette.map((p) => p.hex)).toEqual(png.palette.map((p) => p.hex));
  });

  it.each([95, 70])("reads a JPEG at quality %i as white, cream, and coral, with no noise entries", async (quality) => {
    // JPEG has no alpha, so the white background becomes the largest color.
    // White and cream are about 5.5 apart and must stay separate.
    const jpeg = await sharp(FLAT_MARK).flatten({ background: "#ffffff" }).jpeg({ quality }).toBuffer();
    const { palette, hasTransparency } = await fingerprint(jpeg, { cache: false });
    expect(hasTransparency).toBe(false);
    expect(palette).toHaveLength(3);
    expect(distance(palette[0]!.hex, "#ffffff")).toBeLessThan(2);
    // Coral and cream cover almost the same area, so either may come second.
    for (const expected of [CORAL, CREAM]) {
      expect(Math.min(...palette.map((p) => distance(p.hex, expected)))).toBeLessThan(2);
    }
  });

  it("applies EXIF orientation to width and height", async () => {
    const wide = await sharp(PHOTO).resize(200, 100).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const result = await fingerprint(wide, { cache: false });
    expect(result).toMatchObject({ width: 100, height: 200 });
  });

  it("samples large images down to maxDimension but reports their full size", async () => {
    const large = await sharp(PHOTO).resize(1024, 1024, { kernel: "nearest" }).png().toBuffer();
    let sampled = 0;
    const decoder: Decoder = async (bytes, options) => {
      const out = await sharpDecoder(bytes, options);
      sampled = Math.max(out.pixels.width, out.pixels.height);
      return out;
    };
    const result = await fingerprint(large, { cache: false, decoder, maxDimension: 128 });
    expect(sampled).toBe(128);
    expect(result).toMatchObject({ width: 1024, height: 1024 });
  });

  it("rejects other formats", async () => {
    const gif = await sharp(FLAT_MARK).gif().toBuffer();
    await expect(fingerprint(gif, { cache: false })).rejects.toThrow(/PNG, WebP, or JPEG/);
  });
});

describe("cache", () => {
  it("does not decode the image on a repeat call", async () => {
    const decoder = countingDecoder();
    const first = await fingerprint(FLAT_MARK, { cache, decoder });
    const second = await fingerprint(FLAT_MARK, { cache, decoder });
    expect(decoder.calls).toBe(1);
    expect(second).toEqual(first);
    expect(readdirSync(cache).filter((f) => f.startsWith(first.hash))).toHaveLength(1);
  });

  it("keys on settings as well as the file", async () => {
    const decoder = countingDecoder();
    await fingerprint(FLAT_MARK, { cache, decoder });
    await fingerprint(FLAT_MARK, { cache, decoder, colors: 3 });
    await fingerprint(PHOTO, { cache, decoder });
    expect(decoder.calls).toBe(3);
  });

  it("recomputes over a corrupt cache file", async () => {
    const decoder = countingDecoder();
    const first = await fingerprint(FLAT_MARK, { cache, decoder });
    for (const f of readdirSync(cache)) writeFileSync(join(cache, f), "{ not json");
    expect(await fingerprint(FLAT_MARK, { cache, decoder })).toEqual(first);
    expect(decoder.calls).toBe(2);
  });

  it("skips the cache when it is false", async () => {
    const decoder = countingDecoder();
    await fingerprint(FLAT_MARK, { cache: false, decoder });
    await fingerprint(FLAT_MARK, { cache: false, decoder });
    expect(decoder.calls).toBe(2);
  });
});
