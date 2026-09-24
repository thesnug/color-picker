import { describe, expect, it } from "vitest";

import {
  contrastRatio,
  DESIGN_TOKENS_FORMAT,
  namedRamp,
  RAMP_NAMES,
  slug,
  type Theme,
  theme,
  THEME_ROLES,
  toCssVariables,
  toDesignTokens,
  toOklch,
  toTailwindTheme,
} from "../src/index.js";
import { loadColors, loadCombinations } from "../src/data/index.js";
import { renderHtml, renderThemePreview } from "../src/render/index.js";

const NAVY = { hex: "#1a1a40", name: "Navy" };
const CREAM = { hex: "#f2e8cf", name: "Cream" };
const RUST = { hex: "#c74300", name: "Rust" };

function ok(result: ReturnType<typeof theme>): Theme {
  if (!result.ok) throw new Error(result.reasons.join(" "));
  return result;
}

/** The contrast each role pairing must meet, checked here independently of the module. */
const REQUIRED: [string, string, number][] = [
  ["text", "background", 4.5],
  ["text", "surface", 4.5],
  ["mutedText", "background", 4.5],
  ["mutedText", "surface", 4.5],
  ["accent", "background", 3],
  ["accent", "surface", 3],
  ["onAccent", "accent", 4.5],
];

