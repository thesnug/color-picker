/**
 * Accessibility checks for a combination of colors: WCAG 2.2 and APCA contrast
 * for the web, minimum separation for print, and collapse under color-vision
 * deficiency. Thresholds come from `assets/accessibility.json`; this file only
 * applies them. See docs/DESIGN.md, "Accessibility".
 */
import { type ColorInput, type Hex } from "./color/convert.js";
import { type Deficiency } from "./color/cvd.js";
import { type Accessibility } from "./data/index.js";
/** A color with an optional display name, used in `reasons`. */
export interface Swatch {
    hex: Hex;
    name?: string;
}
/** A color on its own, or a color with a name. */
export type SwatchInput = ColorInput | {
    hex: string;
    name?: string;
};
/** A list of colors, or a book combination given by its member color indexes. */
export type CombinationInput = readonly SwatchInput[] | {
    colors: readonly number[];
};
export type CheckContext = "web-text" | "web-ui" | "print";
export interface AccessibilityOptions {
    /** Thresholds to apply. Defaults to `assets/accessibility.json`. */
    rules?: Accessibility;
}
/**
 * Resolve a combination to swatches. Book combinations carry Wada names.
 *
 * @throws {RangeError} when a combination names a color index that does not exist.
 */
export declare function toSwatches(combination: CombinationInput): Swatch[];
/** `Hermosa Pink (#ffb3f0)`, or the hex alone when the color has no name. */
export declare function label(swatch: Swatch): string;
/**
 * The WCAG 2.2 level a contrast ratio meets. For text, `AA-large` means it meets
 * AA for large text only. For non-text UI and print, only `AA` exists.
 */
export type WcagLevel = "AAA" | "AA" | "AA-large" | "fail";
/** The most demanding APCA use a lightness contrast is enough for. */
export type ApcaLevel = "body-preferred" | "body" | "content" | "large" | "non-text" | "fail";
export declare function wcagLevel(ratio: number, context: CheckContext, options?: AccessibilityOptions): WcagLevel;
/** APCA level for an Lc of either polarity. */
export declare function apcaLevel(lc: number, options?: AccessibilityOptions): ApcaLevel;
export interface PairResult {
    /** The text or foreground color. APCA is measured with this as the text. */
    foreground: Swatch;
    background: Swatch;
    wcag: {
        ratio: number;
        level: WcagLevel;
    };
    apca: {
        lc: number;
        level: ApcaLevel;
    };
    /** OKLab distance, scaled so black to white is 100. */
    distance: number;
    /** Print only: true when the two colors are closer than the print minimum. */
    tooClose?: boolean;
    /** True when the pair meets the context's requirement: WCAG AA for web, separation for print. */
    passes: boolean;
    reasons: string[];
}
export interface CvdCollapse {
    a: Swatch;
    b: Swatch;
    /** Distance between the two colors as simulated. */
    distance: number;
    /** Distance between the two colors with typical vision. */
    normalDistance: number;
}
export interface CvdResult {
    deficiency: Deficiency;
    /** Unordered pairs that fall below the print minimum distance under this simulation. */
    collapsed: CvdCollapse[];
    reasons: string[];
}
export interface CheckResult {
    context: CheckContext;
    colors: Swatch[];
    /** Every ordered pair: n × (n − 1) entries for n colors. */
    pairs: PairResult[];
    cvd: CvdResult[];
    /**
     * For `print`, true when every pair is far enough apart. For the web contexts,
     * true when at least one pair is legible: a combination needs one good
     * foreground and background, not contrast between every member.
     */
    passes: boolean;
    /** True when no pair collapses under any simulated deficiency. */
    cvdSafe: boolean;
    reasons: string[];
}
/**
 * Check every ordered pair of a combination against the thresholds for a
 * context, and every unordered pair for collapse under each simulated
 * color-vision deficiency.
 *
 * - `web-text`: passes at WCAG AA for body text (4.5:1).
 * - `web-ui`: passes at WCAG AA for non-text contrast (3:1).
 * - `print`: passes when the pair is at least the print minimum distance apart.
 *
 * APCA is reported alongside for every context; it is advisory, not a pass
 * criterion, because WCAG 2.2 is the normative standard.
 */
export declare function check(combination: CombinationInput, { context, ...options }: AccessibilityOptions & {
    context: CheckContext;
}): CheckResult;
export interface RoleOptions extends AccessibilityOptions {
    /**
     * `light` requires a background lighter than the text, `dark` the reverse.
     * When omitted, whichever gives the best result wins.
     */
    mode?: "light" | "dark";
}
export interface RoleContrast {
    wcag: {
        ratio: number;
        level: WcagLevel;
    };
    apca: {
        lc: number;
        level: ApcaLevel;
    };
}
export type RoleAssignment = {
    ok: true;
    mode: "light" | "dark";
    background: Swatch;
    text: Swatch;
    /** Absent when no remaining color reaches non-text contrast against the background. */
    accent?: Swatch;
    contrast: {
        text: RoleContrast;
        accent?: RoleContrast;
    };
    reasons: string[];
} | {
    ok: false;
    reasons: string[];
};
/**
 * Suggest which color of a combination serves as background, text, and accent
 * for a web page.
 *
 * Text must meet WCAG AA for body text against the background; the accent must
 * meet WCAG AA non-text contrast (3:1) against it. Among legible assignments,
 * one with an accent beats one without, then higher text contrast wins, and the
 * accent is the most chromatic qualifying color. Reports, rather than throws,
 * when no legible assignment exists.
 */
export declare function roles(combination: CombinationInput, options?: RoleOptions): RoleAssignment;
/**
 * True when a garment is light enough for dark ink, by the print rules'
 * luminance cutoff. Light ink on a dark garment needs an underbase.
 */
export declare function allowsDarkInk(garment: ColorInput, options?: AccessibilityOptions): boolean;
//# sourceMappingURL=accessibility.d.ts.map