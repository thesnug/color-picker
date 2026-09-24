import { describe, expect, it } from "vitest";

import { nameKey, nearest, resolveName } from "../src/index.js";
import { loadColorNames, loadColors } from "../src/data/index.js";

const colors = loadColors();
const indexes = (r: ReturnType<typeof nearest>) => r.matches.map((m) => m.color.index);

describe("nearest by hex", () => {
  it("returns an exact Wada hex at distance 0", () => {
    for (const c of colors) {
      const [first] = nearest(c.hex).matches;
      expect(first?.color.index).toBe(c.index);
      expect(first?.distance).toBe(0);
    }
  });

  it("returns three matches by default, sorted ascending", () => {
    const r = nearest("#ffb3f0");
    expect(r.resolved).toEqual({ via: "hex", hex: "#ffb3f0" });
    expect(indexes(r)).toEqual([1, 2, 3]);
    const distances = r.matches.map((m) => m.distance);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it("accepts short hex without a hash, and other color inputs", () => {
    expect(nearest("fff").matches[0]?.color.name).toBe("White");
    expect(nearest([0, 0, 0]).resolved).toEqual({ via: "color", hex: "#000000" });
    expect(nearest({ l: 0, c: 0, h: 0 }).matches[0]?.color.name).toBe("Black");
  });

  it("finds the book's neutrals near a mid-gray", () => {
    // The book's grays are tinted, so pure OKLab distance ranks Andover Green
    // (6.2) just ahead of Deep Violet, the Plumbeous gray (7.1), for #808080.
    const r = nearest("#808080");
    expect(r.matches.some((m) => m.color.neutral)).toBe(true);
    expect(nearest("#777777").matches[0]?.color).toMatchObject({ name: "Deep Violet", neutral: true });
    expect(nearest("#808080", { within: 10 }).matches.filter((m) => m.color.neutral).length).toBeGreaterThan(0);
  });
});

describe("options", () => {
  it("honors k", () => {
    expect(nearest("#ffb3f0", { k: 1 }).matches).toHaveLength(1);
    expect(nearest("#ffb3f0", { k: 500 }).matches).toHaveLength(colors.length);
  });

  it("returns everything within a distance when only within is given", () => {
    const r = nearest("#ffb3f0", { within: 12 });
    expect(r.matches.length).toBeGreaterThan(3);
    expect(r.matches.every((m) => m.distance <= 12)).toBe(true);
    const all = nearest("#ffb3f0", { k: 500 }).matches.filter((m) => m.distance <= 12);
    expect(indexes(r)).toEqual(all.map((m) => m.color.index));
  });

  it("applies k and within together", () => {
    expect(nearest("#ffb3f0", { within: 8, k: 2 }).matches).toHaveLength(2);
  });

  it("explains an empty result from within", () => {
    const r = nearest("#00ff00", { within: 0.5 });
    expect(r.matches).toEqual([]);
    expect(r.reason).toMatch(/No color within 0\.5 of #00ff00/);
  });

  it("searches caller-supplied colors", () => {
    const pinks = colors.filter((c) => c.index <= 3);
    expect(indexes(nearest("#000000", { colors: pinks }))).toHaveLength(3);
  });

  it("rejects invalid options", () => {
    expect(() => nearest("#fff", { k: 0 })).toThrow(RangeError);
    expect(() => nearest("#fff", { k: 1.5 })).toThrow(RangeError);
    expect(() => nearest("#fff", { within: -1 })).toThrow(RangeError);
  });
});

describe("nearest by name", () => {
  it("resolves Wada names regardless of case and punctuation", () => {
    for (const name of ["Hermosa Pink", "hermosa-pink", "HERMOSA_PINK", "hermosapink"]) {
      const r = nearest(name);
      expect(r.resolved).toEqual({ via: "wada", hex: "#ffb3f0", name: "Hermosa Pink" });
      expect(r.matches[0]).toMatchObject({ color: { index: 1 }, distance: 0 });
    }
  });

  it("resolves Wada aliases and source spellings", () => {
    expect(resolveName("Sulfur Yellow")?.name).toBe("Sulphur Yellow");
    expect(resolveName("Vanderpoel's Blue")?.name).toBe("Vandar Poel's Blue");
    expect(resolveName("Calamine BLue")?.name).toBe("Calamine Blue");
    expect(resolveName("Tobacco")?.name).toBe("Mars Brown");
  });

  it("resolves a name shared by variants to the first variant", () => {
    expect(resolveName("Eugenia Red")?.name).toBe("Eugenia Red A");
    expect(resolveName("Eugenia Red B")?.name).toBe("Eugenia Red B");
  });

  it("falls back to CSS named colors, then xkcd names", () => {
    expect(resolveName("rebeccapurple")).toEqual({ via: "css", hex: "#663399", name: "rebeccapurple" });
    expect(resolveName("Rebecca Purple")?.via).toBe("css");
    // CSS wins over xkcd's "dark green".
    expect(resolveName("dark green")).toMatchObject({ via: "css", hex: "#006400" });
    expect(resolveName("dusty rose")).toEqual({ via: "xkcd", hex: "#c0737a", name: "dusty rose" });
  });

  it("treats grey and gray alike", () => {
    expect(resolveName("Grayish Lavender")).toEqual(resolveName("Greyish Lavender"));
    expect(resolveName("blue gray")).toEqual({ via: "xkcd", hex: "#607c8e", name: "blue grey" });
  });

  it("returns an empty result with a reason for unknown names, never throwing", () => {
    for (const name of ["not a real color", "", "   ", "#abcd", "💜"]) {
      const r = nearest(name);
      expect(r.matches).toEqual([]);
      expect(r.resolved).toBeUndefined();
      expect(r.reason).toMatch(/Unknown color name/);
    }
  });
});

describe("name dictionaries", () => {
  it("cite their source and license", () => {
    for (const source of ["css", "xkcd"] as const) {
      const file = loadColorNames(source);
      expect(file.source).toMatch(/https:\/\//);
      expect(file.license).toMatch(/https:\/\//);
      expect(file.colors.every((c) => /^#[0-9a-f]{6}$/.test(c.hex))).toBe(true);
    }
    expect(loadColorNames("css").colors).toHaveLength(148);
    expect(loadColorNames("xkcd").colors).toHaveLength(949);
  });

  it("normalizes name keys", () => {
    expect(nameKey("Robin's Egg / Blue")).toBe("robinseggblue");
    expect(nameKey("Greyish-Green")).toBe("grayishgreen");
  });
});
