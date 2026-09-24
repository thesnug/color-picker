import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { defaultProduct, loadColors } from "../src/data/index.js";

const read = <T>(file: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/jev/${file}`, import.meta.url), "utf8")) as T;

interface Design {
  id: string;
  palette: { hex: string; share: number; element?: string }[];
  description: { subject: string; mood: string; elements: { name: string; color: string; hex: string }[] };
  picks: string[];
}

const { designs } = read<{ designs: Design[] }>("designs.json");
const { swaps } = read<{ swaps: { design: string; element: string; to: string; plausible: boolean }[] }>(
  "recolor-swaps.json",
);

describe("the labeled designs fixture", () => {
  it("holds about 10 designs with unique IDs", () => {
    expect(designs.length).toBeGreaterThanOrEqual(10);
    expect(new Set(designs.map((d) => d.id)).size).toBe(designs.length);
  });

  it("gives each design a palette whose shares sum to 1 and a description tied to it", () => {
    for (const design of designs) {
      const total = design.palette.reduce((sum, c) => sum + c.share, 0);
      expect(total, design.id).toBeCloseTo(1, 5);
      const hexes = new Set(design.palette.map((c) => c.hex));
      for (const c of design.palette) expect(c.hex, design.id).toMatch(/^#[0-9a-f]{6}$/);
      expect(design.description.subject, design.id).not.toBe("");
      expect(design.description.mood, design.id).not.toBe("");
      // The vision pass ties every element to a palette color; the fixture must too.
      for (const e of design.description.elements) expect(hexes.has(e.hex), `${design.id}: ${e.name}`).toBe(true);
    }
  });

  it("only picks stocked garments of the default product, each once", () => {
    const stocked = new Set(defaultProduct().colors.filter((c) => c.available && c.hex).map((c) => c.name));
    for (const design of designs) {
      expect(design.picks.length, design.id).toBeGreaterThanOrEqual(3);
      expect(new Set(design.picks).size, design.id).toBe(design.picks.length);
      expect(design.picks.filter((p) => !stocked.has(p)), design.id).toEqual([]);
    }
  });
});

describe("the labeled recolor swaps fixture", () => {
  it("holds about 20 swaps with both labels represented", () => {
    expect(swaps.length).toBeGreaterThanOrEqual(20);
    expect(swaps.some((s) => s.plausible)).toBe(true);
    expect(swaps.some((s) => !s.plausible)).toBe(true);
  });

  it("names a design, one of its palette elements, and a Wada color for every swap", () => {
    const wada = new Set(loadColors().map((c) => c.name));
    const byId = new Map(designs.map((d) => [d.id, d]));
    const broken = swaps.filter((s) => {
      const design = byId.get(s.design);
      return !design || !design.palette.some((c) => c.element === s.element) || !wada.has(s.to);
    });
    expect(broken).toEqual([]);
  });
});
