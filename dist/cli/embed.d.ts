/**
 * Garment photos inlined into rendered cards, so a card file shows its photo
 * wherever it is opened.
 *
 * Product cards reference each garment photo by public URL. A browser blocks
 * every external fetch from an SVG shown as an image (a file preview, an
 * `<img>`, an artifact), and sandboxed HTML viewers block it by CSP, so a card
 * written to a file needs its photos inside it. Each photo is fetched once per
 * process, downscaled with `sharp`, and inlined as a JPEG data URI.
 *
 * Embedding never fails a render: without `sharp`, offline, or on any fetch
 * or decode error, the photo keeps its URL.
 */
/** Longest side of an inlined photo in pixels: twice the default 200px tile, for sharp screens. */
export declare const EMBED_SIZE = 400;
/** Set to `0` to skip embedding and keep photo URLs, for offline runs and tests. */
export declare const EMBED_ENV = "COLOR_PICKER_EMBED_IMAGES";
export interface EmbedOptions {
    /** Fetch implementation. Defaults to the global `fetch`. */
    fetch?: typeof fetch;
}
/**
 * Replace each remote `<image href>` in SVG or HTML markup with an inline
 * data URI. Markup without remote images comes back unchanged.
 */
export declare function embedImages(markup: string, options?: EmbedOptions): Promise<string>;
//# sourceMappingURL=embed.d.ts.map