import { describe, expect, it } from "vitest";

import {
  analogous,
  APCA,
  apcaContrast,
  complementary,
  contrastRatio,
  distance,
  gamutMap,
  hexToOklab,
  hexToOklch,
  hexToRgb,
  inGamut,
  isHex,
  linearChannelToSrgb,
  linearToOklab,
  normalizeHex,
  oklabToHex,
  oklabToLinear,
  oklabToOklch,
  oklchToHex,
  oklchToOklab,
  ramp,
  relativeLuminance,
  rgbToHex,
  rgbToLinear,
  simulateCvd,
  splitComplementary,
  srgbChannelToLinear,
  toOklab,
  toOklch,
  triadic,
  type Oklch,
} from "../src/index.js";
import { loadColors } from "../src/data/index.js";

const hueDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

describe("hex", () => {
  it("normalizes hex colors", () => {
    expect(normalizeHex("#FFB3F0")).toBe("#ffb3f0");
    expect(normalizeHex("abc")).toBe("#aabbcc");
    expect(() => normalizeHex("not a color")).toThrow(TypeError);
    expect(isHex("#abc")).toBe(true);
    expect(isHex("#abcd")).toBe(false);
  });

  it("converts between hex and sRGB", () => {
    expect(hexToRgb("#ffb3f0")).toEqual([255, 179, 240]);
    expect(rgbToHex([255, 179, 240])).toBe("#ffb3f0");
    expect(rgbToHex([300, -4, 127.6])).toBe("#ff0080");
  });
});

describe("sRGB transfer", () => {
  it("matches reference values", () => {
    expect(srgbChannelToLinear(0.5)).toBeCloseTo(0.214041, 6);
    expect(linearChannelToSrgb(0.5)).toBeCloseTo(0.735357, 6);
    expect(srgbChannelToLinear(0.04)).toBeCloseTo(0.04 / 12.92, 10);
  });

  it("round-trips every 8-bit value", () => {
    for (let v = 0; v <= 255; v++) {
      expect(linearChannelToSrgb(srgbChannelToLinear(v / 255)) * 255).toBeCloseTo(v, 9);
    }
  });
});

describe("OKLab and OKLCH", () => {
  // Reference values for the sRGB primaries from Ottosson's OKLab post and CSS Color 4.
  it("matches published values for the sRGB primaries", () => {
    const red = hexToOklab("#ff0000");
    expect(red.l).toBeCloseTo(0.62796, 4);
    expect(red.a).toBeCloseTo(0.22486, 4);
    expect(red.b).toBeCloseTo(0.12585, 4);

    const green = hexToOklab("#00ff00");
    expect(green.l).toBeCloseTo(0.86644, 4);
    expect(green.a).toBeCloseTo(-0.23389, 4);
    expect(green.b).toBeCloseTo(0.1795, 4);

    const blue = hexToOklch("#0000ff");
    expect(blue.l).toBeCloseTo(0.45201, 4);
    expect(blue.c).toBeCloseTo(0.31321, 4);
    expect(blue.h).toBeCloseTo(264.052, 2);

    const redLch = hexToOklch("#ff0000");
    expect(redLch.c).toBeCloseTo(0.25768, 4);
    expect(redLch.h).toBeCloseTo(29.2339, 3);
  });

  it("maps white to L 1 and grays to chroma 0 with hue 0", () => {
    const white = hexToOklch("#ffffff");
    expect(white.l).toBeCloseTo(1, 6);
    expect(white.c).toBeCloseTo(0, 6);
    expect(white.h).toBe(0);
    expect(hexToOklch("#808080").h).toBe(0);
    expect(hexToOklab("#000000")).toEqual({ l: 0, a: 0, b: 0 });
  });

  it("round-trips linear RGB through OKLab", () => {
    const lin = rgbToLinear([12, 200, 99]);
    const back = oklabToLinear(linearToOklab(lin));
    // Ottosson's published matrices carry ten digits, so round trips hold to about 1e-7.
    back.forEach((v, i) => expect(v).toBeCloseTo(lin[i]!, 6));
  });

  it("round-trips OKLab through OKLCH", () => {
    const lab = { l: 0.6, a: -0.05, b: 0.12 };
    const back = oklchToOklab(oklabToOklch(lab));
    expect(back.l).toBeCloseTo(lab.l, 12);
    expect(back.a).toBeCloseTo(lab.a, 12);
    expect(back.b).toBeCloseTo(lab.b, 12);
  });

  it("round-trips every Wada hex through OKLab and OKLCH", () => {
    for (const c of loadColors()) {
      expect(oklabToHex(hexToOklab(c.hex))).toBe(c.hex);
      expect(oklchToHex(hexToOklch(c.hex))).toBe(c.hex);
    }
  });

  it("agrees with the precomputed values in the derived data", () => {
    for (const c of loadColors()) {
      const lab = hexToOklab(c.hex);
      expect(lab.l).toBeCloseTo(c.oklab.l, 5);
      expect(lab.a).toBeCloseTo(c.oklab.a, 5);
      expect(lab.b).toBeCloseTo(c.oklab.b, 5);
    }
  });

  it("accepts hex, sRGB, OKLab, and OKLCH input", () => {
    const lab = hexToOklab("#3b82f6");
    const lch = oklabToOklch(lab);
    for (const input of ["#3b82f6", [59, 130, 246] as const, lab, lch]) {
      const got = toOklab(input);
      expect(got.l).toBeCloseTo(lab.l, 10);
      expect(got.a).toBeCloseTo(lab.a, 10);
      expect(got.b).toBeCloseTo(lab.b, 10);
    }
    expect(toOklch(lch)).toBe(lch);
  });
});

