/**
 * Generate the synthetic print files in tests/fixtures/engine/ that the engine
 * fixtures are recorded from (`scripts/record-engine-fixtures.ts`). Every file
 * is drawn here from shapes, so the public repo carries no production artwork;
 * POD vendors these files and the recorded outputs for its drift test. The PNGs
 * are committed, and this script only needs to run again when a fixture should
 * change (which changes the recorded outputs too).
 *
 *   npx tsx scripts/make-engine-fixtures.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import type { ContentBounds } from "../src/engine/index.js";

const here = dirname(fileURLToPath(import.meta.url));
export const ENGINE_FIXTURES = join(here, "..", "tests", "fixtures", "engine");

type Rgba = readonly [number, number, number, number];
/** The ink at a point of the canvas, or null for transparency. */
type Paint = (x: number, y: number) => Rgba | null;

const hex = (value: string, alpha = 255): Rgba => [
  Number.parseInt(value.slice(1, 3), 16),
  Number.parseInt(value.slice(3, 5), 16),
  Number.parseInt(value.slice(5, 7), 16),
  alpha,
];

/** Render a canvas, averaging `samples`² straight-alpha samples per pixel so curved edges are antialiased. */
function render(width: number, height: number, paint: Paint, samples = 1): Buffer {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const p = paint(x + (sx + 0.5) / samples, y + (sy + 0.5) / samples);
          if (!p) continue;
          r += p[0] * p[3];
          g += p[1] * p[3];
          b += p[2] * p[3];
          a += p[3];
        }
      }
      const i = (y * width + x) * 4;
      data[i] = a ? Math.round(r / a) : 0;
      data[i + 1] = a ? Math.round(g / a) : 0;
      data[i + 2] = a ? Math.round(b / a) : 0;
      data[i + 3] = Math.round(a / (samples * samples));
    }
  }
  return data;
}

const inRect = (x: number, y: number, left: number, top: number, w: number, h: number) =>
  x >= left && x < left + w && y >= top && y < top + h;

