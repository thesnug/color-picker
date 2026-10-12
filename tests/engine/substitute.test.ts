import { describe, expect, it } from "vitest";

import { planLegibleInkOptions, RecolorPigmentError, substitutePigments } from "../../src/engine/index.js";
import { garments, twoTone } from "./helpers.js";

const pixels = (...rows: number[][]) => ({ data: new Uint8Array(rows.flat()), width: rows.length, height: 1 });
const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

describe("substitutePigments", () => {
  it("recolors exactly the measured pigment with the planned tolerance, keeping alpha", () => {
    const input = pixels([251, 119, 129, 255], [49, 100, 222, 255], [251, 119, 129, 128], [0, 0, 0, 0]);
    const [plan] = planLegibleInkOptions({ measurement: twoTone, garments, families: ["light"] });
    const { pixels: out, changed } = substitutePigments(input, plan!);
    const to = rgb(plan!.replacements[0]!.to);
    expect([...out.data.subarray(0, 4)]).toEqual([...to, 255]);
    expect([...out.data.subarray(4, 8)]).toEqual([49, 100, 222, 255]);
    expect([...out.data.subarray(8, 12)]).toEqual([...to, 128]);
    expect([...out.data.subarray(12, 16)]).toEqual([0, 0, 0, 0]);
    expect(changed).toBe(2);
    // The input is untouched.
    expect([...input.data.subarray(0, 4)]).toEqual([251, 119, 129, 255]);
  });

  it("weights the unmatched share by alpha, so near-transparent residue barely counts", () => {
    const plan = { replacements: [{ from: "#808080", to: "#204060", tolerance: 6 }] };
    // One opaque ink pixel, and three residue pixels of another color at alpha 3.
    const residue = [255, 0, 0, 3];
    const { unmatched, changed } = substitutePigments(pixels([128, 128, 128, 255], residue, residue, residue), plan);
    expect(changed).toBe(1);
    expect(unmatched).toBe(Number((9 / 264).toFixed(4)));
    // An opaque pixel no pigment reaches counts in full.
    expect(substitutePigments(pixels([128, 128, 128, 255], [0, 255, 0, 255]), plan).unmatched).toBe(0.5);
  });

  it("keeps a pixel's offset from its pigment within tolerance, so shading survives", () => {
    const plan = { replacements: [{ from: "#808080", to: "#204060", tolerance: 6 }] };
    const { pixels: out } = substitutePigments(pixels([133, 128, 124, 255]), plan);
    expect([...out.data]).toEqual([0x20 + 5, 0x40, 0x60 - 4, 255]);
  });

  it("carries a lighter or darker edge tint of one pigment just outside its tolerance", () => {
    const plan = { replacements: [{ from: "#c84020", to: "#2040c8", tolerance: 4 }] };
    // Halfway toward white: an antialiased edge on a light background.
    const edge = [0xc8 + (255 - 0xc8) / 2, 0x40 + (255 - 0x40) / 2, 0x20 + (255 - 0x20) / 2].map(Math.round);
    const { pixels: out, changed } = substitutePigments(pixels([...edge, 255], [0x10, 0xf0, 0x10, 255]), plan);
    expect(changed).toBe(1);
    expect([...out.data.subarray(0, 3)]).toEqual(edge.map((v, k) => Math.max(0, Math.min(255, rgb("#2040c8")[k]! + v - rgb("#c84020")[k]!))));
    // Another color is not a tint of the pigment and stays.
    expect([...out.data.subarray(4, 8)]).toEqual([0x10, 0xf0, 0x10, 255]);
  });

  it("refuses overlapping pigment ranges with POD's message", () => {
    const plan = {
      replacements: [
        { from: "#808080", to: "#000000", tolerance: 10 },
        { from: "#868686", to: "#ffffff", tolerance: 10 },
      ],
    };
    const attempt = () => substitutePigments(pixels([130, 130, 130, 255]), plan);
    expect(attempt).toThrow(RecolorPigmentError);
    expect(attempt).toThrow("Recolor pigment ranges overlap; review a narrower plan.");
    try {
      attempt();
    } catch (error) {
      expect((error as RecolorPigmentError).code).toBe("overlap");
    }
  });

  it("refuses a pigment the artwork does not contain with POD's message", () => {
    const plan = { replacements: [{ from: "#00ff00", to: "#003300", tolerance: 10 }] };
    const attempt = () => substitutePigments(pixels([251, 119, 129, 255], [0, 255, 0, 0]), plan);
    expect(attempt).toThrow("Recolor pigment is absent from the approved artwork.");
    try {
      attempt();
    } catch (error) {
      expect(error).toMatchObject({ code: "absent", name: "RecolorPigmentError" });
    }
  });
});