describe("gamut", () => {
  const vivid: Oklch = { l: 0.7, c: 0.4, h: 150 };

  it("detects out-of-gamut colors", () => {
    expect(inGamut("#00ff00")).toBe(true);
    expect(inGamut(hexToOklch("#00ff00"))).toBe(true);
    expect(inGamut(vivid)).toBe(false);
  });

  it("maps into sRGB by reducing chroma, holding lightness and hue close", () => {
    const mapped = gamutMap(vivid);
    expect(inGamut(mapped)).toBe(true);
    expect(mapped.c).toBeLessThan(vivid.c);
    // CSS Color 4 accepts a final clip within one JND (0.02), so L and h drift slightly.
    expect(Math.abs(mapped.l - vivid.l)).toBeLessThan(0.02);
    expect(hueDiff(mapped.h, vivid.h)).toBeLessThan(5);
  });

  it("leaves in-gamut colors alone and sends extreme lightness to white or black", () => {
    const inside = hexToOklch("#3b82f6");
    expect(gamutMap(inside)).toBe(inside);
    expect(gamutMap({ l: 1.2, c: 0.1, h: 30 })).toEqual({ l: 1, c: 0, h: 0 });
    expect(gamutMap({ l: -0.1, c: 0.1, h: 30 })).toEqual({ l: 0, c: 0, h: 0 });
  });

  it("offers per-channel clipping as an option", () => {
    const mapped = oklchToHex(vivid);
    const clipped = oklchToHex(vivid, { gamut: "clip" });
    expect(mapped).toMatch(/^#[0-9a-f]{6}$/);
    expect(clipped).toMatch(/^#[0-9a-f]{6}$/);
    expect(clipped).not.toBe(mapped);
  });
});

describe("distance", () => {
  it("is 0 for identical colors and symmetric", () => {
    expect(distance("#3b82f6", "#3B82F6")).toBe(0);
    expect(distance("#ff0000", "#00ff00")).toBeCloseTo(distance("#00ff00", "#ff0000"), 12);
  });

  it("puts black to white at 100", () => {
    expect(distance("#000000", "#ffffff")).toBeCloseTo(100, 5);
  });

  it("uses a scale where about 2 is just noticeable", () => {
    // One 8-bit step of mid-gray is well below a JND.
    expect(distance("#808080", "#818181")).toBeLessThan(1);
    // OKLab distance between the reference primaries, scaled by 100.
    const r = hexToOklab("#ff0000");
    const g = hexToOklab("#00ff00");
    expect(distance("#ff0000", "#00ff00")).toBeCloseTo(100 * Math.hypot(r.l - g.l, r.a - g.a, r.b - g.b), 10);
  });
});

describe("WCAG 2.x", () => {
  it("computes relative luminance", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 10);
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#808080")).toBeCloseTo(0.21586, 5);
    expect(relativeLuminance("#ff0000")).toBeCloseTo(0.2126, 10);
  });

  it("computes contrast ratio", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 10);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 10);
    expect(contrastRatio("#3b82f6", "#3b82f6")).toBe(1);
    // #767676 is the lightest gray that passes AA (4.5) on white; #777777 fails.
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
});

