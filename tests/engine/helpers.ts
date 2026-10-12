/**
 * Shared synthetic designs and garments for the engine tests. Every design is
 * drawn from shapes; none is production artwork. The cases are the ones POD's
 * `ink-legibility-v2` tests pinned before the port, unchanged.
 */

import { type InkMeasurement, judgeLegibility, LEGIBILITY_PROTOCOL } from "../../src/engine/index.js";

/** Comfort Colors 1717 garment hexes, as POD's reviewed palette and this package store them. */
export const GARMENTS = {
  "Chalky Mint": "#a7dcd4",
  Butter: "#f5e1a4",
  Orchid: "#cbb3cc",
  "Lagoon Blue": "#89e4ed",
  Violet: "#a88fd7",
  "Island Green": "#54b188",
  "Neon Lemon": "#c9db78",
  Bay: "#aeb5ac",
  Blossom: "#f8d1e2",
  Citrus: "#ffc86e",
  Ivory: "#fff7e7",
  White: "#e7e7ea",
  Black: "#1f1d1e",
  Navy: "#3b4153",
  "True Navy": "#1c1b32",
} as const;
export type GarmentName = keyof typeof GARMENTS;
export const garments = Object.entries(GARMENTS).map(([colorName, hex]) => ({ colorName, hex }));
export const on = (m: InkMeasurement, name: GarmentName) => judgeLegibility(m, { colorName: name, hex: GARMENTS[name] });

/**
 * A synthetic measurement. `edges` lists [ink, ink or 'T', count] pairs; the matrix is
 * symmetric with transparency last, as measureInkPixels returns it. `enclosed` lists
 * [surrounding ink, enclosed ink, count]: that many of the pair's edges belong to marks of the
 * second ink that the first alone surrounds.
 */
export function measurement(
  inks: Array<[hex: string, share: number]>,
  edges: Array<[number, number | "T", number]>,
  options: { approximate?: boolean; alpha?: number; enclosed?: Array<[number, number, number]> } = {},
): InkMeasurement {
  const t = inks.length;
  const zero = () => Array.from({ length: t + 1 }, () => new Array<number>(t + 1).fill(0));
  const matrix = zero();
  for (const [a, b, count] of edges) {
    const j = b === "T" ? t : b;
    matrix[a]![j]! += count;
    matrix[j]![a]! += count;
  }
  const enclosedEdges = zero();
  for (const [a, b, count] of options.enclosed ?? []) enclosedEdges[a]![b]! += count;
  return {
    protocol: LEGIBILITY_PROTOCOL,
    bytesChecksum: "f".repeat(64),
    sampledWidth: 1024,
    sampledHeight: 1024,
    coverage: options.approximate ? 0.7 : 1,
    unmatchedShare: 0,
    approximate: !!options.approximate,
    clusters: inks.map(([hex, share]) => ({ hex, share, alpha: options.alpha ?? 1, spread: 3 })),
    edges: matrix,
    enclosedEdges,
  };
}

const rgba = (hex: string, alpha = 255) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).concat(alpha);

/** Raw RGBA pixels painted from rows of ink letters; `.` is transparent. */
export function paint(rows: string[], inks: Record<string, string>) {
  const width = rows[0]!.length;
  const data = new Uint8Array(width * rows.length * 4);
  rows.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c === ".") return;
      data.set(rgba(inks[c]!), (y * width + x) * 4);
    }),
  );
  return { data, width, height: rows.length };
}

/** A width×height canvas painted by `ink(x, y)`, which returns a hex or null (transparent). */
export function canvas(width: number, height: number, ink: (x: number, y: number) => string | null) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const hex = ink(x, y);
      if (!hex) continue;
      data.set(rgba(hex), (y * width + x) * 4);
    }
  return { data, width, height };
}

// Two-tone lettering: pink (68% of the ink) mostly against transparency, a blue accent (32%)
// touching it a little.
export const twoTone = measurement(
  [
    ["#fb7781", 0.675],
    ["#3164de", 0.325],
  ],
  [
    [0, "T", 9000],
    [1, "T", 5000],
    [0, 1, 800],
  ],
);
// The same inks with the pink lettering drawn inside a blue outline.
export const pinkInBlueOutline = measurement(
  [
    ["#fb7781", 0.675],
    ["#3164de", 0.325],
  ],
  [
    [0, 1, 9000],
    [0, "T", 300],
    [1, "T", 9500],
  ],
);
// Black lettering (85%) with an orange accent (15%) on transparency.
export const blackLettering = measurement(
  [
    ["#000000", 0.851],
    ["#c94100", 0.149],
  ],
  [
    [0, "T", 12000],
    [1, "T", 1500],
    [0, 1, 900],
  ],
);
// A cream fill drawn inside dark linework, with dark greens; the linework's outer edges touch
// transparency.
export const creamInLinework = measurement(
  [
    ["#ebd2ab", 0.365],
    ["#301a10", 0.206],
    ["#2c472a", 0.175],
    ["#385634", 0.155],
    ["#3d2a1c", 0.099],
  ],
  [
    [0, 1, 6000],
    [0, 4, 2500],
    [0, 2, 400],
    [0, "T", 200],
    [1, "T", 6500],
    [2, "T", 3000],
    [3, "T", 2800],
    [4, "T", 1500],
    [2, 3, 2000],
    [1, 2, 900],
  ],
);

export const LIGHT_PASTELS: GarmentName[] = [
  "Chalky Mint",
  "Butter",
  "Orchid",
  "Lagoon Blue",
  "Violet",
  "Neon Lemon",
  "Island Green",
  "Bay",
  "Blossom",
  "Citrus",
  "Ivory",
];

/**
 * A full-color illustration: a cream figure inside dark brown linework with a green apron,
 * and two rows of red and navy lettering, each letter with a cream border inside a dark brown
 * outline. On light garments the cream is under 3:1 but framed by the linework; on dark ones
 * the linework and navy are, framed by the cream.
 */
export const OUTLINED_ILLUSTRATION_INKS = {
  cream: "#efe6cf",
  brown: "#3a2418",
  green: "#3a6e2c",
  red: "#c8372d",
  navy: "#24325a",
} as const;

const inside = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) =>
  x >= x0 && x <= x1 && y >= y0 && y <= y1;

export function outlinedIllustrationPixels() {
  const ink = OUTLINED_ILLUSTRATION_INKS;
  return canvas(96, 96, (x, y) => {
    if (inside(x, y, 36, 22, 59, 47)) return ink.green;
    if (inside(x, y, 17, 5, 78, 54)) return ink.cream;
    if (inside(x, y, 16, 4, 79, 55)) return ink.brown;
    for (const [top, fill] of [
      [60, ink.red],
      [78, ink.navy],
    ] as const) {
      if (y < top || y > top + 13 || x < 4 || (x - 4) % 10 > 7 || x > 91) continue;
      const left = 4 + Math.floor((x - 4) / 10) * 10;
      if (inside(x, y, left + 2, top + 2, left + 5, top + 11)) return fill;
      if (inside(x, y, left + 1, top + 1, left + 6, top + 12)) return ink.cream;
      return ink.brown;
    }
    return null;
  });
}