describe("theme", () => {
  it("assigns every role from a combination", () => {
    const t = ok(theme([NAVY, CREAM, RUST], { mode: "light" }));
    expect(t.mode).toBe("light");
    expect(t.colors.background.hex).toBe("#f2e8cf");
    expect(t.colors.text.hex).toBe("#1a1a40");
    expect(t.colors.accent.hex).toBe("#c74300");
    expect(t.colors.surface.derived).toMatch(/Cream shifted/);
    expect(t.colors.mutedText.derived).toMatch(/Navy mixed toward the background/);
    expect(Object.keys(t.colors)).toEqual([...THEME_ROLES]);
  });

  it("flips background and text for dark mode", () => {
    const t = ok(theme([NAVY, CREAM, RUST], { mode: "dark" }));
    expect(t.colors.background.hex).toBe("#1a1a40");
    expect(t.colors.text.hex).toBe("#f2e8cf");
    // Elevation reads as lightness in dark mode.
    expect(toOklch(t.colors.surface.hex).l).toBeGreaterThan(toOklch(t.colors.background.hex).l);
  });

  it("gives muted text less contrast than text, and a visible surface", () => {
    const t = ok(theme(["#ffffff", "#000000"], { mode: "dark" }));
    expect(contrastRatio(t.colors.mutedText.hex, t.colors.background.hex)).toBeLessThan(
      contrastRatio(t.colors.text.hex, t.colors.background.hex),
    );
    expect(contrastRatio(t.colors.surface.hex, t.colors.background.hex)).toBeGreaterThanOrEqual(1.2);
  });

  it("uses the text color as the accent when the combination has none", () => {
    const t = ok(theme(["#ffffff", "#000000"]));
    expect(t.colors.accent.hex).toBe(t.colors.text.hex);
    expect(t.colors.onAccent.hex).toBe(t.colors.background.hex);
    expect(t.reasons).toContain("The text color doubles as the accent.");
  });

  it("reports pairings with WCAG and APCA levels", () => {
    const t = ok(theme([NAVY, CREAM, RUST], { mode: "light" }));
    expect(t.pairings.map((p) => `${p.foreground}/${p.background}`)).toEqual(REQUIRED.map(([f, b]) => `${f}/${b}`));
    const text = t.pairings[0]!;
    expect(text).toMatchObject({ context: "web-text", passes: true, wcag: { level: "AAA" } });
    expect(text.apca.level).toBe("body-preferred");
    expect(t.pairings.find((p) => p.foreground === "accent")!.context).toBe("web-ui");
  });

  it("returns an error object, not a throw, when nothing is legible", () => {
    const result = theme(["#ffb3f0", "#ffcfc4"], { mode: "light" });
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ mode: "light" });
    expect(result.reasons[0]).toMatch(/No pair of colors for light mode reaches WCAG AA/);
  });

  it("meets WCAG AA for every emitted pairing across the book's combinations", () => {
    let built = 0;
    for (const combination of loadCombinations()) {
      for (const mode of ["light", "dark"] as const) {
        const result = theme(combination, { mode });
        if (!result.ok) continue;
        built++;
        expect(result.mode).toBe(mode);
        for (const [fg, bg, minimum] of REQUIRED) {
          const ratio = contrastRatio(
            result.colors[fg as keyof Theme["colors"]].hex,
            result.colors[bg as keyof Theme["colors"]].hex,
          );
          expect(ratio, `combination ${combination.id} ${mode}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(minimum);
        }
        expect(result.pairings.every((p) => p.passes)).toBe(true);
      }
    }
    // A sanity floor: many book combinations are pastel and have no legible pair.
    expect(built).toBeGreaterThan(250);
  });
});

describe("namedRamp", () => {
  it("names eleven steps 50 to 950 and holds the input at its own step", () => {
    const r = namedRamp(RUST);
    expect(r.steps.map((s) => s.name)).toEqual([...RAMP_NAMES]);
    expect(r.anchor).toBe("600");
    expect(r.steps.find((s) => s.name === "600")!.hex).toBe("#c74300");
    expect(r.color).toEqual(RUST);
  });

  it("is monotonic in lightness for every Wada color", () => {
    for (const color of loadColors()) {
      const r = namedRamp(color);
      const lightness = r.steps.map((s) => toOklch(s.hex).l);
      for (let i = 1; i < lightness.length; i++) {
        expect(lightness[i]!, `${color.name} ${r.steps[i]!.name}`).toBeLessThan(lightness[i - 1]!);
      }
    }
  });

  it("holds hue and tapers chroma toward the ends", () => {
    const r = namedRamp("#3b82f6");
    const origin = toOklch("#3b82f6");
    const chroma = r.steps.map((s) => s.oklch.c);
    const peak = chroma.indexOf(Math.max(...chroma));
    for (const step of r.steps) {
      if (step.oklch.c > 0.02) expect(Math.abs(step.oklch.h - origin.h)).toBeLessThan(0.5);
    }
    expect(chroma[0]!).toBeLessThan(chroma[peak]! / 3);
    expect(chroma[chroma.length - 1]!).toBeLessThan(chroma[peak]!);
  });

  it("names other step counts at even spacing", () => {
    expect(namedRamp("#3b82f6", { steps: 5 }).steps.map((s) => s.name)).toEqual(["50", "300", "500", "750", "950"]);
    expect(() => namedRamp("#3b82f6", { steps: 1 })).toThrow(RangeError);
    expect(() => namedRamp("#3b82f6", { steps: 20 })).toThrow(RangeError);
    expect(() => namedRamp("#3b82f6", { lightest: 0.2, darkest: 0.5 })).toThrow(RangeError);
  });

  it("omits the anchor when the input is darker than the darkest step", () => {
    expect(namedRamp("#000000").anchor).toBeUndefined();
  });
});

describe("emitters", () => {
  const t = ok(theme([NAVY, CREAM, RUST], { mode: "light" }));

  it("slugs names", () => {
    expect(slug("Hermosa Pink")).toBe("hermosa-pink");
    expect(slug("Vinaceous-Tawny ")).toBe("vinaceous-tawny");
  });

  it("emits CSS custom properties for roles and ramps", () => {
    const css = toCssVariables(t);
    expect(css).toContain(":root {\n  color-scheme: light;\n");
    expect(css).toContain("--color-background: #f2e8cf;");
    expect(css).toContain("--color-text-muted: ");
    expect(css).toContain("--color-on-accent: ");
    expect(css).toContain("--color-rust-600: #c74300;");
    expect(css.match(/--color-navy-\d+:/g)).toHaveLength(11);
    expect(toCssVariables(t, { ramps: false, selector: ".card" })).not.toContain("--color-navy-50");
    expect(toCssVariables(t, { selector: "[data-theme=light]" })).toContain("[data-theme=light] {");
  });

  it("emits a Tailwind v4 @theme block", () => {
    const tw = toTailwindTheme(t);
    expect(tw).toContain('@import "tailwindcss";');
    expect(tw).toMatch(/@theme \{\n {2}--color-background: #f2e8cf;/);
    expect(tw).toContain("--color-cream-50: ");
  });

  it("emits W3C design tokens in the 2025.10 format", () => {
    const tokens = toDesignTokens(t) as {
      color: Record<string, any>;
      $extensions: Record<string, any>;
    };
    expect(DESIGN_TOKENS_FORMAT.version).toBe("2025.10");
    expect(tokens.color.$type).toBe("color");
    expect(tokens.color.background.$value).toEqual({
      colorSpace: "srgb",
      components: [0.949, 0.9098, 0.8118],
      alpha: 1,
      hex: "#f2e8cf",
    });
    expect(tokens.color["text-muted"].$description).toMatch(/mixed toward/);
    expect(tokens.color.rust["600"].$value.hex).toBe("#c74300");
    for (const step of Object.values(tokens.color.navy).filter((v): v is any => typeof v === "object")) {
      for (const c of step.$value.components) expect(c).toBeGreaterThanOrEqual(0);
    }
    const ext = tokens.$extensions["io.thesnug.color-picker"];
    expect(ext).toMatchObject({ format: "2025.10", mode: "light" });
    expect(ext.pairings[0]).toMatchObject({ foreground: "text", background: "background" });
  });

  it("gives duplicate names unique ramp keys", () => {
    const dup = ok(theme([{ hex: "#000000", name: "Ink" }, { hex: "#ffffff", name: "Ink" }]));
    const css = toCssVariables(dup);
    expect(css).toContain("--color-ink-50:");
    expect(css).toContain("--color-ink-2-50:");
  });
});

describe("renderThemePreview", () => {
  it("draws a sample UI per mode and explains a mode that failed", () => {
    const light = theme([NAVY, CREAM, RUST], { mode: "light" });
    const failed = theme(["#ffb3f0", "#ffcfc4"], { mode: "dark" });
    const html = renderThemePreview([light, failed]);
    expect(html).toContain("--tp-background:#f2e8cf");
    expect(html).toContain("<button");
    expect(html).toContain('class="card"');
    expect(html).toContain("Dark mode");
    expect(html).toContain("No pair of colors for dark mode");
  });

  it("goes in an HTML page as a section without SVG", () => {
    const page = renderHtml([{ title: "Sample", html: renderThemePreview([theme([NAVY, CREAM])]) }]);
    expect(page).toContain('<section><h2>Sample</h2><div class="themes">');
    expect(page).not.toContain('<div class="svg">');
  });
});