describe("APCA", () => {
  it("uses the 0.0.98G-4g constants", () => {
    expect(APCA.normBG).toBe(0.56);
    expect(APCA.blkThrs).toBe(0.022);
  });

  // Reference pairs from the apca-w3 0.1.9 test suite (test/index.js), text first.
  it.each([
    ["#888", "#fff", 63.056469930209424],
    ["#fff", "#888", -68.54146436644962],
    ["#000", "#aaa", 58.146262578561334],
    ["#aaa", "#000", -56.24113336839742],
    ["#123", "#def", 91.66830811481631],
    ["#def", "#123", -93.06770049484275],
    ["#123", "#444", 8.32326136957393],
    ["#444", "#123", -7.526878460278154],
  ])("Lc of %s on %s is %d", (text, background, expected) => {
    expect(apcaContrast(text, background)).toBeCloseTo(expected, 10);
  });

  it("returns 0 for identical colors", () => {
    expect(apcaContrast("#777", "#777")).toBe(0);
  });
});

describe("color-vision-deficiency simulation", () => {
  const all = ["protan", "deutan", "tritan"] as const;

  it("leaves neutrals unchanged", () => {
    for (const d of all) {
      for (const gray of ["#000000", "#808080", "#ffffff"]) {
        expect(distance(simulateCvd(gray, d), gray)).toBeLessThan(1);
      }
    }
  });

  it("keeps Viénot's blue and yellow anchors fixed for protan and deutan", () => {
    for (const d of ["protan", "deutan"] as const) {
      expect(simulateCvd("#0000ff", d)).toBe("#0000ff");
      expect(simulateCvd("#ffff00", d)).toBe("#ffff00");
    }
  });

  it("collapses the classic confusion pairs", () => {
    // Red and green land on the same yellow hue; protans also see red darker.
    for (const d of ["protan", "deutan"] as const) {
      const red = hexToOklch(simulateCvd("#ff0000", d));
      const green = hexToOklch(simulateCvd("#00a000", d));
      expect(hueDiff(red.h, green.h)).toBeLessThan(1);
    }
    expect(distance(simulateCvd("#ff0000", "deutan"), simulateCvd("#00a000", "deutan"))).toBeLessThan(5);
    const blueGreen = distance("#0000ff", "#00a000");
    const simulated = distance(simulateCvd("#0000ff", "tritan"), simulateCvd("#00a000", "tritan"));
    expect(simulated).toBeLessThan(blueGreen / 2);
  });

  it("returns hex and matches pinned outputs", () => {
    // Regression values from this implementation of the libDaltonLens matrices.
    expect(simulateCvd("#ff0000", "protan")).toBe("#5e5e0d");
    expect(simulateCvd("#ff0000", "deutan")).toBe("#939300");
    expect(simulateCvd("#ff0000", "tritan")).toBe("#ff004e");
    expect(simulateCvd("#b3a1e6", "tritan")).toBe("#a8adaf");
  });
});

describe("harmonies", () => {
  const base = "#8a6fb0";
  const lch = hexToOklch(base);

  it("rotates hue for complementary, split-complementary, triadic, and analogous", () => {
    const cases: [Oklch[], number[]][] = [
      [complementary(base), [0, 180]],
      [splitComplementary(base), [0, 150, 210]],
      [splitComplementary(base, 20), [0, 160, 200]],
      [triadic(base), [0, 120, 240]],
      [analogous(base), [-30, 0, 30]],
    ];
    for (const [colors, offsets] of cases) {
      expect(colors).toHaveLength(offsets.length);
      colors.forEach((c, i) => {
        expect(inGamut(c)).toBe(true);
        expect(hueDiff(c.h, lch.h + offsets[i]!)).toBeLessThan(1e-9);
        expect(c.l).toBeCloseTo(lch.l, 10);
      });
    }
  });

  it("returns copies of a neutral", () => {
    for (const c of triadic("#808080")) {
      expect(oklchToHex(c)).toBe("#808080");
    }
  });

  it("builds a lightness ramp, lightest first, all in gamut, with exact lightness and hue", () => {
    const r = ramp("#3b82f6");
    expect(r).toHaveLength(9);
    expect(r[0]!.l).toBeCloseTo(0.97, 10);
    expect(r[8]!.l).toBeCloseTo(0.25, 10);
    for (const c of r) expect(c.h).toBeCloseTo(hexToOklch("#3b82f6").h, 10);
    for (let i = 1; i < r.length; i++) {
      expect(r[i]!.l).toBeLessThan(r[i - 1]!.l);
      expect(inGamut(r[i]!)).toBe(true);
    }
    const custom = ramp("#3b82f6", { steps: 3, lightest: 0.9, darkest: 0.5 });
    custom.forEach((c, i) => expect(c.l).toBeCloseTo([0.9, 0.7, 0.5][i]!, 10));
  });

  it("rejects bad ramp options", () => {
    expect(() => ramp("#3b82f6", { steps: 1 })).toThrow(RangeError);
    expect(() => ramp("#3b82f6", { lightest: 1.5 })).toThrow(RangeError);
  });
});