/** A deterministic hash of a pixel and a channel to [0, 1), the same on every platform. */
function noise(x: number, y: number, k: number): number {
  let h = Math.imul(Math.floor(x) + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(Math.floor(y) + 0x7f4a7c15, 0xc2b2ae35);
  h = Math.imul(h ^ Math.imul(k + 1, 0x27d4eb2f), 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 0x100000000;
}

/**
 * An ink as a distressed screen print carries it: about a third of its pixels a little
 * lighter or darker in each channel (up to 14), one in twelve worn through to transparency,
 * and one in twenty half-transparent.
 */
function distressed(value: string, x: number, y: number): Rgba | null {
  const [r, g, b] = hex(value);
  const wear = noise(x, y, 0);
  if (wear < 1 / 12) return null;
  const alpha = wear < 1 / 12 + 1 / 20 ? 100 + Math.floor(noise(x, y, 1) * 100) : 255;
  if (noise(x, y, 2) > 1 / 3) return [r, g, b, alpha];
  const shift = (c: number, k: number) => Math.max(0, Math.min(255, c + Math.round((noise(x, y, k) * 2 - 1) * 14)));
  return [shift(r, 3), shift(g, 4), shift(b, 5), alpha];
}

/** The near-transparent residue export tools leave around art: alpha 1 to 6, any color, on half the canvas. */
function residue(x: number, y: number): Rgba | null {
  if (noise(x, y, 6) < 0.5) return null;
  return [Math.floor(noise(x, y, 7) * 256), Math.floor(noise(x, y, 8) * 256), Math.floor(noise(x, y, 9) * 256), 1 + Math.floor(noise(x, y, 10) * 6)];
}

interface Fixture {
  file: string;
  description: string;
  width: number;
  height: number;
  paint: Paint;
  samples?: number;
  contentBounds: ContentBounds | null;
}

export const FIXTURES: Fixture[] = [
  {
    file: "two-tone-lettering.png",
    description:
      "Six pink letter strokes and two blue accents apart on transparency: the pink is under 3:1 on pastels and the blue on Navy.",
    width: 480,
    height: 180,
    paint: (x, y) => {
      for (let i = 0; i < 6; i++) if (inRect(x, y, 20 + i * 50, 20, 30, 120)) return hex("#fb7781");
      for (let i = 0; i < 2; i++) if (inRect(x, y, 340 + i * 60, 20, 40, 130)) return hex("#3164de");
      return null;
    },
    contentBounds: null,
  },
  {
    file: "outlined-fill.png",
    description: "A cream disc inside a dark brown ring: the cream vanishes on light garments but the ring frames it.",
    width: 200,
    height: 200,
    samples: 4,
    paint: (x, y) => {
      const r = Math.hypot(x - 100, y - 100);
      return r < 70 ? hex("#ebd2ab") : r < 82 ? hex("#301a10") : null;
    },
    contentBounds: null,
  },
  {
    file: "bare-fill.png",
    description: "The same cream disc with no outline: lost on light garments.",
    width: 200,
    height: 200,
    samples: 4,
    paint: (x, y) => (Math.hypot(x - 100, y - 100) < 80 ? hex("#ebd2ab") : null),
    contentBounds: null,
  },
  {
    file: "outlined-panels.png",
    description: "Cream panels outlined in dark browns beside dark green leaves.",
    width: 460,
    height: 160,
    paint: (x, y) => {
      const panel = (left: number, line: string) =>
        inRect(x, y, left, 10, 140, 140) ? (inRect(x, y, left + 18, 28, 104, 104) ? "#ebd2ab" : line) : null;
      const ink = panel(10, "#301a10") ?? panel(170, "#3d2a1c");
      if (ink) return hex(ink);
      if (inRect(x, y, 330, 10, 60, 140)) return hex("#2c472a");
      if (inRect(x, y, 400, 10, 50, 140)) return hex("#385634");
      return null;
    },
    contentBounds: null,
  },
  {
    file: "black-lettering-accent.png",
    description: "Black letter blocks with orange inlays: legible on light garments, lost on dark ones.",
    width: 480,
    height: 200,
    paint: (x, y) => {
      for (let i = 0; i < 4; i++) {
        if (inRect(x, y, 40 + i * 110, 60, 50, 43)) return hex("#c94100");
        if (inRect(x, y, 20 + i * 110, 20, 90, 160)) return hex("#000000");
      }
      return null;
    },
    contentBounds: null,
  },
  {
    file: "faded-ink.png",
    description: "A black square at 55% opacity: laid over the garment it reads more faintly than solid black.",
    width: 100,
    height: 100,
    paint: (x, y) => (inRect(x, y, 10, 10, 80, 80) ? hex("#000000", 140) : null),
    contentBounds: null,
  },
  {
    file: "wide-outlined-panel.png",
    description:
      "A 2400 px canvas with a pale panel in an 8 px black outline holding black lettering, measured with its content bounds: wider than 1024 px, so sampling and cropping are exercised.",
    width: 2400,
    height: 2400,
    paint: (x, y) => {
      if (!inRect(x, y, 600, 700, 1100, 800)) return null;
      if (!inRect(x, y, 608, 708, 1084, 784)) return hex("#000000");
      if (inRect(x, y, 800, 950, 700, 300)) return hex("#000000");
      return hex("#fff7e7");
    },
    contentBounds: { x: 600 / 2400, y: 700 / 2400, w: 1100 / 2400, h: 800 / 2400 },
  },
  {
    file: "distressed-lettering.png",
    description:
      "The two-tone lettering distressed: a third of each ink's pixels shifted up to 14 per channel, worn and half-transparent pixels, and alpha 1 to 6 residue of any color over half the canvas. Every pixel of a replaced ink must change, and the residue must not count against a recolor.",
    width: 480,
    height: 180,
    paint: (x, y) => {
      for (let i = 0; i < 6; i++) if (inRect(x, y, 20 + i * 50, 20, 30, 120)) return distressed("#fb7781", x, y) ?? residue(x, y);
      for (let i = 0; i < 2; i++) if (inRect(x, y, 340 + i * 60, 20, 40, 130)) return distressed("#3164de", x, y) ?? residue(x, y);
      return residue(x, y);
    },
    contentBounds: null,
  },
];

/** What `tests/fixtures/engine/manifest.json` lists, and POD's drift test reads. */
export interface FixtureManifest {
  product: string;
  /** The assortment size artwork options are planned for. */
  colorCount: number;
  fixtures: { file: string; expected: string; description: string; contentBounds: ContentBounds | null }[];
}

export const MANIFEST: FixtureManifest = {
  product: "comfort-colors-1717",
  colorCount: 8,
  fixtures: FIXTURES.map((f) => ({
    file: f.file,
    expected: f.file.replace(/\.png$/, ".expected.json"),
    description: f.description,
    contentBounds: f.contentBounds,
  })),
};

async function main() {
  mkdirSync(ENGINE_FIXTURES, { recursive: true });
  for (const f of FIXTURES) {
    const data = render(f.width, f.height, f.paint, f.samples ?? 1);
    await sharp(data, { raw: { width: f.width, height: f.height, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toFile(join(ENGINE_FIXTURES, f.file));
  }
  writeFileSync(join(ENGINE_FIXTURES, "manifest.json"), `${JSON.stringify(MANIFEST, null, 2)}\n`);
  console.log(`Wrote ${FIXTURES.length} fixtures and manifest.json to ${ENGINE_FIXTURES}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
