import { describe, expect, it } from "vitest";

import { allowsDarkInk, apcaLevel, check, roles, toSwatches, wcagLevel } from "../src/index.js";
import { loadAccessibility, loadCombinations } from "../src/data/index.js";

const WHITE = "#ffffff";
const BLACK = "#000000";

describe("accessibility asset", () => {
  const rules = loadAccessibility();

  it("carries a source for every threshold group", () => {
    const groups = [
      rules.wcag,
      rules.wcag.body,
      rules.wcag.large,
      rules.wcag.nonText,
      rules.apca,
      rules.print.minimumDistance,
      rules.print.darkInkGarmentLuminance,
      rules.print.underbase,
      rules.cvd,
    ];
    for (const group of groups) expect(group.source).toMatch(/^https:\/\//);
  });

  it("holds the WCAG 2.2 and APCA numbers", () => {
    expect(rules.wcag.body).toMatchObject({ AA: 4.5, AAA: 7 });
    expect(rules.wcag.large).toMatchObject({ AA: 3, AAA: 4.5 });
    expect(rules.wcag.nonText).toMatchObject({ AA: 3, AAA: null });
    expect(rules.apca.body).toMatchObject({ minimum: 75, preferred: 90 });
    expect(rules.apca.large.minimum).toBe(45);
    expect(rules.apca.nonText.minimum).toBe(30);
    expect(rules.cvd.simulations).toEqual(["protan", "deutan", "tritan"]);
  });
});

describe("levels", () => {
  it("grades WCAG ratios by context", () => {
    expect(wcagLevel(21, "web-text")).toBe("AAA");
    expect(wcagLevel(4.5, "web-text")).toBe("AA");
    expect(wcagLevel(3.2, "web-text")).toBe("AA-large");
    expect(wcagLevel(2.9, "web-text")).toBe("fail");
    expect(wcagLevel(3.2, "web-ui")).toBe("AA");
    expect(wcagLevel(2.9, "web-ui")).toBe("fail");
  });

  it("grades APCA Lc in either polarity", () => {
    expect(apcaLevel(106)).toBe("body-preferred");
    expect(apcaLevel(-80)).toBe("body");
    expect(apcaLevel(50)).toBe("large");
    expect(apcaLevel(-10)).toBe("fail");
  });
});

describe("check", () => {
  it("passes black and white at AAA in both orders", () => {
    const result = check([BLACK, WHITE], { context: "web-text" });
    expect(result.pairs).toHaveLength(2);
    for (const pair of result.pairs) {
      expect(pair.wcag).toEqual({ ratio: 21, level: "AAA" });
      expect(pair.apca.level).toBe("body-preferred");
      expect(pair.passes).toBe(true);
    }
    // APCA is polar: dark on light is positive, light on dark negative.
    expect(result.pairs[0]!.apca.lc).toBeGreaterThan(0);
    expect(result.pairs[1]!.apca.lc).toBeLessThan(0);
    expect(result.passes).toBe(true);
    expect(result.cvdSafe).toBe(true);
  });

  it("puts the WCAG AA boundary between #767676 and #777777 on white", () => {
    const pass = check(["#767676", WHITE], { context: "web-text" }).pairs[0]!;
    const fail = check(["#777777", WHITE], { context: "web-text" }).pairs[0]!;
    expect(pass.wcag.level).toBe("AA");
    expect(pass.passes).toBe(true);
    expect(fail.wcag.level).toBe("AA-large");
    expect(fail.passes).toBe(false);
    expect(fail.reasons[0]).toBe(
      "#777777 on #ffffff: contrast 4.48:1 meets WCAG AA for large text only; APCA Lc 71.1 is enough for short content text, not body text.",
    );
  });

  it("fails pale text for web text but passes it for interface elements at 3:1", () => {
    const colors = ["#949494", WHITE];
    expect(check(colors, { context: "web-text" }).passes).toBe(false);
    expect(check(colors, { context: "web-ui" }).passes).toBe(true);
    expect(check(colors, { context: "web-text" }).reasons[0]).toBe(
      "No foreground and background pairing meets WCAG AA for text.",
    );
  });

  it("flags print colors that are too close together", () => {
    const result = check([{ hex: "#1f3b73", name: "Navy" }, { hex: "#223d78", name: "Almost Navy" }, WHITE], {
      context: "print",
    });
    const close = result.pairs.filter((p) => p.tooClose);
    expect(close).toHaveLength(2);
    expect(close[0]!.reasons[1]).toMatch(/^Navy \(#1f3b73\) on Almost Navy \(#223d78\): distance .* below the print minimum of 10/);
    expect(result.passes).toBe(false);
    expect(result.reasons[0]).toBe("1 pair of colors is too close to print distinctly.");
  });

  it("reports tooClose only for print", () => {
    const [web] = check([BLACK, WHITE], { context: "web-ui" }).pairs;
    const [print] = check([BLACK, WHITE], { context: "print" }).pairs;
    expect(web).not.toHaveProperty("tooClose");
    expect(print).toMatchObject({ tooClose: false, passes: true });
  });

  it("catches a red and green that are distinct normally but collapse with deuteranopia", () => {
    const result = check(
      [
        { hex: "#d62728", name: "Red" },
        { hex: "#2ca02c", name: "Green" },
      ],
      { context: "print" },
    );
    expect(result.passes).toBe(true);
    expect(result.cvdSafe).toBe(false);

    const byDeficiency = Object.fromEntries(result.cvd.map((r) => [r.deficiency, r]));
    expect(byDeficiency.protan!.collapsed).toHaveLength(0);
    expect(byDeficiency.tritan!.collapsed).toHaveLength(0);
    expect(byDeficiency.deutan!.collapsed).toHaveLength(1);

    const collapse = byDeficiency.deutan!.collapsed[0]!;
    expect(collapse.normalDistance).toBeGreaterThan(30);
    expect(collapse.distance).toBeLessThan(10);
    expect(byDeficiency.deutan!.reasons[0]).toMatch(
      /^With deuteranopia, Red \(#d62728\) and Green \(#2ca02c\) collapse to distance \d/,
    );
    expect(result.reasons[1]).toBe("Some colors become hard to tell apart with deuteranopia.");
  });

  it("resolves a book combination to named Wada colors", () => {
    const combination = loadCombinations().find((c) => c.size === 3)!;
    const result = check(combination, { context: "web-text" });
    expect(result.colors).toHaveLength(3);
    for (const color of result.colors) expect(color.name).toBeTruthy();
    expect(result.pairs).toHaveLength(6);
  });

  it("reports rather than throws for a single color", () => {
    const result = check([WHITE], { context: "web-text" });
    expect(result.passes).toBe(false);
    expect(result.pairs).toHaveLength(0);
    expect(result.reasons[0]).toMatch(/at least two colors/);
  });

  it("throws on a combination index that does not exist", () => {
    expect(() => toSwatches({ colors: [9999] })).toThrow(RangeError);
  });
});

describe("roles", () => {
  it("assigns text, background, and the most chromatic qualifying accent", () => {
    const result = roles([
      { hex: "#fbf7ef", name: "Cream" },
      { hex: "#1c1c1c", name: "Ink" },
      { hex: "#c8102e", name: "Red" },
      { hex: "#b8b8b8", name: "Pale Gray" },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.background.name).toBe("Cream");
    expect(result.text.name).toBe("Ink");
    expect(result.accent?.name).toBe("Red");
    expect(result.mode).toBe("light");
    expect(result.contrast.text.wcag.level).toBe("AAA");
    expect(result.contrast.accent!.wcag.ratio).toBeGreaterThanOrEqual(3);
  });

  it("honors dark mode", () => {
    const result = roles([WHITE, "#111111", "#ffcc00"], { mode: "dark" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.background.hex).toBe("#111111");
    expect(result.mode).toBe("dark");
    expect(result.accent?.hex).toBe("#ffcc00");
  });

  it("omits the accent with a reason when no remaining color reaches 3:1", () => {
    const result = roles([WHITE, BLACK, "#f0f0f0"], { mode: "light" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.accent).toBeUndefined();
    expect(result.reasons[1]).toBe("No other color reaches 3:1 against the background, so there is no accent.");
  });

  it("reports when no legible assignment exists", () => {
    const result = roles(["#d62728", "#2ca02c", "#e0443a"]);
    expect(result).toEqual({
      ok: false,
      reasons: [
        "No pair of colors reaches WCAG AA contrast for body text (4.5:1), so no legible text and background assignment exists.",
      ],
    });
  });

  it("finds a legible assignment for most book combinations of three or more", () => {
    const combinations = loadCombinations().filter((c) => c.size >= 3);
    const legible = combinations.filter((c) => roles(c).ok).length;
    expect(legible / combinations.length).toBeGreaterThan(0.5);
  });
});

describe("allowsDarkInk", () => {
  it("uses the garment luminance cutoff", () => {
    expect(allowsDarkInk(WHITE)).toBe(true);
    expect(allowsDarkInk(BLACK)).toBe(false);
    expect(allowsDarkInk("#1f3b73")).toBe(false);
    expect(allowsDarkInk("#e8d8b8")).toBe(true);
  });
});
