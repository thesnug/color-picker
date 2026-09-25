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
import { type AccessibilityOptions, type ApcaLevel, type CheckContext, type CombinationInput, type Swatch, type SwatchInput, type WcagLevel } from "./accessibility.js";
import { type Hex, type Oklch } from "./color/convert.js";
import type { RampOptions } from "./color/harmony.js";
export type ThemeMode = "light" | "dark";
/** The roles a theme fills, in emit order. */
export declare const THEME_ROLES: readonly ["background", "surface", "text", "mutedText", "accent", "onAccent"];
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
    wcag: {
        ratio: number;
        level: WcagLevel;
    };
    apca: {
        lc: number;
        level: ApcaLevel;
    };
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
export type ThemeResult = Theme | {
    ok: false;
    mode?: ThemeMode;
    reasons: string[];
};
export interface ThemeOptions extends AccessibilityOptions {
    /** Light or dark UI. When omitted, whichever gives the better text contrast. */
    mode?: ThemeMode;
}
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
export declare function theme(combination: CombinationInput, options?: ThemeOptions): ThemeResult;
/** A one-line description of a role, for reports: `text: Black (#000000)`. */
export declare function describeRole(role: ThemeRole, color: ThemeColor): string;
/** The Tailwind step names for an eleven-step ramp. */
export declare const RAMP_NAMES: readonly ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
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
export declare function namedRamp(color: SwatchInput, options?: NamedRampOptions): NamedRamp;
export interface EmitOptions {
    /**
     * Also emit a ramp for each color of the source combination, named by its
     * Wada name, or by its hex digits when unnamed. Default true.
     */
    ramps?: boolean;
}
/** Kebab-case slug of a color name: `Hermosa Pink` → `hermosa-pink`. */
export declare function slug(name: string): string;
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
export declare function toCssVariables(theme: Theme, options?: CssVariablesOptions): string;
/**
 * A Tailwind CSS v4 `@theme` block. The `--color-*` namespace makes every role
 * and ramp step a utility: `bg-background`, `text-text-muted`, `bg-accent`,
 * `text-on-accent`, `border-hermosa-pink-300`.
 * See https://tailwindcss.com/docs/theme.
 */
export declare function toTailwindTheme(theme: Theme, options?: EmitOptions): string;
/** Version of the W3C Design Tokens Community Group format `toDesignTokens` emits. */
export declare const DESIGN_TOKENS_FORMAT: {
    readonly version: "2025.10";
    readonly format: "https://www.designtokens.org/tr/2025.10/format/";
    readonly color: "https://www.designtokens.org/tr/2025.10/color/";
};
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
export declare function toDesignTokens(theme: Theme, options?: EmitOptions): Record<string, unknown>;
//# sourceMappingURL=theme.d.ts.map