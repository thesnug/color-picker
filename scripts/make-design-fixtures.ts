/**
 * Generate the sample designs in tests/fixtures/designs/ used by the
 * fingerprint tests. Both images are synthetic so the repo carries no
 * third-party artwork; the PNGs are committed and this script only needs to run
 * again when a fixture should change.
 *
 *   npx tsx scripts/make-design-fixtures.ts
 *
 * - `flat-mark.png`: a flat two-color mark on a transparent background, cream
 *   (#f3e9d2) disc with a coral (#e8836b) ring. Edges are antialiased at 4x4
 *   supersampling, so the file holds partial alpha and cream-to-coral blends,
 *   the pixels that must not become palette entries.
 * - `photo-square.png`: an opaque photographic-style scene with smooth
 *   gradients and per-pixel noise: sky, sun, two hills, and a lake. It stands in
 *   for a photo, which has no flat colors at all.
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "tests", "fixtures", "designs");
const SIZE = 256;

type Rgba = [number, number, number, number];

/** Seeded PRNG (mulberry32) so the fixtures are reproducible. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function write(name: string, pixel: (x: number, y: number) => Rgba, samples = 1) {
  const data = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // Average straight-alpha samples weighted by alpha, as a renderer does.
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const p = pixel(x + (sx + 0.5) / samples, y + (sy + 0.5) / samples);
          r += p[0] * p[3];
          g += p[1] * p[3];
          b += p[2] * p[3];
          a += p[3];
        }
      }
      const i = (y * SIZE + x) * 4;
      data[i] = a ? Math.round(r / a) : 0;
      data[i + 1] = a ? Math.round(g / a) : 0;
      data[i + 2] = a ? Math.round(b / a) : 0;
      data[i + 3] = Math.round((255 * a) / (samples * samples));
    }
  }
  await sharp(data, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, name));
}

function flatMark(x: number, y: number): Rgba {
  const d = Math.hypot(x - SIZE / 2, y - SIZE / 2);
  if (d <= 70) return [0xf3, 0xe9, 0xd2, 1];
  if (d <= 100) return [0xe8, 0x83, 0x6b, 1];
  return [0, 0, 0, 0];
}

function photoSquare(seed: number): (x: number, y: number) => Rgba {
  const rand = random(seed);
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i]! - v) * t);
  const noise = () => (rand() - 0.5) * 18;
  return (x, y) => {
    const u = x / SIZE;
    const v = y / SIZE;
    let c: number[];
    const hillFar = 0.55 + 0.06 * Math.sin(u * 7.1 + 0.4);
    const hillNear = 0.68 + 0.08 * Math.sin(u * 4.3 + 2.1);
    if (v > 0.84) {
      // Lake: darker reflected sky with ripples.
      c = mix([60, 96, 128], [30, 52, 74], (v - 0.84) / 0.16);
      c = c.map((ch) => ch + 10 * Math.sin(y * 1.7 + u * 3));
    } else if (v > hillNear) {
      c = mix([74, 110, 52], [38, 62, 30], (v - hillNear) / (0.84 - hillNear));
    } else if (v > hillFar) {
      c = mix([112, 138, 96], [84, 112, 72], (v - hillFar) / (hillNear - hillFar));
    } else {
      // Sky from deep blue to a warm horizon, with a sun and its glow.
      c = mix([54, 104, 178], [236, 196, 150], v / hillFar);
      const sun = Math.hypot(u - 0.72, v - 0.3);
      if (sun < 0.07) c = [255, 244, 214];
      else c = mix(c, [255, 226, 170], Math.max(0, 0.5 - sun * 2.2));
    }
    return [c[0]! + noise(), c[1]! + noise(), c[2]! + noise(), 1].map((ch, i) =>
      i === 3 ? ch : Math.min(255, Math.max(0, ch)),
    ) as Rgba;
  };
}

mkdirSync(OUT, { recursive: true });
await write("flat-mark.png", flatMark, 4);
await write("photo-square.png", photoSquare(1717));
console.log(`Wrote fixtures to ${OUT}`);
