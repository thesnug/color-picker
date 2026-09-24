/**
 * Web outputs: a UI theme from a combination, tint and shade ramps, and
 * emitters for CSS custom properties, a Tailwind v4 theme, and W3C design
 * tokens. See docs/DESIGN.md, "Web outputs".
 *
 * The combination supplies background, text, and accent through `roles`.
 * Surface and muted text are derived from them in OKLab and OKLCH, because a
 * book combination has two to four colors and a UI needs more. Every pairing
 * the theme emits is checked against WCAG 2.2 AA for its use.
 */

import {
  type AccessibilityOptions,
  type ApcaLevel,
  apcaLevel,
  type CheckContext,
  type CombinationInput,
  label,
  roles,
  type Swatch,
  type SwatchInput,
  toSwatches,
  type WcagLevel,
  wcagLevel,
} from "./accessibility.js";
import { apcaContrast, contrastRatio } from "./color/contrast.js";
import {
  type ColorInput,
  type Hex,
  oklabToHex,
  oklchToHex,
  type Oklch,
  reduceChroma,
  toHex,
  toOklab,
  toOklch,
} from "./color/convert.js";
import type { RampOptions } from "./color/harmony.js";
import { loadAccessibility } from "./data/index.js";

// ---------------------------------------------------------------------------
// Theme

export type ThemeMode = "light" | "dark";

/** The roles a theme fills, in emit order. */
export const THEME_ROLES = ["background", "surface", "text", "mutedText", "accent", "onAccent"] as const;
export type ThemeRole = (typeof THEME_ROLES)[number];

export interface ThemeColor extends Swatch {
  /**
   * How a color not taken directly from the combination was made, for example
   * "Background shifted lighter". Absent for combination members.
   */
  derived?: string;
}

export interface ThemePairing {
  foreground: ThemeRole;
  background: ThemeRole;
  /** `web-text` needs 4.5:1, `web-ui` (non-text, such as borders and buttons) 3:1. */
  context: Extract<CheckContext, "web-text" | "web-ui">;
  wcag: { ratio: number; level: WcagLevel };
  apca: { lc: number; level: ApcaLevel };
  /** True when the pairing meets WCAG AA for its context. */
  passes: boolean;
}

export interface Theme {
  ok: true;
  mode: ThemeMode;
  colors: Record<ThemeRole, ThemeColor>;
  /** The combination the theme was built from, in its original order. */
  source: Swatch[];
  pairings: ThemePairing[];
  reasons: string[];
}

export type ThemeResult = Theme | { ok: false; mode?: ThemeMode; reasons: string[] };

export interface ThemeOptions extends AccessibilityOptions {
  /** Light or dark UI. When omitted, whichever gives the better text contrast. */
  mode?: ThemeMode;
}

/**
 * WCAG contrast the surface aims for against the background: enough to see a
 * card's edge without a border. Dark mode needs more, since elevation reads as
 * lightness there.
 */
const SURFACE_CONTRAST = { light: 1.08, dark: 1.2 } as const;
/** OKLCH lightness step when searching for the surface. */
const SURFACE_STEP = 0.004;
/** How far muted text mixes toward the background in OKLab at most. */
const MUTED_MIX = 0.6;

/** The pairings a theme is judged on, and the context each must meet. */
const PAIRINGS: readonly [ThemeRole, ThemeRole, ThemePairing["context"]][] = [
  ["text", "background", "web-text"],
  ["text", "surface", "web-text"],
  ["mutedText", "background", "web-text"],
  ["mutedText", "surface", "web-text"],
  ["accent", "background", "web-ui"],
  ["accent", "surface", "web-ui"],
  ["onAccent", "accent", "web-text"],
];

const round = (value: number, places: number) => Number(value.toFixed(places));

