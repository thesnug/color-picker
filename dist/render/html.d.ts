/**
 * HTML wrapper: a self-contained page of SVG sections for in-session review,
 * with a light and dark background toggle so a palette can be judged on both.
 */
export interface HtmlSection {
    /** Heading above the section. */
    title?: string;
    /** Rendered SVG markup from this module. Inserted as is, so pass trusted SVG only. */
    svg?: string;
    /**
     * Rendered HTML markup from this module, such as `renderThemePreview`.
     * Inserted as is after any SVG, so pass trusted markup only.
     */
    html?: string;
    /** A line of text under the SVG. */
    caption?: string;
    /** A short label shown as a badge beside the heading, such as a mood level. */
    badge?: string;
}
export interface HtmlOptions {
    /** Page title and top heading. Default "Color review". */
    title?: string;
    /** Starting background. Default follows the viewer's system setting. */
    theme?: "light" | "dark";
}
/**
 * Wrap SVG sections in one self-contained HTML page: no external requests
 * beyond any garment images the SVGs themselves reference.
 */
export declare function renderHtml(sections: readonly (HtmlSection | string)[], options?: HtmlOptions): string;
//# sourceMappingURL=html.d.ts.map