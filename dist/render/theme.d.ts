/**
 * Theme preview: a small sample UI (heading, body text, muted text, a card on
 * the surface, and an accent button) drawn with a theme's colors, so a theme
 * can be judged by eye rather than only read as hex codes.
 */
import type { ThemeResult } from "../theme.js";
export interface ThemePreviewOptions {
    /** Heading in each sample. Default "A palette from Wada's dictionary". */
    heading?: string;
}
/**
 * An HTML fragment with one sample per theme, side by side, for
 * `renderHtml`'s `html` section field. A theme that could not be built shows
 * its reasons in place of a sample.
 */
export declare function renderThemePreview(themes: readonly ThemeResult[], options?: ThemePreviewOptions): string;
//# sourceMappingURL=theme.d.ts.map