/**
 * A UI theme from a combination: background, surface, text, muted text,
 * accent, and a text color for use on the accent.
 *
 * Background, text, and accent come from `roles`. The surface is the
 * background shifted in OKLCH lightness (lighter in dark mode, and in light
 * mode unless the background is already near white) until it reaches a small
 * contrast against the background (1.08:1 light, 1.2:1 dark), stopping early
 * where the text or accent would lose their required contrast against it. Muted text is the text mixed toward the
 * background, as far as it still meets WCAG AA for body text on both. When the
 * combination offers no accent, the text color stands in. On-accent text is
 * whichever of background and text reads better on the accent, or black or
 * white when neither reaches 4.5:1.
 *
 * Returns `{ ok: false, reasons }`, never throws, when no legible assignment
 * exists for the mode.
 */
export function theme(combination: CombinationInput, options: ThemeOptions = {}): ThemeResult {
  const rules = options.rules ?? loadAccessibility();
  const opts: AccessibilityOptions = { rules };
  const assigned = roles(combination, { ...opts, ...(options.mode && { mode: options.mode }) });
  if (!assigned.ok) {
    return options.mode ? { ok: false, mode: options.mode, reasons: assigned.reasons } : assigned;
  }

  const { mode, background, text } = assigned;
  const reasons = [...assigned.reasons];
  const textMin = rules.wcag.body.AA;
  const uiMin = rules.wcag.nonText.AA;

  let accent: ThemeColor;
  if (assigned.accent) {
    accent = assigned.accent;
  } else {
    accent = { ...text, derived: "Text color, because no combination member works as an accent" };
    reasons.push("The text color doubles as the accent.");
  }

  const surface = deriveSurface(background, mode, (hex) =>
    contrastRatio(text.hex, hex) >= textMin && contrastRatio(accent.hex, hex) >= uiMin,
  );
  if (surface.hex === background.hex) {
    reasons.push("The surface matches the background: any shift would cost text or accent contrast.");
  }

  const mutedText = deriveMuted(text, background, (hex) =>
    contrastRatio(hex, background.hex) >= textMin && contrastRatio(hex, surface.hex) >= textMin,
  );
  if (mutedText.hex === text.hex) {
    reasons.push("Muted text matches the text: the text has no contrast to spare.");
  }

  const onAccent = pickOnAccent(accent, [background, text], textMin);

  const colors: Record<ThemeRole, ThemeColor> = { background, surface, text, mutedText, accent, onAccent };
  const pairings = PAIRINGS.map(([fg, bg, context]) => pairing(fg, bg, colors, context, opts));
  const failing = pairings.filter((p) => !p.passes);
  if (failing.length > 0) {
    // The derivations above guarantee each pairing; reaching this is a bug.
    throw new Error(
      `theme: pairing ${failing.map((p) => `${p.foreground} on ${p.background}`).join(", ")} fails WCAG AA`,
    );
  }
  return { ok: true, mode, colors, source: toSwatches(combination), pairings, reasons };
}

function deriveSurface(background: Swatch, mode: ThemeMode, acceptable: (hex: Hex) => boolean): ThemeColor {
  const lch = toOklch(background.hex);
  const target = SURFACE_CONTRAST[mode];
  // Lighter in dark mode; in light mode lighter too, unless there is no room.
  const lighter = mode === "dark" || contrastRatio("#ffffff", background.hex) >= target;
  const direction = lighter ? 1 : -1;
  let best: Hex | undefined;
  // Step away from the background until the target contrast is reached or a
  // constraint fails; the last acceptable step wins.
  for (let shift = SURFACE_STEP; shift <= 0.25; shift += SURFACE_STEP) {
    const l = clamp(lch.l + direction * shift);
    const hex = oklchToHex(reduceChroma({ ...lch, l }));
    if (!acceptable(hex)) break;
    if (hex !== background.hex) best = hex;
    if (contrastRatio(hex, background.hex) >= target || l === 0 || l === 1) break;
  }
  return best
    ? { hex: best, derived: `${background.name ?? "Background"} shifted ${lighter ? "lighter" : "darker"}` }
    : { ...background, derived: "Same as the background" };
}

function deriveMuted(text: Swatch, background: Swatch, acceptable: (hex: Hex) => boolean): ThemeColor {
  const from = toOklab(text.hex);
  const to = toOklab(background.hex);
  let best: Hex = text.hex;
  // Bisect for the largest mix that still passes; contrast falls as the mix grows.
  let lo = 0;
  let hi = MUTED_MIX;
  for (let i = 0; i < 20; i++) {
    const t = (lo + hi) / 2;
    const hex = oklabToHex({
      l: from.l + (to.l - from.l) * t,
      a: from.a + (to.a - from.a) * t,
      b: from.b + (to.b - from.b) * t,
    });
    if (acceptable(hex)) {
      best = hex;
      lo = t;
    } else {
      hi = t;
    }
  }
  return best === text.hex
    ? { ...text, derived: "Same as the text" }
    : { hex: best, derived: `${text.name ?? "Text"} mixed toward the background` };
}

function pickOnAccent(accent: Swatch, candidates: Swatch[], minimum: number): ThemeColor {
  const best = [...candidates].sort((x, y) => contrastRatio(y.hex, accent.hex) - contrastRatio(x.hex, accent.hex))[0]!;
  if (contrastRatio(best.hex, accent.hex) >= minimum) return best;
  const black = "#000000" as Hex;
  const white = "#ffffff" as Hex;
  const hex = contrastRatio(black, accent.hex) >= contrastRatio(white, accent.hex) ? black : white;
  return { hex, name: hex === black ? "Black" : "White", derived: "Neither background nor text reads on the accent" };
}

function pairing(
  foreground: ThemeRole,
  background: ThemeRole,
  colors: Record<ThemeRole, ThemeColor>,
  context: ThemePairing["context"],
  options: AccessibilityOptions,
): ThemePairing {
  const fg = colors[foreground].hex;
  const bg = colors[background].hex;
  const ratio = round(contrastRatio(fg, bg), 2);
  const lc = round(apcaContrast(fg, bg), 1);
  const level = wcagLevel(ratio, context, options);
  return {
    foreground,
    background,
    context,
    wcag: { ratio, level },
    apca: { lc, level: apcaLevel(lc, options) },
    passes: level === "AA" || level === "AAA",
  };
}

const clamp = (l: number) => Math.min(1, Math.max(0, l));

/** A one-line description of a role, for reports: `text: Black (#000000)`. */
export function describeRole(role: ThemeRole, color: ThemeColor): string {
  return `${role}: ${label(color)}${color.derived ? ` — ${color.derived}` : ""}`;
}

// ---------------------------------------------------------------------------
// Ramps

/** The Tailwind step names for an eleven-step ramp. */
export const RAMP_NAMES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"] as const;

export interface RampStep {
  name: string;
  hex: Hex;
  oklch: Oklch;
}

export interface NamedRamp {
  /** The color the ramp was built from. */
  color: Swatch;
  /** The step that holds the input color itself, when one does. */
  anchor?: string;
  /** Lightest first. */
  steps: RampStep[];
}

export interface NamedRampOptions extends RampOptions {
  /**
   * Number of steps, 2 to 19. Default 11, named 50 to 950. Other counts are
   * named at even spacing between 50 and 950, rounded to the nearest 50.
   */
  steps?: number;
}

/**
 * Tints and shades of a color in OKLCH, named in the 50 to 950 convention, for
 * a UI scale. Lightness runs evenly from `lightest` (0.97) to `darkest` (0.25);
 * hue is held constant; chroma is the input's, tapering toward white and black
 * at the ends and reduced further only where sRGB cannot hold it. The step
 * whose lightness is within half a step of the input's is the input color
 * itself, so a Wada color appears exactly in its own scale.
 *
 * `ramp` from the color module is the unnamed primitive: constant chroma,
 * reduced only by the gamut.
 *
 * @throws {RangeError} when `steps` is not an integer from 2 to 19, or the
 * lightness bounds are outside 0 to 1 or out of order.
 */
export function namedRamp(color: SwatchInput, options: NamedRampOptions = {}): NamedRamp {
  const { steps: count = RAMP_NAMES.length, lightest = 0.97, darkest = 0.25 } = options;
  if (!(Number.isInteger(count) && count >= 2 && count <= 19)) {
    throw new RangeError(`steps must be an integer from 2 to 19, got ${count}`);
  }
  if (!(darkest >= 0 && lightest <= 1 && darkest < lightest)) {
    throw new RangeError(`need 0 <= darkest < lightest <= 1, got ${darkest} and ${lightest}`);
  }
  const swatch: Swatch =
    typeof color === "object" && !Array.isArray(color) && "hex" in color
      ? { hex: toHex(color.hex), ...(color.name !== undefined && { name: color.name }) }
      : { hex: toHex(color as ColorInput) };
  const origin = toOklch(swatch.hex);
  const names = rampNames(count);
  const lightness = names.map((_, i) => lightest - ((lightest - darkest) * i) / (count - 1));
  const half = (lightest - darkest) / (count - 1) / 2;

  let nearest = 0;
  lightness.forEach((l, i) => {
    if (Math.abs(l - origin.l) < Math.abs(lightness[nearest]! - origin.l)) nearest = i;
  });
  // The input takes its own step only when that keeps lightness monotonic.
  const anchor = Math.abs(lightness[nearest]! - origin.l) < half ? nearest : -1;

  const steps = names.map((name, i): RampStep => {
    if (i === anchor) return { name, hex: swatch.hex, oklch: origin };
    const l = lightness[i]!;
    const toward = l > origin.l ? (l - origin.l) / (1 - origin.l || 1) : (origin.l - l) / (origin.l || 1);
    const c = origin.c * Math.max(0, 1 - Math.min(1, toward) ** 1.5);
    const lch = reduceChroma({ l, c, h: origin.h });
    return { name, hex: oklchToHex(lch), oklch: lch };
  });
  return anchor >= 0 ? { color: swatch, anchor: names[anchor]!, steps } : { color: swatch, steps };
}

function rampNames(count: number): string[] {
  if (count === RAMP_NAMES.length) return [...RAMP_NAMES];
  return Array.from({ length: count }, (_, i) => String(Math.round((50 + (900 * i) / (count - 1)) / 50) * 50));
}

// ---------------------------------------------------------------------------
// Emitters

export interface EmitOptions {
  /**
   * Also emit a ramp for each color of the source combination, named by its
   * Wada name, or by its hex digits when unnamed. Default true.
   */
  ramps?: boolean;
}

/** Kebab-case CSS names for each role. */
const ROLE_NAMES: Record<ThemeRole, string> = {
  background: "background",
  surface: "surface",
  text: "text",
  mutedText: "text-muted",
  accent: "accent",
  onAccent: "on-accent",
};

/** Kebab-case slug of a color name: `Hermosa Pink` → `hermosa-pink`. */
export function slug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Ramps for the source colors, keyed by a unique slug. */
function sourceRamps(theme: Theme): [string, NamedRamp][] {
  // Design tokens put roles and ramps in the same `color` group. Reserve the
  // role keys for every emitter so a swatch cannot replace a semantic token.
  const used = new Set(Object.values(ROLE_NAMES));
  return theme.source.map((swatch) => {
    const base = (swatch.name && slug(swatch.name)) || swatch.hex.slice(1);
    let key = base;
    for (let n = 2; used.has(key); n++) key = `${base}-${n}`;
    used.add(key);
    return [key, namedRamp(swatch)];
  });
}

/** Every custom property the theme defines, as `[name without --, hex]`. */
function properties(theme: Theme, options: EmitOptions): [string, Hex][] {
  const props: [string, Hex][] = THEME_ROLES.map((role) => [`color-${ROLE_NAMES[role]}`, theme.colors[role].hex]);
  if (options.ramps ?? true) {
    for (const [key, r] of sourceRamps(theme)) {
      for (const step of r.steps) props.push([`color-${key}-${step.name}`, step.hex]);
    }
  }
  return props;
}

function header(theme: Theme): string {
  // Names are public API inputs, not safe CSS comment contents. Keep the
  // source swatches unchanged; only neutralize terminators and line breaks here.
  const names = theme.source
    .map((swatch) => label(swatch).replace(/\*\//g, "* /").replace(/[\r\n\f\u2028\u2029]+/g, " "))
    .join(", ");
  return `/* ${theme.mode} theme from ${names}. Generated by @thesnug/color-picker. */`;
}

export interface CssVariablesOptions extends EmitOptions {
  /** Selector the properties are declared on. Default `:root`. */
  selector?: string;
}

/**
 * CSS custom properties: `--color-background`, `--color-surface`,
 * `--color-text`, `--color-text-muted`, `--color-accent`, `--color-on-accent`,
 * and a `--color-<name>-<step>` ramp for each source color. Sets
 * `color-scheme` to match the mode.
 */
export function toCssVariables(theme: Theme, options: CssVariablesOptions = {}): string {
  const lines = properties(theme, options).map(([name, hex]) => `  --${name}: ${hex};`);
  return `${header(theme)}\n${options.selector ?? ":root"} {\n  color-scheme: ${theme.mode};\n${lines.join("\n")}\n}\n`;
}

/**
 * A Tailwind CSS v4 `@theme` block. The `--color-*` namespace makes every role
 * and ramp step a utility: `bg-background`, `text-text-muted`, `bg-accent`,
 * `text-on-accent`, `border-hermosa-pink-300`.
 * See https://tailwindcss.com/docs/theme.
 */
export function toTailwindTheme(theme: Theme, options: EmitOptions = {}): string {
  const lines = properties(theme, options).map(([name, hex]) => `  --${name}: ${hex};`);
  return `${header(theme)}\n@import "tailwindcss";\n\n@theme {\n${lines.join("\n")}\n}\n`;
}

/** Version of the W3C Design Tokens Community Group format `toDesignTokens` emits. */
export const DESIGN_TOKENS_FORMAT = {
  version: "2025.10",
  format: "https://www.designtokens.org/tr/2025.10/format/",
  color: "https://www.designtokens.org/tr/2025.10/color/",
} as const;

interface ColorToken {
  $value: { colorSpace: "srgb"; components: [number, number, number]; alpha: 1; hex: Hex };
  $description?: string;
}

function colorToken(hex: Hex, description?: string): ColorToken {
  const components = [1, 3, 5].map((i) => round(parseInt(hex.slice(i, i + 2), 16) / 255, 4)) as [
    number,
    number,
    number,
  ];
  return {
    $value: { colorSpace: "srgb", components, alpha: 1, hex },
    ...(description && { $description: description }),
  };
}

/**
 * Design tokens in the W3C Design Tokens Community Group format, version
 * 2025.10 (https://www.designtokens.org/tr/2025.10/format/), with color values
 * as the Color Module defines them (https://www.designtokens.org/tr/2025.10/color/):
 * `{ colorSpace: "srgb", components, alpha, hex }`.
 *
 * Roles sit under `color.<role>`; ramps under `color.<name>.<step>` (with a
 * numeric suffix when the name collides with a role or another ramp). The
 * theme's mode and each pairing's contrast go in `$extensions`.
 */
export function toDesignTokens(theme: Theme, options: EmitOptions = {}): Record<string, unknown> {
  const color: Record<string, unknown> = {
    $type: "color",
    $description: `${theme.mode} theme from ${theme.source.map(label).join(", ")}`,
  };
  for (const role of THEME_ROLES) {
    const c = theme.colors[role];
    color[ROLE_NAMES[role]] = colorToken(c.hex, c.derived ?? c.name);
  }
  if (options.ramps ?? true) {
    for (const [key, r] of sourceRamps(theme)) {
      const group: Record<string, unknown> = r.color.name ? { $description: r.color.name } : {};
      for (const step of r.steps) group[step.name] = colorToken(step.hex);
      color[key] = group;
    }
  }
  return {
    color,
    $extensions: {
      "io.thesnug.color-picker": {
        format: DESIGN_TOKENS_FORMAT.version,
        mode: theme.mode,
        pairings: theme.pairings.map((p) => ({
          foreground: ROLE_NAMES[p.foreground],
          background: ROLE_NAMES[p.background],
          context: p.context,
          wcag: p.wcag,
          apca: p.apca,
        })),
      },
    },
  };
}
